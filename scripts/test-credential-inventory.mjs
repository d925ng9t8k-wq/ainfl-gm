#!/usr/bin/env node
// test-credential-inventory.mjs — regression lock for docs/credential-inventory.md
//
// Purpose: Keep the credential inventory document in lock-step with real env
// var usage in scripts/. The document is a deliverable for Kyle Shea (CIO at
// Rapid Mortgage). Without a regression test, the document silently drifts out
// of sync every time a credential is added, removed, or renamed.
//
// Sub-tests:
//   1. docs/credential-inventory.md exists and is non-empty
//   2. Every env var LISTED in the doc is still referenced somewhere in
//      scripts/ (catches stale entries for removed credentials)
//   3. Every env var REFERENCED in scripts/*.mjs appears in the doc (catches
//      undocumented credentials added to code without updating the doc)
//   4. .env.example: warn if absent, pass if present (rewards progress)
//   5. Doc still contains at least 6 "CRITICAL" markers (C-01 ... C-06)
//      — if someone silently removes critical flags, fail loudly
//
// HERMETIC: read-only. Does NOT modify the doc, does NOT touch .env, does NOT
// hit the network. Completes in well under 15 seconds.

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(REPO_ROOT, 'docs', 'credential-inventory.md');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, '.env.example');

// Env vars that may legitimately appear in code but are not real credentials.
// These are either system/platform vars or runtime flags we do not want the
// doc to track exhaustively. Keep this list tight — too many exemptions
// defeats the point of the test.
const SYSTEM_ALLOWLIST = new Set([
  'HOME',                      // macOS/Linux system
  'USER',                      // macOS/Linux system
  'PATH',                      // macOS/Linux system
  'NODE_ENV',                  // standard Node
  'DEBUG',                     // standard Node debug flag
  'GIT_SHA',                   // CI injected
  'PORT',                      // standard HTTP port override (doc mentions it)
  'PROJECT_DIR',               // VPS mode path override
  'VPS_MODE',                  // VPS mode toggle
  'CHANNELS_INBOUND_TAKEOVER', // runtime feature flag, not a credential
  'OC_RELAY_LOCKDOWN',         // runtime feature flag
  'BRIEFING_MODEL',            // model name override, not a credential
  'GITHUB_TOKEN',              // implicit: injected by GitHub Actions runtime, not read from our code. Kept listed in doc for CIO completeness.
]);

let passed = 0;
let failed = 0;
let warnings = 0;
const failures = [];

function assert(label, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
    failures.push({ label, detail });
  }
}

function warn(label, detail = '') {
  console.warn(`  WARN  ${label}${detail ? ' — ' + detail : ''}`);
  warnings++;
}

console.log('\n=== credential-inventory.md consistency regression test ===\n');

// ── 1. Doc exists and is non-empty ────────────────────────────────────────
console.log('[ Doc presence ]');

if (!existsSync(DOC_PATH)) {
  console.error(`FATAL: ${DOC_PATH} not found`);
  process.exit(1);
}
const docSrc = readFileSync(DOC_PATH, 'utf-8');
assert(
  'docs/credential-inventory.md exists and is non-empty',
  docSrc.trim().length > 0,
);
assert(
  'docs/credential-inventory.md has expected header',
  /Credential Inventory/i.test(docSrc),
);

// ── 2. Extract env vars declared in the doc ───────────────────────────────
console.log('\n[ Extract env vars from doc ]');

// The doc uses backtick-quoted ALL_CAPS identifiers for env vars, e.g.
// `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY_TC`. Bold phrases like
// "**Dominos credentials**" are narrative and not captured; their underlying
// DOMINOS_* vars are listed in backticks on the same row, so they are
// captured correctly.
const docEnvVars = new Set();
const backtickIdentRegex = /`([A-Z][A-Z0-9_]*)`/g;
let m;
while ((m = backtickIdentRegex.exec(docSrc)) !== null) {
  const name = m[1];
  // Skip obvious non-env-var backtick tokens. Real env vars contain an
  // underscore or are at least 4 chars and have a well-known prefix.
  if (name.length < 3) continue;
  if (SYSTEM_ALLOWLIST.has(name)) {
    docEnvVars.add(name);
    continue;
  }
  // Heuristic: env vars nearly always contain an underscore OR end in _KEY,
  // _TOKEN, _SECRET, _URL, _ID, _SID, _PHONE, _PASSWORD etc. Require at least
  // an underscore OR length >= 4.
  if (name.includes('_') || name.length >= 4) {
    docEnvVars.add(name);
  }
}

// Drop narrative-caps that match but are not env vars (e.g. PII, POC, RLS).
const NARRATIVE_CAPS = new Set([
  'PII', 'POC', 'RLS', 'CIO', 'SPOF', 'PCI', 'DSS', 'GLBA', 'NIST', 'SOC', 'ISO',
  'API', 'URL', 'ID', 'SID', 'OK', 'FLAG', 'REVIEW', 'LOW', 'CRITICAL',
  'ORPHAN', 'HIGH', 'MEDIUM', 'CLI', 'DB', 'ENV', 'TTS', 'A2P', 'OAUTH',
  'OWNER', 'SSO', 'WWKD', 'OC', 'QB', 'TODO', 'FIXME', 'POS', 'RAG',
  'TC', 'MVP',
]);
for (const n of NARRATIVE_CAPS) docEnvVars.delete(n);

assert(
  'doc contains at least 20 env vars (guards against parser regression)',
  docEnvVars.size >= 20,
  `found ${docEnvVars.size}`,
);
console.log(`  INFO  extracted ${docEnvVars.size} env var names from doc`);

// ── 3. Extract env vars referenced in scripts/*.mjs ───────────────────────
console.log('\n[ Extract env vars from scripts/ ]');

function walkMjs(dir) {
  const out = [];
  const entries = readdirSync(dir);
  for (const e of entries) {
    const full = path.join(dir, e);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      // Recurse one level (scripts/ is flat but keep it resilient).
      out.push(...walkMjs(full));
    } else if (/\.mjs$/.test(e) && !/\.deprecated/.test(e)) {
      out.push(full);
    }
  }
  return out;
}

const scriptFiles = walkMjs(SCRIPTS_DIR);
assert(
  'scripts/*.mjs discovery found at least 20 files',
  scriptFiles.length >= 20,
  `found ${scriptFiles.length}`,
);

const codeEnvVars = new Map(); // name -> Set(file basenames)
// Primary: process.env.XXX — the canonical Node env read.
const processEnvRegex = /process\.env\.([A-Z][A-Z0-9_]*)/g;
// Secondary: scripts that load a local env object from .env (trader9-bot,
// your9-*, pepper-tools patterns). Match `env.XXX` and `ENV.XXX` — but ONLY
// when the identifier starts with an uppercase letter and contains an
// underscore or is at least 6 chars (to avoid catching `env.ROOT` style
// non-env object accesses).
const localEnvRegex = /\b(?:env|ENV|rootEnv)\.([A-Z][A-Z0-9_]{2,})\b/g;

for (const file of scriptFiles) {
  // Skip this test file itself — it mentions env var names in string literals
  // (allowlists, narrative comments) that would inflate the code side.
  if (path.basename(file) === 'test-credential-inventory.mjs') continue;
  let src;
  try { src = readFileSync(file, 'utf-8'); } catch { continue; }
  let mm;
  while ((mm = processEnvRegex.exec(src)) !== null) {
    const name = mm[1];
    if (!codeEnvVars.has(name)) codeEnvVars.set(name, new Set());
    codeEnvVars.get(name).add(path.basename(file));
  }
  while ((mm = localEnvRegex.exec(src)) !== null) {
    const name = mm[1];
    // Only count it if it looks like an env var (all-caps with underscores or
    // known env-style suffix). This filters out things like `env.PROJECT_ROOT`
    // where PROJECT_ROOT is a local constant, not an env var.
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    if (!name.includes('_') && name.length < 6) continue;
    if (!codeEnvVars.has(name)) codeEnvVars.set(name, new Set());
    codeEnvVars.get(name).add(path.basename(file));
  }
}

console.log(`  INFO  found ${codeEnvVars.size} unique env vars referenced in ${scriptFiles.length} .mjs files`);

// ── 4. Stale entries: doc lists vars no longer used ───────────────────────
console.log('\n[ Stale doc entries (listed but not used) ]');

const stale = [];
for (const name of docEnvVars) {
  if (SYSTEM_ALLOWLIST.has(name)) continue;
  if (!codeEnvVars.has(name)) {
    // Also check cloud-worker + command-hub since the doc's methodology
    // explicitly includes them.
    const extraRoots = [
      path.join(REPO_ROOT, 'cloud-worker'),
      path.join(REPO_ROOT, 'command-hub'),
    ];
    let foundElsewhere = false;
    for (const root of extraRoots) {
      if (!existsSync(root)) continue;
      // Shallow walk — good enough for this check.
      const stack = [root];
      while (stack.length && !foundElsewhere) {
        const cur = stack.pop();
        let ents;
        try { ents = readdirSync(cur); } catch { continue; }
        for (const e of ents) {
          const full = path.join(cur, e);
          let st;
          try { st = statSync(full); } catch { continue; }
          if (st.isDirectory()) {
            if (e === 'node_modules' || e === '.next' || e === 'dist') continue;
            stack.push(full);
          } else if (/\.(mjs|js|ts|tsx|jsx)$/.test(e)) {
            let src;
            try { src = readFileSync(full, 'utf-8'); } catch { continue; }
            if (src.includes(`process.env.${name}`) || src.includes(`env.${name}`) || src.includes(`ENV.${name}`)) {
              foundElsewhere = true;
              break;
            }
          }
        }
      }
    }
    if (!foundElsewhere) stale.push(name);
  }
}

if (stale.length === 0) {
  assert('doc has no stale env var entries (all listed vars still referenced)', true);
} else {
  assert(
    'doc has no stale env var entries (all listed vars still referenced)',
    false,
    `stale entries: ${stale.sort().join(', ')}`,
  );
}

// ── 5. Undocumented entries: code uses vars doc does not list ─────────────
console.log('\n[ Undocumented env vars (used in code but not in doc) ]');

const undocumented = [];
for (const [name, files] of codeEnvVars.entries()) {
  if (SYSTEM_ALLOWLIST.has(name)) continue;
  if (!docEnvVars.has(name)) {
    undocumented.push({ name, files: [...files].sort() });
  }
}

if (undocumented.length === 0) {
  assert('every env var used in code is documented in credential-inventory.md', true);
} else {
  const detail = undocumented
    .map(u => `${u.name} (${u.files.join(', ')})`)
    .join('; ');
  assert(
    'every env var used in code is documented in credential-inventory.md',
    false,
    `undocumented: ${detail}`,
  );
}

// ── 6. .env.example presence ──────────────────────────────────────────────
console.log('\n[ .env.example ]');
if (existsSync(ENV_EXAMPLE_PATH)) {
  const exampleSrc = readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
  assert(
    '.env.example exists and is non-empty (closes H-02 gap)',
    exampleSrc.trim().length > 0,
  );
} else {
  warn(
    '.env.example does not exist — matches current doc state (H-02 open)',
    'creating this file is a 2-hour task called out in the doc recommendations',
  );
  // Not a failure: the doc explicitly documents this as an open gap.
}

// ── 7. CRITICAL markers still present (>= 6) ──────────────────────────────
console.log('\n[ CRITICAL flag count ]');

const criticalMatches = docSrc.match(/CRITICAL/g) || [];
assert(
  'doc still contains at least 6 CRITICAL markers (C-01 ... C-06)',
  criticalMatches.length >= 6,
  `found ${criticalMatches.length}`,
);

// Also verify each C-0N row is still present — guards against renumbering
// that might drop a specific critical flag.
for (const id of ['C-01', 'C-02', 'C-03', 'C-04', 'C-05', 'C-06']) {
  assert(
    `critical flag ${id} still present in doc`,
    docSrc.includes(id),
  );
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${warnings} warnings ===\n`);
if (failed > 0) {
  console.error('Failures:');
  for (const f of failures) console.error(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`);
  process.exit(1);
}
process.exit(0);
