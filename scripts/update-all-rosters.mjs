// update-all-rosters.mjs — Merge ESPN roster data (position, age) into allRosters.js
// Also estimates contractYears and yearsRemaining based on capHit and age

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROSTERS_PATH = join(__dirname, '..', 'src', 'data', 'allRosters.js');
const ESPN_PATH = join(__dirname, 'espn-rosters.json');

// Read allRosters.js — extract the JS object
const rostersSource = readFileSync(ROSTERS_PATH, 'utf-8');

// Extract the object by finding the assignment
const objStart = rostersSource.indexOf('{', rostersSource.indexOf('allRosters'));
// We need to parse the JS object - since it's valid JSON-like, let's extract it
// The file is: export const allRosters = { ... };
const objBody = rostersSource.slice(objStart, rostersSource.lastIndexOf('}') + 1);

// Use eval-like approach: wrap in parentheses for Function
const allRosters = (new Function('return ' + objBody))();

// Read ESPN data
const espnData = JSON.parse(readFileSync(ESPN_PATH, 'utf-8'));

// Manual overrides for players on OTC cap pages but not on ESPN active rosters
// (traded, IR, cut but still have dead money / cap charges)
const manualOverrides = {
  'ATL:Kirk Cousins': { position: 'QB', age: 37 },
  'ARI:Kyler Murray': { position: 'QB', age: 29 },
  'BAL:Gerad Christian-Lichtenhan': { position: 'OT', age: 27 },
  'CLE:Wyatt Teller': { position: 'G', age: 31 },
  'CLE:David Njoku': { position: 'TE', age: 30 },
  'CLE:Nik Constantinou': { position: 'P', age: 24 },
  'DAL:Marshawn Kneeland': { position: 'DE', age: 23 },
  'DEN:Dre Greenlaw': { position: 'LB', age: 28 },
  'GB:Nate Hobbs': { position: 'CB', age: 26 },
  'GB:Christopher Brooks': { position: 'RB', age: 27 },
  'GB:Dante Barnett': { position: 'S', age: 28 },
  'HOU:Layne Pryor': { position: 'LB', age: 25 },
  'IND:Devin Veresuk': { position: 'G', age: 24 },
  'IND:Rob Carter': { position: 'OT', age: 25 },
  'MIA:Bradley Chubb': { position: 'LB', age: 30 },
  'MIA:Jaylen Waddle': { position: 'WR', age: 28 },
  'MIA:Tua Tagovailoa': { position: 'QB', age: 28 },
  'MIN:Jonathan Allen': { position: 'DT', age: 31 },
  'MIN:Harrison Smith': { position: 'S', age: 37 },
  'MIN:Jacob Roberts': { position: 'LS', age: 27 },
  'MIN:Jaylon Hutchings': { position: 'DT', age: 27 },
  'NO:Damien Alford': { position: 'WR', age: 23 },
};

// Name aliases: OTC name -> ESPN name (for format differences)
const nameAliases = {
  'Chauncey Gardner-Johnson, Jr.': 'C.J. Gardner-Johnson',
  'Michael Jackson Sr.': 'Mike Jackson',
  "Cam'Ron Jackson": 'Cam Jackson',
  'Christopher Smith': 'Chris Smith',
};

// Normalize name for matching
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[.']/g, '')     // Remove periods and apostrophes
    .replace(/\s+/g, ' ')     // Normalize whitespace
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '') // Remove suffixes for matching
    .trim();
}

// Build lookup maps for each team
const espnLookups = {};
for (const [teamKey, players] of Object.entries(espnData)) {
  const lookup = new Map();
  for (const p of players) {
    lookup.set(normalizeName(p.name), p);
  }
  espnLookups[teamKey] = lookup;
}

// Estimate contract info based on capHit and age
function estimateContract(capHit, age) {
  if (capHit > 15) {
    // Big veteran deal
    return { contractYears: 4, yearsRemaining: 2 };
  } else if (capHit >= 5 && capHit <= 15) {
    // Mid-level deal
    return { contractYears: 3, yearsRemaining: 1 };
  } else if (capHit >= 1 && capHit < 5 && age <= 25) {
    // Likely rookie deal
    const yearsRemaining = Math.max(0, Math.min(4, 25 - age + 1));
    return { contractYears: 4, yearsRemaining };
  } else if (capHit < 1) {
    // Minimum / practice squad
    return { contractYears: 1, yearsRemaining: 0 };
  } else {
    // capHit 1-5M, age > 25: short veteran deal
    return { contractYears: 2, yearsRemaining: 1 };
  }
}

// Stats
let matched = 0;
let unmatched = 0;
const unmatchedPlayers = [];

// Process each team
for (const [teamKey, teamData] of Object.entries(allRosters)) {
  const espnLookup = espnLookups[teamKey];
  if (!espnLookup) {
    console.log(`WARNING: No ESPN data for ${teamKey}`);
    continue;
  }

  for (const player of teamData.players) {
    // Check manual overrides first
    const overrideKey = `${teamKey}:${player.name}`;
    const override = manualOverrides[overrideKey];
    if (override) {
      player.position = override.position;
      player.age = override.age;
      matched++;
    } else {
      // Try name alias first
      const aliasedName = nameAliases[player.name] || player.name;
      const normalizedName = normalizeName(aliasedName);
      let espnPlayer = espnLookup.get(normalizedName);

      // Try alternative matching if exact normalized match fails
      if (!espnPlayer) {
        // Try matching with suffix variations
        for (const [key, val] of espnLookup) {
          if (key.startsWith(normalizedName) || normalizedName.startsWith(key)) {
            espnPlayer = val;
            break;
          }
        }
      }

      // Try fuzzy: last name match within same team
      if (!espnPlayer) {
        const lastName = normalizedName.split(' ').pop();
        const candidates = [];
        for (const [key, val] of espnLookup) {
          if (key.split(' ').pop() === lastName) {
            candidates.push(val);
          }
        }
        if (candidates.length === 1) {
          espnPlayer = candidates[0];
        }
      }

      if (espnPlayer) {
        player.position = espnPlayer.position;
        player.age = espnPlayer.age;
        matched++;
      } else {
        unmatched++;
        unmatchedPlayers.push(`${teamKey}: ${player.name}`);
      }
    }

    // Estimate contract info based on capHit and (updated) age
    const contract = estimateContract(player.capHit, player.age);
    player.contractYears = contract.contractYears;
    player.yearsRemaining = contract.yearsRemaining;
    // Recalculate contractTotal based on new contractYears
    player.contractTotal = parseFloat((player.capHit * player.contractYears).toFixed(2));
  }
}

console.log(`\nMatching Results:`);
console.log(`  Matched: ${matched} players`);
console.log(`  Unmatched: ${unmatched} players`);

if (unmatchedPlayers.length > 0) {
  console.log(`\nUnmatched players:`);
  for (const p of unmatchedPlayers) {
    console.log(`  - ${p}`);
  }
}

// Regenerate allRosters.js
const header = `// Auto-generated by update-all-rosters.mjs on ${new Date().toISOString()}
// Source: Over The Cap (overthecap.com) 2026 salary cap data + ESPN roster data
// ALL players for each team (except CIN which uses bengalsRoster.js)
// Financial data from OTC, positions/ages from ESPN
export const allRosters = `;

const output = header + JSON.stringify(allRosters, null, 2) + ';\n';

writeFileSync(ROSTERS_PATH, output);
console.log(`\nWrote updated allRosters.js (${(output.length / 1024).toFixed(1)} KB)`);
