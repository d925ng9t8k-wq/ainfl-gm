import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { nbaFreeAgents } from '../data/nba/nbaFreeAgents';
import { nbaDraftProspects, getTeamNbaPicks } from '../data/nba/nbaDraftProspects';
import { nbaTeams } from '../data/nba/nbaTeams';
import { nbaRosters } from '../data/nba/nbaRosters';

// 2025-26 NBA salary cap figures (official)
const SALARY_CAP = 154.647;
const LUXURY_TAX = 187.895;
const FIRST_APRON = 195.945;
const SECOND_APRON = 207.824;

const DATA_VERSION = 'nba-2026-v1';
const STORAGE_KEY = 'nbaOracle_gameState';

const DEFAULT_TEAM = 'BOS'; // default to Celtics

function getTeamRoster(teamAbbr) {
  const teamData = nbaRosters[teamAbbr];
  if (!teamData) return [];
  return teamData.players.map((p, i) => ({
    ...p,
    id: `${teamAbbr}-${i}`,
    deadMoney: 0,
    capSavings: p.capHit,
  }));
}

function getTeamColors(teamAbbr) {
  const team = nbaTeams.find(t => t.abbreviation === teamAbbr);
  return team
    ? { primaryColor: team.primaryColor, secondaryColor: team.secondaryColor }
    : { primaryColor: '#1D428A', secondaryColor: '#FFC72C' };
}

function computeTotalSalary(roster) {
  return roster.reduce((sum, p) => sum + (p.capHit || 0), 0);
}

function isOverSecondApron(total) {
  return total > SECOND_APRON;
}
function isOverFirstApron(total) {
  return total > FIRST_APRON;
}
function isOverLuxuryTax(total) {
  return total > LUXURY_TAX;
}

// NBA max salary tiers (2025-26 approx)
// 0-6 years: ~$34M, 7-9 years: ~$41M, 10+ years: ~$49M
function getMaxSalary(yearsInLeague) {
  if (yearsInLeague >= 10) return 49.2;
  if (yearsInLeague >= 7) return 41.0;
  return 34.0;
}

const initialState = {
  currentTeam: DEFAULT_TEAM,
  currentTeamAbbr: DEFAULT_TEAM,
  selectedTeamColors: getTeamColors(DEFAULT_TEAM),
  roster: getTeamRoster(DEFAULT_TEAM),
  freeAgentPool: nbaFreeAgents,
  draftBoard: nbaDraftProspects,
  myPicks: getTeamNbaPicks(DEFAULT_TEAM),
  tradeHistory: [],
  signingHistory: [],
  cutPlayers: [],
  draftedPlayers: [],
  allDraftPicks: [],
  allTeams: nbaTeams,
  draftStarted: false,
  draftComplete: false,
  draftClassAdded: false,
  currentDraftPick: 0,
  savedScenarios: [],
  activeScenarioName: null,
};

function nbaReducer(state, action) {
  switch (action.type) {

    case 'SIGN_PLAYER': {
      const { player, years, aav } = action.payload;
      const newPlayer = {
        ...player,
        id: player.id || `signed-${Date.now()}`,
        capHit: parseFloat(aav.toFixed(1)),
        contractYears: years,
        contractTotal: parseFloat((aav * years).toFixed(1)),
        yearsRemaining: years - 1,
        deadMoney: 0,
        capSavings: parseFloat(aav.toFixed(1)),
        contractType: aav >= 40 ? 'max' : aav >= 20 ? 'mid' : 'vet-min',
        birdRights: false,
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

    case 'CUT_PLAYER': {
      const { playerId } = action.payload;
      const player = state.roster.find(p => p.id === playerId);
      if (!player) return state;
      // NBA buyout: typically ~1/3 of remaining salary is dead money
      const deadCap = parseFloat((player.capHit * 0.33).toFixed(1));
      const savings = parseFloat((player.capHit - deadCap).toFixed(1));
      const cutEntry = { ...player, deadCap, capSavings: savings, cutDate: new Date().toISOString() };
      const newRoster = state.roster.filter(p => p.id !== playerId);
      return {
        ...state,
        roster: newRoster,
        cutPlayers: [...state.cutPlayers, cutEntry],
        tradeHistory: [...state.tradeHistory, {
          id: Date.now(),
          type: 'cut',
          description: `Waived/Bought out ${player.name} (dead cap: $${deadCap.toFixed(1)}M, savings: $${savings.toFixed(1)}M)`,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    case 'EXTEND_PLAYER': {
      const { playerId, additionalYears, newAAV } = action.payload;
      const player = state.roster.find(p => p.id === playerId);
      if (!player) return state;
      const totalYears = (player.yearsRemaining || 0) + additionalYears;
      const totalValue = parseFloat((newAAV * totalYears).toFixed(1));
      const updatedPlayer = {
        ...player,
        contractYears: totalYears,
        contractTotal: totalValue,
        yearsRemaining: totalYears,
        capHit: parseFloat(newAAV.toFixed(1)),
        capSavings: parseFloat(newAAV.toFixed(1)),
        birdRights: true, // extension means team had Bird rights
      };
      const newRoster = state.roster.map(p => p.id === playerId ? updatedPlayer : p);
      return {
        ...state,
        roster: newRoster,
        tradeHistory: [...state.tradeHistory, {
          id: Date.now(),
          type: 'extension',
          description: `Extended ${player.name}: ${totalYears}yr/$${totalValue.toFixed(1)}M ($${newAAV.toFixed(1)}M/yr)`,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    case 'TRADE_PLAYER': {
      const { myPlayers, myPicks, theirPlayers, theirPicks, targetTeam } = action.payload;
      const myPlayerIds = myPlayers.map(p => p.id);
      const myPickOveralls = myPicks.map(pk => pk.overall);

      let newRoster = state.roster.filter(p => !myPlayerIds.includes(p.id));
      newRoster = [...newRoster, ...theirPlayers.map(p => ({ ...p }))];

      let newMyPicks = state.myPicks.filter(pk => !myPickOveralls.includes(pk.overall));
      newMyPicks = [...newMyPicks, ...theirPicks];

      const tradeEntry = {
        id: Date.now(),
        type: 'trade',
        description: `Trade with ${targetTeam}: Sent ${myPlayers.map(p => p.name).join(', ')}${myPicks.length ? ' + picks' : ''}. Received ${theirPlayers.map(p => p.name).join(', ')}${theirPicks.length ? ' + picks' : ''}.`,
        timestamp: new Date().toISOString(),
        myPlayers, myPicks, theirPlayers, theirPicks, targetTeam,
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
      const newMyPicks = state.myPicks.filter(pk => pk.overall !== pickNumber);
      const newAllDraftPicks = [...state.allDraftPicks, { pickNumber, teamAbbr: state.currentTeamAbbr, prospect }];
      return {
        ...state,
        draftBoard: newBoard,
        draftedPlayers: [...state.draftedPlayers, { ...prospect, pickNumber }],
        myPicks: newMyPicks,
        allDraftPicks: newAllDraftPicks,
        tradeHistory: [...state.tradeHistory, {
          id: Date.now(),
          type: 'draft',
          description: `Drafted ${prospect.name} (${prospect.position}, ${prospect.school}) at pick #${pickNumber}`,
          prospect,
          timestamp: new Date().toISOString(),
        }],
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

    case 'ADD_DRAFT_CLASS': {
      const rookies = state.draftedPlayers.map(p => {
        const pick = p.pickNumber || 60;
        let capHit;
        if (pick <= 5) capHit = 11.0 - (pick - 1) * 0.4;
        else if (pick <= 15) capHit = 9.0 - (pick - 6) * 0.3;
        else if (pick <= 30) capHit = 6.0 - (pick - 16) * 0.15;
        else capHit = 3.5 - (pick - 31) * 0.04;
        capHit = Math.max(parseFloat(capHit.toFixed(2)), 1.1);
        return {
          id: p.id,
          name: p.name,
          position: p.position,
          age: p.age || 21,
          capHit,
          contractYears: 4,
          contractTotal: parseFloat((capHit * 4).toFixed(2)),
          yearsRemaining: 3,
          contractType: 'rookie',
          birdRights: false,
          deadMoney: 0,
          capSavings: capHit,
          draftGrade: p.grade,
          grade: p.grade,
          school: p.school,
          round: p.round,
          pickNumber: p.pickNumber,
          traits: p.traits || [],
        };
      });
      const rookieIds = new Set(rookies.map(r => r.id));
      const filteredRoster = state.roster.filter(p => !rookieIds.has(p.id));
      return { ...state, roster: [...filteredRoster, ...rookies], draftClassAdded: true };
    }

    case 'SELECT_TEAM': {
      const { teamAbbr } = action.payload;
      const teamObj = nbaTeams.find(t => t.abbreviation === teamAbbr);
      if (!teamObj) return state;
      return {
        ...state,
        currentTeam: teamAbbr,
        currentTeamAbbr: teamAbbr,
        selectedTeamColors: getTeamColors(teamAbbr),
        roster: getTeamRoster(teamAbbr),
        myPicks: getTeamNbaPicks(teamAbbr),
        tradeHistory: [],
        signingHistory: [],
        cutPlayers: [],
        draftedPlayers: [],
        allDraftPicks: [],
        draftStarted: false,
        draftComplete: false,
        currentDraftPick: 0,
        freeAgentPool: nbaFreeAgents,
        draftBoard: nbaDraftProspects,
      };
    }

    case 'START_DRAFT':
      return { ...state, draftStarted: true };

    case 'COMPLETE_DRAFT':
      return { ...state, draftComplete: true };

    case 'RESET_DRAFT': {
      let cleanRoster = state.roster;
      if (state.draftClassAdded && state.draftedPlayers.length > 0) {
        const draftedIds = new Set(state.draftedPlayers.map(p => p.id));
        cleanRoster = state.roster.filter(p => !draftedIds.has(p.id));
      }
      return {
        ...state,
        roster: cleanRoster,
        draftBoard: nbaDraftProspects,
        draftedPlayers: [],
        allDraftPicks: [],
        myPicks: getTeamNbaPicks(state.currentTeamAbbr),
        tradeHistory: state.tradeHistory.filter(t => t.type !== 'draft'),
        draftStarted: false,
        draftComplete: false,
        draftClassAdded: false,
        currentDraftPick: 0,
      };
    }

    case 'SAVE_SCENARIO': {
      const { name } = action.payload;
      const snapshot = {
        name,
        savedAt: new Date().toISOString(),
        teamAbbr: state.currentTeamAbbr,
        roster: state.roster,
        signingHistory: state.signingHistory,
        tradeHistory: state.tradeHistory,
        cutPlayers: state.cutPlayers,
        draftedPlayers: state.draftedPlayers,
        freeAgentPool: state.freeAgentPool,
        myPicks: state.myPicks,
        draftComplete: state.draftComplete,
        draftClassAdded: state.draftClassAdded,
      };
      const existing = state.savedScenarios.filter(s => s.name !== name);
      return { ...state, savedScenarios: [...existing, snapshot].slice(-5), activeScenarioName: name };
    }

    case 'LOAD_SCENARIO': {
      const { name } = action.payload;
      const scenario = state.savedScenarios.find(s => s.name === name);
      if (!scenario) return state;
      return { ...state, ...scenario, savedScenarios: state.savedScenarios, activeScenarioName: name };
    }

    case 'DELETE_SCENARIO': {
      const { name } = action.payload;
      return {
        ...state,
        savedScenarios: state.savedScenarios.filter(s => s.name !== name),
        activeScenarioName: state.activeScenarioName === name ? null : state.activeScenarioName,
      };
    }

    case 'RESET_GAME':
      return { ...initialState };

    default:
      return state;
  }
}

const NbaGameContext = createContext(null);

export function NbaGameProvider({ children }) {
  const [state, dispatch] = useReducer(nbaReducer, initialState, (init) => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
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

  // Cap calculation
  const teamData = nbaRosters[state.currentTeamAbbr];
  const totalSalary = computeTotalSalary(state.roster);

  // User delta: signings add to cap, cuts subtract (save the difference)
  const userAddedCap = state.signingHistory.reduce((sum, s) => sum + (s.aav || 0), 0);
  const userFreedCap = state.cutPlayers.reduce((sum, p) => sum + Math.max((p.capHit || 0) - (p.deadCap || 0), 0), 0);
  const userCapDelta = userAddedCap - userFreedCap;

  // Use official cap data + user adjustments
  const baseCapSpace = teamData?.capSummary?.capSpace ?? (SALARY_CAP - totalSalary);
  const capAvailable = baseCapSpace - userCapDelta;
  const capUsed = SALARY_CAP - capAvailable;

  const overLuxuryTax = isOverLuxuryTax(totalSalary + userCapDelta + Math.max(0, -baseCapSpace));
  const overFirstApron = isOverFirstApron(totalSalary + userCapDelta + Math.max(0, -baseCapSpace));
  const overSecondApron = isOverSecondApron(totalSalary + userCapDelta + Math.max(0, -baseCapSpace));

  const signPlayer = (player, years, aav) =>
    dispatch({ type: 'SIGN_PLAYER', payload: { player, years, aav } });
  const cutPlayer = (playerId) =>
    dispatch({ type: 'CUT_PLAYER', payload: { playerId } });
  const extendPlayer = (playerId, additionalYears, newAAV) =>
    dispatch({ type: 'EXTEND_PLAYER', payload: { playerId, additionalYears, newAAV } });
  const tradePlayer = (myPlayers, myPicks, theirPlayers, theirPicks, targetTeam) =>
    dispatch({ type: 'TRADE_PLAYER', payload: { myPlayers, myPicks, theirPlayers, theirPicks, targetTeam } });
  const draftPlayer = (prospect, pickNumber) =>
    dispatch({ type: 'DRAFT_PLAYER', payload: { prospect, pickNumber } });
  const cpuDraftPlayer = (prospect, pickNumber, teamAbbr) =>
    dispatch({ type: 'CPU_DRAFT_PLAYER', payload: { prospect, pickNumber, teamAbbr } });
  const selectTeam = (teamAbbr) =>
    dispatch({ type: 'SELECT_TEAM', payload: { teamAbbr } });
  const startDraft = () => dispatch({ type: 'START_DRAFT' });
  const completeDraft = () => dispatch({ type: 'COMPLETE_DRAFT' });
  const resetGame = () => dispatch({ type: 'RESET_GAME' });
  const resetDraft = () => dispatch({ type: 'RESET_DRAFT' });
  const addDraftClass = () => dispatch({ type: 'ADD_DRAFT_CLASS' });
  const saveScenario = (name) => dispatch({ type: 'SAVE_SCENARIO', payload: { name } });
  const loadScenario = (name) => dispatch({ type: 'LOAD_SCENARIO', payload: { name } });
  const deleteScenario = (name) => dispatch({ type: 'DELETE_SCENARIO', payload: { name } });

  return (
    <NbaGameContext.Provider value={{
      ...state,
      capUsed,
      capAvailable,
      totalCap: SALARY_CAP,
      luxuryTax: LUXURY_TAX,
      firstApron: FIRST_APRON,
      secondApron: SECOND_APRON,
      overLuxuryTax,
      overFirstApron,
      overSecondApron,
      totalSalary,
      getMaxSalary,
      signPlayer,
      cutPlayer,
      extendPlayer,
      tradePlayer,
      draftPlayer,
      cpuDraftPlayer,
      selectTeam,
      startDraft,
      completeDraft,
      resetGame,
      resetDraft,
      addDraftClass,
      saveScenario,
      loadScenario,
      deleteScenario,
    }}>
      {children}
    </NbaGameContext.Provider>
  );
}

export function useNbaGame() {
  const ctx = useContext(NbaGameContext);
  if (!ctx) throw new Error('useNbaGame must be used within NbaGameProvider');
  return ctx;
}
