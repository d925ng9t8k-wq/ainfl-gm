#!/usr/bin/env node
// test-dependency-map.mjs — regression lock for docs/dependency-map.json
//
// Kyle Shea enterprise-readiness deliverable. The dependency map is the
// canonical machine-parseable description of every component in the 9
// Enterprises universe. Without test coverage, the doc silently drifts
// out of sync with live code and we lose the ability to claim the map
// is authoritative. This test enforces:
//
//   1. Structural validity of the JSON and required per-component fields.
//   2. Every component.script that looks like a real file exists on disk.
//   3. Every credential (env var) listed for a component actually appears
//      somewhere in that component's source file — catches stale env vars.
//   4. Every component.port literal appears in the component's source —
//      catches port renumbering drift.
//   5. Loose external_apis sanity check — the source file mentions the
//      domain or a recognizable token for each API listed.
//
// Hermetic: read-only. Does not modify the map or any source files.
// Fast: completes well under 10 seconds (no network, no subprocesses).
// Stdlib-only: no new dependencies.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const MAP_PATH = path.join(REPO_ROOT, 'docs', 'dependency-map.json');

let passed = 0;
let failed = 0;
const failures = [];

function pass(label) {
  console.log(`  PASS  ${label}`);
  passed++;
}

function fail(label, detail = '') {
  console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
  failures.push(detail ? `${label}: ${detail}` : label);
  failed++;
}

function assert(label, cond, detail = '') {
  if (cond) pass(label);
  else fail(label, detail);
}

// ---------------------------------------------------------------------------
// Load map
// ---------------------------------------------------------------------------
console.log('dependency-map.json structural + consistency validator\n');

if (!fs.existsSync(MAP_PATH)) {
  console.error(`FATAL: ${MAP_PATH} does not exist`);
  process.exit(1);
}

let raw;
try {
  raw = fs.readFileSync(MAP_PATH, 'utf8');
} catch (e) {
  console.error(`FATAL: cannot read ${MAP_PATH}: ${e.message}`);
  process.exit(1);
}

let map;
try {
  map = JSON.parse(raw);
  pass('map parses as valid JSON');
} catch (e) {
  fail('map parses as valid JSON', e.message);
  console.log(`\n1 failure(s) — aborting remaining checks`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Structural validity — top-level shape
// ---------------------------------------------------------------------------
console.log('\n[1] Structural validity');

assert(
  'top-level has meta object',
  map.meta && typeof map.meta === 'object',
  'missing map.meta'
);
assert(
  'top-level has components array',
  Array.isArray(map.components),
  'missing map.components array'
);
assert(
  'components array non-empty',
  Array.isArray(map.components) && map.components.length > 0,
  `length=${Array.isArray(map.components) ? map.components.length : 'n/a'}`
);
assert(
  'top-level has external_services_summary array',
  Array.isArray(map.external_services_summary),
  'missing external_services_summary'
);
assert(
  'top-level has launchagents array',
  Array.isArray(map.launchagents),
  'missing launchagents'
);

const REQUIRED_COMPONENT_FIELDS = [
  'id',
  'name',
  'type',
  'script',
  'description',
  'data_stores',
  'credentials',
  'external_apis',
  'reverse_dependencies'
];

// ---------------------------------------------------------------------------
// 2. Per-component required fields
// ---------------------------------------------------------------------------
console.log('\n[2] Per-component required fields');

const components = Array.isArray(map.components) ? map.components : [];
const seenIds = new Set();

for (const c of components) {
  const id = c && c.id ? c.id : '(unknown)';

  // uniqueness
  if (seenIds.has(id)) {
    fail(`component[${id}] id uniqueness`, `duplicate id`);
  } else {
    seenIds.add(id);
  }

  for (const field of REQUIRED_COMPONENT_FIELDS) {
    if (!(field in c)) {
      fail(`component[${id}] has required field "${field}"`, 'field missing');
    } else if (field === 'id' || field === 'name' || field === 'type' || field === 'script' || field === 'description') {
      if (typeof c[field] !== 'string' || c[field].length === 0) {
        fail(`component[${id}] field "${field}"`, 'must be non-empty string');
      } else {
        pass(`component[${id}] field "${field}"`);
      }
    } else if (field === 'data_stores' || field === 'credentials' || field === 'external_apis' || field === 'reverse_dependencies') {
      if (!Array.isArray(c[field])) {
        fail(`component[${id}] field "${field}"`, 'must be array');
      } else {
        pass(`component[${id}] field "${field}"`);
      }
    }
  }

  // port is optional but if present must be number or null
  if ('port' in c) {
    if (c.port !== null && typeof c.port !== 'number') {
      fail(`component[${id}] field "port"`, 'must be number or null');
    }
  }
}

// ---------------------------------------------------------------------------
// 3. File path existence
// ---------------------------------------------------------------------------
console.log('\n[3] File path existence (component.script)');

// Heuristic: a script entry is a real file path if it looks like one:
// ends in .mjs/.js/.ts/.py/.sh, OR contains no spaces and no parenthetical.
// Non-file descriptors we explicitly allow:
//   - "system binary"            (cloudflared)
//   - "src/ (React/Vite app)"    (ainflgm — directory description)
//   - "command-hub/ (Next.js app)"
function isResolvableScript(s) {
  if (!s || typeof s !== 'string') return false;
  if (s === 'system binary') return false;
  // If the string contains " (" it's a directory/description form
  if (s.includes(' (')) return false;
  // Otherwise treat as a path — either a file or a concrete path under repo
  return true;
}

for (const c of components) {
  const id = c.id || '(unknown)';
  const script = c.script;
  if (!isResolvableScript(script)) {
    pass(`component[${id}] script is descriptor (skipped file check): ${script}`);
    continue;
  }
  const abs = path.join(REPO_ROOT, script);
  if (fs.existsSync(abs)) {
    pass(`component[${id}] script file exists: ${script}`);
  } else {
    fail(`component[${id}] script file exists`, `${script} not found on disk at ${abs}`);
  }
}

// ---------------------------------------------------------------------------
// Helper: read a component's source if it's a real file, else null
// ---------------------------------------------------------------------------
const sourceCache = new Map();
function readSource(c) {
  const id = c.id;
  if (sourceCache.has(id)) return sourceCache.get(id);
  const script = c.script;
  if (!isResolvableScript(script)) {
    sourceCache.set(id, null);
    return null;
  }
  const abs = path.join(REPO_ROOT, script);
  if (!fs.existsSync(abs)) {
    sourceCache.set(id, null);
    return null;
  }
  try {
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      sourceCache.set(id, null);
      return null;
    }
    const src = fs.readFileSync(abs, 'utf8');
    sourceCache.set(id, src);
    return src;
  } catch {
    sourceCache.set(id, null);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 4. Credentials (env vars) referenced in source
// ---------------------------------------------------------------------------
console.log('\n[4] Credentials / env vars referenced in source');

// Some env vars are consumed indirectly (e.g. loaded from .env by a loader
// and read elsewhere). To keep the test meaningful but not brittle, we
// require a substring match for the credential NAME inside the component's
// source file. Credentials tied to a service used via different naming
// (e.g. JASSON_PHONE is a recipient, not strictly a credential) are still
// expected to appear by name somewhere in source — that's the point of
// the check: if you drop the env var from code, update the map.

for (const c of components) {
  const id = c.id || '(unknown)';
  const creds = Array.isArray(c.credentials) ? c.credentials : [];
  if (creds.length === 0) {
    pass(`component[${id}] has no credentials to check`);
    continue;
  }
  const src = readSource(c);
  if (src === null) {
    pass(`component[${id}] credentials check skipped (no resolvable source)`);
    continue;
  }
  for (const cred of creds) {
    if (typeof cred !== 'string' || cred.length === 0) {
      fail(`component[${id}] credential entry`, `not a non-empty string: ${JSON.stringify(cred)}`);
      continue;
    }
    if (src.includes(cred)) {
      pass(`component[${id}] credential "${cred}" referenced in source`);
    } else {
      fail(
        `component[${id}] credential "${cred}" referenced in source`,
        `env var "${cred}" not found in ${c.script} — map may be stale`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Port literal appears in source
// ---------------------------------------------------------------------------
console.log('\n[5] Port literal appears in component source');

for (const c of components) {
  const id = c.id || '(unknown)';
  if (c.port === null || c.port === undefined) {
    pass(`component[${id}] has no port (skipped)`);
    continue;
  }
  const src = readSource(c);
  if (src === null) {
    pass(`component[${id}] port check skipped (no resolvable source)`);
    continue;
  }
  const portStr = String(c.port);
  if (src.includes(portStr)) {
    pass(`component[${id}] port ${portStr} found in source`);
  } else {
    fail(
      `component[${id}] port ${portStr} found in source`,
      `port literal "${portStr}" not in ${c.script} — renumbering drift suspected`
    );
  }
}

// ---------------------------------------------------------------------------
// 6. External APIs — loose consistency check
// ---------------------------------------------------------------------------
console.log('\n[6] External API loose consistency');

// For each external_apis entry, look for ANY recognizable token in the
// source file. This is intentionally lenient — we don't want false positives
// breaking CI for a typo in a description field.
const API_TOKENS = {
  'anthropic': ['anthropic', 'claude'],
  'claude': ['anthropic', 'claude'],
  'telegram': ['telegram', 'api.telegram.org'],
  'twilio': ['twilio'],
  'elevenlabs': ['elevenlabs', 'eleven'],
  'gmail': ['gmail', 'smtp', 'nodemailer'],
  'supabase': ['supabase'],
  'neon': ['neon', 'postgres', 'pg'],
  'cloudflare': ['cloudflare', 'trycloudflare', 'workers.dev'],
  'cloudflared': ['cloudflared', 'trycloudflare'],
  'openweather': ['openweather'],
  'openweathermap': ['openweather'],
  'alpaca': ['alpaca'],
  'apple': ['osascript', 'Messages', 'chat.db'],
  'github': ['github'],
  'polymarket': ['polymarket'],
  'kalshi': ['kalshi'],
  // Internal "APIs" — the Comms Hub is referenced as localhost:3457 by
  // internal agents, not by the string "comms hub".
  'comms hub': ['localhost:3457', '3457', '/send', '/context', 'comms-hub']
};

function tokensForService(serviceName) {
  if (!serviceName || typeof serviceName !== 'string') return [];
  const lower = serviceName.toLowerCase();
  for (const key of Object.keys(API_TOKENS)) {
    if (lower.includes(key)) return API_TOKENS[key];
  }
  // fallback: split first word of service name
  const first = lower.split(/[^a-z0-9]+/).filter(Boolean)[0];
  return first ? [first] : [];
}

for (const c of components) {
  const id = c.id || '(unknown)';
  const apis = Array.isArray(c.external_apis) ? c.external_apis : [];
  if (apis.length === 0) {
    pass(`component[${id}] has no external_apis to check`);
    continue;
  }
  const src = readSource(c);
  if (src === null) {
    pass(`component[${id}] external_apis check skipped (no resolvable source)`);
    continue;
  }
  const lowerSrc = src.toLowerCase();
  for (const api of apis) {
    const serviceName = api && typeof api === 'object' ? api.service : null;
    if (!serviceName) {
      fail(`component[${id}] external_apis entry`, `missing service field: ${JSON.stringify(api)}`);
      continue;
    }
    const tokens = tokensForService(serviceName);
    if (tokens.length === 0) {
      // no tokens mapped — don't fail, just note
      pass(`component[${id}] external api "${serviceName}" has no token map (skipped)`);
      continue;
    }
    const found = tokens.some(t => lowerSrc.includes(t));
    if (found) {
      pass(`component[${id}] external api "${serviceName}" referenced in source`);
    } else {
      fail(
        `component[${id}] external api "${serviceName}" referenced in source`,
        `no token from [${tokens.join(', ')}] found in ${c.script}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`dependency-map.json: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  console.log(`\n${failed} failure(s) — dependency map is drifting from live code`);
  process.exit(1);
}

console.log('\nAll dependency map checks passed');
process.exit(0);
