import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { mlbTeams, CBT_THRESHOLDS } from '../data/mlb/mlbTeams';
import { mlbRosters } from '../data/mlb/mlbRosters';
import { mlbFreeAgents } from '../data/mlb/mlbFreeAgents';

const DATA_VERSION = 'mlb-2025-v1';

const MLBGameContext = createContext(null);

export function useMLBGame() {
  const ctx = useContext(MLBGameContext);
  if (!ctx) throw new Error('useMLBGame must be used inside MLBGameProvider');
  return ctx;
}

function getTeamRoster(teamAbbr) {
  const teamData = mlbRosters[teamAbbr];
  if (!teamData) return [];
  return teamData.players.map((p, i) => ({ ...p, id: `${teamAbbr}-${i}` }));
}

function getTeamPayroll(teamAbbr) {
  const teamData = mlbRosters[teamAbbr];
  return teamData ? teamData.payroll : 0;
}

function getTeamColors(teamAbbr) {
  const team = mlbTeams.find(t => t.abbreviation === teamAbbr);
  return team
    ? { primaryColor: team.primaryColor, secondaryColor: team.secondaryColor }
    : { primaryColor: '#003087', secondaryColor: '#C4CED4' };
}

// Compute CBT penalty tier based on payroll
export function computeCBT(payroll, isRepeatOffender = false) {
  if (payroll <= CBT_THRESHOLDS.first) {
    return { tier: 0, label: 'Under Threshold', penalty: 0, penaltyAmt: 0, color: '#4ade80' };
  }
  const over1 = payroll - CBT_THRESHOLDS.first;
  if (payroll <= CBT_THRESHOLDS.second) {
    const rate = isRepeatOffender ? 0.30 : 0.20;
    return {
      tier: 1,
      label: '1st CBT Threshold',
      penalty: rate * 100,
      penaltyAmt: parseFloat((over1 * rate).toFixed(2)),
      color: '#facc15',
    };
  }
  const over2 = payroll - CBT_THRESHOLDS.second;
  if (payroll <= CBT_THRESHOLDS.third) {
    const rate1 = isRepeatOffender ? 0.30 : 0.20;
    const rate2 = isRepeatOffender ? 0.42 : 0.32;
    const penalty = (CBT_THRESHOLDS.second - CBT_THRESHOLDS.first) * rate1 + over2 * rate2;
    return {
      tier: 2,
      label: '2nd CBT Threshold',
      penalty: rate2 * 100,
      penaltyAmt: parseFloat(penalty.toFixed(2)),
      color: '#fb923c',
    };
  }
  // Above third threshold — add surtax
  const rate1 = isRepeatOffender ? 0.30 : 0.20;
  const rate2 = isRepeatOffender ? 0.42 : 0.32;
  const rate3 = isRepeatOffender ? 0.95 : 0.62;
  const over3 = payroll - CBT_THRESHOLDS.third;
  const penalty =
    (CBT_THRESHOLDS.second - CBT_THRESHOLDS.first) * rate1 +
    (CBT_THRESHOLDS.third - CBT_THRESHOLDS.second) * rate2 +
    over3 * rate3;
  return {
    tier: 3,
    label: '3rd CBT Threshold',
    penalty: rate3 * 100,
    penaltyAmt: parseFloat(penalty.toFixed(2)),
    color: '#ef4444',
  };
}

function computePayroll(roster) {
  return parseFloat(roster.reduce((sum, p) => sum + (p.salary || 0), 0).toFixed(2));
}

// Determine service time status label
export function getServiceStatus(serviceTime) {
  if (serviceTime < 3) return 'Pre-Arb';
  if (serviceTime < 6) return `Arb${Math.min(3, Math.ceil(serviceTime - 2))}`;
  return 'Free Agent';
}

const initialState = {
  currentTeam: 'NYY',
  currentTeamAbbr: 'NYY',
  selectedTeamColors: getTeamColors('NYY'),
  roster: getTeamRoster('NYY'),
  freeAgentPool: mlbFreeAgents,
  tradeHistory: [],
  signingHistory: [],
  cutPlayers: [],
  allTeams: mlbTeams,
  savedScenarios: [],
  activeScenarioName: null,
};

function mlbReducer(state, action) {
  switch (action.type) {

    case 'SELECT_TEAM': {
      const abbr = action.payload;
      const team = mlbTeams.find(t => t.abbreviation === abbr);
      if (!team) return state;
      return {
        ...state,
        currentTeam: abbr,
        currentTeamAbbr: abbr,
        selectedTeamColors: getTeamColors(abbr),
        roster: getTeamRoster(abbr),
        freeAgentPool: mlbFreeAgents,
        tradeHistory: [],
        signingHistory: [],
        cutPlayers: [],
      };
    }

    case 'SIGN_PLAYER': {
      const { player, years, aav } = action.payload;
      const newPlayer = {
        ...player,
        id: player.id || `signed-${Date.now()}`,
        salary: parseFloat(aav.toFixed(1)),
        contractYears: years,
        contractTotal: parseFloat((aav * years).toFixed(1)),
        isNewSigning: true,
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
        timestamp: new Date().toISOString(),
      };
      return {
        ...state,
        roster: newRoster,
        freeAgentPool: newFAPool,
        signingHistory: [...state.signingHistory, newSigning],
      };
    }

    case 'RELEASE_PLAYER': {
      const { playerId } = action.payload;
      const player = state.roster.find(p => p.id === playerId);
      if (!player) return state;
      // In MLB, released players count against payroll for remainder of contract (buyout)
      const buyout = player.salary * 0.15; // ~15% buyout estimate
      const newRoster = state.roster.filter(p => p.id !== playerId);
      const cutEntry = { ...player, buyout, releaseDate: new Date().toISOString() };
      return {
        ...state,
        roster: newRoster,
        cutPlayers: [...state.cutPlayers, cutEntry],
        tradeHistory: [...state.tradeHistory, {
          id: Date.now(),
          type: 'release',
          description: `Released ${player.name} (buyout: $${buyout.toFixed(1)}M/yr)`,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    case 'TRADE_PLAYER': {
      const { myPlayers, theirPlayers, targetTeam } = action.payload;
      const myPlayerIds = myPlayers.map(p => p.id);
      let newRoster = state.roster.filter(p => !myPlayerIds.includes(p.id));
      newRoster = [...newRoster, ...theirPlayers.map(p => ({ ...p }))];
      const tradeEntry = {
        id: Date.now(),
        type: 'trade',
        description: `Trade with ${targetTeam}: Sent ${myPlayers.map(p => p.name).join(', ')}. Received ${theirPlayers.map(p => p.name).join(', ')}.`,
        timestamp: new Date().toISOString(),
        myPlayers,
        theirPlayers,
        targetTeam,
      };
      return {
        ...state,
        roster: newRoster,
        tradeHistory: [...state.tradeHistory, tradeEntry],
      };
    }

    case 'SAVE_SCENARIO': {
      const { name } = action.payload;
      const snapshot = {
        id: Date.now(),
        name,
        team: state.currentTeamAbbr,
        roster: state.roster,
        signingHistory: state.signingHistory,
        tradeHistory: state.tradeHistory,
        cutPlayers: state.cutPlayers,
        savedAt: new Date().toISOString(),
      };
      const existing = state.savedScenarios.findIndex(s => s.name === name);
      const newScenarios = existing >= 0
        ? state.savedScenarios.map((s, i) => i === existing ? snapshot : s)
        : [...state.savedScenarios, snapshot];
      return { ...state, savedScenarios: newScenarios, activeScenarioName: name };
    }

    case 'LOAD_SCENARIO': {
      const { name } = action.payload;
      const scenario = state.savedScenarios.find(s => s.name === name);
      if (!scenario) return state;
      return {
        ...state,
        roster: scenario.roster,
        signingHistory: scenario.signingHistory,
        tradeHistory: scenario.tradeHistory,
        cutPlayers: scenario.cutPlayers,
        activeScenarioName: name,
      };
    }

    case 'DELETE_SCENARIO': {
      const { name } = action.payload;
      return {
        ...state,
        savedScenarios: state.savedScenarios.filter(s => s.name !== name),
        activeScenarioName: state.activeScenarioName === name ? null : state.activeScenarioName,
      };
    }

    case 'RESET_TEAM': {
      const abbr = state.currentTeamAbbr;
      return {
        ...state,
        roster: getTeamRoster(abbr),
        freeAgentPool: mlbFreeAgents,
        tradeHistory: [],
        signingHistory: [],
        cutPlayers: [],
      };
    }

    default:
      return state;
  }
}

const STORAGE_KEY = 'aimlbgm_state_v1';

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed._version !== DATA_VERSION) return null;
    return parsed.state;
  } catch {
    return null;
  }
}

export function MLBGameProvider({ children }) {
  const persisted = loadPersistedState();
  const [state, dispatch] = useReducer(mlbReducer, persisted || initialState);

  // Persist state on every change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ _version: DATA_VERSION, state }));
    } catch {}
  }, [state]);

  const payroll = computePayroll(state.roster);
  const cbt = computeCBT(payroll);
  const payrollRemaining = parseFloat((CBT_THRESHOLDS.first - payroll).toFixed(2));

  const value = {
    // State
    ...state,
    payroll,
    cbt,
    payrollRemaining,

    // Actions
    selectTeam: (abbr) => dispatch({ type: 'SELECT_TEAM', payload: abbr }),
    signPlayer: (player, years, aav) => dispatch({ type: 'SIGN_PLAYER', payload: { player, years, aav } }),
    releasePlayer: (playerId) => dispatch({ type: 'RELEASE_PLAYER', payload: { playerId } }),
    tradePlayer: (myPlayers, theirPlayers, targetTeam) =>
      dispatch({ type: 'TRADE_PLAYER', payload: { myPlayers, theirPlayers, targetTeam } }),
    resetTeam: () => dispatch({ type: 'RESET_TEAM' }),
    saveScenario: (name) => dispatch({ type: 'SAVE_SCENARIO', payload: { name } }),
    loadScenario: (name) => dispatch({ type: 'LOAD_SCENARIO', payload: { name } }),
    deleteScenario: (name) => dispatch({ type: 'DELETE_SCENARIO', payload: { name } }),
  };

  return (
    <MLBGameContext.Provider value={value}>
      {children}
    </MLBGameContext.Provider>
  );
}
