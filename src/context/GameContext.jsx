import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { bengalsRoster } from '../data/bengalsRoster';
import { freeAgents } from '../data/freeAgents';
import { draftProspects, bengalsPicks } from '../data/draftProspects';
import { teams } from '../data/teams';
import { allRosters } from '../data/allRosters';

const TOTAL_CAP = 301.2; // 2026 NFL salary cap: $301.2M (official, per NFL.com)
const DATA_VERSION = '2026-03-18-v6';

function getTeamRoster(teamAbbr) {
  if (teamAbbr === 'CIN') return bengalsRoster;
  const teamData = allRosters[teamAbbr];
  if (!teamData) return [];
  // Prefix IDs to avoid collisions across teams
  return teamData.players.map((p, i) => ({ ...p, id: `${teamAbbr}-${i}` }));
}

function getTeamPicks(teamAbbr) {
  const team = teams.find(t => t.abbreviation === teamAbbr);
  return team ? team.picks : [];
}

function getTeamColors(teamAbbr) {
  const team = teams.find(t => t.abbreviation === teamAbbr);
  return team ? { primaryColor: team.primaryColor, secondaryColor: team.secondaryColor } : { primaryColor: '#FB4F14', secondaryColor: '#000000' };
}

const initialState = {
  currentTeam: 'CIN',
  currentTeamAbbr: 'CIN',
  selectedTeamColors: { primaryColor: '#FB4F14', secondaryColor: '#000000' },
  roster: bengalsRoster,
  freeAgentPool: freeAgents,
  draftBoard: draftProspects,
  myPicks: bengalsPicks,
  tradeHistory: [],
  signingHistory: [],
  cutPlayers: [],
  draftedPlayers: [],
  allDraftPicks: [],
  futurePicks: [],
  allTeams: teams,
  draftStarted: false,
  draftComplete: false,
  draftClassAdded: false,
  currentDraftPick: 0,
};

function computeCapUsed(roster) {
  // NFL uses Top 51 contracts for offseason cap calculation
  if (roster.length <= 51) {
    return roster.reduce((sum, p) => sum + p.capHit, 0);
  }
  const sorted = [...roster].sort((a, b) => b.capHit - a.capHit);
  return sorted.slice(0, 51).reduce((sum, p) => sum + p.capHit, 0);
}

function gameReducer(state, action) {
  switch (action.type) {
    case 'SIGN_PLAYER': {
      const { player, years, aav, details } = action.payload;
      const d = details || {};
      const year1CapHit = d.year1CapHit || aav;
      const baseSalary = d.baseSalaryY1 || aav;
      const sigBonus = d.signingBonus || 0;
      const gtd = d.guaranteed || 0;
      const deadMoney = d.deadMoneyY2 || sigBonus;
      const capSavings = year1CapHit - deadMoney;
      const newPlayer = {
        ...player,
        id: player.id,
        capHit: parseFloat(year1CapHit.toFixed(1)),
        baseSalary: parseFloat(baseSalary.toFixed(1)),
        contractYears: years,
        contractTotal: parseFloat((aav * years).toFixed(1)),
        yearsRemaining: years - 1,
        isFranchise: false,
        deadMoney: parseFloat(Math.max(deadMoney, 0).toFixed(1)),
        capSavings: parseFloat(capSavings.toFixed(1)),
        signingBonus: parseFloat(sigBonus.toFixed(1)),
        guaranteed: parseFloat(gtd.toFixed(1)),
      };
      const newFAPool = state.freeAgentPool.filter(fa => fa.id !== player.id);
      const newRoster = [...state.roster, newPlayer];
      const newSigning = {
        id: Date.now(),
        type: 'signing',
        player: player.name,
        position: player.position,
        rating: player.rating || 70,
        years,
        aav,
        signingBonus: sigBonus,
        guaranteed: gtd,
        year1CapHit,
        timestamp: new Date().toISOString(),
      };
      return {
        ...state,
        roster: newRoster,
        freeAgentPool: newFAPool,
        signingHistory: [...state.signingHistory, newSigning],
      };
    }

    case 'CUT_PLAYER': {
      const { playerId } = action.payload;
      const player = state.roster.find(p => p.id === playerId);
      if (!player) return state;
      // Use real OTC dead money if available, otherwise estimate
      const deadCap = player.deadMoney != null ? player.deadMoney : player.capHit * 0.3;
      const savings = player.capSavings != null ? player.capSavings : player.capHit - deadCap;
      const cutEntry = { ...player, deadCap, capSavings: savings, cutDate: new Date().toISOString() };
      const newRoster = state.roster.filter(p => p.id !== playerId);
      return {
        ...state,
        roster: newRoster,
        cutPlayers: [...state.cutPlayers, cutEntry],
        tradeHistory: [...state.tradeHistory, {
          id: Date.now(),
          type: 'cut',
          description: `Cut ${player.name} (dead cap: $${deadCap.toFixed(1)}M, savings: $${savings.toFixed(1)}M)`,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    case 'RESTRUCTURE_CONTRACT': {
      const { playerId } = action.payload;
      const player = state.roster.find(p => p.id === playerId);
      if (!player) return state;
      // Restructure converts base salary to signing bonus, spread over remaining years + 1
      const base = player.baseSalary || player.capHit * 0.5;
      const convertible = Math.max(base - 1.1, 0); // keep league minimum as base
      const remainingYrs = Math.max(player.yearsRemaining, 1) + 1;
      const proratedPerYear = convertible / remainingYrs;
      const savings = convertible - proratedPerYear; // this year's savings
      const newCapHit = player.capHit - savings;
      const newContractYears = player.contractYears + 1;
      const updatedPlayer = {
        ...player,
        capHit: parseFloat(Math.max(newCapHit, 0).toFixed(2)),
        contractYears: newContractYears,
        contractTotal: player.contractTotal,
        yearsRemaining: player.yearsRemaining + 1,
        baseSalary: 1.1, // reduced to near-minimum after restructure
        deadMoney: (player.deadMoney || 0) + convertible, // prorated bonus accelerates on cut
      };
      const newRoster = state.roster.map(p => p.id === playerId ? updatedPlayer : p);
      return {
        ...state,
        roster: newRoster,
        tradeHistory: [...state.tradeHistory, {
          id: Date.now(),
          type: 'restructure',
          description: `Restructured ${player.name}: saved $${savings.toFixed(1)}M this year`,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    case 'EXTEND_PLAYER': {
      const { playerId, additionalYears, newAAV, signingBonus, guaranteedPct } = action.payload;
      const player = state.roster.find(p => p.id === playerId);
      if (!player) return state;
      const totalYears = player.yearsRemaining + additionalYears;
      const totalValue = parseFloat((newAAV * totalYears).toFixed(1));
      const guaranteed = parseFloat((totalValue * guaranteedPct / 100).toFixed(1));
      const proratedBonus = totalYears > 0 ? parseFloat((signingBonus / totalYears).toFixed(2)) : 0;
      const baseSalaryY1 = Math.max(1.1, newAAV - proratedBonus);
      const year1CapHit = parseFloat((baseSalaryY1 + proratedBonus).toFixed(1));
      const deadMoney = parseFloat(Math.max(signingBonus, 0).toFixed(1));
      const updatedPlayer = {
        ...player,
        contractYears: totalYears,
        contractTotal: totalValue,
        yearsRemaining: totalYears,
        capHit: year1CapHit,
        baseSalary: parseFloat(baseSalaryY1.toFixed(1)),
        deadMoney,
        signingBonus: parseFloat(signingBonus.toFixed(1)),
        guaranteed,
      };
      const newRoster = state.roster.map(p => p.id === playerId ? updatedPlayer : p);
      return {
        ...state,
        roster: newRoster,
        tradeHistory: [...state.tradeHistory, {
          id: Date.now(),
          type: 'extension',
          description: `Extended ${player.name}: ${totalYears}yr/$${totalValue.toFixed(1)}M ($${newAAV.toFixed(1)}M/yr, $${guaranteed.toFixed(1)}M guaranteed)`,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    case 'TRADE_PLAYER': {
      const { myPlayers, myPicks, theirPlayers, theirPicks, targetTeam } = action.payload;
      const myPlayerIds = myPlayers.map(p => p.id);
      const myPickIds = myPicks.map(pk => `${pk.round}-${pk.pick}`);

      let newRoster = state.roster.filter(p => !myPlayerIds.includes(p.id));
      const theirPlayerObjects = theirPlayers.map(p => ({ ...p, isFranchise: false }));
      newRoster = [...newRoster, ...theirPlayerObjects];

      let newMyPicks = state.myPicks.filter(pk => !myPickIds.includes(`${pk.round}-${pk.pick}`));
      newMyPicks = [...newMyPicks, ...theirPicks];

      const tradeEntry = {
        id: Date.now(),
        type: 'trade',
        description: `Trade with ${targetTeam}: Sent ${myPlayers.map(p => p.name).join(', ')}${myPicks.length ? ' + picks' : ''}. Received ${theirPlayers.map(p => p.name).join(', ')}${theirPicks.length ? ' + picks' : ''}.`,
        timestamp: new Date().toISOString(),
        myPlayers,
        myPicks,
        theirPlayers,
        theirPicks,
        targetTeam,
      };

      return {
        ...state,
        roster: newRoster,
        myPicks: newMyPicks,
        tradeHistory: [...state.tradeHistory, tradeEntry],
      };
    }

    case 'DRAFT_PLAYER': {
      const { prospect, pickNumber } = action.payload;
      const newBoard = state.draftBoard.filter(p => p.id !== prospect.id);
      // Do NOT add to roster here — roster addition happens via ADD_DRAFT_CLASS after draft completes
      const draftEntry = {
        id: Date.now(),
        type: 'draft',
        description: `Drafted ${prospect.name} (${prospect.position}, ${prospect.school}) in Round ${prospect.round}`,
        prospect,
        timestamp: new Date().toISOString(),
      };
      const newMyPicks = state.myPicks.filter(pk => pk.overall !== pickNumber);
      const newAllDraftPicks = [...state.allDraftPicks, { pickNumber, teamAbbr: state.currentTeamAbbr, prospect }];
      return {
        ...state,
        draftBoard: newBoard,
        draftedPlayers: [...state.draftedPlayers, { ...prospect, pickNumber }],
        myPicks: newMyPicks,
        allDraftPicks: newAllDraftPicks,
        tradeHistory: [...state.tradeHistory, draftEntry],
        currentDraftPick: state.currentDraftPick + 1,
      };
    }

    case 'CPU_DRAFT_PLAYER': {
      const { prospect, pickNumber, teamAbbr } = action.payload;
      const newBoard = state.draftBoard.filter(p => p.id !== prospect.id);
      const newAllDraftPicks = [...state.allDraftPicks, { pickNumber, teamAbbr, prospect }];
      return {
        ...state,
        draftBoard: newBoard,
        allDraftPicks: newAllDraftPicks,
        currentDraftPick: state.currentDraftPick + 1,
      };
    }

    case 'SELECT_TEAM': {
      const { teamAbbr } = action.payload;
      const teamObj = teams.find(t => t.abbreviation === teamAbbr);
      if (!teamObj) return state;
      const newRoster = getTeamRoster(teamAbbr);
      const colors = getTeamColors(teamAbbr);
      return {
        ...state,
        currentTeam: teamAbbr,
        currentTeamAbbr: teamAbbr,
        selectedTeamColors: colors,
        roster: newRoster,
        myPicks: getTeamPicks(teamAbbr),
        tradeHistory: [],
        signingHistory: [],
        cutPlayers: [],
        draftedPlayers: [],
        allDraftPicks: [],
        draftStarted: false,
        draftComplete: false,
        currentDraftPick: 0,
      };
    }

    case 'RESET_DRAFT': {
      // If draft class was added to roster, remove those players
      let cleanRoster = state.roster;
      if (state.draftClassAdded && state.draftedPlayers.length > 0) {
        const draftedIds = new Set(state.draftedPlayers.map(p => p.id));
        cleanRoster = state.roster.filter(p => !draftedIds.has(p.id));
      }
      return {
        ...state,
        roster: cleanRoster,
        draftBoard: draftProspects,
        draftedPlayers: [],
        allDraftPicks: [],
        myPicks: getTeamPicks(state.currentTeamAbbr),
        tradeHistory: state.tradeHistory.filter(t => t.type !== 'draft'),
        draftStarted: false,
        draftComplete: false,
        draftClassAdded: false,
        currentDraftPick: 0,
      };
    }

    case 'START_DRAFT':
      return { ...state, draftStarted: true };

    case 'COMPLETE_DRAFT':
      return { ...state, draftComplete: true };

    case 'ADD_DRAFT_CLASS': {
      // Add all drafted players to roster with estimated rookie cap hits
      const rookies = state.draftedPlayers.map(p => {
        const pick = p.pickNumber || 257;
        let capHit;
        if (pick <= 10) capHit = 12 - (pick - 1) * 0.45; // ~12M down to ~8M
        else if (pick <= 32) capHit = 8 - (pick - 11) * 0.19; // ~8M down to ~4M
        else if (pick <= 64) capHit = 4 - (pick - 33) * 0.047; // ~4M down to ~2.5M
        else if (pick <= 96) capHit = 2.5 - (pick - 65) * 0.031; // ~2.5M down to ~1.5M
        else capHit = 1.5 - (pick - 97) * 0.003; // ~1.5M down to ~1.0M
        capHit = Math.max(parseFloat(capHit.toFixed(2)), 0.9);
        return {
          id: p.id,
          name: p.name,
          position: p.position,
          age: p.age || 22,
          capHit,
          contractYears: 4,
          contractTotal: parseFloat((capHit * 4).toFixed(2)),
          yearsRemaining: 3,
          isFranchise: false,
          draftGrade: p.grade,
          grade: p.grade,
          school: p.school,
          round: p.round,
          pickNumber: p.pickNumber,
        };
      });
      // Remove any existing roster entries for these players (from DRAFT_PLAYER), then add rookies
      const rookieIds = new Set(rookies.map(r => r.id));
      const filteredRoster = state.roster.filter(p => !rookieIds.has(p.id));
      return {
        ...state,
        roster: [...filteredRoster, ...rookies],
        draftClassAdded: true,
      };
    }

    case 'TRADE_DRAFT_PICKS': {
      const { sentPicks, receivedPicks, sentPlayers, receivedPlayers, partnerTeamAbbr } = action.payload;

      // Remove sent picks from myPicks, add received picks
      const sentOveralls = new Set(sentPicks.map(p => p.overall));
      let newMyPicks = state.myPicks.filter(pk => !sentOveralls.has(pk.overall));
      newMyPicks = [...newMyPicks, ...receivedPicks].sort((a, b) => a.overall - b.overall);

      // Remove sent players from roster, add received players
      const sentPlayerIds = new Set(sentPlayers.map(p => p.id));
      let newRoster = state.roster.filter(p => !sentPlayerIds.has(p.id));
      newRoster = [...newRoster, ...receivedPlayers.map(p => ({ ...p, isFranchise: false }))];

      const tradeEntry = {
        id: Date.now(),
        type: 'trade',
        description: `Trade with ${partnerTeamAbbr}: Sent ${[...sentPlayers.map(p => p.name), ...sentPicks.map(p => `R${p.round} #${p.overall}`)].join(', ')} for ${[...receivedPlayers.map(p => p.name), ...receivedPicks.map(p => `R${p.round} #${p.overall}`)].join(', ')}`,
        timestamp: new Date().toISOString(),
      };

      return {
        ...state,
        myPicks: newMyPicks,
        roster: newRoster,
        tradeHistory: [...state.tradeHistory, tradeEntry],
      };
    }

    case 'RESET_GAME':
      return initialState;

    default:
      return state;
  }
}

const GameContext = createContext(null);

const STORAGE_KEY = 'bengalOracle_gameState';

export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(gameReducer, initialState, (init) => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Invalidate if data version changed (new roster/FA data)
        if (parsed._dataVersion !== DATA_VERSION) {
          localStorage.removeItem(STORAGE_KEY);
          return { ...init, _dataVersion: DATA_VERSION };
        }
        return { ...init, ...parsed };
      }
    } catch {
      // ignore
    }
    return { ...init, _dataVersion: DATA_VERSION };
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }, [state]);

  const capUsed = computeCapUsed(state.roster);
  const capAvailable = TOTAL_CAP - capUsed;

  const signPlayer = (player, years, aav, details) => {
    dispatch({ type: 'SIGN_PLAYER', payload: { player, years, aav, details } });
  };

  const cutPlayer = (playerId) => {
    dispatch({ type: 'CUT_PLAYER', payload: { playerId } });
  };

  const restructureContract = (playerId) => {
    dispatch({ type: 'RESTRUCTURE_CONTRACT', payload: { playerId } });
  };

  const extendPlayer = (playerId, additionalYears, newAAV, signingBonus, guaranteedPct) => {
    dispatch({ type: 'EXTEND_PLAYER', payload: { playerId, additionalYears, newAAV, signingBonus, guaranteedPct } });
  };

  const tradePlayer = (myPlayers, myPicks, theirPlayers, theirPicks, targetTeam) => {
    dispatch({ type: 'TRADE_PLAYER', payload: { myPlayers, myPicks, theirPlayers, theirPicks, targetTeam } });
  };

  const draftPlayer = (prospect, pickNumber) => {
    dispatch({ type: 'DRAFT_PLAYER', payload: { prospect, pickNumber } });
  };

  const cpuDraftPlayer = (prospect, pickNumber, teamAbbr) => {
    dispatch({ type: 'CPU_DRAFT_PLAYER', payload: { prospect, pickNumber, teamAbbr } });
  };

  const startDraft = () => dispatch({ type: 'START_DRAFT' });
  const completeDraft = () => dispatch({ type: 'COMPLETE_DRAFT' });
  const resetGame = () => dispatch({ type: 'RESET_GAME' });
  const resetDraft = () => dispatch({ type: 'RESET_DRAFT' });
  const selectTeam = (teamAbbr) => dispatch({ type: 'SELECT_TEAM', payload: { teamAbbr } });
  const addDraftClass = () => dispatch({ type: 'ADD_DRAFT_CLASS' });
  const tradeDraftPicks = (sentPicks, receivedPicks, sentPlayers, receivedPlayers, partnerTeamAbbr) => {
    dispatch({ type: 'TRADE_DRAFT_PICKS', payload: { sentPicks, receivedPicks, sentPlayers, receivedPlayers, partnerTeamAbbr } });
  };

  return (
    <GameContext.Provider value={{
      ...state,
      capUsed,
      capAvailable,
      totalCap: TOTAL_CAP,
      signPlayer,
      cutPlayer,
      restructureContract,
      extendPlayer,
      tradePlayer,
      draftPlayer,
      cpuDraftPlayer,
      startDraft,
      completeDraft,
      resetGame,
      resetDraft,
      selectTeam,
      addDraftClass,
      tradeDraftPicks,
    }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
}
