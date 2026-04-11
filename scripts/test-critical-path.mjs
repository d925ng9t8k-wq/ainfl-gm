#!/usr/bin/env node
/**
 * test-critical-path.mjs
 * Regression test for docs/dependency-map-critical-path.md.
 *
 * Validates:
 *   1. File exists + non-empty.
 *   2. At least 10 distinct component chains (the doc claims "top 10").
 *   3. Every severity label is a valid P0..P4 marker.
 *   4. P0/P1 sections explicitly mention mitigation or lack thereof.
 *   5. Component names referenced in critical-path exist in docs/dependency-map.json.
 *   6. Mac is called out as P0 and Anthropic API is called out as P0 or P1.
 *
 * Doc-quality drift catcher. No new deps. Runs standalone in <15s.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const CP_PATH = path.join(ROOT, 'docs', 'dependency-map-critical-path.md');
const DM_PATH = path.join(ROOT, 'docs', 'dependency-map.json');

const failures = [];
const passes = [];

function pass(label) { passes.push(label); console.log(`  PASS  ${label}`); }
function fail(label, detail = '') {
  failures.push({ label, detail });
  console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== critical-path doc validator ===\n');

// ── Check 1: file exists + non-empty ──────────────────────────────────────
if (!fs.existsSync(CP_PATH)) {
  fail('critical-path doc exists', CP_PATH);
  console.error('\nFATAL: doc missing, aborting remaining checks.');
  process.exit(1);
}

const raw = fs.readFileSync(CP_PATH, 'utf8');
if (raw.trim().length === 0) {
  fail('critical-path doc is non-empty');
  process.exit(1);
}
pass('critical-path doc exists and is non-empty');

// ── Check 2: at least 10 component chains (H2 numbered entries) ───────────
// Chains look like: "## 1. MacBook Pro ...", "## 2. Comms Hub Process ..."
const lines = raw.split('\n');
const chainHeadings = lines.filter(l => /^##\s+\d+\.\s+/.test(l));
if (chainHeadings.length >= 10) {
  pass(`found ${chainHeadings.length} numbered component chains (>= 10)`);
} else {
  fail('at least 10 numbered component chains', `found ${chainHeadings.length}`);
}

// ── Check 3: every severity label is a valid P0..P4 marker ────────────────
// Scan for any "P<char>" sequence — require it to be P0..P4 followed by non-digit boundary.
// We scan for /\bP[^\s]/ tokens in the doc body and check each.
const sevTokenRegex = /\bP[0-9A-Za-z\-]+/g;
const invalidSeverities = new Set();
let m;
while ((m = sevTokenRegex.exec(raw)) !== null) {
  const tok = m[0];
  // Only interrogate tokens that look like they're meant to be severity markers:
  // i.e. P followed by a single digit (with optional extras), or P followed by a letter
  // that might be a typo like "PO" (letter O).
  // Skip common false positives: "PDF", "PR", "PM", "PID", "PC", "PII", "PST", "PR#", etc.
  const falsePositives = /^(PDF|PR|PM|PID|PC|PII|PST|PIL|PEM|PGP|PaaS|PKCE|PEP|PPA|PLS|PHP|PY|PNG|PSQL|Partial|Part|Prov|Provider|Pro|Primary|Process|Processing|Production|Press|Pre|Properly|Public|Pilot|Protocol|Port|Polly|Pres|PROD|Policy|Push|Pay|Power|Probe|Project|Platform)$/;
  if (falsePositives.test(tok)) continue;
  // If it's a single-letter-prefixed word like "Pepper" skip.
  if (/^P[a-zA-Z]/.test(tok) && tok.length > 2) continue;
  // Now check the true severity candidates: P followed by digit(s)/letter(s).
  // Valid ones are exactly P0, P1, P2, P3, P4.
  if (/^P[0-4]$/.test(tok)) continue;
  // Anything else that matches P+digit or P+O etc. is a problem.
  if (/^P[0-9]/.test(tok) || /^PO$/i.test(tok) || /^P\-/.test(tok)) {
    invalidSeverities.add(tok);
  }
}

// Additional strict scan: look for "P<digit>" anywhere (including mid-word) that is not P0..P4.
const strictBadRegex = /P([5-9]|[0-9]{2,})/g;
while ((m = strictBadRegex.exec(raw)) !== null) {
  invalidSeverities.add(m[0]);
}
// "PO" letter-O typo check (where a P0 was intended): match PO followed by space/end
const poTypoRegex = /\bPO\b/g;
while ((m = poTypoRegex.exec(raw)) !== null) {
  invalidSeverities.add('PO (letter O typo?)');
}

if (invalidSeverities.size === 0) {
  pass('all severity markers are valid P0..P4');
} else {
  fail('all severity markers are valid P0..P4',
       `invalid: ${[...invalidSeverities].join(', ')}`);
}

// Confirm the doc actually uses at least one P0..P4 marker so we know the scan is meaningful.
const severityCount = (raw.match(/\bP[0-4]\b/g) || []).length;
if (severityCount >= 5) {
  pass(`found ${severityCount} valid severity markers (sanity check)`);
} else {
  fail('doc contains a meaningful number of severity markers', `only ${severityCount} found`);
}

// ── Check 4: P0/P1 sections mention mitigation or explicit absence ────────
// Split on "## N. " headings, then for each section check severity and language.
const sections = [];
{
  let current = null;
  for (const line of lines) {
    if (/^##\s+\d+\.\s+/.test(line)) {
      if (current) sections.push(current);
      current = { heading: line.trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
}

const mitigationLangRegex = /(mitigation|mitigated by|unmitigated|no mitigation|single point of failure|\bSPOF\b|fallback|failover|redundancy|redundant|no fallback|no redundancy)/i;

let p0p1Checked = 0;
let p0p1Missing = [];
for (const sec of sections) {
  const body = sec.body.join('\n');
  const heading = sec.heading;
  const hasP0 = /\bP0\b/.test(body);
  const hasP1 = /\bP1\b/.test(body);
  if (hasP0 || hasP1) {
    p0p1Checked++;
    if (!mitigationLangRegex.test(body)) {
      p0p1Missing.push(heading);
    }
  }
}

if (p0p1Checked === 0) {
  fail('at least one P0/P1 section exists');
} else if (p0p1Missing.length === 0) {
  pass(`${p0p1Checked} P0/P1 sections all contain mitigation language`);
} else {
  fail('all P0/P1 sections discuss mitigation or its absence',
       `missing in: ${p0p1Missing.join(' | ')}`);
}

// ── Check 5: cross-doc consistency with dependency-map.json ───────────────
if (!fs.existsSync(DM_PATH)) {
  fail('dependency-map.json exists for cross-check', DM_PATH);
} else {
  let dm;
  try {
    dm = JSON.parse(fs.readFileSync(DM_PATH, 'utf8'));
  } catch (e) {
    fail('dependency-map.json parses as JSON', e.message);
    dm = null;
  }
  if (dm) {
    const components = dm.components || [];
    if (components.length === 0) {
      fail('dependency-map.json has components array');
    } else {
      // Build a haystack of names + ids, lowercased.
      const haystack = components.map(c =>
        `${(c.id || '').toLowerCase()}|${(c.name || '').toLowerCase()}`
      ).join('\n');

      // Extract component names from critical-path headings.
      // "## 1. MacBook Pro (The Hardware)" -> "MacBook Pro"
      // Strip parenthetical suffixes, trailing descriptors.
      const extracted = chainHeadings.map(h => {
        let name = h.replace(/^##\s+\d+\.\s+/, '').trim();
        // Strip trailing parenthetical like "(The Hardware)" or "(comms-hub.mjs)"
        name = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
        return name;
      });

      // Tokens/keywords used for fuzzy match — extract meaningful words.
      const missing = [];
      for (const name of extracted) {
        const lower = name.toLowerCase();
        // Try direct substring match first.
        if (haystack.includes(lower)) continue;
        // Then try matching on the most distinctive token (longest word >=4 chars).
        const tokens = lower.split(/[\s\-_/]+/).filter(t => t.length >= 4);
        // Sort by length descending; use first hit.
        tokens.sort((a, b) => b.length - a.length);
        let matched = false;
        for (const tok of tokens) {
          if (haystack.includes(tok)) { matched = true; break; }
        }
        // Special-case: "MacBook" / "Mac" — the host hardware is referenced implicitly
        // in dependency-map via components that run on it; allow "mac" as a pass-through.
        if (!matched && /\bmac(book)?\b/i.test(name)) {
          matched = true; // Mac hardware is the substrate, not a listed component
        }
        // Special-case: generic vendor names like "Anthropic Claude API", "Telegram Bot API",
        // "Twilio", "ElevenLabs", "Supabase" — these are external_apis inside component entries,
        // not top-level components. Allow match against the full JSON text as fallback.
        if (!matched) {
          const fullJson = fs.readFileSync(DM_PATH, 'utf8').toLowerCase();
          for (const tok of tokens) {
            if (fullJson.includes(tok)) { matched = true; break; }
          }
        }
        if (!matched) missing.push(name);
      }

      if (missing.length === 0) {
        pass(`all ${extracted.length} critical-path components found in dependency-map.json`);
      } else {
        fail('critical-path components exist in dependency-map.json',
             `missing: ${missing.join(', ')}`);
      }
    }
  }
}

// ── Check 6: Mac P0, Anthropic P0 or P1 ───────────────────────────────────
function findSectionForKeyword(keyword) {
  const re = new RegExp(keyword, 'i');
  return sections.find(s => re.test(s.heading) || re.test(s.body.join('\n')));
}

const macSection = sections.find(s => /\bmac(book)?\b/i.test(s.heading));
if (!macSection) {
  fail('Mac/MacBook has its own section in critical-path doc');
} else if (!/\bP0\b/.test(macSection.body.join('\n'))) {
  fail('Mac section is labeled P0',
       `heading: ${macSection.heading}`);
} else {
  pass('Mac/MacBook section is labeled P0');
}

const anthropicSection = sections.find(s =>
  /anthropic/i.test(s.heading) || /anthropic/i.test(s.body.join('\n').split('\n').slice(0, 3).join('\n'))
);
if (!anthropicSection) {
  fail('Anthropic API has its own section in critical-path doc');
} else {
  const body = anthropicSection.body.join('\n');
  if (/\bP0\b/.test(body) || /\bP1\b/.test(body)) {
    pass('Anthropic API section is labeled P0 or P1');
  } else {
    fail('Anthropic API section is labeled P0 or P1',
         `heading: ${anthropicSection.heading}`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n=== ${passes.length} passed, ${failures.length} failed ===\n`);
if (failures.length > 0) {
  console.error('FAILURES:');
  for (const f of failures) {
    console.error(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`);
  }
  process.exit(1);
}
process.exit(0);
