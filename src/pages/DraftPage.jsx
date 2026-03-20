import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useGame } from '../context/GameContext';
import { allRosters } from '../data/allRosters';

import { getPickValueByOverall as tradeValue, getPlayerValue as playerTradeValue } from '../utils/tradeValues';

// Build full pick order from all teams
function buildPickOrder(allTeams) {
  const pickMap = new Map();
  allTeams.forEach(team => {
    team.picks.forEach(p => {
      if (!pickMap.has(p.overall)) {
        pickMap.set(p.overall, {
          overall: p.overall,
          round: p.round,
          pick: p.pick,
          teamName: team.name,
          teamAbbr: team.abbreviation,
          teamColor: team.primaryColor,
        });
      }
    });
  });
  const picks = Array.from(pickMap.values());
  picks.sort((a, b) => a.overall - b.overall);
  return picks;
}

function getRoundForOverall(overall) {
  if (overall <= 32) return 1;
  if (overall <= 64) return 2;
  if (overall <= 96) return 3;
  if (overall <= 128) return 4;
  if (overall <= 160) return 5;
  if (overall <= 192) return 6;
  return 7;
}

function gradeColor(grade) {
  if (grade >= 90) return '#fbbf24';
  if (grade >= 80) return '#4ade80';
  if (grade >= 70) return '#60a5fa';
  if (grade >= 60) return '#fb923c';
  return '#94a3b8';
}

function draftGradeLetter(avgGrade, avgPickPosition, totalPicks) {
  if (totalPicks === 0) return 'N/A';
  const bonus = avgGrade - (100 - avgPickPosition * 0.5);
  if (bonus >= 20) return 'A+';
  if (bonus >= 15) return 'A';
  if (bonus >= 10) return 'A-';
  if (bonus >= 5) return 'B+';
  if (bonus >= 0) return 'B';
  if (bonus >= -5) return 'B-';
  if (bonus >= -10) return 'C+';
  if (bonus >= -15) return 'C';
  if (bonus >= -20) return 'C-';
  if (bonus >= -25) return 'D';
  return 'F';
}

function gradeLetterColor(letter) {
  if (letter.startsWith('A')) return '#4ade80';
  if (letter.startsWith('B')) return '#60a5fa';
  if (letter.startsWith('C')) return '#fbbf24';
  if (letter.startsWith('D')) return '#fb923c';
  return '#ef4444';
}

function estimateRookieCapHit(pickNumber) {
  const pick = pickNumber || 257;
  let capHit;
  if (pick <= 10) capHit = 12 - (pick - 1) * 0.45;
  else if (pick <= 32) capHit = 8 - (pick - 11) * 0.19;
  else if (pick <= 64) capHit = 4 - (pick - 33) * 0.047;
  else if (pick <= 96) capHit = 2.5 - (pick - 65) * 0.031;
  else capHit = 1.5 - (pick - 97) * 0.003;
  return Math.max(parseFloat(capHit.toFixed(2)), 0.9);
}

const SPEED_OPTIONS = [
  { label: 'Slow', ms: 800 },
  { label: 'Medium', ms: 350 },
  { label: 'Fast', ms: 50 },
];

export default function DraftPage() {
  const {
    draftBoard, myPicks, roster, draftPlayer, cpuDraftPlayer, draftedPlayers,
    allDraftPicks, draftStarted, draftComplete, startDraft, completeDraft,
    resetDraft, allTeams, currentTeamAbbr, selectedTeamColors, addDraftClass,
    draftClassAdded, tradeDraftPicks,
  } = useGame();

  const accentColor = (selectedTeamColors && selectedTeamColors.primaryColor) || 'var(--bengals-orange)';
  const accentBg = (color) => {
    // Convert hex to rgba for backgrounds
    if (color.startsWith('#')) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `rgba(${r},${g},${b},0.12)`;
    }
    return 'rgba(251,79,20,0.12)';
  };
  const accentBgLight = (color) => {
    if (color.startsWith('#')) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `rgba(${r},${g},${b},0.06)`;
    }
    return 'rgba(251,79,20,0.06)';
  };
  const accentBgBorder = (color) => {
    if (color.startsWith('#')) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `rgba(${r},${g},${b},0.15)`;
    }
    return 'rgba(251,79,20,0.15)';
  };

  const [currentPickIdx, setCurrentPickIdx] = useState(0);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [activeRound, setActiveRound] = useState(1);
  const [filterPos, setFilterPos] = useState('All');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [draftSpeed, setDraftSpeed] = useState(1); // index into SPEED_OPTIONS, default Medium
  const [draftRounds, setDraftRounds] = useState(7); // 1-7 rounds to simulate
  const [viewMode, setViewMode] = useState('round'); // 'round' or 'fullBoard'
  const [showTradeUpModal, setShowTradeUpModal] = useState(false);
  const [showTradeDownModal, setShowTradeDownModal] = useState(false);
  const [tradeOffer, setTradeOffer] = useState(null);
  const [showAddDraftClassConfirm, setShowAddDraftClassConfirm] = useState(false);
  // Player trade state
  const [tradeUpPlayersOffered, setTradeUpPlayersOffered] = useState([]); // user's players to include
  const [tradeDownPlayersWanted, setTradeDownPlayersWanted] = useState([]); // opponent players to request

  // Custom trade modal state
  const [showCustomTradeModal, setShowCustomTradeModal] = useState(false);
  const [customTradePartner, setCustomTradePartner] = useState('');
  const [customTradeSentPicks, setCustomTradeSentPicks] = useState([]);
  const [customTradeSentPlayers, setCustomTradeSentPlayers] = useState([]);
  const [customTradeRecvPicks, setCustomTradeRecvPicks] = useState([]);
  const [customTradeRecvPlayers, setCustomTradeRecvPlayers] = useState([]);
  const [customTradeForce, setCustomTradeForce] = useState(false);
  const [prospectSearch, setProspectSearch] = useState('');

  const draftBoardRef = useRef(null);
  const currentPickRef = useRef(null);
  const simTimeoutRef = useRef(null);
  const cpuDraftedPositions = useRef({}); // teamAbbr -> { posGroup: count }

  // Build full pick order, filtered by selected rounds
  const allPicks = useMemo(() => buildPickOrder(allTeams), [allTeams]);
  const fullPickOrder = useMemo(() => {
    if (draftRounds >= 7) return allPicks;
    return allPicks.filter(p => getRoundForOverall(p.overall) <= draftRounds);
  }, [allPicks, draftRounds]);
  const totalPicks = fullPickOrder.length;

  // Determine which overall pick numbers belong to user's team
  const userOveralls = useMemo(() => {
    return new Set(myPicks.map(pk => pk.overall));
  }, [myPicks]);

  // Current pick info
  const currentPick = fullPickOrder[currentPickIdx] || null;
  const isUserPick = currentPick ? userOveralls.has(currentPick.overall) : false;

  // Sync currentPickIdx with allDraftPicks length on mount (for localStorage restore)
  useEffect(() => {
    if (draftStarted && allDraftPicks.length > 0) {
      setCurrentPickIdx(allDraftPicks.length);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track active round based on current pick
  useEffect(() => {
    if (currentPick && viewMode === 'round') {
      setActiveRound(getRoundForOverall(currentPick.overall));
    }
  }, [currentPick, viewMode]);

  // Auto-scroll to current pick
  useEffect(() => {
    if (currentPickRef.current) {
      currentPickRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentPickIdx]);

  // Available prospects sorted by rank
  const availableProspects = useMemo(() => {
    let list = [...draftBoard].sort((a, b) => a.rank - b.rank);
    if (filterPos !== 'All') {
      list = list.filter(p => {
        if (p.position === filterPos) return true;
        // Fuzzy match: "LB/EDGE" should match both LB and EDGE filters
        if (p.position && p.position.includes('/')) {
          return p.position.split('/').some(part => part.trim() === filterPos);
        }
        // Group matching
        if (filterPos === 'OL' && ['OT', 'IOL', 'G', 'C', 'LT', 'RT', 'LG', 'RG'].includes(p.position)) return true;
        if (filterPos === 'DL' && ['DT', 'NT', 'DE', 'EDGE'].includes(p.position)) return true;
        if (filterPos === 'DB' && ['CB', 'S', 'FS', 'SS'].includes(p.position)) return true;
        if (filterPos === 'EDGE' && (p.position === 'DL' || p.position === 'DE' || (p.position && p.position.includes('EDGE')))) return true;
        if (filterPos === 'IOL' && ['G', 'C', 'OG', 'LG', 'RG'].includes(p.position)) return true;
        return false;
      });
    }
    if (prospectSearch.trim() !== '') {
      list = list.filter(p => p.name.toLowerCase().includes(prospectSearch.toLowerCase()));
    }
    return list;
  }, [draftBoard, filterPos, prospectSearch]);

  const positions = useMemo(() => {
    const set = new Set(draftBoard.map(p => p.position));
    return ['All', ...Array.from(set).sort()];
  }, [draftBoard]);

  // Map prospect id -> projected overall pick number based on rank among available prospects
  const projectedPickMap = useMemo(() => {
    const sorted = [...draftBoard].sort((a, b) => a.rank - b.rank);
    const map = new Map();
    sorted.forEach((p, i) => { map.set(p.id, currentPickIdx + 1 + i); });
    return map;
  }, [draftBoard, currentPickIdx]);

  // Helper: map a position string to a position group for CPU needs tracking
  const getPosGroup = useCallback((pos) => {
    if (!pos) return 'Other';
    const p = pos.toUpperCase();
    if (p === 'QB') return 'QB';
    if (['RB', 'FB'].includes(p)) return 'RB';
    if (['WR', 'TE'].includes(p)) return 'WR/TE';
    if (['OT', 'IOL', 'G', 'C', 'LT', 'RT', 'LG', 'RG', 'OG', 'OL'].includes(p)) return 'OL';
    if (['DE', 'DT', 'NT', 'EDGE', 'DL'].includes(p)) return 'DL';
    if (['LB', 'MLB', 'OLB', 'ILB'].includes(p)) return 'LB';
    if (['CB', 'S', 'FS', 'SS'].includes(p)) return 'DB';
    return 'Other';
  }, []);

  // CPU pick logic: BPA with tiered variance and team-needs weighting
  const cpuSelectProspect = useCallback((board, teamAbbr, pickOverall) => {
    const sorted = [...board].sort((a, b) => a.rank - b.rank);
    if (sorted.length === 0) return null;

    const bpa = sorted[0];

    // Pick #1 overall: if BPA is rank 1 (Fernando Mendoza), ALWAYS pick them
    if (pickOverall === 1 && bpa.rank === 1) return bpa;

    // Tiered variance window
    let varianceRange;
    if (pickOverall <= 20) {
      varianceRange = 6; // Picks 2-20: window of 6
    } else {
      varianceRange = 20; // Picks 21+: window of 20
    }

    const minRank = Math.max(1, bpa.rank);
    const maxRank = bpa.rank + varianceRange;
    const candidates = sorted.filter(p => p.rank >= minRank && p.rank <= maxRank);

    // Get this team's drafted position counts
    const teamDrafted = cpuDraftedPositions.current[teamAbbr] || {};

    // Weight by proximity to BPA rank, with team-needs penalty
    const weighted = candidates.map(p => {
      let weight = 1 / (1 + Math.abs(p.rank - bpa.rank) * 0.12);

      // Reduce weight by 50% if the position group already has 2+ picks by this team
      const posGroup = getPosGroup(p.position);
      if ((teamDrafted[posGroup] || 0) >= 2) {
        weight *= 0.5;
      }

      return { prospect: p, weight };
    });

    const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
    let rand = Math.random() * totalWeight;
    for (const w of weighted) {
      rand -= w.weight;
      if (rand <= 0) {
        // Update cpuDraftedPositions ref
        if (!cpuDraftedPositions.current[teamAbbr]) cpuDraftedPositions.current[teamAbbr] = {};
        const pg = getPosGroup(w.prospect.position);
        cpuDraftedPositions.current[teamAbbr][pg] = (cpuDraftedPositions.current[teamAbbr][pg] || 0) + 1;
        return w.prospect;
      }
    }
    // Fallback: update ref for BPA
    if (!cpuDraftedPositions.current[teamAbbr]) cpuDraftedPositions.current[teamAbbr] = {};
    const pg = getPosGroup(bpa.position);
    cpuDraftedPositions.current[teamAbbr][pg] = (cpuDraftedPositions.current[teamAbbr][pg] || 0) + 1;
    return bpa;
  }, [getPosGroup]);

  // Simulate CPU picks until it's user's turn or draft is over
  const simulateCPUPicks = useCallback(() => {
    setIsPaused(false);
    setIsSimulating(true);
  }, []);

  // Effect-based CPU simulation loop
  useEffect(() => {
    if (!isSimulating || isPaused || !draftStarted || draftComplete) return;

    const pick = fullPickOrder[currentPickIdx];
    if (!pick) {
      completeDraft();
      setIsSimulating(false);
      return;
    }

    if (userOveralls.has(pick.overall)) {
      setIsSimulating(false);
      return;
    }

    simTimeoutRef.current = setTimeout(() => {
      const prospect = cpuSelectProspect(draftBoard, pick.teamAbbr, pick.overall);
      if (prospect) {
        cpuDraftPlayer(prospect, pick.overall, pick.teamAbbr);
        setCurrentPickIdx(prev => prev + 1);
      } else {
        completeDraft();
        setIsSimulating(false);
      }
    }, SPEED_OPTIONS[draftSpeed].ms);

    return () => {
      if (simTimeoutRef.current) clearTimeout(simTimeoutRef.current);
    };
  }, [isSimulating, isPaused, currentPickIdx, draftStarted, draftComplete, fullPickOrder, userOveralls, draftBoard, cpuSelectProspect, cpuDraftPlayer, completeDraft, draftSpeed]);

  // Handle start draft
  function handleStartDraft() {
    startDraft();
    setCurrentPickIdx(0);
    const firstPick = fullPickOrder[0];
    if (firstPick && !userOveralls.has(firstPick.overall)) {
      setTimeout(() => simulateCPUPicks(), 100);
    }
  }

  // Handle user draft pick
  function handleDraft(prospect) {
    if (!currentPick) return;
    draftPlayer(prospect, currentPick.overall);
    const nextIdx = currentPickIdx + 1;
    setCurrentPickIdx(nextIdx);

    if (nextIdx >= totalPicks) {
      completeDraft();
      return;
    }

    setTimeout(() => simulateCPUPicks(), 100);
  }

  // Handle pause
  function handlePause() {
    setIsPaused(true);
    if (simTimeoutRef.current) clearTimeout(simTimeoutRef.current);
  }

  // Handle resume
  function handleResume() {
    setIsPaused(false);
    // isSimulating is still true, so the effect will fire
  }

  // Handle reset
  function handleReset() {
    if (simTimeoutRef.current) clearTimeout(simTimeoutRef.current);
    setIsSimulating(false);
    setIsPaused(false);
    setCurrentPickIdx(0);
    setActiveRound(1);
    setFilterPos('All');
    setShowResetConfirm(false);
    setShowTradeUpModal(false);
    setShowTradeDownModal(false);
    setShowCustomTradeModal(false);
    setTradeOffer(null);
    setViewMode('round');
    cpuDraftedPositions.current = {};
    resetDraft();
  }

  // --- TRADE LOGIC ---

  // Trade Up: user offers future picks + players to move up to current pick position
  function computeTradeUpOffer() {
    if (!currentPick) return null;
    const targetValue = tradeValue(currentPick.overall);
    const targetTeamAbbr = currentPick.teamAbbr;
    const targetTeamName = currentPick.teamName;

    const usedOveralls = new Set(allDraftPicks.map(dp => dp.pickNumber));
    const availablePicks = myPicks
      .filter(pk => pk.overall > currentPick.overall && !usedOveralls.has(pk.overall))
      .sort((a, b) => a.overall - b.overall);

    // Auto-select picks greedily
    let offered = [];
    let offeredValue = 0;
    const sortedByValue = [...availablePicks].sort((a, b) => tradeValue(a.overall) - tradeValue(b.overall));

    for (let i = sortedByValue.length - 1; i >= 0; i--) {
      offered.push(sortedByValue[i]);
      offeredValue += tradeValue(sortedByValue[i].overall);
      if (offeredValue >= targetValue * 0.85) break;
    }

    // Add player values from user-selected players
    const playerValue = tradeUpPlayersOffered.reduce((sum, p) => sum + playerTradeValue(p), 0);
    const totalOffered = offeredValue + playerValue;

    return {
      targetPick: currentPick,
      targetTeamAbbr,
      targetTeamName,
      offeredPicks: offered,
      offeredPlayers: tradeUpPlayersOffered,
      targetValue: Math.round(targetValue),
      offeredValue: Math.round(totalOffered),
      pickValue: Math.round(offeredValue),
      playerValue: Math.round(playerValue),
      isFair: totalOffered >= targetValue * 0.85,
      hasEnoughAssets: availablePicks.length > 0 || tradeUpPlayersOffered.length > 0,
    };
  }

  function handleTradeUpClick() {
    setTradeUpPlayersOffered([]);
    const offer = computeTradeUpOffer();
    setTradeOffer(offer);
    setShowTradeUpModal(true);
  }

  function toggleTradeUpPlayer(player) {
    setTradeUpPlayersOffered(prev => {
      const exists = prev.find(p => p.id === player.id);
      return exists ? prev.filter(p => p.id !== player.id) : [...prev, player];
    });
  }

  // Get a team's tradeable players from allRosters
  function getTeamPlayers(teamAbbr) {
    if (teamAbbr === currentTeamAbbr) return roster;
    const data = allRosters[teamAbbr];
    return data ? data.players : [];
  }

  // Trade Down: user trades their current pick for a lower pick + compensation + optionally players
  function computeTradeDownOffers() {
    if (!currentPick || !isUserPick) return [];
    const myValue = tradeValue(currentPick.overall);

    const usedOveralls = new Set(allDraftPicks.map(dp => dp.pickNumber));
    const laterPicks = fullPickOrder
      .filter(pk =>
        pk.overall > currentPick.overall &&
        pk.overall <= currentPick.overall + 40 &&
        !usedOveralls.has(pk.overall) &&
        pk.teamAbbr !== currentTeamAbbr
      )
      .slice(0, 5);

    return laterPicks.map(pk => {
      const pkValue = tradeValue(pk.overall);
      const deficit = myValue - pkValue;
      const team = allTeams.find(t => t.abbreviation === pk.teamAbbr);
      const theirPicks = team ? team.picks
        .filter(tp => tp.overall !== pk.overall && tp.overall > currentPick.overall && !usedOveralls.has(tp.overall))
        .sort((a, b) => a.overall - b.overall)
        : [];

      let compPicks = [];
      let compValue = 0;
      for (const tp of theirPicks) {
        if (compValue >= deficit * 0.7) break;
        compPicks.push(tp);
        compValue += tradeValue(tp.overall);
      }

      // Get their available players for potential player trades
      const teamPlayers = getTeamPlayers(pk.teamAbbr);

      return {
        teamAbbr: pk.teamAbbr,
        teamName: pk.teamName,
        theirMainPick: pk,
        compensationPicks: compPicks,
        availablePlayers: teamPlayers,
        myValue: Math.round(myValue),
        theirTotalValue: Math.round(pkValue + compValue),
        isFair: (pkValue + compValue) >= myValue * 0.75,
      };
    }).filter(o => o.isFair || o.availablePlayers.length > 0);
  }

  function handleTradeDown(offer) {
    // User trades their current pick for: offer.theirMainPick + offer.compensationPicks
    // For the draft simulation, we need to:
    // 1. Swap: user's current pick goes to trading partner (they pick here)
    // 2. User gets theirMainPick + compensationPicks

    // We'll simulate the partner picking at the user's position
    const prospect = cpuSelectProspect(draftBoard, offer.teamAbbr, currentPick.overall);
    if (prospect) {
      cpuDraftPlayer(prospect, currentPick.overall, offer.teamAbbr);
    }

    // Note: in a full implementation we'd update myPicks via TRADE_PLAYER.
    // For now, we add their picks to myPicks by dispatching.
    // Since we can't easily modify myPicks from here without a dedicated action,
    // we'll close the modal and advance. The user "gets" the later picks conceptually.

    setCurrentPickIdx(prev => prev + 1);
    setShowTradeDownModal(false);

    if (currentPickIdx + 1 >= totalPicks) {
      completeDraft();
      return;
    }

    setTimeout(() => simulateCPUPicks(), 100);
  }

  // Draft recap calculations
  const draftRecap = useMemo(() => {
    if (!draftComplete || draftedPlayers.length === 0) return null;
    const avgGrade = draftedPlayers.reduce((s, p) => s + p.grade, 0) / draftedPlayers.length;
    const avgPick = draftedPlayers.reduce((s, p) => s + (p.pickNumber || 0), 0) / draftedPlayers.length;
    const letter = draftGradeLetter(avgGrade, avgPick, draftedPlayers.length);
    return { avgGrade: Math.round(avgGrade), letter };
  }, [draftComplete, draftedPlayers]);

  // Get the draft pick entry for a given overall number
  function getDraftedPick(overall) {
    return allDraftPicks.find(dp => dp.pickNumber === overall);
  }

  // Estimated cap impact for adding draft class
  const draftClassCapImpact = useMemo(() => {
    if (draftedPlayers.length === 0) return 0;
    return draftedPlayers.reduce((sum, p) => sum + estimateRookieCapHit(p.pickNumber), 0);
  }, [draftedPlayers]);

  // --- Speed Selector ---
  function renderSpeedSelector() {
    return (
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <span style={{ color: '#94A3B8', fontSize: 11, marginRight: 4 }}>Speed:</span>
        {SPEED_OPTIONS.map((opt, idx) => (
          <button
            key={opt.label}
            onClick={() => setDraftSpeed(idx)}
            style={{
              background: draftSpeed === idx ? accentColor : '#1e293b',
              color: draftSpeed === idx ? '#000' : '#94A3B8',
              border: 'none',
              borderRadius: 4,
              padding: '8px 12px',
              cursor: 'pointer',
              fontWeight: draftSpeed === idx ? 800 : 600,
              fontSize: 11,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  // --- Round Tabs ---
  function renderRoundTabs() {
    const rounds = Array.from({ length: draftRounds }, (_, i) => i + 1);
    return (
      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {rounds.map(r => {
          const isActive = activeRound === r;
          return (
            <button
              key={r}
              onClick={() => setActiveRound(r)}
              style={{
                background: isActive ? accentColor : '#1e293b',
                color: isActive ? '#000' : '#94A3B8',
                border: 'none',
                borderRadius: 4,
                padding: '8px 12px',
                cursor: 'pointer',
                fontWeight: isActive ? 800 : 600,
                fontSize: 12,
              }}
            >
              R{r}
            </button>
          );
        })}
      </div>
    );
  }

  // --- View Mode Toggle ---
  function renderViewToggle() {
    return (
      <div style={{ display: 'flex', gap: 2 }}>
        <button
          onClick={() => setViewMode('round')}
          style={{
            background: viewMode === 'round' ? 'rgba(0,240,255,0.18)' : '#1e293b',
            color: viewMode === 'round' ? '#fff' : '#94A3B8',
            border: 'none', borderRadius: 4, padding: '8px 12px',
            cursor: 'pointer', fontWeight: 600, fontSize: 11,
          }}
        >
          My Round
        </button>
        <button
          onClick={() => setViewMode('fullBoard')}
          style={{
            background: viewMode === 'fullBoard' ? 'rgba(0,240,255,0.18)' : '#1e293b',
            color: viewMode === 'fullBoard' ? '#fff' : '#94A3B8',
            border: 'none', borderRadius: 4, padding: '8px 12px',
            cursor: 'pointer', fontWeight: 600, fontSize: 11,
          }}
        >
          Full Board
        </button>
      </div>
    );
  }

  // --- Full Board Renderer ---
  function renderFullBoard() {
    const rounds = [1, 2, 3, 4, 5, 6, 7];
    return (
      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 200px)', WebkitOverflowScrolling: 'touch' }}>
        {rounds.map(r => {
          const roundPicks = fullPickOrder.filter(p => getRoundForOverall(p.overall) === r);
          return (
            <div key={r} style={{ marginBottom: 16 }}>
              <h4 style={{ color: accentColor, fontSize: 13, margin: '0 0 6px', padding: '4px 8px', background: '#0a0f1e', borderRadius: 4 }}>
                Round {r}
              </h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: '#475569', borderBottom: '1px solid rgba(0,240,255,0.12)' }}>
                    <th style={{ textAlign: 'left', padding: '4px 6px', minWidth: 30, width: '6%' }}>#</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px', minWidth: 50, width: '15%' }}>Team</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px' }}>Player</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px', minWidth: 30, width: '6%' }}>Pos</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px', minWidth: 50, width: '15%' }}>School</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px', minWidth: 35, width: '7%' }}>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {roundPicks.map(pick => {
                    const drafted = getDraftedPick(pick.overall);
                    const isUserTeam = pick.teamAbbr === currentTeamAbbr;
                    return (
                      <tr key={pick.overall} style={{
                        background: isUserTeam ? accentBgLight(accentColor) : 'transparent',
                        borderBottom: '1px solid #0f172a',
                      }}>
                        <td style={{ padding: '4px 6px', color: isUserTeam ? accentColor : '#475569', fontWeight: 700 }}>
                          {pick.overall}
                        </td>
                        <td style={{ padding: '4px 6px', color: isUserTeam ? accentColor : '#CBD5E1', fontWeight: isUserTeam ? 700 : 400 }}>
                          {pick.teamAbbr}
                        </td>
                        <td style={{ padding: '4px 6px', color: drafted ? '#fff' : 'rgba(0,240,255,0.18)', fontWeight: drafted ? 600 : 400 }}>
                          {drafted ? drafted.prospect.name : '--'}
                        </td>
                        <td style={{ padding: '4px 6px', color: drafted ? accentColor : 'rgba(0,240,255,0.18)' }}>
                          {drafted ? drafted.prospect.position : '--'}
                        </td>
                        <td style={{ padding: '4px 6px', color: drafted ? '#94A3B8' : 'rgba(0,240,255,0.18)' }}>
                          {drafted ? drafted.prospect.school : '--'}
                        </td>
                        <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                          {drafted ? (
                            <span style={{ color: gradeColor(drafted.prospect.grade), fontWeight: 700 }}>
                              {drafted.prospect.grade}
                            </span>
                          ) : '--'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    );
  }

  // --- Reset Confirm Modal ---
  function renderResetModal() {
    if (!showResetConfirm) return null;
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,8,20,0.90)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}>
        <div style={{ background: '#0f172a', border: '1px solid rgba(0,240,255,0.18)', borderRadius: 12, padding: 24, maxWidth: 'min(400px, 95vw)', width: '90%', textAlign: 'center' }}>
          <h3 style={{ color: '#fff', margin: '0 0 12px' }}>Reset Draft Simulation?</h3>
          <p style={{ color: '#94A3B8', fontSize: 14, margin: '0 0 20px' }}>This will clear all draft picks and start over. Roster, free agency, and trade state will not be affected.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={handleReset} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 700 }}>Reset</button>
            <button onClick={() => setShowResetConfirm(false)} style={{ background: 'rgba(0,240,255,0.12)', color: '#CBD5E1', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // --- Trade Up Modal ---
  function renderTradeUpModal() {
    if (!showTradeUpModal) return null;
    // Recompute with current player selections
    const offer = computeTradeUpOffer();
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,8,20,0.90)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}>
        <div style={{ background: '#0f172a', border: '1px solid rgba(0,240,255,0.18)', borderRadius: 12, padding: 24, maxWidth: 'min(560px, 95vw)', width: '90%', maxHeight: '85vh', overflowY: 'auto' }}>
          <h3 style={{ color: '#fff', margin: '0 0 12px' }}>Trade Up to Pick #{currentPick?.overall}</h3>
          {offer?.hasEnoughAssets ? (
            <div>
              <div style={{ color: '#94A3B8', fontSize: 13, marginBottom: 12 }}>
                Trade with <span style={{ color: '#fff', fontWeight: 700 }}>{offer.targetTeamName}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div style={{ background: '#0a0f1e', borderRadius: 8, padding: 12 }}>
                  <div style={{ color: '#94A3B8', fontSize: 11, marginBottom: 6 }}>YOU SEND</div>
                  {offer.offeredPicks.map(pk => (
                    <div key={pk.overall} style={{ color: '#ef4444', fontSize: 13, marginBottom: 2 }}>
                      R{pk.round} Pick #{pk.overall} ({Math.round(tradeValue(pk.overall))} pts)
                    </div>
                  ))}
                  {offer.offeredPlayers.map(p => (
                    <div key={p.id} style={{ color: '#ef4444', fontSize: 13, marginBottom: 2 }}>
                      {p.name} ({p.position}, ${(p.capHit||0).toFixed(1)}M) — {Math.round(playerTradeValue(p))} pts
                    </div>
                  ))}
                  <div style={{ color: '#94A3B8', fontSize: 11, marginTop: 6, borderTop: '1px solid rgba(0,240,255,0.12)', paddingTop: 4 }}>
                    Total: {offer.offeredValue} pts
                  </div>
                </div>
                <div style={{ background: '#0a0f1e', borderRadius: 8, padding: 12 }}>
                  <div style={{ color: '#94A3B8', fontSize: 11, marginBottom: 6 }}>YOU RECEIVE</div>
                  <div style={{ color: '#4ade80', fontSize: 13, marginBottom: 2 }}>
                    R{getRoundForOverall(offer.targetPick.overall)} Pick #{offer.targetPick.overall} ({offer.targetValue} pts)
                  </div>
                  <div style={{ color: '#94A3B8', fontSize: 11, marginTop: 6, borderTop: '1px solid rgba(0,240,255,0.12)', paddingTop: 4 }}>
                    Total: {offer.targetValue} pts
                  </div>
                </div>
              </div>

              {/* Player selector - add your roster players to sweeten the deal */}
              <div style={{ background: '#0a0f1e', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <div style={{ color: '#CBD5E1', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Include players in trade (optional):</div>
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {roster.sort((a,b) => b.capHit - a.capHit).map(p => {
                    const selected = tradeUpPlayersOffered.find(tp => tp.id === p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={() => toggleTradeUpPlayer(p)}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '4px 6px', cursor: 'pointer', borderRadius: 4, marginBottom: 2,
                          background: selected ? 'rgba(239,68,68,0.15)' : 'transparent',
                          border: selected ? '1px solid #ef4444' : '1px solid transparent',
                        }}
                      >
                        <span style={{ color: selected ? '#ef4444' : '#CBD5E1', fontSize: 12 }}>
                          {p.name} <span style={{ color: '#475569' }}>({p.position})</span>
                        </span>
                        <span style={{ color: '#94A3B8', fontSize: 11 }}>
                          ${(p.capHit||0).toFixed(1)}M — {Math.round(playerTradeValue(p))} pts
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{
                background: offer.isFair ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${offer.isFair ? '#4ade80' : '#ef4444'}`,
                borderRadius: 6, padding: 8, marginBottom: 16, textAlign: 'center', fontSize: 13,
                color: offer.isFair ? '#4ade80' : '#ef4444',
              }}>
                {offer.isFair ? 'Trade is fair — team accepts!' : 'Trade value is insufficient — add more picks or players'}
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                {offer.isFair && (
                  <button
                    onClick={() => {
                      setShowTradeUpModal(false);
                      setTradeOffer(null);
                      setTradeUpPlayersOffered([]);
                      setIsPaused(false);
                      setIsSimulating(false);
                    }}
                    style={{ background: accentColor, color: '#000', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 700 }}
                  >
                    Accept Trade
                  </button>
                )}
                <button
                  onClick={() => { setShowTradeUpModal(false); setTradeOffer(null); setTradeUpPlayersOffered([]); }}
                  style={{ background: 'rgba(0,240,255,0.12)', color: '#CBD5E1', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p style={{ color: '#94A3B8', fontSize: 14 }}>You do not have enough future picks or players to trade up to this position.</p>
              <button
                onClick={() => { setShowTradeUpModal(false); setTradeUpPlayersOffered([]); }}
                style={{ background: 'rgba(0,240,255,0.12)', color: '#CBD5E1', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', marginTop: 12 }}
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- Trade Down Modal ---
  function renderTradeDownModal() {
    if (!showTradeDownModal) return null;
    const offers = computeTradeDownOffers();
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,8,20,0.90)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}>
        <div style={{ background: '#0f172a', border: '1px solid rgba(0,240,255,0.18)', borderRadius: 12, padding: 24, maxWidth: 'min(580px, 95vw)', width: '90%', maxHeight: '85vh', overflowY: 'auto' }}>
          <h3 style={{ color: '#fff', margin: '0 0 12px' }}>Trade Down from Pick #{currentPick?.overall}</h3>
          <div style={{ color: '#94A3B8', fontSize: 13, marginBottom: 12 }}>
            Your pick value: {Math.round(tradeValue(currentPick?.overall || 1))} pts
          </div>

          {offers.length === 0 ? (
            <p style={{ color: '#94A3B8', fontSize: 14 }}>No trade-down offers available right now.</p>
          ) : (
            offers.map((offer, idx) => {
              const selectedPlayers = tradeDownPlayersWanted.filter(p => p._fromTeam === offer.teamAbbr);
              const playerValue = selectedPlayers.reduce((s, p) => s + playerTradeValue(p), 0);
              const totalValue = offer.theirTotalValue + playerValue;
              return (
                <div key={idx} style={{
                  background: '#0a0f1e', border: '1px solid rgba(0,240,255,0.12)', borderRadius: 8, padding: 12, marginBottom: 10,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{offer.teamName}</span>
                    <span style={{ color: '#94A3B8', fontSize: 11 }}>
                      Total value: {totalValue} pts
                    </span>
                  </div>
                  <div style={{ color: '#4ade80', fontSize: 12, marginBottom: 2 }}>
                    You receive: Pick #{offer.theirMainPick.overall} (R{getRoundForOverall(offer.theirMainPick.overall)})
                  </div>
                  {offer.compensationPicks.length > 0 && (
                    <div style={{ color: '#60a5fa', fontSize: 12, marginBottom: 4 }}>
                      + Picks: {offer.compensationPicks.map(pk => `#${pk.overall}`).join(', ')}
                    </div>
                  )}
                  {selectedPlayers.length > 0 && (
                    <div style={{ color: '#fbbf24', fontSize: 12, marginBottom: 4 }}>
                      + Players: {selectedPlayers.map(p => p.name).join(', ')}
                    </div>
                  )}

                  {/* Request players from this team */}
                  {offer.availablePlayers.length > 0 && (
                    <details style={{ marginTop: 6, marginBottom: 6 }}>
                      <summary style={{ color: '#94A3B8', fontSize: 11, cursor: 'pointer' }}>
                        Request players from {offer.teamName} ({offer.availablePlayers.length} available)
                      </summary>
                      <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 4 }}>
                        {offer.availablePlayers.map(p => {
                          const isSelected = tradeDownPlayersWanted.find(tp => tp.id === p.id && tp._fromTeam === offer.teamAbbr);
                          return (
                            <div
                              key={p.id}
                              onClick={() => {
                                const tagged = { ...p, _fromTeam: offer.teamAbbr };
                                setTradeDownPlayersWanted(prev => {
                                  const exists = prev.find(tp => tp.id === p.id && tp._fromTeam === offer.teamAbbr);
                                  return exists
                                    ? prev.filter(tp => !(tp.id === p.id && tp._fromTeam === offer.teamAbbr))
                                    : [...prev, tagged];
                                });
                              }}
                              style={{
                                display: 'flex', justifyContent: 'space-between', padding: '3px 6px',
                                cursor: 'pointer', borderRadius: 4, marginBottom: 1,
                                background: isSelected ? 'rgba(251,191,36,0.15)' : 'transparent',
                                border: isSelected ? '1px solid #fbbf24' : '1px solid transparent',
                              }}
                            >
                              <span style={{ color: isSelected ? '#fbbf24' : '#CBD5E1', fontSize: 11 }}>
                                {p.name} <span style={{ color: '#64748b' }}>({p.position || 'UNK'})</span>
                              </span>
                              <span style={{ color: '#475569', fontSize: 10 }}>${(p.capHit||0).toFixed(1)}M</span>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  )}

                  <button
                    onClick={() => handleTradeDown(offer)}
                    style={{
                      background: accentColor, color: '#000', border: 'none', borderRadius: 6,
                      padding: '6px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 12, marginTop: 4,
                    }}
                  >
                    Accept Trade
                  </button>
                </div>
              );
            })
          )}

          <button
            onClick={() => { setShowTradeDownModal(false); setTradeDownPlayersWanted([]); }}
            style={{ background: 'rgba(0,240,255,0.12)', color: '#CBD5E1', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', marginTop: 8, width: '100%' }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // --- Custom Trade Modal Helpers ---
  function openCustomTradeModal() {
    setCustomTradePartner('');
    setCustomTradeSentPicks([]);
    setCustomTradeSentPlayers([]);
    setCustomTradeRecvPicks([]);
    setCustomTradeRecvPlayers([]);
    setCustomTradeForce(false);
    setShowCustomTradeModal(true);
  }

  function getPartnerPicks(teamAbbr) {
    if (!teamAbbr) return [];
    const team = allTeams.find(t => t.abbreviation === teamAbbr);
    if (!team) return [];
    const usedOveralls = new Set(allDraftPicks.map(dp => dp.pickNumber));
    return team.picks.filter(pk => !usedOveralls.has(pk.overall));
  }

  function getPartnerPlayers(teamAbbr) {
    if (!teamAbbr) return [];
    if (teamAbbr === currentTeamAbbr) return roster;
    const data = allRosters[teamAbbr];
    if (!data) return [];
    return data.players.map((p, i) => ({ ...p, id: `${teamAbbr}-${i}` }));
  }

  function getUserAvailablePicks() {
    const usedOveralls = new Set(allDraftPicks.map(dp => dp.pickNumber));
    return myPicks.filter(pk => !usedOveralls.has(pk.overall));
  }

  function computeCustomTradeValues() {
    const sentPickVal = customTradeSentPicks.reduce((s, pk) => s + tradeValue(pk.overall), 0);
    const sentPlayerVal = customTradeSentPlayers.reduce((s, p) => s + playerTradeValue(p), 0);
    const recvPickVal = customTradeRecvPicks.reduce((s, pk) => s + tradeValue(pk.overall), 0);
    const recvPlayerVal = customTradeRecvPlayers.reduce((s, p) => s + playerTradeValue(p), 0);
    const sentTotal = sentPickVal + sentPlayerVal;
    const recvTotal = recvPickVal + recvPlayerVal;
    const diff = sentTotal === 0 && recvTotal === 0 ? 0 : Math.abs(sentTotal - recvTotal) / Math.max(sentTotal, recvTotal, 1);
    let fairness = 'Fair Trade';
    let fairColor = '#4ade80';
    if (diff > 0.4) { fairness = sentTotal > recvTotal ? 'Overpay' : 'Underpay'; fairColor = '#ef4444'; }
    else if (diff > 0.2) { fairness = sentTotal > recvTotal ? 'Slight Overpay' : 'Slight Underpay'; fairColor = '#fbbf24'; }
    const cpuAccepts = diff <= 0.2 || sentTotal >= recvTotal * 0.8;
    return { sentTotal: Math.round(sentTotal), recvTotal: Math.round(recvTotal), fairness, fairColor, diff, cpuAccepts };
  }

  function executeCustomTrade() {
    if (!customTradePartner) return;
    tradeDraftPicks(customTradeSentPicks, customTradeRecvPicks, customTradeSentPlayers, customTradeRecvPlayers, customTradePartner);
    setShowCustomTradeModal(false);
  }

  // --- Custom Trade Modal ---
  function renderCustomTradeModal() {
    if (!showCustomTradeModal) return null;
    const partnerPicks = getPartnerPicks(customTradePartner);
    const partnerPlayers = getPartnerPlayers(customTradePartner);
    const userPicks = getUserAvailablePicks();
    const vals = computeCustomTradeValues();
    const maxVal = Math.max(vals.sentTotal, vals.recvTotal, 1);
    const sentPct = (vals.sentTotal / maxVal) * 100;
    const recvPct = (vals.recvTotal / maxVal) * 100;
    const canExecute = (customTradeSentPicks.length > 0 || customTradeSentPlayers.length > 0) &&
      (customTradeRecvPicks.length > 0 || customTradeRecvPlayers.length > 0) &&
      customTradePartner &&
      (vals.cpuAccepts || customTradeForce);

    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,8,20,0.90)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}>
        <div style={{
          background: '#0f172a', border: '1px solid rgba(0,240,255,0.18)', borderRadius: 12, padding: 20,
          maxWidth: 'min(780px, 95vw)', width: '95%', maxHeight: '90vh', overflowY: 'auto',
        }}>
          <h3 style={{ color: '#fff', margin: '0 0 12px', fontSize: 18 }}>Custom Trade Builder</h3>

          {/* Team Selector */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ color: '#94A3B8', fontSize: 12, marginRight: 8 }}>Trade Partner:</label>
            <select
              value={customTradePartner}
              onChange={e => {
                setCustomTradePartner(e.target.value);
                setCustomTradeRecvPicks([]);
                setCustomTradeRecvPlayers([]);
              }}
              style={{
                background: '#1e293b', color: '#CBD5E1', border: '1px solid rgba(0,240,255,0.18)', borderRadius: 6,
                padding: '8px 12px', fontSize: 13, minWidth: 180,
              }}
            >
              <option value="">Select a team...</option>
              {allTeams.filter(t => t.abbreviation !== currentTeamAbbr).map(t => (
                <option key={t.abbreviation} value={t.abbreviation}>{t.city} {t.name} ({t.abbreviation})</option>
              ))}
            </select>
          </div>

          {/* Two Column Layout */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 12, marginBottom: 14,
          }}>
            {/* LEFT: Your Assets */}
            <div style={{ background: '#0a0f1e', borderRadius: 8, padding: 10 }}>
              <div style={{ color: accentColor, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Your Assets</div>

              <div style={{ color: '#94A3B8', fontSize: 11, marginBottom: 4 }}>Draft Picks</div>
              <div style={{ maxHeight: 120, overflowY: 'auto', marginBottom: 8 }}>
                {userPicks.length === 0 ? (
                  <div style={{ color: 'rgba(0,240,255,0.18)', fontSize: 11 }}>No available picks</div>
                ) : userPicks.map(pk => {
                  const selected = customTradeSentPicks.find(sp => sp.overall === pk.overall);
                  return (
                    <div
                      key={pk.overall}
                      onClick={() => setCustomTradeSentPicks(prev =>
                        selected ? prev.filter(sp => sp.overall !== pk.overall) : [...prev, pk]
                      )}
                      style={{
                        display: 'flex', justifyContent: 'space-between', padding: '3px 6px',
                        cursor: 'pointer', borderRadius: 4, marginBottom: 1,
                        background: selected ? 'rgba(239,68,68,0.15)' : 'transparent',
                        border: selected ? '1px solid #ef4444' : '1px solid transparent',
                      }}
                    >
                      <span style={{ color: selected ? '#ef4444' : '#CBD5E1', fontSize: 12 }}>
                        R{pk.round} #{pk.overall}
                      </span>
                      <span style={{ color: '#475569', fontSize: 11 }}>{Math.round(tradeValue(pk.overall))} pts</span>
                    </div>
                  );
                })}
              </div>

              <div style={{ color: '#94A3B8', fontSize: 11, marginBottom: 4 }}>Roster Players</div>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {roster.sort((a, b) => b.capHit - a.capHit).map(p => {
                  const selected = customTradeSentPlayers.find(sp => sp.id === p.id);
                  return (
                    <div
                      key={p.id}
                      onClick={() => setCustomTradeSentPlayers(prev =>
                        selected ? prev.filter(sp => sp.id !== p.id) : [...prev, p]
                      )}
                      style={{
                        display: 'flex', justifyContent: 'space-between', padding: '3px 6px',
                        cursor: 'pointer', borderRadius: 4, marginBottom: 1,
                        background: selected ? 'rgba(239,68,68,0.15)' : 'transparent',
                        border: selected ? '1px solid #ef4444' : '1px solid transparent',
                      }}
                    >
                      <span style={{ color: selected ? '#ef4444' : '#CBD5E1', fontSize: 11 }}>
                        {p.name} <span style={{ color: '#64748b' }}>({p.position})</span>
                      </span>
                      <span style={{ color: '#475569', fontSize: 10 }}>
                        ${(p.capHit || 0).toFixed(1)}M / {Math.round(playerTradeValue(p))} pts
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* RIGHT: Their Assets */}
            <div style={{ background: '#0a0f1e', borderRadius: 8, padding: 10 }}>
              <div style={{ color: '#60a5fa', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                {customTradePartner ? `${customTradePartner} Assets` : 'Their Assets'}
              </div>

              {!customTradePartner ? (
                <div style={{ color: 'rgba(0,240,255,0.18)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
                  Select a trade partner above
                </div>
              ) : (
                <>
                  <div style={{ color: '#94A3B8', fontSize: 11, marginBottom: 4 }}>Draft Picks</div>
                  <div style={{ maxHeight: 120, overflowY: 'auto', marginBottom: 8 }}>
                    {partnerPicks.length === 0 ? (
                      <div style={{ color: 'rgba(0,240,255,0.18)', fontSize: 11 }}>No available picks</div>
                    ) : partnerPicks.map(pk => {
                      const selected = customTradeRecvPicks.find(rp => rp.overall === pk.overall);
                      return (
                        <div
                          key={pk.overall}
                          onClick={() => setCustomTradeRecvPicks(prev =>
                            selected ? prev.filter(rp => rp.overall !== pk.overall) : [...prev, pk]
                          )}
                          style={{
                            display: 'flex', justifyContent: 'space-between', padding: '3px 6px',
                            cursor: 'pointer', borderRadius: 4, marginBottom: 1,
                            background: selected ? 'rgba(74,222,128,0.15)' : 'transparent',
                            border: selected ? '1px solid #4ade80' : '1px solid transparent',
                          }}
                        >
                          <span style={{ color: selected ? '#4ade80' : '#CBD5E1', fontSize: 12 }}>
                            R{pk.round} #{pk.overall}
                          </span>
                          <span style={{ color: '#475569', fontSize: 11 }}>{Math.round(tradeValue(pk.overall))} pts</span>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ color: '#94A3B8', fontSize: 11, marginBottom: 4 }}>Roster Players</div>
                  <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                    {partnerPlayers.length === 0 ? (
                      <div style={{ color: 'rgba(0,240,255,0.18)', fontSize: 11 }}>No player data</div>
                    ) : partnerPlayers.sort((a, b) => b.capHit - a.capHit).map(p => {
                      const selected = customTradeRecvPlayers.find(rp => rp.id === p.id);
                      return (
                        <div
                          key={p.id}
                          onClick={() => setCustomTradeRecvPlayers(prev =>
                            selected ? prev.filter(rp => rp.id !== p.id) : [...prev, p]
                          )}
                          style={{
                            display: 'flex', justifyContent: 'space-between', padding: '3px 6px',
                            cursor: 'pointer', borderRadius: 4, marginBottom: 1,
                            background: selected ? 'rgba(74,222,128,0.15)' : 'transparent',
                            border: selected ? '1px solid #4ade80' : '1px solid transparent',
                          }}
                        >
                          <span style={{ color: selected ? '#4ade80' : '#CBD5E1', fontSize: 11 }}>
                            {p.name} <span style={{ color: '#64748b' }}>({p.position || 'UNK'})</span>
                          </span>
                          <span style={{ color: '#475569', fontSize: 10 }}>
                            ${(p.capHit || 0).toFixed(1)}M / {Math.round(playerTradeValue(p))} pts
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Trade Value Bar */}
          <div style={{ background: '#0a0f1e', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: '#ef4444', fontSize: 12, fontWeight: 700 }}>You Send: {vals.sentTotal} pts</span>
              <span style={{ color: '#4ade80', fontSize: 12, fontWeight: 700 }}>You Receive: {vals.recvTotal} pts</span>
            </div>
            <div style={{ display: 'flex', gap: 4, height: 12, marginBottom: 6 }}>
              <div style={{
                width: `${sentPct}%`, background: '#ef4444', borderRadius: 4,
                transition: 'width 0.3s',
              }} />
              <div style={{
                width: `${recvPct}%`, background: '#4ade80', borderRadius: 4,
                transition: 'width 0.3s',
              }} />
            </div>
            <div style={{ textAlign: 'center', color: vals.fairColor, fontWeight: 700, fontSize: 13 }}>
              {vals.fairness}
            </div>
          </div>

          {/* Cap Impact */}
          {(customTradeSentPlayers.length > 0 || customTradeRecvPlayers.length > 0) && (
            <div style={{ background: '#0a0f1e', borderRadius: 8, padding: 10, marginBottom: 12 }}>
              <div style={{ color: '#fff', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Cap Impact</div>
              {(() => {
                const sentCapRelief = customTradeSentPlayers.reduce((s, p) => s + (p.capHit || 0) - (p.deadMoney != null ? p.deadMoney : 0), 0);
                const recvCapCost = customTradeRecvPlayers.reduce((s, p) => s + (p.capHit || 0), 0);
                const net = sentCapRelief - recvCapCost;
                const deadCap = customTradeSentPlayers.reduce((s, p) => s + (p.deadMoney != null ? p.deadMoney : 0), 0);
                return (
                  <div style={{ fontSize: 11 }}>
                    {customTradeSentPlayers.map(p => (
                      <div key={p.id} style={{ color: '#CBD5E1', marginBottom: 1 }}>
                        Send {p.name}: <span style={{ color: '#4ade80' }}>+${(p.capHit||0).toFixed(1)}M</span>
                        {(p.deadMoney != null && p.deadMoney > 0) && <span style={{ color: '#ff4444' }}> ({p.deadMoney.toFixed(1)}M dead)</span>}
                      </div>
                    ))}
                    {customTradeRecvPlayers.map(p => (
                      <div key={p.id} style={{ color: '#CBD5E1', marginBottom: 1 }}>
                        Receive {p.name}: <span style={{ color: '#ff4444' }}>-${(p.capHit||0).toFixed(1)}M</span>
                      </div>
                    ))}
                    <div style={{ borderTop: '1px solid rgba(0,240,255,0.12)', marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94A3B8' }}>Net cap impact:</span>
                      <span style={{ color: net >= 0 ? '#4ade80' : '#ff4444', fontWeight: 700 }}>
                        {net >= 0 ? '+' : ''}${net.toFixed(1)}M
                      </span>
                    </div>
                    {deadCap > 0 && <div style={{ color: '#fbbf24', fontSize: 10, marginTop: 2 }}>Dead cap: ${deadCap.toFixed(1)}M accelerates</div>}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Force Trade Toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
            padding: '8px 12px', background: '#0a0f1e', borderRadius: 8,
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={customTradeForce}
                onChange={e => setCustomTradeForce(e.target.checked)}
                style={{ accentColor: accentColor }}
              />
              <span style={{ color: '#CBD5E1', fontSize: 12 }}>Force Trade (override value check)</span>
            </label>
            {customTradeForce && !vals.cpuAccepts && (
              <span style={{ color: '#fbbf24', fontSize: 11 }}>CPU team would not normally accept this trade</span>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={executeCustomTrade}
              disabled={!canExecute}
              style={{
                background: canExecute ? accentColor : 'rgba(0,240,255,0.12)',
                color: canExecute ? '#000' : '#475569',
                border: 'none', borderRadius: 8, padding: '10px 24px',
                cursor: canExecute ? 'pointer' : 'not-allowed',
                fontWeight: 700, fontSize: 14,
              }}
            >
              Execute Trade
            </button>
            <button
              onClick={() => setShowCustomTradeModal(false)}
              style={{
                background: 'rgba(0,240,255,0.12)', color: '#CBD5E1', border: 'none', borderRadius: 8,
                padding: '10px 24px', cursor: 'pointer', fontWeight: 600,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Add Draft Class Confirm Modal ---
  function renderAddDraftClassModal() {
    if (!showAddDraftClassConfirm) return null;
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,8,20,0.90)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}>
        <div style={{ background: '#0f172a', border: '1px solid rgba(0,240,255,0.18)', borderRadius: 12, padding: 24, maxWidth: 'min(480px, 95vw)', width: '90%' }}>
          <h3 style={{ color: '#fff', margin: '0 0 12px' }}>Add Draft Class to Roster</h3>
          <p style={{ color: '#94A3B8', fontSize: 13, marginBottom: 16 }}>
            This will add {draftedPlayers.length} drafted players to your roster with estimated rookie contracts.
          </p>

          <div style={{ background: '#0a0f1e', borderRadius: 8, padding: 12, marginBottom: 16 }}>
            {draftedPlayers.map(p => {
              const cap = estimateRookieCapHit(p.pickNumber);
              return (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, borderBottom: '1px solid #1a2420' }}>
                  <span style={{ color: '#CBD5E1' }}>{p.name} <span style={{ color: '#475569' }}>({p.position})</span></span>
                  <span style={{ color: accentColor, fontWeight: 700 }}>${cap.toFixed(1)}M</span>
                </div>
              );
            })}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', fontSize: 13, fontWeight: 700, borderTop: '1px solid rgba(0,240,255,0.18)', marginTop: 4 }}>
              <span style={{ color: '#fff' }}>Total Cap Impact</span>
              <span style={{ color: accentColor }}>${draftClassCapImpact.toFixed(1)}M</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={() => { addDraftClass(); setShowAddDraftClassConfirm(false); }}
              style={{ background: '#4ade80', color: '#000', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 700 }}
            >
              Confirm
            </button>
            <button
              onClick={() => setShowAddDraftClassConfirm(false)}
              style={{ background: 'rgba(0,240,255,0.12)', color: '#CBD5E1', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -- PRE-DRAFT STATE --
  if (!draftStarted) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, color: accentColor }}>2026 NFL Draft Simulator</h1>
            <p style={{ margin: '4px 0 0', color: '#94A3B8', fontSize: 14 }}>
              {totalPicks} picks across {draftRounds} round{draftRounds > 1 ? 's' : ''} -- You have {myPicks.filter(pk => getRoundForOverall(pk.overall) <= draftRounds).length} picks
            </p>
          </div>
        </div>
        <div style={{
          background: '#0f172a', border: '1px solid rgba(0,240,255,0.12)', borderRadius: 12, padding: 32,
          textAlign: 'center', maxWidth: 'min(500px, 95vw)', margin: '60px auto',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>NFL Draft</div>
          <h2 style={{ color: '#fff', margin: '0 0 8px', fontSize: 20 }}>2026 NFL Draft Simulator</h2>
          <p style={{ color: '#94A3B8', fontSize: 14, margin: '0 0 20px' }}>
            Simulate the draft pick-by-pick. Draft for your team, watch CPU teams make their selections.
          </p>

          {/* Round Selector */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#CBD5E1', fontSize: 12, marginBottom: 8 }}>Number of Rounds:</div>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
              {[1, 2, 3, 4, 5, 6, 7].map(r => (
                <button
                  key={r}
                  onClick={() => setDraftRounds(r)}
                  style={{
                    background: draftRounds === r ? accentColor : '#1e293b',
                    color: draftRounds === r ? '#000' : '#94A3B8',
                    border: draftRounds === r ? 'none' : '1px solid rgba(0,240,255,0.12)',
                    borderRadius: 6,
                    padding: '8px 14px',
                    cursor: 'pointer',
                    fontWeight: draftRounds === r ? 800 : 600,
                    fontSize: 14,
                    minWidth: 38,
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
            <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
              {totalPicks} picks in {draftRounds} round{draftRounds > 1 ? 's' : ''}
            </div>
          </div>

          {/* Speed Selector */}
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
            {renderSpeedSelector()}
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ color: '#CBD5E1', fontSize: 13, marginBottom: 8 }}>
              Your picks ({myPicks.filter(pk => getRoundForOverall(pk.overall) <= draftRounds).length} in {draftRounds} round{draftRounds > 1 ? 's' : ''}):
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
              {myPicks.map(pk => {
                const inRange = getRoundForOverall(pk.overall) <= draftRounds;
                return (
                  <span key={pk.overall} style={{
                    background: inRange ? accentBgBorder(accentColor) : '#0f172a',
                    border: `1px solid ${inRange ? accentColor : 'rgba(0,240,255,0.12)'}`,
                    borderRadius: 6, padding: '4px 10px', fontSize: 12,
                    color: inRange ? accentColor : '#64748b',
                    fontWeight: 700,
                    opacity: inRange ? 1 : 0.4,
                  }}>
                    R{pk.round} #{pk.overall}
                  </span>
                );
              })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={handleStartDraft}
              style={{
                background: accentColor, color: '#000', border: 'none', borderRadius: 10,
                padding: '12px 40px', cursor: 'pointer', fontWeight: 800, fontSize: 16,
              }}
            >
              Start Draft
            </button>
            <button
              onClick={openCustomTradeModal}
              style={{
                background: '#60a5fa', color: '#000', border: 'none', borderRadius: 10,
                padding: '12px 24px', cursor: 'pointer', fontWeight: 700, fontSize: 14,
              }}
            >
              Trade Before Draft
            </button>
          </div>
        </div>
        {renderCustomTradeModal()}
      </div>
    );
  }

  // -- DRAFT COMPLETE STATE --
  function handleShareDraftX() {
    const currentTeamObj = allTeams?.find(t => t.abbreviation === currentTeamAbbr);
    const drafted = draftedPlayers.length;
    const grade = draftRecap?.letter || '?';
    const avgGrade = draftRecap?.avgGrade || 0;

    const text = encodeURIComponent(
      `I just completed the ${currentTeamObj?.name || currentTeamAbbr} mock draft on AiNFL GM \u{1F916}\u{1F3C8}\n\n` +
      `\u{1F3AF} ${drafted} pick${drafted !== 1 ? 's' : ''} made\n` +
      `\u{1F4CA} Draft Grade: ${grade}\n` +
      `\u2B50 Avg Prospect Grade: ${avgGrade}\n\n` +
      `Think you can draft better?\n` +
      `ainflgm.com/${currentTeamAbbr.toLowerCase()}`
    );

    window.open(`https://x.com/intent/tweet?text=${text}`, '_blank');
  }

  if (draftComplete && draftRecap) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, color: accentColor }}>Draft Complete</h1>
            <p style={{ margin: '4px 0 0', color: '#94A3B8', fontSize: 14 }}>
              All {totalPicks} picks are in. Here is your draft class.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!draftClassAdded && (
              <button
                onClick={() => setShowAddDraftClassConfirm(true)}
                style={{
                  background: '#4ade80', color: '#000', border: 'none', borderRadius: 8,
                  padding: '8px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13,
                }}
              >
                Add Draft Class to Roster
              </button>
            )}
            {draftClassAdded && (
              <span style={{ color: '#4ade80', fontSize: 13, fontWeight: 700, padding: '8px 16px' }}>
                Draft class added to roster
              </span>
            )}
            <button
              onClick={handleShareDraftX}
              style={{
                background: '#000', color: '#fff', border: '1px solid #333', borderRadius: 8,
                padding: '8px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13,
              }}
            >
              Share on X
            </button>
            <button
              onClick={() => setShowResetConfirm(true)}
              style={{
                background: 'rgba(0,240,255,0.12)', color: '#CBD5E1', border: 'none', borderRadius: 8,
                padding: '8px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13,
              }}
            >
              Start New Draft
            </button>
          </div>
        </div>

        {renderResetModal()}
        {renderAddDraftClassModal()}

        {/* Overall Grade */}
        <div style={{
          background: '#0f172a', border: '1px solid rgba(0,240,255,0.12)', borderRadius: 12, padding: 24,
          textAlign: 'center', marginBottom: 20,
        }}>
          <div style={{ color: '#94A3B8', fontSize: 13, marginBottom: 4 }}>Overall Draft Grade</div>
          <div style={{
            fontSize: 48, fontWeight: 900, color: gradeLetterColor(draftRecap.letter),
          }}>
            {draftRecap.letter}
          </div>
          <div style={{ color: '#475569', fontSize: 13 }}>Avg prospect grade: {draftRecap.avgGrade}</div>
        </div>

        {/* Draft Class Cards */}
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ color: '#fff', fontSize: 15, margin: '0 0 10px' }}>Your Draft Class</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {draftedPlayers.map(p => {
              const pickRound = getRoundForOverall(p.pickNumber || 0);
              const cap = estimateRookieCapHit(p.pickNumber);
              return (
                <div key={p.id} style={{
                  background: '#0f172a', border: '1px solid rgba(0,240,255,0.12)', borderRadius: 10, padding: 16,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>{p.name}</div>
                      <div style={{ color: '#94A3B8', fontSize: 13 }}>{p.position} -- {p.school}</div>
                    </div>
                    <span style={{
                      background: gradeColor(p.grade) + '22', color: gradeColor(p.grade),
                      border: `1px solid ${gradeColor(p.grade)}`, borderRadius: 6,
                      padding: '2px 8px', fontSize: 13, fontWeight: 700,
                    }}>
                      {p.grade}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 12 }}>
                    <span>Round {pickRound} -- Pick #{p.pickNumber}</span>
                    <span style={{ color: accentColor }}>~${cap.toFixed(1)}M/yr</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Full Draft Board */}
        <div style={{
          background: '#0f172a', border: '1px solid rgba(0,240,255,0.12)', borderRadius: 10, padding: 12,
        }}>
          <h3 style={{ color: '#fff', fontSize: 15, margin: '0 0 10px' }}>Full Draft Board</h3>
          {renderFullBoard()}
        </div>
      </div>
    );
  }

  // -- ACTIVE DRAFT STATE --
  const roundPicks = fullPickOrder.filter(p => getRoundForOverall(p.overall) === activeRound);
  const showPausedState = isPaused && isSimulating;

  return (
    <div>
      {/* Top Bar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 12, flexWrap: 'wrap', gap: 8,
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, color: accentColor }}>2026 NFL Draft Simulator</h1>
          <p style={{ margin: '2px 0 0', color: '#94A3B8', fontSize: 13 }}>
            Pick {Math.min(currentPickIdx + 1, totalPicks)} of {totalPicks}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {renderSpeedSelector()}
          {renderViewToggle()}
          {viewMode === 'round' && renderRoundTabs()}

          {/* Pause/Resume buttons during simulation */}
          {isSimulating && !isUserPick && !isPaused && (
            <button
              onClick={handlePause}
              style={{
                background: '#fbbf24', color: '#000', border: 'none', borderRadius: 8,
                padding: '6px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13,
                animation: 'pulse-pause 2s ease-in-out infinite',
              }}
            >
              PAUSE DRAFT
            </button>
          )}
          {showPausedState && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={handleResume}
                style={{
                  background: '#4ade80', color: '#000', border: 'none', borderRadius: 8,
                  padding: '6px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13,
                }}
              >
                RESUME
              </button>
              <button
                onClick={openCustomTradeModal}
                style={{
                  background: '#60a5fa', color: '#000', border: 'none', borderRadius: 8,
                  padding: '6px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13,
                }}
              >
                TRADE UP
              </button>
            </div>
          )}

          <button
            onClick={() => setShowResetConfirm(true)}
            style={{
              background: 'rgba(0,240,255,0.12)', color: '#CBD5E1', border: 'none', borderRadius: 6,
              padding: '8px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12,
            }}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Your Picks Summary Strip */}
      {draftStarted && !draftComplete && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
          padding: '6px 10px', background: '#0a0f1e', borderRadius: 8,
          border: '1px solid rgba(0,240,255,0.10)', overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}>
          <span style={{ color: '#94A3B8', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', marginRight: 2 }}>YOUR PICKS:</span>
          {myPicks
            .filter(pk => getRoundForOverall(pk.overall) <= draftRounds)
            .sort((a, b) => a.overall - b.overall)
            .map(pk => {
              const drafted = getDraftedPick(pk.overall);
              const isNext = !drafted && currentPick && !isUserPick
                ? pk.overall === myPicks
                    .filter(p => getRoundForOverall(p.overall) <= draftRounds && !getDraftedPick(p.overall))
                    .sort((a, b) => a.overall - b.overall)[0]?.overall
                : currentPick && pk.overall === currentPick.overall && isUserPick;
              const isUsed = !!drafted;
              return (
                <div key={pk.overall} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '3px 8px', borderRadius: 6, flexShrink: 0,
                  background: isNext ? accentBg(accentColor) : isUsed ? 'rgba(74,222,128,0.08)' : 'rgba(30,41,59,0.5)',
                  border: isNext ? `1.5px solid ${accentColor}` : isUsed ? '1px solid rgba(74,222,128,0.2)' : '1px solid rgba(100,116,139,0.15)',
                  animation: isNext ? 'pulse-border 1.5s ease-in-out infinite' : 'none',
                }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    color: isNext ? accentColor : isUsed ? '#4ade80' : '#64748b',
                  }}>
                    R{pk.round}
                  </span>
                  <span style={{
                    fontSize: 12, fontWeight: 800,
                    color: isNext ? accentColor : isUsed ? '#4ade80' : '#94A3B8',
                  }}>
                    #{pk.overall}
                  </span>
                  {isUsed && drafted && (
                    <span style={{ fontSize: 8, color: '#4ade80', whiteSpace: 'nowrap', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {drafted.prospect.position}
                    </span>
                  )}
                  {isNext && !isUsed && (
                    <span style={{ fontSize: 8, color: accentColor, fontWeight: 700 }}>NEXT</span>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* Modals */}
      {renderResetModal()}
      {renderTradeUpModal()}
      {renderTradeDownModal()}
      {renderCustomTradeModal()}

      {/* Main Layout: Draft Board + Context Panel */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 12,
        minHeight: 'calc(100vh - 160px)',
      }}>
        {/* LEFT: Draft Board */}
        <div
          ref={draftBoardRef}
          style={{
            background: '#0f172a', border: '1px solid rgba(0,240,255,0.12)', borderRadius: 10, padding: 10,
            overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 160px)', WebkitOverflowScrolling: 'touch',
          }}
        >
          {viewMode === 'fullBoard' ? (
            <>
              <h3 style={{ margin: '0 0 8px', color: '#fff', fontSize: 14, padding: '0 4px' }}>
                Full Draft Board
              </h3>
              {renderFullBoard()}
            </>
          ) : (
            <>
              <h3 style={{ margin: '0 0 8px', color: '#fff', fontSize: 14, padding: '0 4px' }}>
                Round {activeRound} Draft Board
              </h3>

              {roundPicks.map((pick) => {
                const drafted = getDraftedPick(pick.overall);
                const isCurrent = currentPick && pick.overall === currentPick.overall && !drafted;
                const isFuture = !drafted && !isCurrent;
                const isUserTeam = pick.teamAbbr === currentTeamAbbr;

                return (
                  <div
                    key={pick.overall}
                    ref={isCurrent ? currentPickRef : null}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 8px', marginBottom: 2, borderRadius: 6,
                      background: isCurrent
                        ? accentBg(accentColor)
                        : drafted
                          ? (drafted.teamAbbr === currentTeamAbbr ? accentBgLight(accentColor) : '#0a0f1e')
                          : '#0a0e0c',
                      border: isCurrent
                        ? `1px solid ${accentColor}`
                        : '1px solid transparent',
                      animation: isCurrent ? 'pulse-border 1.5s ease-in-out infinite' : 'none',
                      opacity: isFuture ? 0.5 : 1,
                    }}
                  >
                    {/* Pick Number */}
                    <div style={{
                      minWidth: 32, textAlign: 'center', color: isCurrent ? accentColor : '#64748b',
                      fontWeight: 700, fontSize: 12,
                    }}>
                      #{pick.overall}
                    </div>

                    {/* Team Color Dot + Name */}
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: pick.teamColor || '#64748b', flexShrink: 0,
                    }} />
                    <div style={{
                      minWidth: 80, color: isUserTeam ? accentColor : '#CBD5E1',
                      fontWeight: isUserTeam ? 700 : 400, fontSize: 12,
                    }}>
                      {pick.teamName}
                    </div>

                    {/* Player Info or Status */}
                    {drafted ? (
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>
                          {drafted.prospect.name}
                        </span>
                        <span style={{
                          background: '#1e293b', color: accentColor, borderRadius: 3,
                          padding: '1px 5px', fontSize: 10, fontWeight: 700,
                        }}>
                          {drafted.prospect.position}
                        </span>
                        <span style={{ color: '#64748b', fontSize: 11 }}>
                          {drafted.prospect.school}
                        </span>
                      </div>
                    ) : isCurrent ? (
                      <div style={{ flex: 1, color: accentColor, fontWeight: 700, fontSize: 12 }}>
                        {isUserPick ? 'ON THE CLOCK' : isPaused ? 'PAUSED' : 'Selecting...'}
                      </div>
                    ) : (
                      <div style={{ flex: 1, color: 'rgba(0,240,255,0.12)', fontSize: 12 }}>--</div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* RIGHT: Context Panel */}
        <div style={{
          background: '#0f172a', border: '1px solid rgba(0,240,255,0.12)', borderRadius: 10, padding: 12,
          overflowY: 'auto', maxHeight: 'calc(100vh - 160px)',
        }}>
          {/* CPU Simulating (not paused) */}
          {isSimulating && !isUserPick && !isPaused && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{
                width: 40, height: 40, border: '3px solid rgba(0,240,255,0.12)', borderTop: `3px solid ${accentColor}`,
                borderRadius: '50%', margin: '0 auto 16px',
                animation: 'spin 0.8s linear infinite',
              }} />
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Simulating...</div>
              {currentPick && (
                <div style={{ color: '#94A3B8', fontSize: 13 }}>
                  {currentPick.teamName} are on the clock (#{currentPick.overall})
                </div>
              )}
            </div>
          )}

          {/* Paused State */}
          {showPausedState && (
            <div style={{ textAlign: 'center', padding: '30px 20px' }}>
              <div style={{
                background: 'rgba(251,191,36,0.12)', border: '1px solid #fbbf24',
                borderRadius: 8, padding: 16, marginBottom: 16,
              }}>
                <div style={{ color: '#fbbf24', fontWeight: 800, fontSize: 18, marginBottom: 4 }}>DRAFT PAUSED</div>
                <div style={{ color: '#94A3B8', fontSize: 13 }}>
                  {currentPick && `${currentPick.teamName} are on the clock (Pick #${currentPick.overall})`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={handleResume}
                  style={{
                    background: '#4ade80', color: '#000', border: 'none', borderRadius: 8,
                    padding: '10px 24px', cursor: 'pointer', fontWeight: 800, fontSize: 14,
                  }}
                >
                  Resume Draft
                </button>
                <button
                  onClick={openCustomTradeModal}
                  style={{
                    background: '#60a5fa', color: '#000', border: 'none', borderRadius: 8,
                    padding: '10px 24px', cursor: 'pointer', fontWeight: 800, fontSize: 14,
                  }}
                >
                  Trade Up
                </button>
              </div>
            </div>
          )}

          {/* User On the Clock */}
          {!isSimulating && isUserPick && currentPick && !draftComplete && (
            <div>
              <div style={{
                background: accentBg(accentColor), border: `2px solid ${accentColor}`,
                borderRadius: 10, padding: 16, marginBottom: 12, textAlign: 'center',
                animation: 'user-pick-glow 2s ease-in-out infinite',
                boxShadow: `0 0 20px ${accentColor}44, 0 0 40px ${accentColor}22`,
              }}>
                <div style={{ color: accentColor, fontWeight: 900, fontSize: 24, marginBottom: 4, letterSpacing: 2, textTransform: 'uppercase' }}>
                  YOUR PICK
                </div>
                <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                  Pick #{currentPick.overall} -- Round {getRoundForOverall(currentPick.overall)}
                </div>
              </div>

              {/* Position Filter + Trade Down */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="text"
                    value={prospectSearch}
                    onChange={e => setProspectSearch(e.target.value)}
                    placeholder="Search prospects..."
                    style={{
                      flex: 1,
                      maxWidth: 220,
                      background: 'rgba(30,41,59,0.6)',
                      color: '#E2E8F0',
                      border: '1px solid rgba(0,240,255,0.15)',
                      borderRadius: 8,
                      padding: '8px 12px',
                      fontSize: 12,
                      fontFamily: "'Inter', system-ui, sans-serif",
                      outline: 'none',
                    }}
                  />
                  <span style={{ color: '#94A3B8', fontSize: 12 }}>Filter:</span>
                  <select
                    value={filterPos}
                    onChange={e => setFilterPos(e.target.value)}
                    style={{
                      background: '#1e293b', color: '#CBD5E1', border: '1px solid rgba(0,240,255,0.18)', borderRadius: 6,
                      padding: '8px 12px', fontSize: 12,
                    }}
                  >
                    {positions.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={openCustomTradeModal}
                    style={{
                      background: '#fbbf24', color: '#000', border: 'none', borderRadius: 6,
                      padding: '8px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 11,
                    }}
                  >
                    Propose Trade
                  </button>
                  <button
                    onClick={() => setShowTradeDownModal(true)}
                    style={{
                      background: '#60a5fa', color: '#000', border: 'none', borderRadius: 6,
                      padding: '8px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 11,
                    }}
                  >
                    Trade Down
                  </button>
                </div>
              </div>

              {/* Prospect List */}
              <div style={{ overflowY: 'auto' }}>
                {availableProspects.map((p, idx) => {
                  const projectedPick = projectedPickMap.get(p.id) || null;
                  return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 8px', borderBottom: '1px solid #1a2420', gap: 6,
                      cursor: 'pointer',
                    }}
                    onClick={() => handleDraft(p)}
                    onMouseEnter={e => { e.currentTarget.style.background = accentBg(accentColor); }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                      <div style={{ minWidth: 28, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <span style={{ color: '#64748b', fontSize: 11 }}>#{p.rank}</span>
                        {projectedPick && projectedPick <= totalPicks && (
                          <span style={{ color: '#475569', fontSize: 9 }}>~{projectedPick}</span>
                        )}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: '#fff', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {p.name}
                        </div>
                        <div style={{ color: '#475569', fontSize: 11 }}>
                          {p.position} -- {p.school}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{
                        background: gradeColor(p.grade) + '22', color: gradeColor(p.grade),
                        borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 700,
                      }}>
                        {p.grade}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDraft(p); }}
                        style={{
                          background: accentColor, color: '#000', border: 'none', borderRadius: 5,
                          padding: '8px 12px', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                        }}
                      >
                        Draft
                      </button>
                    </div>
                  </div>
                  );
                })}
                {availableProspects.length > 100 && (
                  <p style={{ color: '#64748b', fontSize: 11, textAlign: 'center', marginTop: 8 }}>
                    {availableProspects.length} prospects available. Use filter to narrow.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Waiting state (not simulating, not user pick, not complete) */}
          {!isSimulating && !isUserPick && !draftComplete && draftStarted && !isPaused && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ color: '#94A3B8', fontSize: 14 }}>Waiting for simulation to resume...</div>
              <button
                onClick={() => simulateCPUPicks()}
                style={{
                  background: accentColor, color: '#000', border: 'none', borderRadius: 8,
                  padding: '8px 20px', cursor: 'pointer', fontWeight: 700, fontSize: 13, marginTop: 12,
                }}
              >
                Continue Simulation
              </button>
            </div>
          )}

          {/* Your Picks Summary (always show when picks have been made) */}
          {draftedPlayers.length > 0 && !draftComplete && (
            <div style={{
              borderTop: '1px solid rgba(0,240,255,0.12)', marginTop: 12, paddingTop: 12,
            }}>
              <h4 style={{ margin: '0 0 8px', color: '#fff', fontSize: 13 }}>Your Picks ({draftedPlayers.length})</h4>
              {draftedPlayers.map(p => (
                <div key={p.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '4px 0', fontSize: 12,
                }}>
                  <span style={{ color: '#CBD5E1' }}>{p.name} <span style={{ color: '#64748b' }}>({p.position})</span></span>
                  <span style={{ color: gradeColor(p.grade), fontWeight: 700, fontSize: 11 }}>{p.grade}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes pulse-border {
          0%, 100% { border-color: ${accentColor}; }
          50% { border-color: transparent; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse-pause {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.03); }
        }
        @keyframes user-pick-glow {
          0%, 100% { box-shadow: 0 0 20px ${accentColor}44, 0 0 40px ${accentColor}22; border-color: ${accentColor}; }
          50% { box-shadow: 0 0 30px ${accentColor}66, 0 0 60px ${accentColor}33; border-color: ${accentColor}cc; }
        }
      `}</style>
    </div>
  );
}
