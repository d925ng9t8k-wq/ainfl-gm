#!/usr/bin/env node
/**
 * your9-usage-limits.mjs — Real-time Usage Enforcement Engine
 * Your9 by 9 Enterprises
 *
 * Extends the billing system with per-instance daily usage tracking,
 * tier-based limit enforcement, usage alerts, and monthly invoice generation.
 *
 * Tier daily limits (per billing.mjs definitions):
 *   Starter    — 100 API calls/day
 *   Growth     — 500 API calls/day
 *   Enterprise — unlimited
 *
 * Capabilities:
 *   - Real-time token tracking: every API call logged to daily JSON file
 *   - Tier enforcement: warn at 80%, queue at 100% (or hard-stop)
 *   - Usage alerts: Telegram to instance founder at 80% and 100%
 *   - Monthly invoice generation: aggregate dailies → invoice-compatible JSON
 *   - Overage handling: auto-upgrade or hard-stop (configurable per instance)
 *
 * Usage (CLI):
 *   node scripts/your9-usage-limits.mjs --instance {customer-id}                  # Status
 *   node scripts/your9-usage-limits.mjs --instance {customer-id} --record         # Record one API call
 *   node scripts/your9-usage-limits.mjs --instance {customer-id} --daily          # Print today's usage
 *   node scripts/your9-usage-limits.mjs --instance {customer-id} --monthly        # Print monthly totals
 *   node scripts/your9-usage-limits.mjs --instance {customer-id} --invoice        # Generate invoice JSON
 *   node scripts/your9-usage-limits.mjs --instance {customer-id} --check          # Check limit status
 *
 * Exports (for hub integration):
 *   recordApiCall(instanceId, metadata?)  → usageEntry
 *   checkUsageLimit(instanceId)           → { allowed, percent, status, queued }
 *   getDailyUsage(instanceId, date?)      → dailyRecord
 *   getMonthlyUsage(instanceId, year, month) → monthlySummary
 *   generateInvoice(instanceId, year, month) → invoiceData
 */

import https from 'https';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');
const USAGE_LOG = join(ROOT, 'logs', 'your9-usage-limits.log');

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function loadEnv(instanceId = null) {
  const sources = [join(ROOT, '.env')];
  if (instanceId) sources.push(join(INSTANCES_DIR, instanceId, 'config', '.env'));

  const vars = {};
  for (const envPath of sources) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      vars[key] = val;
    }
  }
  return vars;
}

// ---------------------------------------------------------------------------
// Tier definitions — mirrors your9-billing.mjs TIERS exactly
// ---------------------------------------------------------------------------

const TIERS = {
  starter: {
    label: 'Starter',
    priceMonthly: 499,
    dailyCallLimit: 100,
    monthlyCallLimit: 100,   // billing.mjs uses monthly; we enforce daily too
    maxAgents: 3,
    overageStrategy: 'hard_stop' // 'hard_stop' | 'auto_upgrade' | 'queue'
  },
  growth: {
    label: 'Growth',
    priceMonthly: 999,
    dailyCallLimit: 500,
    monthlyCallLimit: 500,
    maxAgents: 6,
    overageStrategy: 'queue'
  },
  enterprise: {
    label: 'Enterprise',
    priceMonthly: 2499,
    dailyCallLimit: -1,      // unlimited
    monthlyCallLimit: -1,
    maxAgents: 12,
    overageStrategy: 'none'
  }
};

// Thresholds that trigger Telegram alerts
const WARN_THRESHOLD  = 0.80; // 80% → warn
const LIMIT_THRESHOLD = 1.00; // 100% → enforce

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] USAGE: ${msg}`;
  console.log(line);
  try {
    if (!existsSync(join(ROOT, 'logs'))) mkdirSync(join(ROOT, 'logs'), { recursive: true });
    appendFileSync(USAGE_LOG, line + '\n');
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function todayDateStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function yearMonthStr(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Daily usage file paths
// instances/{id}/data/usage/daily-YYYY-MM-DD.json
// ---------------------------------------------------------------------------

function usageDir(instanceId) {
  return join(INSTANCES_DIR, instanceId, 'data', 'usage');
}

function dailyFilePath(instanceId, dateStr = todayDateStr()) {
  return join(usageDir(instanceId), `daily-${dateStr}.json`);
}

// ---------------------------------------------------------------------------
// Daily usage record schema
// ---------------------------------------------------------------------------

function emptyDailyRecord(instanceId, dateStr, tier) {
  return {
    instanceId,
    date: dateStr,
    tier,
    calls: 0,
    limit: TIERS[tier]?.dailyCallLimit ?? -1,
    warnSentAt: null,
    limitSentAt: null,
    queued: 0,
    blocked: 0,
    entries: []   // per-call log
  };
}

// ---------------------------------------------------------------------------
// Load / save daily record
// ---------------------------------------------------------------------------

function loadDailyRecord(instanceId, dateStr = todayDateStr()) {
  const p = dailyFilePath(instanceId, dateStr);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function saveDailyRecord(instanceId, record) {
  const dir = usageDir(instanceId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(dailyFilePath(instanceId, record.date), JSON.stringify(record, null, 2));
}

// ---------------------------------------------------------------------------
// Instance helpers
// ---------------------------------------------------------------------------

function loadInstanceConfig(instanceId) {
  const configPath = join(INSTANCES_DIR, instanceId, 'config', 'customer.json');
  if (!existsSync(configPath)) throw new Error(`No customer config for instance: ${instanceId}`);
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

function instanceTier(instanceId) {
  try {
    const config = loadInstanceConfig(instanceId);
    return (config.tier || 'starter').toLowerCase();
  } catch {
    return 'starter';
  }
}

// ---------------------------------------------------------------------------
// Telegram alert (direct bot API — matches customer-success.mjs pattern)
// ---------------------------------------------------------------------------

async function sendTelegramAlert(instanceId, message) {
  const env = loadEnv(instanceId);
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId   = env.TELEGRAM_OWNER_CHAT_ID;

  if (!botToken || !chatId ||
      botToken.startsWith('PLACEHOLDER') || chatId.startsWith('PLACEHOLDER')) {
    log(`Telegram alert skipped for ${instanceId} — no bot token or chat ID configured`);
    return false;
  }

  const MAX = 4000;
  const chunks = [];
  let remaining = String(message);
  while (remaining.length > MAX) {
    chunks.push(remaining.slice(0, MAX));
    remaining = remaining.slice(MAX);
  }
  chunks.push(remaining);

  for (const chunk of chunks) {
    await new Promise((resolve) => {
      const body = JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'Markdown' });
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${botToken}/sendMessage`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        },
        res => {
          res.on('data', () => {});
          res.on('end', resolve);
        }
      );
      req.on('error', (e) => {
        log(`Telegram alert error for ${instanceId}: ${e.message}`);
        resolve();
      });
      req.setTimeout(8000, () => { req.destroy(); resolve(); });
      req.write(body);
      req.end();
    });
  }

  log(`Telegram alert sent to ${instanceId}`);
  return true;
}

// ---------------------------------------------------------------------------
// Alert message builders
// ---------------------------------------------------------------------------

function buildWarnMessage(instanceId, record) {
  const tierLabel = TIERS[record.tier]?.label || record.tier;
  const pct = Math.round((record.calls / record.limit) * 100);
  const remaining = record.limit - record.calls;

  return (
    `*Your9 Usage Alert — ${instanceId}*\n\n` +
    `Your AI instance has reached *${pct}%* of your daily API call limit.\n\n` +
    `*Tier:* ${tierLabel}\n` +
    `*Used today:* ${record.calls} / ${record.limit} calls\n` +
    `*Remaining:* ${remaining} calls\n` +
    `*Date:* ${record.date}\n\n` +
    `If you continue at this rate, tasks will be queued or paused when the limit is reached. ` +
    `Upgrade to a higher tier for more capacity.`
  );
}

function buildLimitMessage(instanceId, record) {
  const tierLabel = TIERS[record.tier]?.label || record.tier;
  const strategy  = TIERS[record.tier]?.overageStrategy || 'hard_stop';

  const actionLine = strategy === 'queue'
    ? 'New tasks are being *queued* and will resume tomorrow when the limit resets.'
    : strategy === 'auto_upgrade'
    ? 'Your instance is being *auto-upgraded* to the next tier to continue service.'
    : 'New API calls are *paused* until tomorrow. Contact support to upgrade your tier.';

  return (
    `*Your9 Daily Limit Reached — ${instanceId}*\n\n` +
    `Your AI instance has hit its daily API call limit.\n\n` +
    `*Tier:* ${tierLabel}\n` +
    `*Calls used:* ${record.calls} / ${record.limit}\n` +
    `*Date:* ${record.date}\n\n` +
    actionLine
  );
}

// ---------------------------------------------------------------------------
// Core: recordApiCall
// Logs one API call to the daily file, fires alerts at thresholds.
// ---------------------------------------------------------------------------

/**
 * Record one Anthropic API call for an instance.
 *
 * @param {string} instanceId   — customer instance ID (e.g. "acme-corp-001")
 * @param {object} [metadata]   — optional: { model, tokens, taskId, agentId }
 * @returns {object}            — the usage entry that was recorded
 */
export async function recordApiCall(instanceId, metadata = {}) {
  const dateStr = todayDateStr();
  const tier    = instanceTier(instanceId);
  const tierCfg = TIERS[tier] || TIERS.starter;

  let record = loadDailyRecord(instanceId, dateStr);
  if (!record) record = emptyDailyRecord(instanceId, dateStr, tier);

  const entry = {
    ts:      new Date().toISOString(),
    model:   metadata.model   || null,
    tokens:  metadata.tokens  || null,
    taskId:  metadata.taskId  || null,
    agentId: metadata.agentId || null
  };

  record.calls += 1;
  record.entries.push(entry);
  saveDailyRecord(instanceId, record);

  log(`API call recorded — instance=${instanceId} date=${dateStr} calls=${record.calls}/${tierCfg.dailyCallLimit === -1 ? 'unlimited' : tierCfg.dailyCallLimit} tier=${tier}`);

  // ---- Alert logic (skip for unlimited) -----------------------------------
  if (tierCfg.dailyCallLimit !== -1) {
    const percent = record.calls / tierCfg.dailyCallLimit;

    // 80% warn — send once per day
    if (percent >= WARN_THRESHOLD && !record.warnSentAt) {
      log(`Usage warn threshold reached for ${instanceId} (${Math.round(percent * 100)}%)`);
      record.warnSentAt = new Date().toISOString();
      saveDailyRecord(instanceId, record);
      await sendTelegramAlert(instanceId, buildWarnMessage(instanceId, record));
    }

    // 100% limit — send once per day
    if (percent >= LIMIT_THRESHOLD && !record.limitSentAt) {
      log(`Usage limit reached for ${instanceId} — enforcing ${tierCfg.overageStrategy}`);
      record.limitSentAt = new Date().toISOString();
      saveDailyRecord(instanceId, record);
      await sendTelegramAlert(instanceId, buildLimitMessage(instanceId, record));
    }
  }

  return entry;
}

// ---------------------------------------------------------------------------
// Core: checkUsageLimit
// Returns whether a new API call is allowed right now.
// ---------------------------------------------------------------------------

/**
 * Check if the instance is allowed to make another API call.
 *
 * @param {string} instanceId
 * @returns {{ allowed: boolean, percent: number, calls: number, limit: number,
 *             status: 'ok'|'warn'|'at_limit', queued: boolean, strategy: string }}
 */
export function checkUsageLimit(instanceId) {
  const dateStr = todayDateStr();
  const tier    = instanceTier(instanceId);
  const tierCfg = TIERS[tier] || TIERS.starter;

  // Enterprise = unlimited
  if (tierCfg.dailyCallLimit === -1) {
    return {
      allowed:  true,
      percent:  0,
      calls:    0,
      limit:    -1,
      status:   'ok',
      queued:   false,
      strategy: 'none',
      tier
    };
  }

  const record  = loadDailyRecord(instanceId, dateStr);
  const calls   = record?.calls ?? 0;
  const limit   = tierCfg.dailyCallLimit;
  const percent = calls / limit;
  const strategy = tierCfg.overageStrategy;

  let status  = 'ok';
  let allowed = true;
  let queued  = false;

  if (percent >= LIMIT_THRESHOLD) {
    status = 'at_limit';
    if (strategy === 'hard_stop') {
      allowed = false;
    } else if (strategy === 'queue') {
      allowed = false;
      queued  = true;
    } else if (strategy === 'auto_upgrade') {
      // Caller handles upgrade — still allow but flag it
      allowed = true;
    }
  } else if (percent >= WARN_THRESHOLD) {
    status = 'warn';
  }

  return { allowed, percent, calls, limit, status, queued, strategy, tier };
}

// ---------------------------------------------------------------------------
// Core: getDailyUsage
// ---------------------------------------------------------------------------

/**
 * Get daily usage record for an instance.
 *
 * @param {string} instanceId
 * @param {string} [dateStr]  — YYYY-MM-DD, defaults to today
 * @returns {object|null}
 */
export function getDailyUsage(instanceId, dateStr = todayDateStr()) {
  const tier    = instanceTier(instanceId);
  const record  = loadDailyRecord(instanceId, dateStr);

  if (!record) {
    // Return an empty record so callers don't have to null-check
    return emptyDailyRecord(instanceId, dateStr, tier);
  }

  return record;
}

// ---------------------------------------------------------------------------
// Core: getMonthlyUsage
// Aggregate all daily files for a given year-month.
// ---------------------------------------------------------------------------

/**
 * Aggregate daily usage files into a monthly summary.
 *
 * @param {string} instanceId
 * @param {number} [year]    — defaults to current year
 * @param {number} [month]   — 1-based, defaults to current month
 * @returns {object} monthlySummary
 */
export function getMonthlyUsage(instanceId, year = null, month = null) {
  const now      = new Date();
  const y        = year  ?? now.getFullYear();
  const m        = month ?? (now.getMonth() + 1);
  const prefix   = `${y}-${String(m).padStart(2, '0')}`;
  const dir      = usageDir(instanceId);
  const tier     = instanceTier(instanceId);
  const tierCfg  = TIERS[tier] || TIERS.starter;

  const summary = {
    instanceId,
    yearMonth:    prefix,
    tier,
    tierLabel:    tierCfg.label,
    monthlyLimit: tierCfg.monthlyCallLimit,
    totalCalls:   0,
    totalQueued:  0,
    totalBlocked: 0,
    dailyBreakdown: [],
    daysWithData: 0,
    averageCallsPerDay: 0,
    peakDay: null,
    peakCalls: 0
  };

  if (!existsSync(dir)) return summary;

  const files = readdirSync(dir)
    .filter(f => f.startsWith(`daily-${prefix}`) && f.endsWith('.json'))
    .sort();

  for (const file of files) {
    let rec;
    try {
      rec = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch {
      continue;
    }

    summary.totalCalls   += rec.calls   || 0;
    summary.totalQueued  += rec.queued  || 0;
    summary.totalBlocked += rec.blocked || 0;
    summary.daysWithData += 1;

    summary.dailyBreakdown.push({
      date:    rec.date,
      calls:   rec.calls   || 0,
      queued:  rec.queued  || 0,
      blocked: rec.blocked || 0
    });

    if ((rec.calls || 0) > summary.peakCalls) {
      summary.peakCalls = rec.calls || 0;
      summary.peakDay   = rec.date;
    }
  }

  if (summary.daysWithData > 0) {
    summary.averageCallsPerDay = Math.round(summary.totalCalls / summary.daysWithData);
  }

  // Monthly usage percent (skip for unlimited)
  if (tierCfg.monthlyCallLimit !== -1) {
    summary.usagePercent = Math.round((summary.totalCalls / tierCfg.monthlyCallLimit) * 100);
  } else {
    summary.usagePercent = null;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Core: generateInvoice
// Stripe-compatible invoice data from monthly usage aggregate.
// ---------------------------------------------------------------------------

/**
 * Generate invoice data for a billing period, compatible with Stripe invoice items.
 *
 * @param {string} instanceId
 * @param {number} [year]
 * @param {number} [month]   — 1-based
 * @returns {object} invoiceData
 */
export function generateInvoice(instanceId, year = null, month = null) {
  const now     = new Date();
  const y       = year  ?? now.getFullYear();
  const m       = month ?? (now.getMonth() + 1);
  const prefix  = `${y}-${String(m).padStart(2, '0')}`;

  let config;
  try { config = loadInstanceConfig(instanceId); } catch { config = { tier: 'starter' }; }

  const tier     = (config.tier || 'starter').toLowerCase();
  const tierCfg  = TIERS[tier] || TIERS.starter;
  const monthly  = getMonthlyUsage(instanceId, y, m);

  // Period boundaries
  const periodStart = new Date(y, m - 1, 1);
  const periodEnd   = new Date(y, m, 0, 23, 59, 59);

  // Base subscription line item
  const lineItems = [
    {
      description:  `Your9 ${tierCfg.label} — ${prefix}`,
      type:         'subscription',
      quantity:     1,
      unitAmountCents: tierCfg.priceMonthly * 100,
      amountCents:  tierCfg.priceMonthly * 100,
      currency:     'usd'
    }
  ];

  // Overage line item (Starter/Growth only — enterprise is unlimited)
  let overageCalls = 0;
  let overageCents = 0;

  if (tierCfg.monthlyCallLimit !== -1 && monthly.totalCalls > tierCfg.monthlyCallLimit) {
    overageCalls = monthly.totalCalls - tierCfg.monthlyCallLimit;
    // Overage: $0.05 per call above limit
    const OVERAGE_RATE_CENTS = 5;
    overageCents = overageCalls * OVERAGE_RATE_CENTS;

    lineItems.push({
      description:  `API call overage — ${overageCalls} calls over ${tierCfg.monthlyCallLimit} limit`,
      type:         'overage',
      quantity:     overageCalls,
      unitAmountCents: OVERAGE_RATE_CENTS,
      amountCents:  overageCents,
      currency:     'usd'
    });
  }

  const subtotalCents = lineItems.reduce((sum, li) => sum + li.amountCents, 0);
  // No tax calculation — Stripe handles tax via automatic tax or tax rates
  const totalCents = subtotalCents;

  const invoice = {
    // Stripe-compatible metadata fields
    object:       'invoice_data',
    instanceId,
    stripeCustomerId: config.stripeCustomerId || null,
    stripeSubscriptionId: config.stripeSubscriptionId || null,
    currency:     'usd',
    status:       'draft',   // caller promotes to 'open' when ready to collect
    billingPeriod: prefix,
    periodStart:  periodStart.toISOString(),
    periodEnd:    periodEnd.toISOString(),
    generatedAt:  new Date().toISOString(),

    // Customer info
    customer: {
      instanceId,
      name:    config.name    || instanceId,
      email:   config.email   || null,
      company: config.company || null,
      tier,
      tierLabel: tierCfg.label
    },

    // Usage summary
    usage: {
      totalCalls:     monthly.totalCalls,
      includedCalls:  tierCfg.monthlyCallLimit === -1 ? 'unlimited' : tierCfg.monthlyCallLimit,
      overageCalls,
      dailyBreakdown: monthly.dailyBreakdown
    },

    // Billing
    lineItems,
    subtotalCents,
    totalCents,
    totalUsd: (totalCents / 100).toFixed(2),

    // For Stripe invoice creation via billing.mjs
    stripePayload: {
      customer:    config.stripeCustomerId || null,
      currency:    'usd',
      description: `Your9 ${tierCfg.label} — ${prefix}`,
      metadata: {
        your9_instance_id: instanceId,
        your9_tier:        tier,
        billing_period:    prefix,
        total_api_calls:   String(monthly.totalCalls),
        overage_calls:     String(overageCalls)
      }
    }
  };

  return invoice;
}

// ---------------------------------------------------------------------------
// CLI: status report
// ---------------------------------------------------------------------------

function printStatus(instanceId) {
  const dateStr = todayDateStr();
  const tier    = instanceTier(instanceId);
  const tierCfg = TIERS[tier] || TIERS.starter;
  const limit   = checkUsageLimit(instanceId);
  const daily   = getDailyUsage(instanceId, dateStr);
  const ym      = yearMonthStr();
  const monthly = getMonthlyUsage(instanceId);

  const bar = '='.repeat(60);
  console.log(`\n${bar}`);
  console.log(`  Usage Limits — ${instanceId}`);
  console.log(bar);
  console.log(`  Tier:           ${tierCfg.label}`);
  console.log(`  Daily limit:    ${tierCfg.dailyCallLimit === -1 ? 'Unlimited' : tierCfg.dailyCallLimit + ' calls/day'}`);
  console.log(`  Overage policy: ${tierCfg.overageStrategy}`);
  console.log(`\n  Today (${dateStr}):`);
  console.log(`    Calls:        ${daily.calls} / ${tierCfg.dailyCallLimit === -1 ? 'unlimited' : tierCfg.dailyCallLimit}`);
  console.log(`    Status:       ${limit.status.toUpperCase()}`);
  console.log(`    Allowed:      ${limit.allowed ? 'YES' : 'NO'}`);
  if (limit.queued) console.log(`    Queued:       YES`);
  if (daily.warnSentAt)  console.log(`    80% alert:    sent ${daily.warnSentAt}`);
  if (daily.limitSentAt) console.log(`    100% alert:   sent ${daily.limitSentAt}`);
  console.log(`\n  This month (${ym}):`);
  console.log(`    Total calls:  ${monthly.totalCalls}`);
  console.log(`    Peak day:     ${monthly.peakDay || 'n/a'} (${monthly.peakCalls} calls)`);
  console.log(`    Avg/day:      ${monthly.averageCallsPerDay}`);
  if (monthly.usagePercent !== null) {
    console.log(`    Monthly pct:  ${monthly.usagePercent}%`);
  }
  console.log(bar + '\n');
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const instanceIdx = args.indexOf('--instance');
  const instanceId  = instanceIdx !== -1 ? args[instanceIdx + 1] : null;

  if (!instanceId) {
    console.error('Usage: node scripts/your9-usage-limits.mjs --instance {customer-id} [--record|--daily|--monthly|--invoice|--check]');
    process.exit(1);
  }

  if (!existsSync(join(INSTANCES_DIR, instanceId))) {
    console.error(`Instance not found: ${instanceId}`);
    process.exit(1);
  }

  if (args.includes('--record')) {
    // Record one API call (for manual testing or CLI-driven invocation)
    const entry = await recordApiCall(instanceId, { model: 'cli-test', taskId: 'manual' });
    console.log('Recorded:', JSON.stringify(entry, null, 2));
    return;
  }

  if (args.includes('--check')) {
    const result = checkUsageLimit(instanceId);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.includes('--daily')) {
    const dateStr = todayDateStr();
    const record  = getDailyUsage(instanceId, dateStr);
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  if (args.includes('--monthly')) {
    const monthly = getMonthlyUsage(instanceId);
    console.log(JSON.stringify(monthly, null, 2));
    return;
  }

  if (args.includes('--invoice')) {
    const invoice = generateInvoice(instanceId);
    // Save to instances/{id}/data/billing/
    const billingDir = join(INSTANCES_DIR, instanceId, 'data', 'billing');
    if (!existsSync(billingDir)) mkdirSync(billingDir, { recursive: true });
    const ym = yearMonthStr();
    const invoicePath = join(billingDir, `invoice-${ym}.json`);
    writeFileSync(invoicePath, JSON.stringify(invoice, null, 2));
    console.log(`Invoice written: ${invoicePath}`);
    console.log(JSON.stringify(invoice, null, 2));
    return;
  }

  // Default: status
  printStatus(instanceId);
}

// Run if invoked directly
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
