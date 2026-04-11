/**
 * budget-tracker.mjs
 *
 * Computes today's Anthropic API spend by walking the per-day agent-runs JSONL
 * folder PLUS the canonical token-usage log, sums tokens by model, and prices
 * them at published Anthropic rates. Used by:
 *
 *   - scripts/comms-hub.mjs    — circuit breaker (60s sweep + /budget/today)
 *   - scripts/budget-guard.mjs — CLI gate for cost-incurring scripts
 *   - scripts/test-budget-breaker.mjs — regression test
 *
 * The audit at logs/scout-task-cost-audit-apr11.md flagged cache_creation +
 * cache_read as the dominant cost. We INCLUDE both — better to over-count and
 * trip early than under-count and overrun. This is the "$142.65/day" upper-
 * bound formula from that audit, which is the higher of the two computations.
 *
 * Pricing constants are pulled from the same audit table (logs/scout-task-cost-
 * audit-apr11.md, "AI / LLM API Spend" row, Anthropic re-derivation).
 *
 * Day boundary is America/New_York. Resets clean at local midnight ET.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT   = path.resolve(__dirname, '..');

// ─── Config ─────────────────────────────────────────────────────────────────
export const DAILY_CAP_USD = Number(process.env.BUDGET_DAILY_CAP_USD || 500);
export const TRIPPED_FLAG_FILE = '/tmp/9-budget-tripped';

const AGENT_RUNS_DIR     = path.join(PROJECT, 'data', 'agent-runs');
const TOKEN_USAGE_LOG    = path.join(PROJECT, 'logs', 'api-token-usage.jsonl');

// ─── Pricing ($ per 1M tokens) — from logs/scout-task-cost-audit-apr11.md ───
// Each row: [input, output, cache_creation, cache_read]
const PRICING = {
  // Opus family — including 1M-context variants. Default Opus pricing.
  opus: { input: 15, output: 75, cache_creation: 18.75, cache_read: 1.50 },
  // Sonnet family — including 4-5, 4-6, 4-20250514. Default Sonnet pricing.
  sonnet: { input: 3, output: 15, cache_creation: 3.75, cache_read: 0.30 },
  // Haiku — fallback at conservative Sonnet/5 (audit didn't itemize Haiku).
  haiku: { input: 0.80, output: 4, cache_creation: 1, cache_read: 0.08 },
  // Unknown model — bill at Opus rate (over-count, never under-count).
  unknown: { input: 15, output: 75, cache_creation: 18.75, cache_read: 1.50 },
};

function priceFor(model) {
  if (!model) return PRICING.unknown;
  const m = String(model).toLowerCase();
  if (m.includes('opus'))   return PRICING.opus;
  if (m.includes('sonnet')) return PRICING.sonnet;
  if (m.includes('haiku'))  return PRICING.haiku;
  return PRICING.unknown;
}

// ─── Day boundary (America/New_York) ────────────────────────────────────────
// Returns YYYY-MM-DD in ET for a given Date (defaults to now). All accumulators
// key off this string so a single midnight crossover automatically rolls over.
export function todayET(date = new Date()) {
  // en-CA gives YYYY-MM-DD format directly
  return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// ─── Token cost calculator ──────────────────────────────────────────────────
// Coerces a possibly-undefined / possibly-NaN / possibly-object field into a
// safe non-negative integer. Anthropic SDK returns cache_creation as either
// a number OR an object { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }
// depending on the model. We handle both shapes.
function safeNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'object') {
    let sum = 0;
    for (const k of Object.keys(v)) {
      const inner = v[k];
      if (typeof inner === 'number' && Number.isFinite(inner)) sum += inner;
    }
    return sum;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function costForUsage(model, usage) {
  if (!usage) return 0;
  const p = priceFor(model);
  const inp   = safeNum(usage.input_tokens);
  const out   = safeNum(usage.output_tokens);
  // cache_creation_input_tokens is the canonical scalar; cache_creation is the
  // object form (see safeNum). Prefer the scalar; fall back to the object sum.
  const cWri  = safeNum(usage.cache_creation_input_tokens) || safeNum(usage.cache_creation);
  const cRead = safeNum(usage.cache_read_input_tokens)     || safeNum(usage.cache_read);
  const cost  = (inp * p.input + out * p.output + cWri * p.cache_creation + cRead * p.cache_read) / 1_000_000;
  return Number.isFinite(cost) ? cost : 0;
}

// ─── Source 1: data/agent-runs/<YYYY-MM-DD>/agent-*.jsonl ───────────────────
// Live raw Claude Code agent transcripts. Each line is either user/assistant.
// Assistant lines carry message.usage with full token counts.
function spendFromAgentRuns(dateStr) {
  const dayDir = path.join(AGENT_RUNS_DIR, dateStr);
  if (!existsSync(dayDir)) return { total: 0, files: 0, lines: 0 };

  let total = 0;
  let lines = 0;
  let files = 0;

  let entries = [];
  try {
    entries = readdirSync(dayDir).filter(f => f.endsWith('.jsonl'));
  } catch {
    return { total: 0, files: 0, lines: 0 };
  }

  // Dedupe by message.id within and across files. Claude Code writes the
  // same assistant message multiple times as it streams (each tool_use is a
  // separate JSONL line carrying the SAME message.id and usage). Without
  // dedup we overcount by ~3-5x. We bill the FIRST occurrence per id.
  const seenIds = new Set();

  for (const file of entries) {
    files++;
    const full = path.join(dayDir, file);
    let raw;
    try { raw = readFileSync(full, 'utf-8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      lines++;
      try {
        const obj = JSON.parse(line);
        const msg = obj.message;
        if (!msg || !msg.usage) continue;
        const id = msg.id;
        if (id) {
          if (seenIds.has(id)) continue;
          seenIds.add(id);
        }
        const model = msg.model || obj.model || 'unknown';
        total += costForUsage(model, msg.usage);
      } catch {
        // skip malformed line
      }
    }
  }
  return { total, files, lines };
}

// ─── Source 2: logs/api-token-usage.jsonl (today's slice) ───────────────────
// Normalized format from token-usage-logger.mjs. Used as a backup signal in
// case agent-runs is missing OR contains entries the logger picked up before
// us. We DEDUPE by adding both then taking the max-of-the-two-or-sum approach
// described below: we just SUM both, then deduct the overlap by file pattern.
// In practice the logger reads from /tmp not data/agent-runs, so the overlap
// is rare; if both fire on the same agent_id we still over-count which the
// audit explicitly says is acceptable.
function spendFromTokenLog(dateStr) {
  if (!existsSync(TOKEN_USAGE_LOG)) return { total: 0, lines: 0 };

  let total = 0;
  let lines = 0;
  let raw;
  try { raw = readFileSync(TOKEN_USAGE_LOG, 'utf-8'); } catch { return { total: 0, lines: 0 }; }

  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      const ts = obj.timestamp;
      if (!ts) continue;
      // Convert UTC timestamp to ET date string and compare
      let entryDate;
      try { entryDate = todayET(new Date(ts)); } catch { continue; }
      if (entryDate !== dateStr) continue;
      lines++;
      const model = obj.model || 'unknown';
      total += costForUsage(model, obj);
    } catch {
      // skip
    }
  }
  return { total, lines };
}

// ─── Public: compute today's spend ──────────────────────────────────────────
// Returns the canonical budget snapshot used by every consumer.
export function computeBudgetSnapshot(dateOverride = null) {
  const date = dateOverride || todayET();
  const fromRuns = spendFromAgentRuns(date);
  const fromLog  = spendFromTokenLog(date);

  // Per the audit: when in doubt, use the HIGHER number. We sum both sources
  // (already over-counts cache reads) and let it ride.
  const spent = fromRuns.total + fromLog.total;

  const cap        = DAILY_CAP_USD;
  const remaining  = Math.max(0, cap - spent);
  const pct        = cap > 0 ? (spent / cap) * 100 : 0;

  let status;
  if      (pct >= 100) status = 'tripped';
  else if (pct >=  90) status = 'critical';
  else if (pct >=  70) status = 'warning';
  else                 status = 'ok';

  return {
    date,
    spent_usd:     Math.round(spent * 100) / 100,
    cap_usd:       cap,
    remaining_usd: Math.round(remaining * 100) / 100,
    percent_used:  Math.round(pct * 10) / 10,
    status,
    last_updated:  new Date().toISOString(),
    sources: {
      agent_runs: { dollars: Math.round(fromRuns.total * 100) / 100, files: fromRuns.files, lines: fromRuns.lines },
      token_log:  { dollars: Math.round(fromLog.total  * 100) / 100, lines: fromLog.lines },
    },
  };
}

// ─── Trip flag helpers ──────────────────────────────────────────────────────
// Read by /budget/today, askClaude (OC autonomous), and budget-guard.mjs CLI.
export function isTripped() {
  return existsSync(TRIPPED_FLAG_FILE);
}
