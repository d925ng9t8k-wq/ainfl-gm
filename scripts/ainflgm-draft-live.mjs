#!/usr/bin/env node
/**
 * ainflgm-draft-live.mjs
 * Live NFL Draft pick-speed analysis engine for ainflgm.com/draft-live
 *
 * Polls ESPN's undocumented draft API every 60s during the broadcast.
 * On new pick detected: calls Claude for instant dynasty take.
 * Stores picks in data/draft-picks-2026.json.
 *
 * Endpoints:
 *   GET /draft-picks       — returns accumulated picks array + metadata
 *   GET /draft-status      — returns current draft state (pre/in/post)
 *   POST /test-pick        — inject a fake pick for E2E testing
 *   GET /health            — health check
 *
 * Deploy: Railway. Set env vars:
 *   ANTHROPIC_API_KEY      — Anthropic API key
 *   PORT                   — defaults to 3485
 *   AINFLGM_ORIGIN         — e.g. https://ainflgm.com (for CORS)
 */

import https from 'https';
import http from 'http';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_FILE = join(ROOT, 'data', 'draft-picks-2026.json');
const LOG_PREFIX = '[draft-live]';

// ─── Env ─────────────────────────────────────────────────────────────────────
function loadEnv() {
  const paths = [join(ROOT, '.env'), '/Users/jassonfishback/Projects/BengalOracle/.env'];
  const vars = {};
  for (const envPath of paths) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      if (!(key in vars)) vars[key] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return vars;
}

const ENV = loadEnv();
const ANTHROPIC_KEY = ENV.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
const PORT          = parseInt(process.env.PORT || '3485', 10);
const ORIGIN        = ENV.AINFLGM_ORIGIN || process.env.AINFLGM_ORIGIN || 'https://ainflgm.com';
const POLL_INTERVAL_MS = 60_000;

// ─── ESPN API ────────────────────────────────────────────────────────────────
const ESPN_BASE = 'sports.core.api.espn.com';
const ESPN_ROUNDS_PATH = '/v2/sports/football/leagues/nfl/seasons/2026/draft/rounds?lang=en&region=us';
const ESPN_DRAFT_STATUS_PATH = '/v2/sports/football/leagues/nfl/seasons/2026/draft/status?lang=en&region=us';

// ESPN team ID → abbreviation map (all 32 teams)
const TEAM_MAP = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
  8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR',
  15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI',
  22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH',
  29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU'
};

const TEAM_NAMES = {
  1: 'Atlanta Falcons', 2: 'Buffalo Bills', 3: 'Chicago Bears', 4: 'Cincinnati Bengals',
  5: 'Cleveland Browns', 6: 'Dallas Cowboys', 7: 'Denver Broncos', 8: 'Detroit Lions',
  9: 'Green Bay Packers', 10: 'Tennessee Titans', 11: 'Indianapolis Colts',
  12: 'Kansas City Chiefs', 13: 'Las Vegas Raiders', 14: 'Los Angeles Rams',
  15: 'Miami Dolphins', 16: 'Minnesota Vikings', 17: 'New England Patriots',
  18: 'New Orleans Saints', 19: 'New York Giants', 20: 'New York Jets',
  21: 'Philadelphia Eagles', 22: 'Arizona Cardinals', 23: 'Pittsburgh Steelers',
  24: 'Los Angeles Chargers', 25: 'San Francisco 49ers', 26: 'Seattle Seahawks',
  27: 'Tampa Bay Buccaneers', 28: 'Washington Commanders', 29: 'Carolina Panthers',
  30: 'Jacksonville Jaguars', 33: 'Baltimore Ravens', 34: 'Houston Texans'
};

// ─── State ───────────────────────────────────────────────────────────────────
let state = {
  picks: [],
  lastPickOverall: 0,
  draftStatus: 'pre',
  lastPoll: null,
  pollCount: 0,
  errors: []
};

function loadState() {
  try {
    if (existsSync(DATA_FILE)) {
      const saved = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
      state.picks = saved.picks || [];
      state.lastPickOverall = saved.lastPickOverall || 0;
      log(`Loaded ${state.picks.length} existing picks from disk`);
    }
  } catch (e) {
    log(`State load error: ${e.message}`);
  }
}

function saveState() {
  try {
    const dir = join(ROOT, 'data');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify({
      picks: state.picks,
      lastPickOverall: state.lastPickOverall,
      updatedAt: new Date().toISOString()
    }, null, 2));
  } catch (e) {
    log(`State save error: ${e.message}`);
  }
}

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`${LOG_PREFIX} [${ts}] ${msg}`);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function httpsGet(hostname, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method: 'GET',
      headers: { 'User-Agent': 'ainflgm.com/draft-live' },
      timeout: 10_000
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function anthropicPost(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      timeout: 30_000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Anthropic JSON error: ${e.message}`)); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Anthropic timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── ESPN data fetchers ──────────────────────────────────────────────────────
function extractTeamId(refUrl) {
  // "$ref": "http://...leagues/nfl/seasons/2026/teams/13?lang=en..."
  const m = refUrl.match(/\/teams\/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

function extractAthleteId(refUrl) {
  const m = refUrl.match(/\/athletes\/(\d+)/);
  return m ? m[1] : null;
}

async function fetchAthleteInfo(athleteId) {
  try {
    const path = `/v2/sports/football/leagues/nfl/seasons/2026/draft/athletes/${athleteId}?lang=en&region=us`;
    const data = await httpsGet(ESPN_BASE, path);
    const posRef = data.position?.$ref || '';
    const posMatch = posRef.match(/\/positions\/(\d+)/);
    return {
      name: data.displayName || data.fullName || 'Unknown',
      firstName: data.firstName,
      lastName: data.lastName,
      position: data.position?.abbreviation || data.position?.displayName || 'UNK',
      college: null  // college is a ref, skip extra fetch for speed
    };
  } catch (e) {
    return { name: 'Unknown', position: 'UNK', college: null };
  }
}

async function fetchCollegeName(athleteId) {
  try {
    const path = `/v2/sports/football/leagues/nfl/seasons/2026/draft/athletes/${athleteId}?lang=en&region=us`;
    const data = await httpsGet(ESPN_BASE, path);
    if (!data.college?.$ref) return null;
    const collegeRef = data.college.$ref.replace('http://', '').replace('https://', '');
    const [host, ...pathParts] = collegeRef.split('/');
    const collegePath = '/' + pathParts.join('/');
    const collegeData = await httpsGet(host, collegePath + '?lang=en&region=us');
    return collegeData.name || collegeData.shortName || null;
  } catch {
    return null;
  }
}

async function fetchDraftRounds() {
  return httpsGet(ESPN_BASE, ESPN_ROUNDS_PATH);
}

async function fetchDraftStatus() {
  const data = await httpsGet(ESPN_BASE, ESPN_DRAFT_STATUS_PATH);
  // type.state: "pre", "in", "post"
  return data?.type?.state || 'pre';
}

// ─── Dynasty analysis via Claude ─────────────────────────────────────────────
async function getDynastyAnalysis(pick) {
  if (!ANTHROPIC_KEY) {
    log('No ANTHROPIC_API_KEY — skipping Claude call');
    return {
      tier: 'N/A',
      analysis: 'Analysis unavailable — API key not configured.',
      verdict: 'HOLD',
      verdictColor: 'yellow'
    };
  }

  const teamName = pick.teamName || pick.teamAbbr || 'Unknown Team';
  const prompt = `Pick #${pick.overall}: ${pick.playerName}, ${pick.position}${pick.college ? ` (${pick.college})` : ''} goes to the ${teamName}.

Give a 3-sentence dynasty fantasy football take:
1. Dynasty value tier (Elite/High/Mid/Low/Deep) and why
2. Landing spot impact — how does this team affect their dynasty ceiling?
3. Buy/sell/hold verdict with one-line reasoning

Be direct and confident. No hedging. NFL dynasty fantasy context only.`;

  try {
    const result = await anthropicPost({
      model: 'claude-sonnet-4-6',
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = result.content?.[0]?.text || '';

    // Parse verdict keyword from the response
    let verdict = 'HOLD';
    let verdictColor = 'yellow';
    const lc = text.toLowerCase();
    if (lc.includes('strong buy') || (lc.includes('buy') && !lc.includes('sell'))) {
      verdict = 'BUY'; verdictColor = 'green';
    } else if (lc.includes('sell')) {
      verdict = 'SELL'; verdictColor = 'red';
    } else {
      verdict = 'HOLD'; verdictColor = 'yellow';
    }

    // Extract tier
    let tier = 'Mid';
    if (lc.includes('elite')) tier = 'Elite';
    else if (lc.includes('high')) tier = 'High';
    else if (lc.includes('low')) tier = 'Low';
    else if (lc.includes('deep')) tier = 'Deep';

    return { tier, analysis: text, verdict, verdictColor };
  } catch (e) {
    log(`Claude error: ${e.message}`);
    return {
      tier: 'Mid',
      analysis: 'Analysis temporarily unavailable.',
      verdict: 'HOLD',
      verdictColor: 'yellow'
    };
  }
}

// ─── Poll loop ────────────────────────────────────────────────────────────────
async function pollDraft() {
  state.pollCount++;
  state.lastPoll = new Date().toISOString();

  try {
    // Check draft status
    const draftState = await fetchDraftStatus();
    state.draftStatus = draftState;

    if (draftState === 'pre') {
      log(`Draft not started yet (state: pre). Poll #${state.pollCount}`);
      return;
    }

    log(`Polling ESPN draft... state=${draftState} poll=#${state.pollCount}`);
    const roundsData = await fetchDraftRounds();

    const newPicks = [];

    for (const round of (roundsData.items || [])) {
      for (const pick of (round.picks || [])) {
        // A pick is "made" when it has an athlete ref and status is SELECTED (or similar)
        const hasMade = pick.athlete || (pick.status?.name === 'SELECTED') ||
                        (pick.status?.name === 'COMPLETE') || (pick.status?.id === 2) ||
                        (pick.status?.id === 3);
        if (!hasMade) continue;
        if (pick.overall <= state.lastPickOverall) continue;

        // New pick detected
        const teamId = pick.team?.$ref ? extractTeamId(pick.team.$ref) : null;
        const teamAbbr = TEAM_MAP[teamId] || 'UNK';
        const teamName = TEAM_NAMES[teamId] || teamAbbr;

        let playerName = pick.athlete?.displayName || pick.athlete?.fullName || null;
        let position = pick.athlete?.position?.abbreviation || null;
        let college = null;

        if (!playerName && pick.athlete?.$ref) {
          const athleteId = extractAthleteId(pick.athlete.$ref);
          if (athleteId) {
            const info = await fetchAthleteInfo(athleteId);
            playerName = info.name;
            position = info.position;
            college = info.college;
          }
        }

        playerName = playerName || `Pick #${pick.overall}`;
        position = position || 'UNK';

        newPicks.push({
          overall: pick.overall,
          round: pick.round,
          pickInRound: pick.pick,
          playerName,
          position,
          college,
          teamAbbr,
          teamName,
          traded: pick.traded || false,
          tradeNote: pick.tradeNote || '',
          timestamp: new Date().toISOString(),
          analysisStatus: 'pending'
        });
      }
    }

    if (newPicks.length === 0) {
      log(`No new picks detected. Last pick: #${state.lastPickOverall}`);
      return;
    }

    log(`${newPicks.length} new pick(s) detected. Getting dynasty analysis...`);

    for (const pick of newPicks) {
      log(`Analyzing Pick #${pick.overall}: ${pick.playerName} (${pick.position}) to ${pick.teamName}`);
      const dynasty = await getDynastyAnalysis(pick);
      pick.dynasty = dynasty;
      pick.analysisStatus = 'complete';
      state.picks.push(pick);
      state.lastPickOverall = Math.max(state.lastPickOverall, pick.overall);
      log(`Pick #${pick.overall} analyzed: ${dynasty.verdict} — ${dynasty.tier} tier`);
    }

    // Sort by overall descending (newest first)
    state.picks.sort((a, b) => b.overall - a.overall);
    saveState();

  } catch (e) {
    log(`Poll error: ${e.message}`);
    state.errors.push({ ts: new Date().toISOString(), msg: e.message });
    if (state.errors.length > 20) state.errors = state.errors.slice(-20);
  }
}

// ─── CORS headers ─────────────────────────────────────────────────────────────
function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, statusCode, data) {
  corsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    corsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /health
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      status: 'ok',
      draftStatus: state.draftStatus,
      pickCount: state.picks.length,
      lastPickOverall: state.lastPickOverall,
      lastPoll: state.lastPoll,
      pollCount: state.pollCount,
      uptime: process.uptime()
    });
  }

  // GET /draft-picks
  if (req.method === 'GET' && url.pathname === '/draft-picks') {
    return json(res, 200, {
      draftStatus: state.draftStatus,
      picks: state.picks,
      lastPickOverall: state.lastPickOverall,
      lastUpdated: state.lastPoll,
      pollCount: state.pollCount
    });
  }

  // GET /draft-status
  if (req.method === 'GET' && url.pathname === '/draft-status') {
    return json(res, 200, {
      draftStatus: state.draftStatus,
      lastPoll: state.lastPoll,
      pickCount: state.picks.length
    });
  }

  // POST /test-pick — inject a fake pick for E2E testing
  if (req.method === 'POST' && url.pathname === '/test-pick') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let overrideData = {};
      try { overrideData = JSON.parse(body); } catch {}

      const fakePick = {
        overall: overrideData.overall || 1,
        round: 1,
        pickInRound: overrideData.overall || 1,
        playerName: overrideData.playerName || 'Travis Hunter',
        position: overrideData.position || 'CB',
        college: overrideData.college || 'Colorado',
        teamAbbr: overrideData.teamAbbr || 'LV',
        teamName: overrideData.teamName || 'Las Vegas Raiders',
        traded: false,
        tradeNote: '',
        timestamp: new Date().toISOString(),
        analysisStatus: 'pending',
        isTest: true
      };

      log(`TEST PICK injected: #${fakePick.overall} ${fakePick.playerName}`);
      const dynasty = await getDynastyAnalysis(fakePick);
      fakePick.dynasty = dynasty;
      fakePick.analysisStatus = 'complete';

      // Remove existing test pick with same overall if any
      state.picks = state.picks.filter(p => p.overall !== fakePick.overall);
      state.picks.unshift(fakePick);
      state.lastPickOverall = Math.max(state.lastPickOverall, fakePick.overall);
      saveState();

      log(`TEST PICK analysis: ${dynasty.verdict} — ${dynasty.tier}`);
      return json(res, 200, { success: true, pick: fakePick });
    });
    return;
  }

  // 404
  return json(res, 404, { error: 'Not found' });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
loadState();

server.listen(PORT, () => {
  log(`ainflgm-draft-live server running on port ${PORT}`);
  log(`CORS origin: ${ORIGIN}`);
  log(`Anthropic key: ${ANTHROPIC_KEY ? 'configured' : 'MISSING'}`);
  log(`Poll interval: ${POLL_INTERVAL_MS / 1000}s`);

  // First poll immediately
  pollDraft();
  // Then every 60s
  setInterval(pollDraft, POLL_INTERVAL_MS);
});

server.on('error', (err) => {
  log(`Server error: ${err.message}`);
  process.exit(1);
});

process.on('SIGTERM', () => {
  log('SIGTERM received — saving state and shutting down');
  saveState();
  process.exit(0);
});
