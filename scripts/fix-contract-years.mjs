// fix-contract-years.mjs — Fix contractYears and yearsRemaining using dead money analysis
// + cross-reference with offseasonMoves.js for 2026 FA signings with known contract years

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROSTERS_PATH = join(__dirname, '..', 'src', 'data', 'allRosters.js');
const MOVES_PATH = join(__dirname, '..', 'src', 'data', 'offseasonMoves.js');

// ── Parse allRosters.js ──
const rostersSource = readFileSync(ROSTERS_PATH, 'utf-8');
const objStart = rostersSource.indexOf('{', rostersSource.indexOf('allRosters'));
const objBody = rostersSource.slice(objStart, rostersSource.lastIndexOf('}') + 1);
const allRosters = (new Function('return ' + objBody))();

// ── Parse offseasonMoves.js ──
// Extract the preseasonMoves object (ends before the computeBaselineGrade function)
const movesSource = readFileSync(MOVES_PATH, 'utf-8');
const movesObjStart = movesSource.indexOf('{', movesSource.indexOf('preseasonMoves'));
// The object ends at "};" before the "export function" or "function" line
const funcIdx = movesSource.indexOf('export function computeBaselineGrade');
const movesEndSection = funcIdx > 0 ? movesSource.lastIndexOf('};', funcIdx) : movesSource.lastIndexOf('};');
const movesBody = movesSource.slice(movesObjStart, movesEndSection + 1);
const preseasonMoves = (new Function('return ' + movesBody))();

// ── Build lookup of 2026 FA signings with known contract years ──
// Maps: normalized player name -> { years, aav, total, team (destination) }
const faSignings = new Map();

for (const [teamAbbr, moves] of Object.entries(preseasonMoves)) {
  if (moves.signings) {
    for (const s of moves.signings) {
      if (s.years && s.player) {
        faSignings.set(s.player.toLowerCase(), {
          years: s.years,
          aav: s.aav,
          total: s.total,
          team: teamAbbr,
          player: s.player,
        });
      }
    }
  }
  // Also check extensions (some have year info in details string)
  if (moves.extensions) {
    for (const ext of moves.extensions) {
      if (ext.player && ext.details) {
        // Try to extract years from details like "3yr/$78M" or "2yr/$88M extension"
        const match = ext.details.match(/(\d+)yr/i);
        if (match) {
          const years = parseInt(match[1]);
          faSignings.set(ext.player.toLowerCase(), {
            years,
            team: teamAbbr,
            player: ext.player,
            isExtension: true,
          });
        }
      }
    }
  }
}

console.log(`Found ${faSignings.size} FA signings/extensions with contract year data.\n`);

// ── Dead money based estimation ──
function estimateFromDeadMoney(player) {
  const { capHit, deadMoney } = player;

  if (deadMoney === 0 && capHit < 3) {
    return { contractYears: 1, yearsRemaining: 0 };
  }
  if (deadMoney === 0 && capHit >= 3) {
    return { contractYears: 1, yearsRemaining: 0 };
  }
  if (deadMoney > 0 && deadMoney < capHit) {
    return { yearsRemaining: 1 };
  }
  if (deadMoney >= capHit && deadMoney < capHit * 2) {
    return { yearsRemaining: 2 };
  }
  if (deadMoney >= capHit * 2 && deadMoney < capHit * 4) {
    return { yearsRemaining: 3 };
  }
  if (deadMoney >= capHit * 4) {
    return { yearsRemaining: 4 };
  }
  return {};
}

// ── Check if player is on a rookie deal (age <= 24, 4yr contract) ──
function isRookieDeal(player) {
  return player.age <= 24 && player.contractYears === 4;
}

let changedCount = 0;
const changes = [];
const verifyPlayers = {};

for (const [teamAbbr, teamData] of Object.entries(allRosters)) {
  for (const player of teamData.players) {
    const oldCY = player.contractYears;
    const oldYR = player.yearsRemaining;

    // 1. Check if this player is a known 2026 FA signing/extension
    const faKey = player.name.toLowerCase();
    const faDeal = faSignings.get(faKey);

    if (faDeal) {
      // Use actual contract data from offseasonMoves
      const newCY = faDeal.years;
      const newYR = faDeal.years - 1; // Year 1 is 2026, remaining = total - 1

      if (oldCY !== newCY || oldYR !== newYR) {
        player.contractYears = newCY;
        player.yearsRemaining = newYR;
        player.contractTotal = parseFloat((player.capHit * newCY).toFixed(2));
        changedCount++;
        changes.push({
          team: teamAbbr,
          name: player.name,
          reason: 'FA signing/extension',
          oldCY, newCY,
          oldYR, newYR,
          deal: faDeal,
        });
      }
    }
    // 2. Skip rookie deals (age <= 24 with contractYears = 4) — already correct
    else if (isRookieDeal(player)) {
      // Leave as-is
    }
    // 3. Dead money based estimation for everyone else
    else {
      const est = estimateFromDeadMoney(player);
      if (est.yearsRemaining !== undefined) {
        const newYR = est.yearsRemaining;
        const newCY = est.contractYears || (newYR + 1); // contractYears = yearsRemaining + 1 (current year)

        if (oldCY !== newCY || oldYR !== newYR) {
          player.contractYears = newCY;
          player.yearsRemaining = newYR;
          player.contractTotal = parseFloat((player.capHit * newCY).toFixed(2));
          changedCount++;
          changes.push({
            team: teamAbbr,
            name: player.name,
            reason: 'dead money',
            oldCY, newCY,
            oldYR, newYR,
            deadMoney: player.deadMoney,
            capHit: player.capHit,
          });
        }
      }
    }

    // Track specific players for verification
    const checkNames = [
      'Tyler Linderbaum', 'Quay Walker', 'Nakobe Dean',
      'Trey Hendrickson', 'Jaelan Phillips', 'Mike Evans',
    ];
    if (checkNames.includes(player.name)) {
      verifyPlayers[player.name] = {
        team: teamAbbr,
        contractYears: player.contractYears,
        yearsRemaining: player.yearsRemaining,
        capHit: player.capHit,
        deadMoney: player.deadMoney,
      };
    }
  }
}

// ── Write back ──
const header = rostersSource.slice(0, objStart).trimEnd();
const output = `${header} ${JSON.stringify(allRosters, null, 2)};\n`;
writeFileSync(ROSTERS_PATH, output, 'utf-8');

// ── Report ──
console.log(`Changed ${changedCount} players total.\n`);

console.log('=== Changes by reason ===');
const byReason = {};
for (const c of changes) {
  byReason[c.reason] = (byReason[c.reason] || 0) + 1;
}
for (const [reason, count] of Object.entries(byReason)) {
  console.log(`  ${reason}: ${count}`);
}

console.log('\n=== FA signing changes (sample) ===');
const faChanges = changes.filter(c => c.reason === 'FA signing/extension');
for (const c of faChanges.slice(0, 30)) {
  console.log(`  ${c.team} ${c.name}: CY ${c.oldCY}->${c.newCY}, YR ${c.oldYR}->${c.newYR}`);
}
if (faChanges.length > 30) console.log(`  ... and ${faChanges.length - 30} more`);

console.log('\n=== Dead money changes (sample) ===');
const dmChanges = changes.filter(c => c.reason === 'dead money');
for (const c of dmChanges.slice(0, 20)) {
  console.log(`  ${c.team} ${c.name}: CY ${c.oldCY}->${c.newCY}, YR ${c.oldYR}->${c.newYR} (dead=$${c.deadMoney}M, cap=$${c.capHit}M)`);
}
if (dmChanges.length > 20) console.log(`  ... and ${dmChanges.length - 20} more`);

console.log('\n=== Verification of specific players ===');
for (const [name, info] of Object.entries(verifyPlayers)) {
  const correct = (() => {
    switch (name) {
      case 'Tyler Linderbaum': return info.yearsRemaining === 2 ? 'CORRECT' : 'WRONG';
      case 'Quay Walker': return info.yearsRemaining === 2 ? 'CORRECT' : 'WRONG'; // 3yr deal, YR=2
      case 'Nakobe Dean': return info.yearsRemaining === 1 ? 'CORRECT' : 'WRONG'; // 2yr deal, YR=1
      case 'Trey Hendrickson': return info.yearsRemaining === 3 ? 'CORRECT' : 'WRONG'; // 4yr deal, YR=3
      case 'Jaelan Phillips': return info.yearsRemaining === 3 ? 'CORRECT' : 'WRONG'; // 4yr deal, YR=3
      case 'Mike Evans': return info.yearsRemaining === 2 ? 'CORRECT' : 'WRONG'; // 3yr deal, YR=2
      default: return '?';
    }
  })();
  console.log(`  ${name} (${info.team}): contractYears=${info.contractYears}, yearsRemaining=${info.yearsRemaining} — ${correct}`);
}
