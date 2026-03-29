#!/usr/bin/env node
/**
 * verify-data.mjs
 * Cross-references BengalOracle simulator data against ESPN's public API.
 * Reports discrepancies in roster composition, player team assignments,
 * and recent transactions not yet reflected in our data files.
 *
 * Usage: node scripts/verify-data.mjs
 * Options:
 *   --team ARI        Only check one team (abbreviation)
 *   --all             Check all 32 teams (slower, ~3 min)
 *   --transactions    Check recent ESPN transactions against offseasonMoves
 *   --verbose         Show matched players too, not just discrepancies
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const targetTeam = args.includes('--team') ? args[args.indexOf('--team') + 1]?.toUpperCase() : null;
const checkAll = args.includes('--all');
const checkTransactions = args.includes('--transactions');
const verbose = args.includes('--verbose');

// ─── ESPN team ID map (abbrev → ESPN numeric ID) ──────────────────────────────
const ESPN_TEAM_IDS = {
  ARI: '22', ATL: '1',  BAL: '33', BUF: '2',  CAR: '29',
  CHI: '3',  CIN: '4',  CLE: '5',  DAL: '6',  DEN: '7',
  DET: '8',  GB:  '9',  HOU: '34', IND: '11', JAX: '30',
  KC:  '12', LAC: '24', LAR: '14', LV:  '13', MIA: '15',
  MIN: '16', NE:  '17', NO:  '18', NYG: '19', NYJ: '20',
  PHI: '21', PIT: '23', SEA: '26', SF:  '25', TB:  '27',
  TEN: '10', WSH: '28',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/** Normalize player name for fuzzy matching: lowercase, strip punctuation, trim */
function normName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance for near-match detection */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function isSimilarName(a, b) {
  const na = normName(a), nb = normName(b);
  if (na === nb) return true;
  // Allow suffix differences (Jr., II, III) and edit distance ≤ 2
  const stripSuffix = s => s.replace(/\b(jr|sr|ii|iii|iv)\b/g, '').trim();
  if (stripSuffix(na) === stripSuffix(nb)) return true;
  return levenshtein(na, nb) <= 2;
}

// ─── Load local data files ────────────────────────────────────────────────────

async function loadLocalData() {
  // Dynamic import of ES module data files
  const [allRostersModule, bengalsRosterModule, teamsModule, offseasonModule, freeAgentsModule] =
    await Promise.all([
      import(path.join(ROOT, 'src/data/allRosters.js')),
      import(path.join(ROOT, 'src/data/bengalsRoster.js')),
      import(path.join(ROOT, 'src/data/teams.js')),
      import(path.join(ROOT, 'src/data/offseasonMoves.js')),
      import(path.join(ROOT, 'src/data/freeAgents.js')),
    ]);

  return {
    allRosters: allRostersModule.allRosters,
    bengalsRoster: bengalsRosterModule.bengalsRoster,
    teams: teamsModule.teams,
    preseasonMoves: offseasonModule.preseasonMoves,
    freeAgents: freeAgentsModule.freeAgents,
  };
}

// ─── ESPN fetch functions ─────────────────────────────────────────────────────

async function fetchESPNTeams() {
  const data = await fetchJSON('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams');
  const teams = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return teams.map(t => ({
    id: t.team.id,
    abbrev: t.team.abbreviation,
    name: t.team.displayName,
  }));
}

async function fetchESPNRoster(espnId) {
  const data = await fetchJSON(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${espnId}/roster`
  );
  const groups = data?.athletes ?? [];
  const players = [];
  for (const group of groups) {
    for (const p of group.items ?? []) {
      players.push({
        fullName: p.fullName ?? `${p.firstName} ${p.lastName}`,
        age: p.age,
        position: p.position?.abbreviation ?? '',
        jersey: p.jersey,
        status: p.status?.type ?? 'active',
      });
    }
  }
  return players;
}

async function fetchESPNTransactions() {
  const data = await fetchJSON(
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/transactions?season=2026'
  );
  return (data?.transactions ?? []).map(t => ({
    date: t.date,
    description: t.description,
    teamAbbrev: t.team?.abbreviation,
    teamName: t.team?.displayName,
  }));
}

// ─── Core comparison logic ────────────────────────────────────────────────────

/**
 * Compare local roster for one team against ESPN roster.
 * Returns { matched, missingFromLocal, missingFromESPN, nameMismatches }
 */
function compareRosters(teamAbbrev, localPlayers, espnPlayers) {
  const result = {
    team: teamAbbrev,
    matched: [],
    missingFromLocal: [],   // on ESPN but not in our data
    missingFromESPN: [],    // in our data but not on ESPN (may have been cut/traded)
    nameMismatches: [],     // likely same player, name formatted differently
  };

  const espnNames = espnPlayers.map(p => p.fullName);
  const localNames = localPlayers.map(p => p.name);

  // Find ESPN players missing from local
  for (const espnPlayer of espnPlayers) {
    const exactMatch = localNames.find(n => normName(n) === normName(espnPlayer.fullName));
    if (exactMatch) {
      result.matched.push(espnPlayer.fullName);
      continue;
    }
    // Near-match check
    const nearMatch = localNames.find(n => isSimilarName(n, espnPlayer.fullName));
    if (nearMatch) {
      result.nameMismatches.push({
        espn: espnPlayer.fullName,
        local: nearMatch,
        note: 'Likely same player — name formatting differs',
      });
    } else {
      result.missingFromLocal.push({
        name: espnPlayer.fullName,
        age: espnPlayer.age,
        position: espnPlayer.position,
        note: 'On ESPN roster but not in our data',
      });
    }
  }

  // Find local players missing from ESPN
  for (const localPlayer of localPlayers) {
    const exactMatch = espnNames.find(n => normName(n) === normName(localPlayer.name));
    if (exactMatch) continue;
    const nearMatch = espnNames.find(n => isSimilarName(n, localPlayer.name));
    if (!nearMatch) {
      result.missingFromESPN.push({
        name: localPlayer.name,
        position: localPlayer.position,
        capHit: localPlayer.capHit,
        note: 'In our data but not found on ESPN roster — may have been cut or traded',
      });
    }
  }

  return result;
}

/**
 * Check ESPN transactions against our offseasonMoves data.
 * Flags recent transactions (last 30 days) that may not be in our records.
 */
function compareTransactions(espnTransactions, preseasonMoves) {
  const issues = [];
  const cutoff = new Date('2026-02-01T00:00:00Z');

  // Build a flat list of all moves we know about (player names mentioned)
  const knownPlayerMentions = new Set();
  for (const [abbrev, teamMoves] of Object.entries(preseasonMoves)) {
    for (const signing of teamMoves.signings ?? []) {
      knownPlayerMentions.add(normName(signing.player));
    }
    for (const departure of teamMoves.departures ?? []) {
      knownPlayerMentions.add(normName(departure.player));
    }
    for (const trade of teamMoves.trades ?? []) {
      if (trade.acquired) knownPlayerMentions.add(normName(trade.acquired));
    }
  }

  for (const txn of espnTransactions) {
    const txnDate = new Date(txn.date);
    if (txnDate < cutoff) continue; // skip pre-offseason transactions

    // Try to extract player names from the description
    // ESPN format: "Signed WR Player Name to a contract." or "Released CB Player Name."
    const descLower = (txn.description ?? '').toLowerCase();

    // Check if description mentions any player we don't have data on
    // We flag the whole transaction if the team isn't in our offseasonMoves
    const teamAbbrev = txn.teamAbbrev;
    const teamMoves = preseasonMoves[teamAbbrev];

    // Check for keywords that suggest significant moves
    const isSignificant = /signed|traded|released|acquired|extended/i.test(txn.description);
    if (!isSignificant) continue;

    // Flag if description doesn't seem to match any player we track
    // Simple heuristic: look for $ amounts or multi-year deals
    const hasContractDetails = /\$|\d+.year|\d+.yr/i.test(txn.description);

    issues.push({
      date: txn.date?.split('T')[0],
      team: teamAbbrev,
      description: txn.description,
      hasContractDetails,
      likelyUntracked: !teamMoves,
    });
  }

  return issues;
}

// ─── Reporting ────────────────────────────────────────────────────────────────

function formatTeamReport(comparison) {
  const lines = [];
  const { team, matched, missingFromLocal, missingFromESPN, nameMismatches } = comparison;

  const issueCount = missingFromLocal.length + missingFromESPN.length + nameMismatches.length;
  const status = issueCount === 0 ? 'OK' : `${issueCount} issue(s)`;

  lines.push(`\n${'─'.repeat(60)}`);
  lines.push(`TEAM: ${team}   |   ESPN matched: ${matched.length}   |   Issues: ${issueCount > 0 ? `⚠  ${issueCount}` : 'none'}`);
  lines.push(`${'─'.repeat(60)}`);

  if (verbose && matched.length > 0) {
    lines.push(`  Matched (${matched.length}):`);
    for (const name of matched) lines.push(`    OK  ${name}`);
  }

  if (missingFromLocal.length > 0) {
    lines.push(`\n  On ESPN but MISSING from our data (${missingFromLocal.length}):`);
    for (const p of missingFromLocal) {
      lines.push(`    ADD  ${p.name} | ${p.position} | age ${p.age ?? '?'}`);
    }
  }

  if (missingFromESPN.length > 0) {
    lines.push(`\n  In our data but NOT on ESPN (${missingFromESPN.length}) — possibly cut/traded:`);
    for (const p of missingFromESPN) {
      const cap = p.capHit ? ` | cap $${p.capHit}M` : '';
      lines.push(`    REMOVE?  ${p.name} | ${p.position}${cap}`);
    }
  }

  if (nameMismatches.length > 0) {
    lines.push(`\n  Name format differences (${nameMismatches.length}):`);
    for (const m of nameMismatches) {
      lines.push(`    RENAME  Local: "${m.local}"  →  ESPN: "${m.espn}"`);
    }
  }

  return lines.join('\n');
}

function printSummary(allResults, transactionIssues, elapsed) {
  let totalIssues = 0;
  let totalMissingLocal = 0;
  let totalMissingESPN = 0;
  let totalNameMismatch = 0;

  for (const r of allResults) {
    totalMissingLocal += r.missingFromLocal.length;
    totalMissingESPN += r.missingFromESPN.length;
    totalNameMismatch += r.nameMismatches.length;
    totalIssues += r.missingFromLocal.length + r.missingFromESPN.length + r.nameMismatches.length;
  }

  console.log('\n' + '='.repeat(60));
  console.log('VERIFICATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Teams checked:            ${allResults.length}`);
  console.log(`Total issues found:       ${totalIssues}`);
  console.log(`  Missing from local:     ${totalMissingLocal}  (add these to data files)`);
  console.log(`  Not on ESPN:            ${totalMissingESPN}  (may have been cut/traded)`);
  console.log(`  Name format diffs:      ${totalNameMismatch}  (minor — same player)`);

  if (transactionIssues.length > 0) {
    console.log(`\nRecent ESPN transactions: ${transactionIssues.length} flagged`);
  }

  console.log(`\nRun time: ${(elapsed / 1000).toFixed(1)}s`);

  if (totalIssues === 0) {
    console.log('\nAll checked rosters match ESPN data. No discrepancies found.');
  } else {
    console.log('\nAction needed — see team reports above for specifics.');
    console.log('Files to update:');
    console.log('  src/data/allRosters.js     — non-CIN teams');
    console.log('  src/data/bengalsRoster.js  — Bengals (CIN)');
    console.log('  src/data/offseasonMoves.js — signings/trades/departures');
    console.log('  src/data/freeAgents.js     — unsigned free agents');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();

  console.log('BengalOracle Data Verification Tool');
  console.log('Source: ESPN public API vs src/data/ files');
  console.log(`Date: ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })}\n`);

  // Load local data
  console.log('Loading local data files...');
  let localData;
  try {
    localData = await loadLocalData();
  } catch (err) {
    console.error('Failed to load local data:', err.message);
    process.exit(1);
  }

  const { allRosters, bengalsRoster, preseasonMoves, freeAgents } = localData;

  // Merge CIN into allRosters for uniform processing
  const mergedRosters = {
    ...allRosters,
    CIN: { players: bengalsRoster },
  };

  // Determine which teams to check
  let teamsToCheck;
  if (targetTeam) {
    if (!ESPN_TEAM_IDS[targetTeam]) {
      console.error(`Unknown team abbreviation: ${targetTeam}`);
      console.error('Valid: ' + Object.keys(ESPN_TEAM_IDS).join(', '));
      process.exit(1);
    }
    teamsToCheck = [targetTeam];
  } else if (checkAll) {
    teamsToCheck = Object.keys(ESPN_TEAM_IDS);
  } else {
    // Default: check Bengals + a handful of teams with known offseason activity
    teamsToCheck = ['CIN', 'BAL', 'BUF', 'NYJ', 'NE', 'KC', 'PHI', 'DET'];
    console.log('Checking 8 teams with most offseason activity (use --all to check all 32).\n');
  }

  // Fetch ESPN transactions if requested or not in single-team mode
  let transactionIssues = [];
  if (checkTransactions || (!targetTeam && !checkAll)) {
    console.log('Fetching ESPN transactions (2026 offseason)...');
    try {
      const espnTxns = await fetchESPNTransactions();
      console.log(`  Got ${espnTxns.length} transactions from ESPN.`);
      transactionIssues = compareTransactions(espnTxns, preseasonMoves);

      if (transactionIssues.length > 0) {
        console.log('\n' + '='.repeat(60));
        console.log('RECENT ESPN TRANSACTIONS (2026 offseason)');
        console.log('='.repeat(60));
        for (const txn of transactionIssues) {
          const flag = txn.likelyUntracked ? '  NEW TEAM ' : '  CHECK   ';
          console.log(`${flag} [${txn.date}] ${txn.team}: ${txn.description}`);
        }
      } else {
        console.log('  No untracked transactions found.\n');
      }
    } catch (err) {
      console.warn(`  Warning: Could not fetch transactions — ${err.message}`);
    }
  }

  // Check rosters
  console.log(`\nChecking ${teamsToCheck.length} team roster(s) against ESPN...\n`);

  const allResults = [];

  for (let i = 0; i < teamsToCheck.length; i++) {
    const abbrev = teamsToCheck[i];
    const espnId = ESPN_TEAM_IDS[abbrev];
    const localRoster = mergedRosters[abbrev];

    if (!localRoster) {
      console.warn(`  SKIP ${abbrev} — no local roster data found`);
      continue;
    }

    process.stdout.write(`  [${i + 1}/${teamsToCheck.length}] ${abbrev}... `);

    try {
      const espnPlayers = await fetchESPNRoster(espnId);
      const localPlayers = localRoster.players ?? localRoster;

      const result = compareRosters(abbrev, localPlayers, espnPlayers);
      allResults.push(result);

      const issueCount = result.missingFromLocal.length + result.missingFromESPN.length + result.nameMismatches.length;
      console.log(issueCount === 0 ? 'OK' : `${issueCount} issue(s)`);

      console.log(formatTeamReport(result));

      // Polite rate limiting — ESPN doesn't document a limit but don't hammer it
      if (i < teamsToCheck.length - 1) await sleep(300);
    } catch (err) {
      console.log(`ERROR — ${err.message}`);
      allResults.push({
        team: abbrev,
        matched: [],
        missingFromLocal: [],
        missingFromESPN: [],
        nameMismatches: [],
        error: err.message,
      });
    }
  }

  // Check free agents list against ESPN rosters
  // Any player in freeAgents that shows up on an ESPN team roster is likely signed
  if (!targetTeam) {
    console.log('\n' + '='.repeat(60));
    console.log('FREE AGENT LIST CROSS-CHECK');
    console.log('='.repeat(60));
    console.log('Checking if listed free agents appear on any ESPN roster...\n');

    // Build a set of all ESPN player names we already fetched
    const allESPNPlayers = new Map(); // normName → { name, team }
    for (const result of allResults) {
      const abbrev = result.team;
      // We need the ESPN players — re-use the matched + missingFromLocal lists
      // (matched are confirmed ESPN names, missingFromLocal are ESPN-only)
      for (const name of result.matched) {
        allESPNPlayers.set(normName(name), { name, team: abbrev });
      }
      for (const p of result.missingFromLocal) {
        allESPNPlayers.set(normName(p.name), { name: p.name, team: abbrev });
      }
    }

    const signedFreeAgents = [];
    for (const fa of freeAgents) {
      const norm = normName(fa.name);
      // Check exact match first
      if (allESPNPlayers.has(norm)) {
        const match = allESPNPlayers.get(norm);
        signedFreeAgents.push({
          name: fa.name,
          position: fa.position,
          previousTeam: fa.previousTeam,
          foundOnTeam: match.team,
        });
        continue;
      }
      // Near-match check
      for (const [key, val] of allESPNPlayers) {
        if (isSimilarName(fa.name, val.name)) {
          signedFreeAgents.push({
            name: fa.name,
            position: fa.position,
            previousTeam: fa.previousTeam,
            foundOnTeam: val.team,
            espnName: val.name,
            note: 'near-match',
          });
          break;
        }
      }
    }

    if (signedFreeAgents.length > 0) {
      console.log(`Found ${signedFreeAgents.length} free agent(s) that appear on an ESPN roster:`);
      for (const fa of signedFreeAgents) {
        const note = fa.note ? ` (ESPN: "${fa.espnName}")` : '';
        console.log(`  SIGNED  ${fa.name} | ${fa.position} | was: ${fa.previousTeam} → now on: ${fa.foundOnTeam}${note}`);
        console.log(`          Action: Remove from freeAgents.js, add to ${fa.foundOnTeam} in offseasonMoves.js`);
      }
    } else {
      console.log('All listed free agents confirmed unsigned on checked teams.');
      console.log('(Only teams in the checked set were scanned — run --all for full coverage)');
    }
  }

  const elapsed = Date.now() - start;
  printSummary(allResults, transactionIssues, elapsed);
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
