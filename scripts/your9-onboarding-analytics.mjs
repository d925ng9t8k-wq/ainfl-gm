#!/usr/bin/env node
/**
 * your9-onboarding-analytics.mjs — Customer Onboarding Analytics & Conversion Tracking
 * Your9 by 9 Enterprises
 *
 * Tracks the full customer journey from signup to active use. Detects
 * drop-offs, measures time-to-value, tracks 7-day engagement curves,
 * and fires non-engagement alerts to the admin team.
 *
 * Usage:
 *   node scripts/your9-onboarding-analytics.mjs --instance <customer-id>
 *   node scripts/your9-onboarding-analytics.mjs --instance <customer-id> --check-dropoffs
 *   node scripts/your9-onboarding-analytics.mjs --instance <customer-id> --funnel
 *   node scripts/your9-onboarding-analytics.mjs --instance <customer-id> --time-to-value
 *   node scripts/your9-onboarding-analytics.mjs --instance <customer-id> --week-curve
 *   node scripts/your9-onboarding-analytics.mjs --report
 *
 * Exported functions (for hub / cron integration):
 *   recordMilestone(instanceDir, milestone, ts?)   → void
 *   getFunnelStatus(instanceDir)                    → FunnelStatus object
 *   getTimeToValue(instanceDir)                     → { minutes, hours, days } | null
 *   checkDropoffs(instanceDir)                      → DropoffResult[]
 *
 * Data stored in: instances/{id}/data/onboarding/milestones.json
 */

import {
  existsSync, mkdirSync, readdirSync, readFileSync,
  writeFileSync, appendFileSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');
const LOGS_DIR = join(ROOT, 'logs');
const SERVICE_LOG = join(LOGS_DIR, 'your9-onboarding-analytics.log');

mkdirSync(LOGS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  const line = `[${new Date().toISOString()}] ONBOARDING: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  try { appendFileSync(SERVICE_LOG, line + '\n'); } catch {}
}

// ---------------------------------------------------------------------------
// Milestone definitions — ordered funnel stages
// ---------------------------------------------------------------------------

/**
 * MILESTONES defines every trackable stage in the onboarding funnel.
 * Each entry: { id, label, dropoffThresholdHours }
 *
 * dropoffThresholdHours: flag as stuck if milestone is not reached within
 * this many hours after the PREVIOUS milestone was completed.
 * The first milestone (account_created) uses provisionedAt as baseline.
 */
export const MILESTONES = [
  {
    id: 'account_created',
    label: 'Account Created',
    dropoffThresholdHours: null,   // entry point — no prior stage
  },
  {
    id: 'instance_provisioned',
    label: 'Instance Provisioned',
    dropoffThresholdHours: 2,      // should happen within 2h of account creation
  },
  {
    id: 'first_telegram_message',
    label: 'First Telegram Message',
    dropoffThresholdHours: 24,
  },
  {
    id: 'first_ceo_response',
    label: 'First CEO Response',
    dropoffThresholdHours: 24,
  },
  {
    id: 'first_agent_task_delegated',
    label: 'First Agent Task Delegated',
    dropoffThresholdHours: 24,
  },
  {
    id: 'first_agent_action_completed',
    label: 'First Agent Action Completed',
    dropoffThresholdHours: 24,
  },
  {
    id: 'first_dashboard_visit',
    label: 'First Dashboard Visit',
    dropoffThresholdHours: 48,
  },
];

// Milestone IDs that indicate value has been delivered to the customer.
// Time-to-value is measured from account_created to the earliest of these.
const VALUE_MILESTONES = new Set([
  'first_agent_action_completed',
  'first_ceo_response',
]);

// ---------------------------------------------------------------------------
// .env loader — no process.env pollution
// ---------------------------------------------------------------------------

function loadEnvFile(envPath) {
  const env = {};
  if (!existsSync(envPath)) return env;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^"(.*)"$/, '$1');
    env[key] = val;
  }
  return env;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Instance helpers
// ---------------------------------------------------------------------------

function discoverInstances() {
  if (!existsSync(INSTANCES_DIR)) return [];
  return readdirSync(INSTANCES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '_integration-check')
    .map(d => {
      const id = d.name;
      const instanceDir = join(INSTANCES_DIR, id);
      const configDir = join(instanceDir, 'config');
      const customerPath = join(configDir, 'customer.json');
      let customer = null;
      try { customer = JSON.parse(readFileSync(customerPath, 'utf-8')); } catch {}
      return { id, instanceDir, customer };
    });
}

function loadInstance(customerId) {
  const instanceDir = join(INSTANCES_DIR, customerId);
  if (!existsSync(instanceDir)) {
    throw new Error(`Instance not found: ${customerId}`);
  }
  const customerPath = join(instanceDir, 'config', 'customer.json');
  const customer = existsSync(customerPath)
    ? JSON.parse(readFileSync(customerPath, 'utf-8'))
    : {};
  const envPath = join(instanceDir, 'config', '.env');
  const env = loadEnvFile(envPath);
  return { customerId, instanceDir, customer, env };
}

// ---------------------------------------------------------------------------
// Onboarding data directory
// ---------------------------------------------------------------------------

function onboardingDir(instanceDir) {
  const p = join(instanceDir, 'data', 'onboarding');
  mkdirSync(p, { recursive: true });
  return p;
}

const MILESTONES_FILE = 'milestones.json';

// ---------------------------------------------------------------------------
// Core data model
// ---------------------------------------------------------------------------

/**
 * milestones.json schema:
 * {
 *   instanceId: string,
 *   milestones: {
 *     [milestoneId]: { ts: ISO8601, recordedBy: string }
 *   },
 *   alertsSent: {
 *     [milestoneId]: ISO8601  // last alert sent for this stuck stage
 *   },
 *   weekActivity: {
 *     [YYYY-MM-DD]: number   // activity events on that date (day 0–7 from account_created)
 *   },
 *   createdAt: ISO8601,
 *   updatedAt: ISO8601
 * }
 */

function loadMilestones(instanceDir) {
  const p = join(onboardingDir(instanceDir), MILESTONES_FILE);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

function saveMilestones(instanceDir, data) {
  const p = join(onboardingDir(instanceDir), MILESTONES_FILE);
  writeFileSync(p, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2));
}

function ensureMilestonesRecord(instanceDir, instanceId) {
  let data = loadMilestones(instanceDir);
  if (!data) {
    data = {
      instanceId,
      milestones: {},
      alertsSent: {},
      weekActivity: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveMilestones(instanceDir, data);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Public: recordMilestone
// ---------------------------------------------------------------------------

/**
 * Record that a customer has reached a milestone.
 *
 * @param {string} instanceDir   - absolute path to instances/{id}
 * @param {string} milestone     - one of MILESTONES[].id
 * @param {string|Date} [ts]     - timestamp override (defaults to now)
 * @param {string} [recordedBy]  - who/what recorded this (hub, agent, cron, etc.)
 */
export function recordMilestone(instanceDir, milestone, ts = null, recordedBy = 'system') {
  const validIds = MILESTONES.map(m => m.id);
  if (!validIds.includes(milestone)) {
    throw new Error(`Unknown milestone: ${milestone}. Valid: ${validIds.join(', ')}`);
  }

  const instanceId = instanceDir.split('/').pop();
  const data = ensureMilestonesRecord(instanceDir, instanceId);

  if (data.milestones[milestone]) {
    // Already recorded — skip silently (idempotent)
    log(`Milestone already recorded: ${instanceId} / ${milestone}`);
    return;
  }

  const recordedTs = ts ? new Date(ts).toISOString() : new Date().toISOString();
  data.milestones[milestone] = { ts: recordedTs, recordedBy };

  // Track week activity if within first 7 days of account_created
  const accountCreatedTs = data.milestones['account_created']?.ts;
  if (accountCreatedTs) {
    const daysSinceAccount = msSince(accountCreatedTs) / (24 * 60 * 60 * 1000);
    if (daysSinceAccount <= 7) {
      const dateKey = recordedTs.slice(0, 10);
      data.weekActivity[dateKey] = (data.weekActivity[dateKey] || 0) + 1;
    }
  }

  saveMilestones(instanceDir, data);
  log(`Milestone recorded: ${instanceId} / ${milestone} at ${recordedTs}`);
}

// ---------------------------------------------------------------------------
// Public: recordWeekActivity
// ---------------------------------------------------------------------------

/**
 * Increment the daily activity count for the 7-day engagement curve.
 * Call this for any meaningful customer action (message, task, visit, etc.)
 * during the first 7 days after account_created.
 *
 * @param {string} instanceDir
 * @param {string|Date} [ts] - timestamp of the activity (defaults to now)
 */
export function recordWeekActivity(instanceDir, ts = null) {
  const instanceId = instanceDir.split('/').pop();
  const data = ensureMilestonesRecord(instanceDir, instanceId);

  const accountCreatedTs = data.milestones['account_created']?.ts;
  if (!accountCreatedTs) return; // no baseline yet

  const activityTs = ts ? new Date(ts) : new Date();
  const daysSinceAccount = (activityTs.getTime() - new Date(accountCreatedTs).getTime())
    / (24 * 60 * 60 * 1000);

  if (daysSinceAccount < 0 || daysSinceAccount > 7) return; // outside window

  const dateKey = activityTs.toISOString().slice(0, 10);
  data.weekActivity[dateKey] = (data.weekActivity[dateKey] || 0) + 1;
  saveMilestones(instanceDir, data);
}

// ---------------------------------------------------------------------------
// Public: getFunnelStatus
// ---------------------------------------------------------------------------

/**
 * Returns full funnel status for an instance.
 *
 * @param {string} instanceDir
 * @returns {FunnelStatus}
 *
 * FunnelStatus: {
 *   instanceId: string,
 *   stages: [{ id, label, completed, ts, hoursFromPrevious }],
 *   completedCount: number,
 *   totalStages: number,
 *   completionPct: number,
 *   currentStage: string|null,   // first incomplete stage
 *   isStuck: boolean,
 *   stuckAt: string|null,
 *   stuckHours: number|null,
 * }
 */
export function getFunnelStatus(instanceDir) {
  const instanceId = instanceDir.split('/').pop();
  const data = loadMilestones(instanceDir);

  if (!data) {
    return {
      instanceId,
      stages: MILESTONES.map(m => ({ id: m.id, label: m.label, completed: false, ts: null, hoursFromPrevious: null })),
      completedCount: 0,
      totalStages: MILESTONES.length,
      completionPct: 0,
      currentStage: MILESTONES[0].id,
      isStuck: false,
      stuckAt: null,
      stuckHours: null,
    };
  }

  const stages = [];
  let prevTs = null;
  let completedCount = 0;
  let currentStage = null;
  let isStuck = false;
  let stuckAt = null;
  let stuckHours = null;

  for (const m of MILESTONES) {
    const record = data.milestones[m.id];
    const completed = !!record;
    let hoursFromPrevious = null;

    if (completed) {
      completedCount++;
      if (prevTs) {
        hoursFromPrevious = parseFloat(
          ((new Date(record.ts).getTime() - new Date(prevTs).getTime()) / 3_600_000).toFixed(2)
        );
      }
      prevTs = record.ts;
    } else {
      if (!currentStage) currentStage = m.id;

      // Check if stuck: threshold exceeded since previous stage was completed
      if (!isStuck && m.dropoffThresholdHours !== null && prevTs) {
        const hoursSincePrev = msSince(prevTs) / 3_600_000;
        if (hoursSincePrev > m.dropoffThresholdHours) {
          isStuck = true;
          stuckAt = m.id;
          stuckHours = parseFloat(hoursSincePrev.toFixed(2));
        }
      }
    }

    stages.push({ id: m.id, label: m.label, completed, ts: record?.ts || null, hoursFromPrevious });
  }

  return {
    instanceId,
    stages,
    completedCount,
    totalStages: MILESTONES.length,
    completionPct: parseFloat(((completedCount / MILESTONES.length) * 100).toFixed(1)),
    currentStage,
    isStuck,
    stuckAt,
    stuckHours,
  };
}

// ---------------------------------------------------------------------------
// Public: getTimeToValue
// ---------------------------------------------------------------------------

/**
 * Calculate time from account_created to first value milestone reached.
 *
 * @param {string} instanceDir
 * @returns {{ minutes: number, hours: number, days: number, milestone: string } | null}
 *   Returns null if value has not yet been delivered.
 */
export function getTimeToValue(instanceDir) {
  const data = loadMilestones(instanceDir);
  if (!data) return null;

  const accountCreatedRecord = data.milestones['account_created'];
  if (!accountCreatedRecord) return null;

  const accountCreatedTs = new Date(accountCreatedRecord.ts).getTime();

  let earliest = null;
  let earliestMilestone = null;

  for (const milestoneId of VALUE_MILESTONES) {
    const record = data.milestones[milestoneId];
    if (!record) continue;
    const ts = new Date(record.ts).getTime();
    if (earliest === null || ts < earliest) {
      earliest = ts;
      earliestMilestone = milestoneId;
    }
  }

  if (earliest === null) return null;

  const ms = earliest - accountCreatedTs;
  const minutes = parseFloat((ms / 60_000).toFixed(2));
  const hours = parseFloat((ms / 3_600_000).toFixed(2));
  const days = parseFloat((ms / 86_400_000).toFixed(2));

  return { minutes, hours, days, milestone: earliestMilestone };
}

// ---------------------------------------------------------------------------
// Public: getWeekCurve
// ---------------------------------------------------------------------------

/**
 * Returns the 7-day engagement curve for an instance.
 * Each entry represents one calendar day from account_created.
 *
 * @param {string} instanceDir
 * @returns {Array<{ day: number, date: string, events: number }>}
 */
export function getWeekCurve(instanceDir) {
  const data = loadMilestones(instanceDir);
  if (!data) return [];

  const accountCreatedRecord = data.milestones['account_created'];
  if (!accountCreatedRecord) return [];

  const startDate = new Date(accountCreatedRecord.ts);
  startDate.setHours(0, 0, 0, 0);

  const curve = [];
  for (let day = 0; day <= 6; day++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + day);
    const dateKey = d.toISOString().slice(0, 10);
    curve.push({
      day,
      date: dateKey,
      events: data.weekActivity[dateKey] || 0,
    });
  }
  return curve;
}

// ---------------------------------------------------------------------------
// Public: checkDropoffs
// ---------------------------------------------------------------------------

/**
 * Returns all instances (or the specified instance) that are stuck in onboarding.
 * "Stuck" means: a milestone's threshold has been exceeded but the milestone
 * has not been completed.
 *
 * Also checks for 48-hour non-engagement during the first 7 days.
 *
 * @param {string} instanceDir   - check one instance
 * @returns {DropoffResult[]}
 *
 * DropoffResult: {
 *   instanceId: string,
 *   type: 'funnel_stuck' | 'no_engagement',
 *   stuckAt: string,            // milestone id or 'no_engagement'
 *   stuckHours: number,
 *   label: string,
 *   alertSent: boolean,
 * }
 */
export function checkDropoffs(instanceDir) {
  const instanceId = instanceDir.split('/').pop();
  const data = loadMilestones(instanceDir);
  if (!data) return [];

  const results = [];

  // 1. Funnel stuck check
  const funnel = getFunnelStatus(instanceDir);
  if (funnel.isStuck) {
    const stageLabel = MILESTONES.find(m => m.id === funnel.stuckAt)?.label || funnel.stuckAt;
    results.push({
      instanceId,
      type: 'funnel_stuck',
      stuckAt: funnel.stuckAt,
      stuckHours: funnel.stuckHours,
      label: `Stuck at: ${stageLabel} (${funnel.stuckHours}h elapsed)`,
      alertSent: !!data.alertsSent?.[funnel.stuckAt],
    });
  }

  // 2. Non-engagement during first 7 days
  const accountCreatedRecord = data.milestones['account_created'];
  if (accountCreatedRecord) {
    const daysSinceAccount = msSince(accountCreatedRecord.ts) / 86_400_000;
    if (daysSinceAccount <= 7) {
      // Find last activity timestamp: check weekActivity, or last milestone ts
      let lastActivityTs = new Date(accountCreatedRecord.ts).getTime();

      // Latest milestone
      for (const r of Object.values(data.milestones)) {
        const t = new Date(r.ts).getTime();
        if (t > lastActivityTs) lastActivityTs = t;
      }

      // Latest week activity date
      for (const [dateKey, count] of Object.entries(data.weekActivity)) {
        if (count > 0) {
          const t = new Date(dateKey + 'T23:59:59Z').getTime();
          if (t > lastActivityTs) lastActivityTs = t;
        }
      }

      const hoursSilent = (Date.now() - lastActivityTs) / 3_600_000;
      if (hoursSilent >= 48) {
        results.push({
          instanceId,
          type: 'no_engagement',
          stuckAt: 'no_engagement',
          stuckHours: parseFloat(hoursSilent.toFixed(2)),
          label: `No engagement for ${hoursSilent.toFixed(1)}h during first week`,
          alertSent: !!data.alertsSent?.['no_engagement'],
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Alert helpers
// ---------------------------------------------------------------------------

const HUB_PORT = 3457;

function postToHub(path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request(
      { hostname: '127.0.0.1', port: HUB_PORT, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => resolve(d));
      }
    );
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}

function sendAdminAlert(instanceId, message) {
  // Try hub first, fall back to log-only
  const payload = {
    channel: 'telegram',
    message: `[ONBOARDING ALERT] ${instanceId}\n${message}`,
  };
  // Use http (local hub)
  const data = JSON.stringify(payload);
  const net = require?.('http') ?? null; // ESM-safe optional
  // We'll use a direct http call since this is local
  const http = { request: null };
  import('http').then(mod => {
    const req = mod.default.request(
      { hostname: '127.0.0.1', port: HUB_PORT, path: '/send', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      () => {}
    );
    req.on('error', () => {});
    req.write(data);
    req.end();
  }).catch(() => {});

  log(`ADMIN ALERT: ${instanceId} — ${message}`);
}

/**
 * Run drop-off checks and send alerts for any new dropoffs not yet alerted.
 * Marks alertsSent in milestones.json so we don't spam.
 *
 * @param {string} instanceDir
 */
export function runDropoffAlertsForInstance(instanceDir) {
  const instanceId = instanceDir.split('/').pop();
  const dropoffs = checkDropoffs(instanceDir);
  if (dropoffs.length === 0) return;

  const data = loadMilestones(instanceDir);
  if (!data) return;

  let changed = false;
  for (const d of dropoffs) {
    if (d.alertSent) continue; // already notified

    sendAdminAlert(instanceId, d.label);
    data.alertsSent = data.alertsSent || {};
    data.alertsSent[d.stuckAt] = new Date().toISOString();
    changed = true;
  }

  if (changed) saveMilestones(instanceDir, data);
}

// ---------------------------------------------------------------------------
// Aggregate report builder
// ---------------------------------------------------------------------------

function buildAggregateReport(instances) {
  const totalInstances = instances.length;
  let fullyOnboarded = 0;
  let stuck = 0;
  let noEngagement = 0;
  const stageCounts = {};
  for (const m of MILESTONES) stageCounts[m.id] = 0;

  const ttvList = [];
  const perInstance = [];

  for (const { id, instanceDir, customer } of instances) {
    const funnel = getFunnelStatus(instanceDir);
    const ttv = getTimeToValue(instanceDir);
    const dropoffs = checkDropoffs(instanceDir);
    const curve = getWeekCurve(instanceDir);

    for (const s of funnel.stages) {
      if (s.completed) stageCounts[s.id]++;
    }

    if (funnel.completedCount === MILESTONES.length) fullyOnboarded++;
    if (funnel.isStuck) stuck++;
    if (dropoffs.some(d => d.type === 'no_engagement')) noEngagement++;
    if (ttv) ttvList.push(ttv.hours);

    perInstance.push({
      instanceId: id,
      name: customer?.name || id,
      completionPct: funnel.completionPct,
      currentStage: funnel.currentStage,
      isStuck: funnel.isStuck,
      stuckAt: funnel.stuckAt,
      ttvHours: ttv ? ttv.hours : null,
      weekCurve: curve,
      dropoffs,
    });
  }

  const avgTtvHours = ttvList.length
    ? parseFloat((ttvList.reduce((a, b) => a + b, 0) / ttvList.length).toFixed(2))
    : null;

  const funnelConversion = {};
  for (const m of MILESTONES) {
    funnelConversion[m.id] = {
      label: m.label,
      count: stageCounts[m.id],
      conversionPct: totalInstances
        ? parseFloat(((stageCounts[m.id] / totalInstances) * 100).toFixed(1))
        : 0,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    totalInstances,
    fullyOnboarded,
    stuck,
    noEngagement,
    avgTtvHours,
    funnelConversion,
    perInstance,
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function msSince(isoTs) {
  return Date.now() - new Date(isoTs).getTime();
}

function formatHours(h) {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

// ---------------------------------------------------------------------------
// CLI renderers
// ---------------------------------------------------------------------------

function printFunnel(funnel) {
  console.log(`\nFunnel Status — ${funnel.instanceId}`);
  console.log(`Progress: ${funnel.completedCount}/${funnel.totalStages} stages (${funnel.completionPct}%)`);
  if (funnel.isStuck) {
    console.log(`STUCK at: ${funnel.stuckAt} (${funnel.stuckHours}h elapsed)`);
  }
  console.log('');
  for (const s of funnel.stages) {
    const icon = s.completed ? '[x]' : '[ ]';
    const timing = s.hoursFromPrevious !== null ? ` (+${formatHours(s.hoursFromPrevious)})` : '';
    const ts = s.ts ? ` @ ${s.ts.slice(0, 16).replace('T', ' ')}` : '';
    console.log(`  ${icon} ${s.label}${ts}${timing}`);
  }
  console.log('');
}

function printTimeToValue(ttv) {
  if (!ttv) {
    console.log('Time to Value: not yet achieved\n');
    return;
  }
  console.log(`\nTime to Value: ${formatHours(ttv.hours)} (via ${ttv.milestone})\n`);
}

function printWeekCurve(curve, instanceId) {
  console.log(`\n7-Day Engagement Curve — ${instanceId}`);
  const max = Math.max(...curve.map(c => c.events), 1);
  for (const c of curve) {
    const bar = '#'.repeat(Math.round((c.events / max) * 20));
    const pad = ' '.repeat(20 - bar.length);
    console.log(`  Day ${c.day} (${c.date}): [${bar}${pad}] ${c.events}`);
  }
  console.log('');
}

function printDropoffs(dropoffs, instanceId) {
  if (dropoffs.length === 0) {
    console.log(`\nDrop-offs: none detected for ${instanceId}\n`);
    return;
  }
  console.log(`\nDrop-offs — ${instanceId}`);
  for (const d of dropoffs) {
    const alerted = d.alertSent ? ' [ALERTED]' : ' [NOT YET ALERTED]';
    console.log(`  ${d.type.toUpperCase()}: ${d.label}${alerted}`);
  }
  console.log('');
}

function printAggregateReport(report) {
  console.log('\n=== Onboarding Aggregate Report ===');
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Total instances: ${report.totalInstances}`);
  console.log(`Fully onboarded: ${report.fullyOnboarded}`);
  console.log(`Currently stuck: ${report.stuck}`);
  console.log(`Non-engagement alerts: ${report.noEngagement}`);
  console.log(`Avg time to value: ${report.avgTtvHours !== null ? formatHours(report.avgTtvHours) : 'N/A'}`);
  console.log('\n--- Funnel Conversion ---');
  for (const [id, s] of Object.entries(report.funnelConversion)) {
    const bar = '#'.repeat(Math.round(s.conversionPct / 5));
    const pad = ' '.repeat(20 - bar.length);
    console.log(`  ${s.label.padEnd(36)} [${bar}${pad}] ${s.count}/${report.totalInstances} (${s.conversionPct}%)`);
  }
  console.log('\n--- Per Instance ---');
  for (const inst of report.perInstance) {
    const stuck = inst.isStuck ? ` STUCK@${inst.stuckAt}` : '';
    const ttv = inst.ttvHours !== null ? ` TTV:${formatHours(inst.ttvHours)}` : '';
    console.log(`  ${inst.name} (${inst.instanceId}): ${inst.completionPct}%${stuck}${ttv}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Main — CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  // --report: aggregate across all instances
  if (args.report) {
    const instances = discoverInstances();
    if (instances.length === 0) {
      console.log('No instances found.');
      process.exit(0);
    }
    const report = buildAggregateReport(instances);
    printAggregateReport(report);

    // Run dropoff alerts as side effect
    for (const { instanceDir } of instances) {
      runDropoffAlertsForInstance(instanceDir);
    }
    process.exit(0);
  }

  // --instance: per-customer view
  if (!args.instance) {
    console.error('Usage: --instance <customer-id> | --report');
    console.error('  Flags: --funnel | --time-to-value | --week-curve | --check-dropoffs');
    process.exit(1);
  }

  const { instanceDir, customerId, customer } = loadInstance(args.instance);
  const name = customer?.name || customerId;

  log(`Running for instance: ${customerId} (${name})`);

  const showAll = !args.funnel && !args['time-to-value'] && !args['week-curve'] && !args['check-dropoffs'];

  if (showAll || args.funnel) {
    const funnel = getFunnelStatus(instanceDir);
    printFunnel(funnel);
  }

  if (showAll || args['time-to-value']) {
    const ttv = getTimeToValue(instanceDir);
    printTimeToValue(ttv);
  }

  if (showAll || args['week-curve']) {
    const curve = getWeekCurve(instanceDir);
    printWeekCurve(curve, customerId);
  }

  if (showAll || args['check-dropoffs']) {
    const dropoffs = checkDropoffs(instanceDir);
    printDropoffs(dropoffs, customerId);
    // Send alerts for new dropoffs
    runDropoffAlertsForInstance(instanceDir);
  }
}

// Only run main when executed directly (not when imported as a module)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => {
    log(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
