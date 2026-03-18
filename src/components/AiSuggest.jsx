import React, { useState, useMemo } from 'react';
import { useGame } from '../context/GameContext';
import { useLocation } from 'react-router-dom';

// Map specific positions to position groups
const positionGroupMap = {
  QB: 'QB', RB: 'RB', FB: 'RB',
  WR: 'WR',
  TE: 'TE',
  LT: 'OL', RT: 'OL', LG: 'OL', RG: 'OL', C: 'OL', OT: 'OL', OG: 'OL', IOL: 'OL', G: 'OL', T: 'OL',
  DE: 'DL', DT: 'DL', NT: 'DL', DL: 'DL', EDGE: 'DL',
  LB: 'LB', ILB: 'LB', OLB: 'LB', MLB: 'LB', 'LB/EDGE': 'LB',
  CB: 'CB',
  S: 'S', FS: 'S', SS: 'S',
  K: 'K', P: 'P', LS: 'LS',
};

const idealCounts = { QB: 2, RB: 3, WR: 5, TE: 3, OL: 5, DL: 5, LB: 4, CB: 4, S: 3 };

const groupLabels = {
  QB: 'Quarterback', RB: 'Running Back', WR: 'Wide Receiver', TE: 'Tight End',
  OL: 'Offensive Line', DL: 'Defensive Line', LB: 'Linebacker', CB: 'Cornerback', S: 'Safety',
};

function getGroup(position) {
  return positionGroupMap[position] || null;
}

function analyzeRosterNeeds(roster) {
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0, OL: 0, DL: 0, LB: 0, CB: 0, S: 0 };
  roster.forEach(p => {
    const g = getGroup(p.position);
    if (g && counts[g] !== undefined) counts[g]++;
  });
  const needs = [];
  for (const [group, ideal] of Object.entries(idealCounts)) {
    const deficit = ideal - counts[group];
    if (deficit > 0) {
      needs.push({ group, deficit, current: counts[group], ideal, label: groupLabels[group] });
    }
  }
  needs.sort((a, b) => b.deficit - a.deficit);
  return { counts, needs };
}

function getExpiringContracts(roster) {
  return roster
    .filter(p => p.yearsRemaining === 0 && p.capHit > 2)
    .sort((a, b) => b.capHit - a.capHit);
}

function getOverpaidPlayers(roster) {
  // Group by position, find players well above group average
  const groupTotals = {};
  const groupCounts = {};
  roster.forEach(p => {
    const g = getGroup(p.position);
    if (!g) return;
    groupTotals[g] = (groupTotals[g] || 0) + p.capHit;
    groupCounts[g] = (groupCounts[g] || 0) + 1;
  });
  return roster
    .filter(p => {
      const g = getGroup(p.position);
      if (!g || !groupCounts[g]) return false;
      const avg = groupTotals[g] / groupCounts[g];
      return p.capHit > avg * 2 && p.capHit > 5;
    })
    .sort((a, b) => b.capHit - a.capHit);
}

function getCutCandidates(roster) {
  return roster
    .filter(p => (p.capSavings || 0) > 0 && p.capHit > 3)
    .sort((a, b) => (b.capSavings || 0) - (a.capSavings || 0));
}

function getRestructureCandidates(roster) {
  return roster
    .filter(p => (p.baseSalary || 0) > 5 && (p.yearsRemaining || 0) >= 1)
    .sort((a, b) => (b.baseSalary || 0) - (a.baseSalary || 0));
}

function getTradeableAssets(roster) {
  return roster
    .filter(p => (p.capSavings || 0) > 2 && p.capHit > 5 && p.age >= 28)
    .sort((a, b) => (b.capSavings || 0) - (a.capSavings || 0));
}

function generateRosterSuggestions(roster) {
  const suggestions = [];
  const { needs } = analyzeRosterNeeds(roster);
  const expiring = getExpiringContracts(roster);

  // Position needs
  if (needs.length > 0) {
    const top = needs[0];
    suggestions.push({
      icon: '\u26A0\uFE0F',
      title: `Position Need: ${top.label}`,
      description: `Only ${top.current} ${top.label}${top.current !== 1 ? 's' : ''} on roster (ideal: ${top.ideal}). Consider adding depth via free agency or draft.`,
      action: { label: 'Go to Free Agency', path: '/fa' },
      priority: 1,
    });
  }

  // Expiring contracts
  if (expiring.length > 0) {
    const p = expiring[0];
    suggestions.push({
      icon: '\u23F3',
      title: `Extend ${p.name}`,
      description: `${p.name} ($${p.capHit.toFixed(1)}M) is in the final year of their contract. Consider extending before they hit free agency.`,
      action: null,
      priority: 2,
    });
  }

  // Overpaid players
  const overpaid = getOverpaidPlayers(roster);
  if (overpaid.length > 0) {
    const p = overpaid[0];
    suggestions.push({
      icon: '\uD83D\uDCB0',
      title: `Cap Watch: ${p.name}`,
      description: `${p.name} has a $${p.capHit.toFixed(1)}M cap hit, well above the ${groupLabels[getGroup(p.position)] || p.position} group average. Consider restructuring or trading.`,
      action: { label: 'View Cap', path: '/cap' },
      priority: 3,
    });
  }

  return suggestions.slice(0, 3);
}

function generateCapSuggestions(roster, capAvailable, totalCap) {
  const suggestions = [];

  if (capAvailable < 0) {
    // Over cap
    const cuts = getCutCandidates(roster);
    if (cuts.length > 0) {
      const p = cuts[0];
      suggestions.push({
        icon: '\u2702\uFE0F',
        title: `Cut ${p.name} to Save $${(p.capSavings || 0).toFixed(1)}M`,
        description: `You're over the cap. Cutting ${p.name} saves $${(p.capSavings || 0).toFixed(1)}M with only $${(p.deadMoney || 0).toFixed(1)}M dead money.`,
        action: null,
        priority: 1,
      });
    }
    const restructures = getRestructureCandidates(roster);
    if (restructures.length > 0) {
      const p = restructures[0];
      const convertible = Math.max((p.baseSalary || 0) - 1.1, 0);
      const remaining = Math.max(p.yearsRemaining || 1, 1) + 1;
      const savings = convertible - (convertible / remaining);
      suggestions.push({
        icon: '\uD83D\uDD04',
        title: `Restructure ${p.name}`,
        description: `Converting ${p.name}'s base salary could save ~$${savings.toFixed(1)}M this year by spreading it over ${remaining} years.`,
        action: null,
        priority: 2,
      });
    }
  } else if (capAvailable < 10) {
    // Tight cap
    const restructures = getRestructureCandidates(roster);
    if (restructures.length > 0) {
      const p = restructures[0];
      suggestions.push({
        icon: '\uD83D\uDD04',
        title: `Restructure ${p.name}`,
        description: `Cap space is tight at $${capAvailable.toFixed(1)}M. Restructuring ${p.name} ($${(p.baseSalary || 0).toFixed(1)}M base) could free up room.`,
        action: null,
        priority: 1,
      });
    }
    const cuts = getCutCandidates(roster);
    if (cuts.length > 0) {
      const p = cuts[0];
      suggestions.push({
        icon: '\u2702\uFE0F',
        title: `Potential Cut: ${p.name}`,
        description: `Cutting ${p.name} would save $${(p.capSavings || 0).toFixed(1)}M against $${(p.deadMoney || 0).toFixed(1)}M dead money.`,
        action: null,
        priority: 2,
      });
    }
  } else {
    // Flush
    suggestions.push({
      icon: '\uD83D\uDE80',
      title: 'Cap Space Available',
      description: `You have $${capAvailable.toFixed(1)}M in cap space. You have room to make a splash signing or extend a key player.`,
      action: { label: 'Go to Free Agency', path: '/fa' },
      priority: 1,
    });
    const expiring = getExpiringContracts(roster);
    if (expiring.length > 0) {
      const p = expiring[0];
      suggestions.push({
        icon: '\u23F3',
        title: `Lock Up ${p.name}`,
        description: `With cap room to spare, now is a good time to extend ${p.name} before their contract expires.`,
        action: null,
        priority: 2,
      });
    }
  }

  return suggestions.slice(0, 3);
}

function generateFASuggestions(roster, freeAgentPool, capAvailable) {
  const suggestions = [];
  const { needs } = analyzeRosterNeeds(roster);

  if (needs.length === 0 && freeAgentPool.length > 0) {
    // No clear needs, suggest BPA
    const bestAvailable = [...freeAgentPool].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    if (bestAvailable.length > 0) {
      const fa = bestAvailable[0];
      suggestions.push({
        icon: '\u2B50',
        title: `Best Available: ${fa.name}`,
        description: `${fa.name} (${fa.position}, ${fa.rating} OVR) is the highest-rated free agent. Estimated cost: $${fa.askingPrice}M/yr.`,
        action: null,
        priority: 1,
      });
    }
  }

  // For each top need, find the best FA at that position
  for (const need of needs.slice(0, 2)) {
    const groupPositions = Object.entries(positionGroupMap)
      .filter(([, g]) => g === need.group)
      .map(([pos]) => pos);

    const candidates = freeAgentPool
      .filter(fa => groupPositions.includes(getGroup(fa.position) === need.group ? fa.position : '') || getGroup(fa.position) === need.group)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0));

    if (candidates.length > 0) {
      const fa = candidates[0];
      const affordable = capAvailable >= fa.askingPrice;
      suggestions.push({
        icon: affordable ? '\u2705' : '\u26A0\uFE0F',
        title: `Sign ${fa.name} (${fa.position})`,
        description: `Fills your ${need.label} need (${need.current}/${need.ideal} on roster). ${fa.rating} OVR, ~$${fa.askingPrice}M/yr.${!affordable ? ' Warning: exceeds cap space.' : ''}`,
        action: null,
        priority: suggestions.length + 1,
      });
    }
  }

  if (suggestions.length === 0) {
    suggestions.push({
      icon: '\u2705',
      title: 'Roster Looks Solid',
      description: 'No critical position needs detected. Consider signing depth pieces or best available talent.',
      action: null,
      priority: 1,
    });
  }

  return suggestions.slice(0, 3);
}

function generateTradeSuggestions(roster) {
  const suggestions = [];
  const tradeable = getTradeableAssets(roster);
  const { needs } = analyzeRosterNeeds(roster);

  if (tradeable.length > 0) {
    const p = tradeable[0];
    const needLabel = needs.length > 0 ? needs[0].label : 'depth';
    suggestions.push({
      icon: '\uD83D\uDD04',
      title: `Trade ${p.name}`,
      description: `${p.name} (age ${p.age}, $${p.capHit.toFixed(1)}M) could free $${(p.capSavings || 0).toFixed(1)}M. Target a ${needLabel} upgrade.`,
      action: null,
      priority: 1,
    });
  }

  if (needs.length > 0) {
    const topNeed = needs[0];
    suggestions.push({
      icon: '\uD83C\uDFAF',
      title: `Target ${topNeed.label} via Trade`,
      description: `Only ${topNeed.current} ${topNeed.label}${topNeed.current !== 1 ? 's' : ''} on roster. Look for trade partners with surplus at this position.`,
      action: null,
      priority: 2,
    });
  }

  if (tradeable.length > 1) {
    const p = tradeable[1];
    suggestions.push({
      icon: '\uD83D\uDCB8',
      title: `Also Consider: ${p.name}`,
      description: `${p.name} ($${p.capHit.toFixed(1)}M cap hit, age ${p.age}) is another tradeable asset that could free $${(p.capSavings || 0).toFixed(1)}M.`,
      action: null,
      priority: 3,
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      icon: '\uD83D\uDCA1',
      title: 'Explore Trade Packages',
      description: 'No obvious trade candidates. Consider packaging draft picks to move up for a premium prospect.',
      action: null,
      priority: 1,
    });
  }

  return suggestions.slice(0, 3);
}

function generateDraftSuggestions(roster, draftBoard, draftStarted, draftComplete, draftedPlayers, myPicks, currentDraftPick) {
  const suggestions = [];
  const { needs } = analyzeRosterNeeds(roster);

  if (draftComplete) {
    // After draft
    if (draftedPlayers.length > 0) {
      const positionsFilled = [...new Set(draftedPlayers.map(p => getGroup(p.position)).filter(Boolean))];
      const unaddressed = needs.filter(n => !positionsFilled.includes(n.group));
      if (unaddressed.length > 0) {
        suggestions.push({
          icon: '\u26A0\uFE0F',
          title: `Unaddressed Need: ${unaddressed[0].label}`,
          description: `Your draft class didn't address the ${unaddressed[0].label} position. Consider the free agent market to fill this gap.`,
          action: { label: 'Go to Free Agency', path: '/fa' },
          priority: 1,
        });
      }
      suggestions.push({
        icon: '\u2705',
        title: `Drafted ${draftedPlayers.length} Player${draftedPlayers.length !== 1 ? 's' : ''}`,
        description: `You selected: ${draftedPlayers.map(p => `${p.name} (${p.position})`).join(', ')}. Review your full offseason on the Summary page.`,
        action: { label: 'View Summary', path: '/summary' },
        priority: 2,
      });
    }
  } else if (draftStarted) {
    // During draft - on the clock
    const userPicksRemaining = myPicks.filter(pk => pk.overall > currentDraftPick);
    if (userPicksRemaining.length > 0) {
      // Find best available at position of need
      const available = draftBoard.filter(p => p.rank != null).sort((a, b) => (a.rank || 999) - (b.rank || 999));
      if (needs.length > 0 && available.length > 0) {
        const topNeed = needs[0];
        const needPositions = Object.entries(positionGroupMap)
          .filter(([, g]) => g === topNeed.group)
          .map(([pos]) => pos);
        const bestAtNeed = available.find(p => needPositions.includes(p.position) || getGroup(p.position) === topNeed.group);
        if (bestAtNeed) {
          suggestions.push({
            icon: '\uD83C\uDFAF',
            title: `Draft ${bestAtNeed.name} (${bestAtNeed.position})`,
            description: `Fills your ${topNeed.label} need. Grade: ${bestAtNeed.grade}. ${bestAtNeed.school}.`,
            action: null,
            priority: 1,
          });
        }
      }
      // Also suggest BPA
      if (available.length > 0) {
        const bpa = available[0];
        suggestions.push({
          icon: '\u2B50',
          title: `BPA: ${bpa.name} (${bpa.position})`,
          description: `Highest-graded prospect available. Grade: ${bpa.grade}. ${bpa.school}. ${bpa.traits ? bpa.traits.join(', ') : ''}`,
          action: null,
          priority: 2,
        });
      }
    }
  } else {
    // Before draft
    if (needs.length > 0) {
      const topNeeds = needs.slice(0, 2);
      suggestions.push({
        icon: '\uD83D\uDCCB',
        title: 'Draft Priority Positions',
        description: `Focus on: ${topNeeds.map(n => `${n.label} (${n.current}/${n.ideal})`).join(', ')}. These are your biggest roster gaps.`,
        action: null,
        priority: 1,
      });
    }
    // Suggest top prospect at biggest need
    if (needs.length > 0 && draftBoard.length > 0) {
      const topNeed = needs[0];
      const needPositions = Object.entries(positionGroupMap)
        .filter(([, g]) => g === topNeed.group)
        .map(([pos]) => pos);
      const topProspect = draftBoard
        .filter(p => needPositions.includes(p.position) || getGroup(p.position) === topNeed.group)
        .sort((a, b) => (a.rank || 999) - (b.rank || 999))[0];
      if (topProspect) {
        suggestions.push({
          icon: '\uD83C\uDFAF',
          title: `Watch: ${topProspect.name} (${topProspect.position})`,
          description: `Top ${topNeed.label} prospect. Grade: ${topProspect.grade}. ${topProspect.school}. Round ${topProspect.round} projection.`,
          action: null,
          priority: 2,
        });
      }
    }
    if (myPicks.length > 0) {
      const rounds = [...new Set(myPicks.map(pk => pk.round))].sort((a, b) => a - b);
      suggestions.push({
        icon: '\uD83C\uDFC8',
        title: `${myPicks.length} Pick${myPicks.length !== 1 ? 's' : ''} Available`,
        description: `You have picks in Round${rounds.length !== 1 ? 's' : ''} ${rounds.join(', ')}. Start the draft when ready.`,
        action: null,
        priority: 3,
      });
    }
  }

  if (suggestions.length === 0) {
    suggestions.push({
      icon: '\uD83D\uDCA1',
      title: 'Draft Board Ready',
      description: 'Review the available prospects and start the draft when you are ready.',
      action: null,
      priority: 1,
    });
  }

  return suggestions.slice(0, 3);
}

function generateSummarySuggestions(roster, signingHistory, cutPlayers, tradeHistory, draftedPlayers) {
  const suggestions = [];
  const { needs } = analyzeRosterNeeds(roster);

  // Grade FA signings
  const faSignings = signingHistory.length;
  const draftPicks = draftedPlayers.length;
  const trades = tradeHistory.filter(t => t.type === 'trade').length;
  const cuts = cutPlayers.length;
  const totalMoves = faSignings + draftPicks + trades + cuts;

  if (totalMoves === 0) {
    suggestions.push({
      icon: '\uD83D\uDCA1',
      title: 'No Moves Yet',
      description: 'Start building your roster! Visit Free Agency to sign players, or the Draft to select prospects.',
      action: { label: 'Go to Free Agency', path: '/fa' },
      priority: 1,
    });
  } else {
    // Analyze what positions were addressed
    const addressedGroups = new Set();
    signingHistory.forEach(s => { const g = getGroup(s.position); if (g) addressedGroups.add(g); });
    draftedPlayers.forEach(p => { const g = getGroup(p.position); if (g) addressedGroups.add(g); });

    const unaddressed = needs.filter(n => !addressedGroups.has(n.group));

    if (unaddressed.length > 0) {
      suggestions.push({
        icon: '\u26A0\uFE0F',
        title: `Still Need: ${unaddressed.map(n => n.label).slice(0, 2).join(', ')}`,
        description: `Your offseason moves haven't addressed ${unaddressed[0].label}. Consider a late FA signing or trade.`,
        action: { label: 'Go to Free Agency', path: '/fa' },
        priority: 1,
      });
    }

    // Overall grade
    const movesSummary = [];
    if (faSignings > 0) movesSummary.push(`${faSignings} signing${faSignings !== 1 ? 's' : ''}`);
    if (draftPicks > 0) movesSummary.push(`${draftPicks} draft pick${draftPicks !== 1 ? 's' : ''}`);
    if (trades > 0) movesSummary.push(`${trades} trade${trades !== 1 ? 's' : ''}`);
    if (cuts > 0) movesSummary.push(`${cuts} cut${cuts !== 1 ? 's' : ''}`);

    suggestions.push({
      icon: '\uD83D\uDCCA',
      title: `Offseason Activity: ${totalMoves} Move${totalMoves !== 1 ? 's' : ''}`,
      description: `${movesSummary.join(', ')}. ${unaddressed.length === 0 ? 'All major roster needs addressed!' : `${unaddressed.length} position need${unaddressed.length !== 1 ? 's' : ''} still open.`}`,
      action: null,
      priority: 2,
    });
  }

  return suggestions.slice(0, 3);
}

export default function AiSuggest({ embedded, onClose }) {
  const [isOpen, setIsOpen] = useState(!!embedded);
  const location = useLocation();
  const game = useGame();
  const handleClose = () => { if (onClose) onClose(); else setIsOpen(false); };

  const {
    roster, freeAgentPool, draftBoard, capAvailable, totalCap,
    draftStarted, draftComplete, draftedPlayers, myPicks, currentDraftPick,
    signingHistory, cutPlayers, tradeHistory,
  } = game;

  const suggestions = useMemo(() => {
    const path = location.pathname;
    if (path === '/' || path === '') {
      return generateRosterSuggestions(roster);
    } else if (path === '/cap') {
      return generateCapSuggestions(roster, capAvailable, totalCap);
    } else if (path === '/fa') {
      return generateFASuggestions(roster, freeAgentPool, capAvailable);
    } else if (path === '/trades') {
      return generateTradeSuggestions(roster);
    } else if (path === '/draft') {
      return generateDraftSuggestions(roster, draftBoard, draftStarted, draftComplete, draftedPlayers, myPicks, currentDraftPick);
    } else if (path === '/summary') {
      return generateSummarySuggestions(roster, signingHistory, cutPlayers, tradeHistory, draftedPlayers);
    }
    return generateRosterSuggestions(roster);
  }, [location.pathname, roster, freeAgentPool, draftBoard, capAvailable, totalCap, draftStarted, draftComplete, draftedPlayers, myPicks, currentDraftPick, signingHistory, cutPlayers, tradeHistory]);

  if (!isOpen) {
    if (embedded) return null;
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: 120,
          left: 12,
          zIndex: 999,
          background: 'linear-gradient(135deg, #00F0FF, #00A0CC)',
          color: '#000',
          border: 'none',
          borderRadius: 24,
          padding: '8px 14px',
          cursor: 'pointer',
          fontWeight: 700,
          fontSize: 12,
          fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          boxShadow: '0 2px 16px rgba(0,240,255,0.35), 0 0 24px rgba(0,240,255,0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,240,255,0.5), 0 0 32px rgba(0,240,255,0.25)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 2px 16px rgba(0,240,255,0.35), 0 0 24px rgba(0,240,255,0.15)'; }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>{'\uD83E\uDD16'}</span> AI Suggest
      </button>
    );
  }

  return (
    <div style={{
      position: embedded ? 'absolute' : 'fixed',
      bottom: embedded ? 52 : 70,
      right: embedded ? 0 : undefined,
      left: embedded ? undefined : 12,
      zIndex: 999,
      width: 340,
      maxWidth: 'calc(100vw - 24px)',
      background: 'rgba(10, 22, 40, 0.97)',
      border: '1px solid rgba(0,240,255,0.25)',
      borderRadius: 14,
      boxShadow: '0 4px 30px rgba(0,0,0,0.6), 0 0 20px rgba(0,240,255,0.1)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(0,240,255,0.12), rgba(195,0,255,0.08))',
        padding: '12px 14px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid rgba(0,240,255,0.12)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #00F0FF, #00A0CC)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 15,
            boxShadow: '0 0 12px rgba(0,240,255,0.4)',
          }}>
            {'\uD83E\uDD16'}
          </div>
          <div>
            <div style={{
              color: '#00F0FF',
              fontWeight: 700,
              fontSize: 13,
              fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              AI Suggest
            </div>
            <div style={{ color: '#94A3B8', fontSize: 10, marginTop: 1 }}>
              Your AI assistant GM
            </div>
          </div>
        </div>
        <button
          onClick={handleClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#94A3B8',
            fontSize: 18,
            cursor: 'pointer',
            padding: 4,
            lineHeight: 1,
          }}
        >
          {'\u2715'}
        </button>
      </div>

      {/* Suggestions List */}
      <div style={{ padding: '10px 14px 14px', maxHeight: 360, overflowY: 'auto' }}>
        {suggestions.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
            No suggestions right now. Keep building your roster!
          </div>
        ) : (
          suggestions.map((s, i) => (
            <div
              key={i}
              style={{
                background: 'rgba(30,41,59,0.5)',
                border: '1px solid rgba(0,240,255,0.1)',
                borderRadius: 10,
                padding: '10px 12px',
                marginBottom: i < suggestions.length - 1 ? 8 : 0,
                transition: 'border-color 0.2s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,240,255,0.3)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,240,255,0.1)'; }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: 18, lineHeight: 1.2, flexShrink: 0 }}>{s.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    color: '#E2E8F0',
                    fontWeight: 700,
                    fontSize: 13,
                    fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                    letterSpacing: '0.02em',
                    marginBottom: 3,
                  }}>
                    {s.title}
                  </div>
                  <div style={{
                    color: '#94A3B8',
                    fontSize: 12,
                    lineHeight: 1.4,
                  }}>
                    {s.description}
                  </div>
                  {s.action && (
                    <a
                      href={s.action.path}
                      onClick={e => {
                        e.preventDefault();
                        setIsOpen(false);
                        // Use history navigation if available
                        window.history.pushState({}, '', s.action.path);
                        window.dispatchEvent(new PopStateEvent('popstate'));
                      }}
                      style={{
                        display: 'inline-block',
                        marginTop: 6,
                        padding: '4px 10px',
                        background: 'rgba(0,240,255,0.12)',
                        color: '#00F0FF',
                        border: '1px solid rgba(0,240,255,0.25)',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        textDecoration: 'none',
                        cursor: 'pointer',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,240,255,0.22)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,240,255,0.12)'; }}
                    >
                      {s.action.label} {'\u2192'}
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '8px 14px',
        borderTop: '1px solid rgba(0,240,255,0.08)',
        textAlign: 'center',
      }}>
        <span style={{
          color: 'rgba(0,240,255,0.35)',
          fontSize: 9,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontFamily: "'Oswald', 'Inter', system-ui, sans-serif",
        }}>
          AI-Powered Analysis
        </span>
      </div>
    </div>
  );
}
