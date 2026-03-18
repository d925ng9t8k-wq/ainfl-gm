// fix-rookie-contracts.mjs — Fix yearsRemaining and contractYears for players on rookie deals
// The estimation script used a capHit-based formula that doesn't handle rookie contracts properly.

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROSTERS_PATH = join(__dirname, '..', 'src', 'data', 'allRosters.js');

// Read and parse allRosters.js
const rostersSource = readFileSync(ROSTERS_PATH, 'utf-8');
const objStart = rostersSource.indexOf('{', rostersSource.indexOf('allRosters'));
const objBody = rostersSource.slice(objStart, rostersSource.lastIndexOf('}') + 1);
const allRosters = (new Function('return ' + objBody))();

let fixedCount = 0;
const fixedPlayers = [];

for (const [teamAbbr, teamData] of Object.entries(allRosters)) {
  for (const player of teamData.players) {
    // Determine if this player is likely on a rookie deal
    const isRookie =
      (player.age <= 25 && player.deadMoney > player.capHit * 0.3) ||
      (player.age <= 24 && player.capHit < 15);

    if (!isRookie) continue;

    // Estimate draft year: most players drafted at ~21
    // (User examples confirm age-21 matches expected results, e.g. MHJ age 23 -> drafted 2024)
    const draftYear = 2026 - (player.age - 21);
    const yearsIntoContract = 2026 - draftYear;

    let newYearsRemaining;
    if (yearsIntoContract <= 1) {
      newYearsRemaining = 3; // drafted 2025
    } else if (yearsIntoContract === 2) {
      newYearsRemaining = 2; // drafted 2024
    } else if (yearsIntoContract === 3) {
      newYearsRemaining = 1; // drafted 2023
    } else {
      // drafted 2022 or earlier — likely on extension or entering FA, skip
      continue;
    }

    const oldYR = player.yearsRemaining;
    const oldCY = player.contractYears;

    if (oldYR !== newYearsRemaining || oldCY !== 4) {
      player.yearsRemaining = newYearsRemaining;
      player.contractYears = 4;
      fixedCount++;
      fixedPlayers.push({
        team: teamAbbr,
        name: player.name,
        age: player.age,
        capHit: player.capHit,
        oldYR,
        newYR: newYearsRemaining,
        oldCY,
        newCY: 4
      });
    }
  }
}

// Write back
const header = rostersSource.slice(0, objStart).trimEnd();
const output = `${header} ${JSON.stringify(allRosters, null, 2)};\n`;
writeFileSync(ROSTERS_PATH, output, 'utf-8');

console.log(`Fixed ${fixedCount} players across teams.`);
console.log('\nSample fixes:');
for (const p of fixedPlayers.slice(0, 20)) {
  console.log(`  ${p.team} ${p.name} (age ${p.age}, $${p.capHit}M): yearsRemaining ${p.oldYR} -> ${p.newYR}, contractYears ${p.oldCY} -> ${p.newCY}`);
}
if (fixedPlayers.length > 20) {
  console.log(`  ... and ${fixedPlayers.length - 20} more`);
}

// Verify Marvin Harrison Jr.
const mhj = allRosters['ARI'].players.find(p => p.name === 'Marvin Harrison Jr.');
console.log(`\nVerification - Marvin Harrison Jr.: yearsRemaining=${mhj?.yearsRemaining}, contractYears=${mhj?.contractYears}`);
