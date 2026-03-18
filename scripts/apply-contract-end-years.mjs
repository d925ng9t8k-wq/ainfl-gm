/**
 * BengalOracle — Apply Contract End Years to allRosters.js and bengalsRoster.js
 *
 * Reads contract-end-years.json and updates yearsRemaining for each player.
 * yearsRemaining = endYear - 2026 (so 2026=0, 2027=1, 2028=2, etc.)
 * The display adds +1, so data=0 shows "1yr", data=1 shows "2yr", etc.
 *
 * Run: node ~/Projects/BengalOracle/scripts/apply-contract-end-years.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_JSON = join(__dirname, 'contract-end-years.json');
const ALL_ROSTERS_JS = join(__dirname, '..', 'src', 'data', 'allRosters.js');
const BENGALS_ROSTER_JS = join(__dirname, '..', 'src', 'data', 'bengalsRoster.js');

const BASE_YEAR = 2026;

function main() {
  console.log('=== Applying Contract End Years ===\n');

  // Read contract end years
  const contractData = JSON.parse(readFileSync(CONTRACT_JSON, 'utf-8'));
  console.log(`Loaded contract data for ${Object.keys(contractData).length} teams\n`);

  // --- Update allRosters.js ---
  let allRostersContent = readFileSync(ALL_ROSTERS_JS, 'utf-8');
  let totalCorrected = 0;
  let totalPlayers = 0;
  let notFound = 0;
  const corrections = [];

  // Parse the JS object — it's an export const, extract the JSON-like content
  // We'll do regex-based replacement for each player's yearsRemaining
  for (const [abbr, players] of Object.entries(contractData)) {
    if (abbr === 'CIN') continue; // Bengals handled separately

    for (const [playerName, endYear] of Object.entries(players)) {
      const newYearsRemaining = endYear - BASE_YEAR;

      // Find this player in allRosters.js and update yearsRemaining
      // Player entries look like: "name": "Budda Baker", ... "yearsRemaining": 1,
      // We need to find the specific player by name and update their yearsRemaining
      const nameEscaped = playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(
        `("name":\\s*"${nameEscaped}"[^}]*?"yearsRemaining":\\s*)(\\d+)`,
        'g'
      );

      let matched = false;
      allRostersContent = allRostersContent.replace(pattern, (match, prefix, oldVal) => {
        matched = true;
        const oldYears = parseInt(oldVal);
        if (oldYears !== newYearsRemaining) {
          totalCorrected++;
          corrections.push({
            team: abbr,
            player: playerName,
            old: oldYears,
            new: newYearsRemaining,
            endYear,
          });
        }
        totalPlayers++;
        return `${prefix}${newYearsRemaining}`;
      });

      if (!matched) {
        notFound++;
      }
    }
  }

  writeFileSync(ALL_ROSTERS_JS, allRostersContent);
  console.log(`allRosters.js: ${totalPlayers} players checked, ${totalCorrected} corrected, ${notFound} not found in file`);

  // --- Update bengalsRoster.js ---
  let bengalsContent = readFileSync(BENGALS_ROSTER_JS, 'utf-8');
  let bengalsCorrected = 0;
  let bengalsTotal = 0;
  let bengalsNotFound = 0;
  const bengalsCorrections = [];

  if (contractData['CIN']) {
    for (const [playerName, endYear] of Object.entries(contractData['CIN'])) {
      const newYearsRemaining = endYear - BASE_YEAR;

      // bengalsRoster.js uses single quotes: name: 'Joe Burrow'
      // Try both quote styles
      const nameEscaped = playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Pattern for single-quoted names
      const patternSingle = new RegExp(
        `(name:\\s*'${nameEscaped}'[^}]*?yearsRemaining:\\s*)(\\d+)`,
        'g'
      );
      // Pattern for double-quoted names
      const patternDouble = new RegExp(
        `(name:\\s*"${nameEscaped}"[^}]*?yearsRemaining:\\s*)(\\d+)`,
        'g'
      );

      let matched = false;
      bengalsContent = bengalsContent.replace(patternSingle, (match, prefix, oldVal) => {
        matched = true;
        const oldYears = parseInt(oldVal);
        if (oldYears !== newYearsRemaining) {
          bengalsCorrected++;
          bengalsCorrections.push({
            player: playerName,
            old: oldYears,
            new: newYearsRemaining,
            endYear,
          });
        }
        bengalsTotal++;
        return `${prefix}${newYearsRemaining}`;
      });

      if (!matched) {
        bengalsContent = bengalsContent.replace(patternDouble, (match, prefix, oldVal) => {
          matched = true;
          const oldYears = parseInt(oldVal);
          if (oldYears !== newYearsRemaining) {
            bengalsCorrected++;
            bengalsCorrections.push({
              player: playerName,
              old: oldYears,
              new: newYearsRemaining,
              endYear,
            });
          }
          bengalsTotal++;
          return `${prefix}${newYearsRemaining}`;
        });
      }

      if (!matched) {
        bengalsNotFound++;
      }
    }
  }

  writeFileSync(BENGALS_ROSTER_JS, bengalsContent);
  console.log(`bengalsRoster.js: ${bengalsTotal} players checked, ${bengalsCorrected} corrected, ${bengalsNotFound} not found in file`);

  // Print corrections
  if (corrections.length > 0) {
    console.log(`\n--- allRosters.js Corrections (${corrections.length}) ---`);
    for (const c of corrections.slice(0, 50)) {
      console.log(`  ${c.team} ${c.player}: ${c.old} → ${c.new} (ends ${c.endYear})`);
    }
    if (corrections.length > 50) {
      console.log(`  ... and ${corrections.length - 50} more`);
    }
  }

  if (bengalsCorrections.length > 0) {
    console.log(`\n--- bengalsRoster.js Corrections (${bengalsCorrections.length}) ---`);
    for (const c of bengalsCorrections) {
      console.log(`  CIN ${c.player}: ${c.old} → ${c.new} (ends ${c.endYear})`);
    }
  }

  // Spot checks
  console.log('\n--- Spot Checks ---');

  // Check Jared Verse in allRosters
  const verseMatch = allRostersContent.match(/"name":\s*"Jared Verse"[^}]*?"yearsRemaining":\s*(\d+)/);
  if (verseMatch) {
    console.log(`Jared Verse (LAR): yearsRemaining = ${verseMatch[1]} (displays as ${parseInt(verseMatch[1]) + 1}yr)`);
  }

  // Check Tee Higgins in bengalsRoster
  const higginsMatch = bengalsContent.match(/name:\s*'Tee Higgins'[^}]*?yearsRemaining:\s*(\d+)/);
  if (higginsMatch) {
    console.log(`Tee Higgins (CIN): yearsRemaining = ${higginsMatch[1]} (displays as ${parseInt(higginsMatch[1]) + 1}yr)`);
  }

  console.log(`\n=== Total corrections: ${totalCorrected + bengalsCorrected} (${totalCorrected} allRosters + ${bengalsCorrected} bengals) ===`);
}

main();
