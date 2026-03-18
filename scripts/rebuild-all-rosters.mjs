/**
 * BengalOracle GM — Rebuild All Rosters from Scraped Data
 * Merges OTC dead money data, ESPN roster data, and contract end years
 * into a complete allRosters.js matching the bengalsRoster.js field structure.
 *
 * Run: node ~/Projects/BengalOracle/scripts/rebuild-all-rosters.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'src', 'data');

// ─── LOAD DATA ─────────────────────────────────────────────────────────────────

const deadMoneyRaw = JSON.parse(readFileSync(join(__dirname, 'all-teams-deadmoney.json'), 'utf8'));
const espnRosters = JSON.parse(readFileSync(join(__dirname, 'espn-rosters.json'), 'utf8'));
const contractEndYears = JSON.parse(readFileSync(join(__dirname, 'contract-end-years.json'), 'utf8'));

// Load offseason moves to remove departed players
const offseasonMovesPath = join(SRC, 'offseasonMoves.js');
const offseasonMovesText = readFileSync(offseasonMovesPath, 'utf8');

// Parse departed players from offseasonMoves.js
function parseDepartures(text) {
  // Extract departures arrays per team
  const departures = {};
  // Match team blocks
  const teamRegex = /\b([A-Z]{2,3}):\s*\{/g;
  let match;
  const teamPositions = [];
  while ((match = teamRegex.exec(text)) !== null) {
    teamPositions.push({ abbr: match[1], idx: match.index });
  }

  for (let i = 0; i < teamPositions.length; i++) {
    const team = teamPositions[i].abbr;
    const start = teamPositions[i].idx;
    const end = i + 1 < teamPositions.length ? teamPositions[i + 1].idx : text.length;
    const block = text.substring(start, end);

    // Find departures array
    const depMatch = block.match(/departures:\s*\[([\s\S]*?)\]/);
    if (depMatch) {
      const depBlock = depMatch[1];
      const playerMatches = [...depBlock.matchAll(/player:\s*'([^']+)'/g)];
      departures[team] = playerMatches.map(m => m[1]);
    }
  }
  return departures;
}

const departuresByTeam = parseDepartures(offseasonMovesText);

// Slug to abbreviation mapping
const SLUG_TO_ABBR = {
  'arizona-cardinals': 'ARI', 'atlanta-falcons': 'ATL', 'baltimore-ravens': 'BAL',
  'buffalo-bills': 'BUF', 'carolina-panthers': 'CAR', 'chicago-bears': 'CHI',
  'cincinnati-bengals': 'CIN', 'cleveland-browns': 'CLE', 'dallas-cowboys': 'DAL',
  'denver-broncos': 'DEN', 'detroit-lions': 'DET', 'green-bay-packers': 'GB',
  'houston-texans': 'HOU', 'indianapolis-colts': 'IND', 'jacksonville-jaguars': 'JAX',
  'kansas-city-chiefs': 'KC', 'las-vegas-raiders': 'LV', 'los-angeles-chargers': 'LAC',
  'los-angeles-rams': 'LAR', 'miami-dolphins': 'MIA', 'minnesota-vikings': 'MIN',
  'new-england-patriots': 'NE', 'new-orleans-saints': 'NO', 'new-york-giants': 'NYG',
  'new-york-jets': 'NYJ', 'philadelphia-eagles': 'PHI', 'pittsburgh-steelers': 'PIT',
  'san-francisco-49ers': 'SF', 'seattle-seahawks': 'SEA', 'tampa-bay-buccaneers': 'TB',
  'tennessee-titans': 'TEN', 'washington-commanders': 'WSH',
};

// ─── NAME MATCHING ─────────────────────────────────────────────────────────────

function normalizeName(name) {
  return name
    // Remove commas before suffixes: "Pittman, Jr." -> "Pittman Jr."
    .replace(/,\s*(Jr\.|Jr|III|II|IV|Sr\.|Sr)/gi, ' $1')
    // Remove suffixes entirely
    .replace(/\s+(Jr\.|Jr|III|II|IV|V|Sr\.|Sr)$/i, '')
    .replace(/\s+(Jr\.|Jr|III|II|IV|V|Sr\.|Sr)\s+/gi, ' ')
    // Remove periods from initials: D.J. -> DJ, A.J. -> AJ
    .replace(/\./g, '')
    // Normalize quotes
    .replace(/[''`]/g, "'")
    .trim()
    .toLowerCase();
}

// Common nickname/full name mappings
const NAME_ALIASES = {
  'gregory': 'greg',
  'greg': 'gregory',
  'patrick': 'pat',
  'pat': 'patrick',
  'matthew': 'matt',
  'matt': 'matthew',
  'michael': 'mike',
  'mike': 'michael',
  'robert': 'rob',
  'rob': 'robert',
  'christopher': 'chris',
  'chris': 'christopher',
  'william': 'will',
  'will': 'william',
  'benjamin': 'ben',
  'ben': 'benjamin',
  'cameron': 'cam',
  'cam': 'cameron',
  'marshall': 'marshawn',
  'kamren': 'kam',
  'kam': 'kamren',
  'dk': 'dk',
  'dj': 'dj',
  'cj': 'cj',
  'aj': 'aj',
  'jt': 'jt',
  'jk': 'jk',
  'jj': 'jj',
  'jc': 'jc',
  'jp': 'jp',
  'rj': 'rj',
  'bj': 'bj',
  'pj': 'pj',
  'tj': 'tj',
  'kt': 'kt',
  'jl': 'jl',
  'mj': 'mj',
};

// Manual name mappings for players with completely different names in OTC vs ESPN
const MANUAL_ALIASES = {
  'ahmad gardner': 'sauce gardner',
  'sauce gardner': 'ahmad gardner',
  'chauncey gardner-johnson': 'cj gardner-johnson',
  'cj gardner-johnson': 'chauncey gardner-johnson',
};

// Manual position/age overrides for notable players not in ESPN data
// (dead cap charges, recent signings, etc.)
const MANUAL_OVERRIDES = {
  'Kirk Cousins': { position: 'QB', age: 37 },
  'David Njoku': { position: 'TE', age: 28 },
  'Wyatt Teller': { position: 'OG', age: 30 },
  'Jaylen Waddle': { position: 'WR', age: 26 },
  'Harrison Smith': { position: 'S', age: 37 },
  'Jonathan Allen': { position: 'DT', age: 31 },
  'Nate Hobbs': { position: 'CB', age: 25 },
  'Dre Greenlaw': { position: 'LB', age: 28 },
  'Marshawn Kneeland': { position: 'DE', age: 24 },
  'Julius Brents': { position: 'CB', age: 25 },
  'Chauncey Gardner-Johnson, Jr.': { position: 'S', age: 28 },
  'Nik Constantinou': { position: 'P', age: 25 },
  'Basil Okoye': { position: 'DT', age: 25 },
  'Gerad Christian-Lichtenhan': { position: 'OT', age: 28 },
  'Dante Barnett': { position: 'S', age: 27 },
  'Layne Pryor': { position: 'OT', age: 25 },
  'Delmar Glaze': { position: 'OT', age: 25 },
  'Brodric Martin': { position: 'DT', age: 26 },
  'Damien Alford': { position: 'WR', age: 24 },
  'Xavier Newman-Johnson': { position: 'OG', age: 26 },
  'Francisco Mauigoa': { position: 'LB', age: 22 },
  'Juanyeh Thomas': { position: 'S', age: 26 },
  'Devin Veresuk': { position: 'OT', age: 24 },
  'Rob Carter': { position: 'OG', age: 24 },
  'Andrew Ogletree': { position: 'TE', age: 26 },
  'Jaseem Reed': { position: 'WR', age: 24 },
  'Jacob Roberts': { position: 'TE', age: 25 },
  'Jaylon Hutchings': { position: 'DT', age: 25 },
  'Andru Phillips': { position: 'CB', age: 24 },
  'Sala Aumavae-Laulu': { position: 'OT', age: 26 },
  'Nathan Thomas': { position: 'WR', age: 24 },
};

function findESPNMatch(playerName, espnPlayers) {
  // Exact match first
  const exact = espnPlayers.find(p => p.name === playerName);
  if (exact) return exact;

  // Normalized match
  const normalized = normalizeName(playerName);
  const match = espnPlayers.find(p => normalizeName(p.name) === normalized);
  if (match) return match;

  // Manual alias match
  const manualAlias = MANUAL_ALIASES[normalized];
  if (manualAlias) {
    const aliasMatch = espnPlayers.find(p => normalizeName(p.name) === manualAlias);
    if (aliasMatch) return aliasMatch;
  }

  // Last name match + first name alias
  const parts = normalized.split(/\s+/);
  if (parts.length >= 2) {
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];

    // For hyphenated last names, also try matching on the full compound last name
    const fullLastName = parts.slice(1).join(' ');

    for (const espnPlayer of espnPlayers) {
      const eParts = normalizeName(espnPlayer.name).split(/\s+/);
      if (eParts.length < 2) continue;
      const eFirst = eParts[0];
      const eLast = eParts[eParts.length - 1];
      const eFullLast = eParts.slice(1).join(' ');

      // Same last name (or same hyphenated last name)
      const lastNameMatch = lastName === eLast || fullLastName === eFullLast;
      if (!lastNameMatch) continue;

      // Same first name already handled above, check aliases
      const alias = NAME_ALIASES[firstName];
      if (alias && alias === eFirst) return espnPlayer;
      const eAlias = NAME_ALIASES[eFirst];
      if (eAlias && eAlias === firstName) return espnPlayer;

      // Check if first names share first 3+ chars
      if (firstName.length >= 3 && eFirst.length >= 3 && firstName.substring(0, 3) === eFirst.substring(0, 3)) {
        return espnPlayer;
      }

      // Handle De'Von vs Devon, Dre vs Andre, etc — strip apostrophes and check
      const f1 = firstName.replace(/'/g, '');
      const f2 = eFirst.replace(/'/g, '');
      if (f1 === f2) return espnPlayer;

      // One name starts with the other (Dru vs Andru, Riq vs Tariq)
      if ((f1.length >= 3 && f2.endsWith(f1)) || (f2.length >= 3 && f1.endsWith(f2))) {
        return espnPlayer;
      }
    }
  }

  return null;
}

function findContractEndYear(playerName, teamEndYears) {
  if (!teamEndYears) return null;

  // Exact match
  if (teamEndYears[playerName] !== undefined) return teamEndYears[playerName];

  // Normalized match
  const normalized = normalizeName(playerName);
  for (const [name, year] of Object.entries(teamEndYears)) {
    if (normalizeName(name) === normalized) return year;
  }

  return null;
}

// ─── BUILD ROSTERS ─────────────────────────────────────────────────────────────

const allRosters = {};
let grandTotalPlayers = 0;
let totalUnmatched = 0;
const unmatchedPlayers = [];
const departedRemoved = [];

for (const [slug, data] of Object.entries(deadMoneyRaw)) {
  const abbr = SLUG_TO_ABBR[slug];
  if (!abbr || abbr === 'CIN') continue; // Skip CIN — uses bengalsRoster.js

  const otcPlayers = data.players || [];
  const espnPlayers = espnRosters[abbr] || [];
  const teamEndYears = contractEndYears[abbr] || {};

  // Get departed players for this team
  const departed = departuresByTeam[abbr] || [];
  const departedNormalized = departed.map(n => normalizeName(n));

  // Build players
  const players = [];
  let id = 1;

  for (const otcPlayer of otcPlayers) {
    // Check if this player departed
    const playerNorm = normalizeName(otcPlayer.name);
    if (departedNormalized.includes(playerNorm)) {
      departedRemoved.push({ team: abbr, name: otcPlayer.name });
      continue;
    }

    // Match to ESPN for position/age
    const espnMatch = findESPNMatch(otcPlayer.name, espnPlayers);

    // Match to contract end years
    const endYear = findContractEndYear(otcPlayer.name, teamEndYears);

    // Calculate yearsRemaining
    let yearsRemaining;
    if (endYear !== null) {
      yearsRemaining = Math.max(0, endYear - 2026);
    } else {
      // Estimate: if dead money is significant relative to cap hit, longer contract
      if (otcPlayer.deadMoney > otcPlayer.capHit * 2) {
        yearsRemaining = 2;
      } else if (otcPlayer.deadMoney > otcPlayer.capHit) {
        yearsRemaining = 1;
      } else {
        yearsRemaining = 0;
      }
    }

    // contractYears = yearsRemaining + 1 (including current)
    const contractYears = yearsRemaining + 1;

    // contractTotal estimate
    const contractTotal = Math.round(otcPlayer.capHit * contractYears * 100) / 100;

    // baseSalary estimate: capHit - (deadMoney / max(yearsRemaining+1, 1))
    const divisor = Math.max(yearsRemaining + 1, 1);
    const baseSalary = Math.round((otcPlayer.capHit - (otcPlayer.deadMoney / divisor)) * 100) / 100;

    // Check manual overrides for players not in ESPN
    const override = MANUAL_OVERRIDES[otcPlayer.name];
    const position = espnMatch ? espnMatch.position : (override ? override.position : 'UNK');
    const age = espnMatch ? espnMatch.age : (override ? override.age : 27);

    if (!espnMatch && !override) {
      totalUnmatched++;
      unmatchedPlayers.push({ team: abbr, name: otcPlayer.name });
    }

    players.push({
      id: id++,
      name: otcPlayer.name,
      position,
      age,
      capHit: otcPlayer.capHit,
      contractYears,
      contractTotal,
      yearsRemaining,
      isFranchise: false,
      deadMoney: otcPlayer.deadMoney || 0,
      capSavings: otcPlayer.capSavings,
      baseSalary,
    });
  }

  // Sort by capHit descending
  players.sort((a, b) => b.capHit - a.capHit);
  // Re-assign IDs after sort
  players.forEach((p, i) => p.id = i + 1);

  // Cap summary — use existing OTC data
  const totalCapUsed = players.reduce((sum, p) => sum + p.capHit, 0);
  const totalDeadCap = players.reduce((sum, p) => sum + (p.deadMoney || 0), 0);

  allRosters[abbr] = {
    players,
    capSummary: {
      totalCap: data.totalCap || 301.2,
      capUsed: Math.round(totalCapUsed * 100) / 100,
      deadCap: Math.round(totalDeadCap * 100) / 100,
      capSpace: data.capSpace || 0,
    },
  };

  grandTotalPlayers += players.length;
}

// ─── WRITE allRosters.js ───────────────────────────────────────────────────────

const js = `// Auto-generated by rebuild-all-rosters.mjs on ${new Date().toISOString()}
// Source: Over The Cap (overthecap.com) 2026 salary cap data + ESPN roster data + OTC contract end years
// ALL players for each team (except CIN which uses bengalsRoster.js)
// Financial data (capHit, deadMoney, capSavings) from OTC dead money scrape
// Positions/ages from ESPN rosters, contract end years from OTC
// yearsRemaining = years AFTER current season (0 = final year). Display adds +1 for "including current season".
export const allRosters = ${JSON.stringify(allRosters, null, 2)};
`;

writeFileSync(join(SRC, 'allRosters.js'), js);
console.log(`\nWrote allRosters.js`);

// ─── VERIFICATION ──────────────────────────────────────────────────────────────

console.log('\n=== VERIFICATION ===');

// Check UNK positions
let unkCount = 0;
const unkTeams = {};
for (const [abbr, roster] of Object.entries(allRosters)) {
  const unks = roster.players.filter(p => p.position === 'UNK');
  if (unks.length > 0) {
    unkTeams[abbr] = unks.length;
    unkCount += unks.length;
  }
}
console.log(`\nUNK positions: ${unkCount} total`);
if (unkCount > 0) {
  for (const [abbr, count] of Object.entries(unkTeams)) {
    const names = allRosters[abbr].players.filter(p => p.position === 'UNK').map(p => p.name);
    console.log(`  ${abbr}: ${count} — ${names.join(', ')}`);
  }
}

// Check negative yearsRemaining
let negYR = 0;
for (const [abbr, roster] of Object.entries(allRosters)) {
  const negs = roster.players.filter(p => p.yearsRemaining < 0);
  if (negs.length > 0) {
    console.log(`  ${abbr}: ${negs.length} players with negative yearsRemaining`);
    negYR += negs.length;
  }
}
console.log(`Negative yearsRemaining: ${negYR}`);

// Check departed players are removed
console.log(`\nDeparted players removed: ${departedRemoved.length}`);
for (const { team, name } of departedRemoved) {
  console.log(`  ${team}: ${name}`);
}

// Verify departed players are NOT in rosters
let departedStillPresent = 0;
for (const [abbr, departed] of Object.entries(departuresByTeam)) {
  if (abbr === 'CIN') continue;
  const roster = allRosters[abbr];
  if (!roster) continue;
  for (const depName of departed) {
    const norm = normalizeName(depName);
    const found = roster.players.find(p => normalizeName(p.name) === norm);
    if (found) {
      console.log(`  WARNING: ${depName} still on ${abbr} roster!`);
      departedStillPresent++;
    }
  }
}
if (departedStillPresent === 0) {
  console.log('  All departed players confirmed removed.');
}

// Contract end years match check (sample)
console.log('\nContract end year spot checks:');
// Expected values come from contract-end-years.json
const spotChecks = [
  { team: 'BAL', name: 'Lamar Jackson' },
  { team: 'BUF', name: 'Josh Allen' },
  { team: 'KC', name: 'Patrick Mahomes' },
  { team: 'DAL', name: 'CeeDee Lamb' },
  { team: 'PHI', name: 'Jalen Hurts' },
  { team: 'SF', name: 'Brock Purdy' },
  { team: 'DET', name: 'Jared Goff' },
];
for (const { team, name } of spotChecks) {
  const endYear = contractEndYears[team]?.[name];
  const roster = allRosters[team];
  const player = roster?.players.find(p => p.name === name);
  const expectedYR = endYear ? endYear - 2026 : null;
  const actualYR = player?.yearsRemaining;
  const status = expectedYR !== null && actualYR === expectedYR ? 'OK' : expectedYR === null ? 'NO END YEAR DATA' : `MISMATCH (expected ${expectedYR}, got ${actualYR})`;
  console.log(`  ${team} ${name}: endYear=${endYear}, yearsRemaining=${actualYR} — ${status}`);
}

// Key player cap hit verification
console.log('\nKey player cap hit spot checks:');
const capChecks = [
  { team: 'BAL', name: 'Lamar Jackson' },
  { team: 'BUF', name: 'Josh Allen' },
  { team: 'KC', name: 'Patrick Mahomes' },
  { team: 'DAL', name: 'CeeDee Lamb' },
  { team: 'PHI', name: 'Jalen Hurts' },
];
for (const { team, name } of capChecks) {
  const player = allRosters[team]?.players.find(p => p.name === name);
  if (player) {
    console.log(`  ${team} ${name}: cap=$${player.capHit}M, dead=$${player.deadMoney}M, savings=$${player.capSavings}M, yrsRem=${player.yearsRemaining}, pos=${player.position}`);
  } else {
    console.log(`  ${team} ${name}: NOT FOUND`);
  }
}

// Summary
console.log('\n=== SUMMARY ===');
console.log(`Teams built: ${Object.keys(allRosters).length}`);
console.log(`Total players: ${grandTotalPlayers}`);
console.log(`Unmatched (no ESPN data): ${totalUnmatched}`);
if (unmatchedPlayers.length > 0 && unmatchedPlayers.length <= 50) {
  console.log('Unmatched players:');
  for (const { team, name } of unmatchedPlayers) {
    console.log(`  ${team}: ${name}`);
  }
} else if (unmatchedPlayers.length > 50) {
  console.log(`First 50 unmatched players:`);
  for (const { team, name } of unmatchedPlayers.slice(0, 50)) {
    console.log(`  ${team}: ${name}`);
  }
}
console.log(`UNK positions: ${unkCount}`);
console.log(`Departed removed: ${departedRemoved.length}`);
console.log(`Departed still present: ${departedStillPresent}`);
console.log(`Negative yearsRemaining: ${negYR}`);
