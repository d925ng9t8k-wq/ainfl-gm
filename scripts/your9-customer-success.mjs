#!/usr/bin/env node
/**
 * your9-customer-success.mjs — Automated Customer Success & Retention Engine
 * Your9 by 9 Enterprises
 *
 * Ensures customers stay engaged, extract real value, and never churn silently.
 *
 * Systems:
 *   1. Health Score       — 0-100 composite metric: engagement + satisfaction +
 *                           task completion + feature adoption. Stored per instance.
 *   2. Churn Risk         — Flags customers with: 3+ day silence, declining task
 *                           counts week-over-week, zero use of key features.
 *   3. Engagement Metrics — Tracks messages/day, tasks completed, dashboard visits,
 *                           agent interactions, response times.
 *   4. Proactive Outreach — When engagement drops, the CEO reaches out with
 *                           specific, personalized value suggestions via Telegram.
 *   5. Weekly Report      — "How is Your9 doing?" summary to the founder:
 *                           usage stats, value delivered, health score, suggestions.
 *
 * Usage:
 *   node scripts/your9-customer-success.mjs --instance <customer-id>
 *   node scripts/your9-customer-success.mjs --instance <customer-id> --weekly-report
 *   node scripts/your9-customer-success.mjs --instance <customer-id> --check-churn
 *   node scripts/your9-customer-success.mjs --instance <customer-id> --health-score
 *   node scripts/your9-customer-success.mjs --instance <customer-id> --outreach
 *   node scripts/your9-customer-success.mjs --instance <customer-id> --track-visit
 *   node scripts/your9-customer-success.mjs --report   # Aggregate across all instances
 *
 * Exported functions (for hub / cron integration):
 *   calculateHealthScore(instanceDir)          → number 0-100
 *   detectChurnRisk(instanceDir)               → { isAtRisk, reasons[], score }
 *   generateSuccessReport(instanceDir, customer) → string (Markdown)
 *   recordDashboardVisit(instanceDir)          → void
 *   recordAgentInteraction(instanceDir, agentId, responseTimeMs) → void
 *
 * Data stored in: instances/{id}/data/success/
 *   health.json        — current health score + component breakdown
 *   churn-risk.json    — latest churn risk assessment
 *   metrics.jsonl      — time-series engagement events
 *   outreach-log.jsonl — proactive outreach history (prevents spam)
 *   weekly-reports.jsonl — history of weekly reports sent
 */

import {
  existsSync, mkdirSync, readdirSync, readFileSync,
  writeFileSync, appendFileSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

// ---------------------------------------------------------------------------
// Paths & bootstrap
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');
const LOGS_DIR = join(ROOT, 'logs');
const SERVICE_LOG = join(LOGS_DIR, 'your9-customer-success.log');

mkdirSync(LOGS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const SONNET_MODEL = 'claude-sonnet-4-5';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  const line = `[${new Date().toISOString()}] SUCCESS: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  try { appendFileSync(SERVICE_LOG, line + '\n'); } catch {}
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
// Instance discovery
// ---------------------------------------------------------------------------

function discoverInstances() {
  if (!existsSync(INSTANCES_DIR)) return [];
  return readdirSync(INSTANCES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '_integration-check')
    .map(d => {
      const id = d.name;
      const instanceDir = join(INSTANCES_DIR, id);
      const configDir = join(instanceDir, 'config');
      const envPath = join(configDir, '.env');
      const customerPath = join(configDir, 'customer.json');
      const env = loadEnvFile(envPath);
      let customer = null;
      try { customer = JSON.parse(readFileSync(customerPath, 'utf-8')); } catch {}
      return { id, instanceDir, configDir, envPath, env, customer };
    });
}

function loadInstance(customerId) {
  const instanceDir = join(INSTANCES_DIR, customerId);
  if (!existsSync(instanceDir)) {
    throw new Error(`Instance not found: ${customerId}`);
  }
  const configPath = join(instanceDir, 'config', 'customer.json');
  const customer = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf-8'))
    : {};
  const envPath = join(instanceDir, 'config', '.env');
  const env = loadEnvFile(envPath);
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const ownerChatId = env.TELEGRAM_CHAT_ID || env.OWNER_CHAT_ID;
  const anthropicKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  return { customerId, instanceDir, customer, env, botToken, ownerChatId, anthropicKey };
}

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

function successDir(instanceDir) {
  const p = join(instanceDir, 'data', 'success');
  mkdirSync(p, { recursive: true });
  return p;
}

function analyticsDir(instanceDir) {
  return join(instanceDir, 'data', 'analytics');
}

function feedbackDir(instanceDir) {
  return join(instanceDir, 'data', 'feedback');
}

function tasksDir(instanceDir) {
  return join(instanceDir, 'data', 'tasks');
}

// ---------------------------------------------------------------------------
// DATA READERS — pull from existing analytics + feedback systems
// ---------------------------------------------------------------------------

/**
 * Load usage analytics from your9-beta-feedback.mjs data.
 */
function loadUsageAnalytics(instanceDir) {
  const p = join(analyticsDir(instanceDir), 'usage.json');
  if (!existsSync(p)) {
    return {
      messagesSent: 0,
      tasksCompleted: 0,
      agentsUsed: [],
      sessionCount: 0,
      featureUsage: {},
      dailyActive: {},
      lastActivity: null,
      createdAt: null,
    };
  }
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return {}; }
}

/**
 * Load satisfaction ratings from your9-feedback-loop.mjs data.
 */
function loadRatings(instanceDir) {
  const p = join(feedbackDir(instanceDir), 'ratings.jsonl');
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch { return []; }
}

/**
 * Load NPS survey results from your9-beta-feedback.mjs data.
 */
function loadSurveys(instanceDir) {
  const p = join(feedbackDir(instanceDir), 'surveys.jsonl');
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch { return []; }
}

/**
 * Load all task files from instances/{id}/data/tasks/.
 */
function loadTasks(instanceDir) {
  const dir = tasksDir(instanceDir);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(readFileSync(join(dir, f), 'utf-8')); } catch { return null; }
      })
      .filter(Boolean);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// SUCCESS DATA — stored in instances/{id}/data/success/
// ---------------------------------------------------------------------------

const HEALTH_FILE = 'health.json';
const CHURN_FILE = 'churn-risk.json';
const METRICS_FILE = 'metrics.jsonl';
const OUTREACH_LOG_FILE = 'outreach-log.jsonl';
const WEEKLY_REPORTS_FILE = 'weekly-reports.jsonl';

function loadHealthRecord(instanceDir) {
  const p = join(successDir(instanceDir), HEALTH_FILE);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

function saveHealthRecord(instanceDir, record) {
  const p = join(successDir(instanceDir), HEALTH_FILE);
  writeFileSync(p, JSON.stringify(record, null, 2));
}

function loadChurnRecord(instanceDir) {
  const p = join(successDir(instanceDir), CHURN_FILE);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

function saveChurnRecord(instanceDir, record) {
  const p = join(successDir(instanceDir), CHURN_FILE);
  writeFileSync(p, JSON.stringify(record, null, 2));
}

function appendMetric(instanceDir, event) {
  const p = join(successDir(instanceDir), METRICS_FILE);
  appendFileSync(p, JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\n');
}

function loadMetrics(instanceDir) {
  const p = join(successDir(instanceDir), METRICS_FILE);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch { return []; }
}

function appendOutreachLog(instanceDir, record) {
  const p = join(successDir(instanceDir), OUTREACH_LOG_FILE);
  appendFileSync(p, JSON.stringify({ ...record, ts: new Date().toISOString() }) + '\n');
}

function loadOutreachLog(instanceDir) {
  const p = join(successDir(instanceDir), OUTREACH_LOG_FILE);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch { return []; }
}

function appendWeeklyReport(instanceDir, record) {
  const p = join(successDir(instanceDir), WEEKLY_REPORTS_FILE);
  appendFileSync(p, JSON.stringify(record) + '\n');
}

// ---------------------------------------------------------------------------
// ENGAGEMENT METRICS — public export for hub to call on events
// ---------------------------------------------------------------------------

/**
 * Record a dashboard visit.
 * Call this from the admin/dashboard server on every authenticated page load.
 */
export function recordDashboardVisit(instanceDir) {
  appendMetric(instanceDir, { type: 'dashboard_visit' });
  log(`Dashboard visit recorded for ${instanceDir}`);
}

/**
 * Record an agent interaction with optional response time.
 * Call this from the hub whenever an agent responds to a founder request.
 *
 * @param {string} instanceDir
 * @param {string} agentId         - executor|mind|voice|social|etc.
 * @param {number} responseTimeMs  - wall-clock ms from request to response
 */
export function recordAgentInteraction(instanceDir, agentId, responseTimeMs = null) {
  appendMetric(instanceDir, {
    type: 'agent_interaction',
    agentId: agentId || 'unknown',
    responseTimeMs: responseTimeMs ?? null,
  });
}

// ---------------------------------------------------------------------------
// DERIVED METRICS — computed from stored data
// ---------------------------------------------------------------------------

/**
 * Returns messages per day over the past 30 days, computed from dailyActive map.
 */
function computeMessagesPerDay(analytics, daysBack = 30) {
  const daily = analytics.dailyActive || {};
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  let total = 0;
  let activeDays = 0;
  for (const [date, count] of Object.entries(daily)) {
    if (new Date(date) >= cutoff) {
      total += count;
      activeDays++;
    }
  }
  return activeDays === 0 ? 0 : parseFloat((total / daysBack).toFixed(2));
}

/**
 * Count dashboard visits from metrics log, past N days.
 */
function countDashboardVisits(instanceDir, daysBack = 30) {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  return loadMetrics(instanceDir)
    .filter(m => m.type === 'dashboard_visit' && new Date(m.ts).getTime() >= cutoff)
    .length;
}

/**
 * Average agent response time from metrics log, past 30 days.
 * Returns null if no interactions recorded.
 */
function computeAvgResponseTime(instanceDir, daysBack = 30) {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const interactions = loadMetrics(instanceDir)
    .filter(m =>
      m.type === 'agent_interaction' &&
      m.responseTimeMs != null &&
      new Date(m.ts).getTime() >= cutoff
    );
  if (interactions.length === 0) return null;
  const total = interactions.reduce((s, m) => s + m.responseTimeMs, 0);
  return Math.round(total / interactions.length);
}

/**
 * Returns tasks completed in the last N days.
 */
function tasksCompletedInWindow(tasks, daysBack) {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  return tasks.filter(t =>
    t.status === 'completed' &&
    t.completedAt &&
    new Date(t.completedAt).getTime() >= cutoff
  ).length;
}

/**
 * Feature adoption: how many of the key features has the customer used?
 * Key features defined below. Returns { count, total, features }.
 */
const KEY_FEATURES = [
  'briefing',
  'pipeline',
  'research',
  'email',
  'social',
  'voice',
  'planner',
  'strategy',
];

function computeFeatureAdoption(analytics) {
  const used = analytics.featureUsage || {};
  const adopted = KEY_FEATURES.filter(f => (used[f] || 0) > 0);
  return { count: adopted.length, total: KEY_FEATURES.length, adopted, unused: KEY_FEATURES.filter(f => !adopted.includes(f)) };
}

/**
 * Average satisfaction rating (1-5) from feedback-loop ratings.
 * Returns null if no ratings.
 */
function computeAvgRating(ratings) {
  const valid = ratings.filter(r => typeof r.rating === 'number');
  if (valid.length === 0) return null;
  const sum = valid.reduce((s, r) => s + r.rating, 0);
  return parseFloat((sum / valid.length).toFixed(2));
}

/**
 * NPS score from beta-feedback surveys (−100 to +100).
 * Promoters: nps 9-10, Detractors: nps 1-6, Passives: 7-8.
 */
function computeNPS(surveys) {
  const completed = surveys.filter(s => s.status === 'complete' && s.answers?.nps != null);
  if (completed.length === 0) return null;
  const promoters = completed.filter(s => s.answers.nps >= 9).length;
  const detractors = completed.filter(s => s.answers.nps <= 6).length;
  return Math.round(((promoters - detractors) / completed.length) * 100);
}

// ---------------------------------------------------------------------------
// HEALTH SCORE — 0-100 composite, five components
//
// Component weights:
//   Engagement       35 pts  — messages/day + dashboard visits + session count
//   Task Completion  25 pts  — tasks completed, completion rate
//   Feature Adoption 20 pts  — % of key features ever used
//   Satisfaction     15 pts  — avg rating + NPS
//   Recency          5 pts   — time since last activity
// ---------------------------------------------------------------------------

/**
 * Calculate the composite health score for an instance.
 * Reads from existing analytics + feedback data; writes result to success/.
 *
 * @param {string} instanceDir
 * @returns {number} 0-100 health score
 */
export function calculateHealthScore(instanceDir) {
  const analytics = loadUsageAnalytics(instanceDir);
  const ratings = loadRatings(instanceDir);
  const surveys = loadSurveys(instanceDir);
  const tasks = loadTasks(instanceDir);

  // --- Engagement (35 pts) ---
  const msgsPerDay = computeMessagesPerDay(analytics, 30);
  const dashVisits = countDashboardVisits(instanceDir, 30);
  const sessionCount = analytics.sessionCount || 0;

  // Scale: 3+ msgs/day = full score on messages
  const msgScore = Math.min(msgsPerDay / 3, 1) * 15;
  // Scale: 5+ dashboard visits/30d = full score
  const dashScore = Math.min(dashVisits / 5, 1) * 10;
  // Scale: 5+ sessions = full score
  const sessionScore = Math.min(sessionCount / 5, 1) * 10;
  const engagementScore = msgScore + dashScore + sessionScore;

  // --- Task Completion (25 pts) ---
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const completionRate = totalTasks === 0 ? 0 : completedTasks / totalTasks;
  // 10+ completed tasks = full volume score
  const taskVolumeScore = Math.min(completedTasks / 10, 1) * 15;
  const taskRateScore = completionRate * 10;
  const taskScore = taskVolumeScore + taskRateScore;

  // --- Feature Adoption (20 pts) ---
  const adoption = computeFeatureAdoption(analytics);
  const featureScore = (adoption.count / adoption.total) * 20;

  // --- Satisfaction (15 pts) ---
  const avgRating = computeAvgRating(ratings);
  const nps = computeNPS(surveys);
  // Ratings are 1-5; normalize to 0-1. Full score = 4.5+
  const ratingScore = avgRating == null ? 0 : Math.min((avgRating - 1) / 3.5, 1) * 10;
  // NPS is -100 to +100; normalize: 50+ = full score
  const npsScore = nps == null ? 0 : Math.min((nps + 100) / 150, 1) * 5;
  const satisfactionScore = ratingScore + npsScore;

  // --- Recency (5 pts) ---
  let recencyScore = 0;
  if (analytics.lastActivity) {
    const daysSince = (Date.now() - new Date(analytics.lastActivity).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince <= 1) recencyScore = 5;
    else if (daysSince <= 3) recencyScore = 3;
    else if (daysSince <= 7) recencyScore = 1;
  }

  const total = Math.round(
    engagementScore + taskScore + featureScore + satisfactionScore + recencyScore
  );
  const score = Math.max(0, Math.min(100, total));

  const record = {
    score,
    components: {
      engagement: {
        score: Math.round(engagementScore),
        max: 35,
        detail: { msgsPerDay, dashVisits, sessionCount },
      },
      taskCompletion: {
        score: Math.round(taskScore),
        max: 25,
        detail: { totalTasks, completedTasks, completionRate: parseFloat(completionRate.toFixed(2)) },
      },
      featureAdoption: {
        score: Math.round(featureScore),
        max: 20,
        detail: { adopted: adoption.adopted, unused: adoption.unused },
      },
      satisfaction: {
        score: Math.round(satisfactionScore),
        max: 15,
        detail: { avgRating, nps },
      },
      recency: {
        score: recencyScore,
        max: 5,
        detail: { lastActivity: analytics.lastActivity },
      },
    },
    calculatedAt: new Date().toISOString(),
  };

  saveHealthRecord(instanceDir, record);
  log(`Health score calculated: ${score}/100`);
  return score;
}

// ---------------------------------------------------------------------------
// CHURN RISK DETECTION
//
// Churn signals (each adds to risk):
//   CRITICAL  — silent for 3+ days (no messages)
//   HIGH      — task count declining week-over-week (past wk < wk before)
//   HIGH      — zero feature adoption (never used any key feature)
//   MEDIUM    — silent for 1-2 days
//   MEDIUM    — only 1 key feature ever used
//   MEDIUM    — NPS score ≤ 4
//   LOW       — avg rating < 3
//   LOW       — dashboard never visited
//
// Risk levels: none | low | medium | high | critical
// ---------------------------------------------------------------------------

/**
 * Detect churn risk for an instance.
 * Reads existing data; writes result to success/churn-risk.json.
 *
 * @param {string} instanceDir
 * @returns {{ isAtRisk: boolean, level: string, reasons: string[], score: number }}
 */
export function detectChurnRisk(instanceDir) {
  const analytics = loadUsageAnalytics(instanceDir);
  const ratings = loadRatings(instanceDir);
  const surveys = loadSurveys(instanceDir);
  const tasks = loadTasks(instanceDir);

  const reasons = [];
  let riskPoints = 0;

  // --- Silence detection ---
  let daysSilent = null;
  if (analytics.lastActivity) {
    daysSilent = (Date.now() - new Date(analytics.lastActivity).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSilent >= 3) {
      reasons.push(`Silent for ${Math.floor(daysSilent)} days (last message: ${analytics.lastActivity.slice(0, 10)})`);
      riskPoints += 40;
    } else if (daysSilent >= 1) {
      reasons.push(`No messages in ${Math.floor(daysSilent * 24)} hours`);
      riskPoints += 15;
    }
  } else {
    reasons.push('No messages ever recorded');
    riskPoints += 30;
  }

  // --- Task count trend: compare last 7 days vs prior 7 days ---
  const thisWeekTasks = tasksCompletedInWindow(tasks, 7);
  const lastWeekTasks = tasksCompletedInWindow(
    tasks.filter(t => {
      if (!t.completedAt) return false;
      const age = (Date.now() - new Date(t.completedAt).getTime()) / (1000 * 60 * 60 * 24);
      return age >= 7 && age < 14;
    }),
    7
  );
  if (thisWeekTasks < lastWeekTasks && lastWeekTasks > 0) {
    const pct = Math.round(((lastWeekTasks - thisWeekTasks) / lastWeekTasks) * 100);
    reasons.push(`Task completion down ${pct}% this week (${thisWeekTasks} vs ${lastWeekTasks} last week)`);
    riskPoints += 25;
  }

  // --- Feature adoption ---
  const adoption = computeFeatureAdoption(analytics);
  if (adoption.count === 0) {
    reasons.push('Never used any key feature');
    riskPoints += 30;
  } else if (adoption.count === 1) {
    reasons.push(`Only used 1 of ${adoption.total} key features`);
    riskPoints += 10;
  }

  // --- Satisfaction signals ---
  const avgRating = computeAvgRating(ratings);
  if (avgRating !== null && avgRating < 3) {
    reasons.push(`Low satisfaction rating: ${avgRating}/5`);
    riskPoints += 15;
  }

  const nps = computeNPS(surveys);
  if (nps !== null && nps <= 4) {
    reasons.push(`Low NPS score: ${nps}`);
    riskPoints += 20;
  }

  // --- Dashboard usage ---
  const dashVisits = countDashboardVisits(instanceDir, 30);
  if (dashVisits === 0) {
    reasons.push('Dashboard never visited in 30 days');
    riskPoints += 10;
  }

  // --- Determine level ---
  let level;
  if (riskPoints >= 60) level = 'critical';
  else if (riskPoints >= 40) level = 'high';
  else if (riskPoints >= 20) level = 'medium';
  else if (riskPoints >= 10) level = 'low';
  else level = 'none';

  const isAtRisk = level !== 'none';

  const record = {
    isAtRisk,
    level,
    reasons,
    score: riskPoints,
    detail: {
      daysSilent: daysSilent != null ? parseFloat(daysSilent.toFixed(1)) : null,
      thisWeekTasks,
      lastWeekTasks,
      featureAdoption: adoption.count,
      avgRating,
      nps,
      dashVisits,
    },
    assessedAt: new Date().toISOString(),
  };

  saveChurnRecord(instanceDir, record);
  log(`Churn risk: ${level} (${riskPoints} pts) — ${reasons.length} signal(s)`);
  return { isAtRisk, level, reasons, score: riskPoints };
}

// ---------------------------------------------------------------------------
// PROACTIVE VALUE SUGGESTIONS
//
// When engagement drops, the CEO sends a personalized suggestion message.
// The message targets specific unused features the customer could benefit from.
//
// Rules:
//   - Only trigger if health score < 60 OR churn risk level is medium+
//   - Max 1 outreach per 72 hours per instance (prevent spam)
//   - Message is personalized to the customer's business type if known
// ---------------------------------------------------------------------------

const OUTREACH_COOLDOWN_MS = 72 * 60 * 60 * 1000; // 72 hours

function lastOutreachAge(instanceDir) {
  const log = loadOutreachLog(instanceDir);
  if (log.length === 0) return Infinity;
  const last = new Date(log[log.length - 1].ts).getTime();
  return Date.now() - last;
}

/**
 * Build a personalized outreach message for unused features.
 * Uses Anthropic API to tailor to the customer's business context.
 */
async function buildOutreachMessage(customer, unusedFeatures, anthropicKey) {
  const name = customer?.founderName || customer?.name || 'there';
  const business = customer?.businessDescription || customer?.businessType || 'your business';

  if (!anthropicKey || unusedFeatures.length === 0) {
    // Fallback: static message
    const examples = {
      research: 'Try asking me to research your top 3 competitors and summarize their positioning.',
      briefing: 'Ask me for your daily briefing — I\'ll surface what matters most for your day.',
      pipeline: 'I can audit your pipeline and flag stalled deals. Just say "audit my pipeline".',
      email: 'I can draft and send emails on your behalf. Try "email [name] about [topic]".',
      social: 'I can create and schedule social posts for you. Ask me to "post about [topic]".',
      voice: 'Did you know I can call contacts for you? Ask me to "call [name]".',
      planner: 'I can build out your weekly plan. Ask me "plan my week".',
      strategy: 'Ask me for a strategy session on any business challenge you\'re facing.',
    };
    const feature = unusedFeatures[0];
    return `Hey ${name} — just checking in. ${examples[feature] || `Have you tried using my ${feature} capability?`} Let me know if you need anything.`;
  }

  const prompt = `You are an AI CEO assistant called "Your9". You are checking in with a founder named ${name} who runs: ${business}.

The founder hasn't used these features yet: ${unusedFeatures.slice(0, 3).join(', ')}.

Write a short, warm, direct check-in message (2-3 sentences max). Pick the ONE most relevant unused feature for their business. Give a concrete, specific example of what they could ask you to do. Do not be salesy. Sound like a capable colleague, not a product pitch.

Example output format:
"Hey [name] — [one concrete suggestion with example prompt]. [optional one-sentence follow-up]"`;

  try {
    const response = await callClaude(anthropicKey, SONNET_MODEL, prompt);
    return response.trim();
  } catch (err) {
    log(`Claude outreach generation failed: ${err.message}`);
    return null;
  }
}

/**
 * Send proactive outreach to the founder if conditions are met.
 * Exported so the hub's scheduled jobs can trigger this.
 *
 * @param {string} instanceDir
 * @param {object} customer
 * @param {string} botToken
 * @param {string} ownerChatId
 * @param {string} anthropicKey
 */
export async function sendProactiveOutreach(instanceDir, customer, botToken, ownerChatId, anthropicKey) {
  // Check cooldown
  const age = lastOutreachAge(instanceDir);
  if (age < OUTREACH_COOLDOWN_MS) {
    const hoursLeft = Math.round((OUTREACH_COOLDOWN_MS - age) / (1000 * 60 * 60));
    log(`Outreach skipped: cooldown active (${hoursLeft}h remaining)`);
    return { sent: false, reason: 'cooldown' };
  }

  // Check if outreach is warranted
  const healthScore = calculateHealthScore(instanceDir);
  const churnRisk = detectChurnRisk(instanceDir);

  const shouldReach = healthScore < 60 || ['medium', 'high', 'critical'].includes(churnRisk.level);
  if (!shouldReach) {
    log(`Outreach skipped: health=${healthScore}, risk=${churnRisk.level} — not needed`);
    return { sent: false, reason: 'healthy' };
  }

  // Get unused features to suggest
  const analytics = loadUsageAnalytics(instanceDir);
  const adoption = computeFeatureAdoption(analytics);
  const unusedFeatures = adoption.unused;

  if (unusedFeatures.length === 0) {
    log('Outreach skipped: no unused features to suggest');
    return { sent: false, reason: 'no_suggestions' };
  }

  const message = await buildOutreachMessage(customer, unusedFeatures, anthropicKey);
  if (!message) {
    return { sent: false, reason: 'message_generation_failed' };
  }

  await sendTelegramMessage(botToken, ownerChatId, message);
  appendOutreachLog(instanceDir, { message, healthScore, churnLevel: churnRisk.level, unusedFeatures });
  log(`Proactive outreach sent — health=${healthScore}, risk=${churnRisk.level}`);
  return { sent: true, message };
}

// ---------------------------------------------------------------------------
// WEEKLY SUCCESS REPORT
//
// "How is Your9 doing?" — sent to the founder weekly.
// Covers: health score, engagement stats, tasks completed, value delivered,
// feature gaps, and 2-3 specific suggestions.
// ---------------------------------------------------------------------------

/**
 * Generate the weekly success report text (Markdown).
 * Exported for use by the hub's weekly scheduler.
 *
 * @param {string} instanceDir
 * @param {object} customer
 * @returns {string} Markdown report
 */
export function generateSuccessReport(instanceDir, customer) {
  const analytics = loadUsageAnalytics(instanceDir);
  const ratings = loadRatings(instanceDir);
  const surveys = loadSurveys(instanceDir);
  const tasks = loadTasks(instanceDir);

  const healthScore = calculateHealthScore(instanceDir);
  const churnRisk = detectChurnRisk(instanceDir);

  // Compute period stats (last 7 days)
  const thisWeekMsgs = Object.entries(analytics.dailyActive || {})
    .filter(([date]) => {
      const d = new Date(date);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      return d >= cutoff;
    })
    .reduce((s, [, count]) => s + count, 0);

  const thisWeekTasks = tasksCompletedInWindow(tasks, 7);
  const totalTasks = tasks.filter(t => t.status === 'completed').length;
  const avgRating = computeAvgRating(ratings);
  const nps = computeNPS(surveys);
  const dashVisits = countDashboardVisits(instanceDir, 7);
  const adoption = computeFeatureAdoption(analytics);
  const avgResponseMs = computeAvgResponseTime(instanceDir, 7);

  // Health label
  const healthLabel =
    healthScore >= 80 ? 'Excellent' :
    healthScore >= 60 ? 'Good' :
    healthScore >= 40 ? 'Needs Attention' :
    'At Risk';

  const name = customer?.founderName || customer?.name || 'Founder';

  const lines = [
    `*Your9 Weekly Report — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}*`,
    '',
    `Hey ${name}, here's how Your9 performed this week.`,
    '',
    `*Health Score: ${healthScore}/100 — ${healthLabel}*`,
    '',
    '*This Week*',
    `• Messages exchanged: ${thisWeekMsgs}`,
    `• Tasks completed: ${thisWeekTasks}`,
    `• Dashboard visits: ${dashVisits}`,
    avgResponseMs != null ? `• Avg agent response: ${(avgResponseMs / 1000).toFixed(1)}s` : null,
    '',
    '*All Time*',
    `• Total tasks completed: ${totalTasks}`,
    `• Features adopted: ${adoption.count}/${adoption.total}`,
    avgRating != null ? `• Satisfaction rating: ${avgRating}/5` : null,
    nps != null ? `• NPS score: ${nps}` : null,
    '',
  ].filter(l => l !== null);

  // Feature suggestions
  if (adoption.unused.length > 0) {
    const suggestions = {
      research: 'Research: "Research my top 3 competitors and summarize their positioning"',
      briefing: 'Daily briefing: "Give me my daily briefing"',
      pipeline: 'Pipeline audit: "Audit my pipeline and flag stalled deals"',
      email: 'Email drafting: "Draft an email to [contact] about [topic]"',
      social: 'Social posting: "Write a LinkedIn post about [topic]"',
      voice: 'Voice calls: "Call [contact] about [topic]"',
      planner: 'Weekly planning: "Plan my week"',
      strategy: 'Strategy session: "Let\'s do a strategy session on [challenge]"',
    };

    lines.push('*Try These This Week*');
    adoption.unused.slice(0, 3).forEach(f => {
      if (suggestions[f]) lines.push(`• ${suggestions[f]}`);
    });
    lines.push('');
  }

  // Churn signals (only surface if risk is medium+, softened language)
  if (['medium', 'high', 'critical'].includes(churnRisk.level)) {
    lines.push('*Areas to Improve*');
    churnRisk.reasons.slice(0, 2).forEach(r => lines.push(`• ${r}`));
    lines.push('');
  }

  lines.push('Reply anytime to ask me anything. I\'m here 24/7.');

  return lines.join('\n');
}

/**
 * Send the weekly success report via Telegram and log it.
 */
async function sendWeeklyReport(instanceDir, customer, botToken, ownerChatId) {
  const report = generateSuccessReport(instanceDir, customer);
  await sendTelegramMessage(botToken, ownerChatId, report);
  const healthRecord = loadHealthRecord(instanceDir);
  appendWeeklyReport(instanceDir, {
    sentAt: new Date().toISOString(),
    healthScore: healthRecord?.score ?? null,
    report,
  });
  log('Weekly report sent');
  return report;
}

// ---------------------------------------------------------------------------
// AGGREGATE REPORT — across all instances, for 9 Enterprises operator view
// ---------------------------------------------------------------------------

function aggregateReport() {
  const instances = discoverInstances().filter(i => i.customer);
  const rows = [];

  for (const inst of instances) {
    try {
      const healthScore = calculateHealthScore(inst.instanceDir);
      const churnRisk = detectChurnRisk(inst.instanceDir);
      const analytics = loadUsageAnalytics(inst.instanceDir);
      rows.push({
        id: inst.id,
        name: inst.customer?.founderName || inst.customer?.name || inst.id,
        company: inst.customer?.companyName || inst.customer?.businessName || '',
        healthScore,
        churnRisk: churnRisk.level,
        lastActivity: analytics.lastActivity,
        tasksCompleted: analytics.tasksCompleted || 0,
        messagesSent: analytics.messagesSent || 0,
      });
    } catch (err) {
      rows.push({ id: inst.id, error: err.message });
    }
  }

  rows.sort((a, b) => (a.healthScore ?? 0) - (b.healthScore ?? 0));

  const lines = [
    `*Your9 Customer Success Overview — ${new Date().toLocaleDateString()}*`,
    `${rows.length} active instances`,
    '',
  ];

  for (const r of rows) {
    if (r.error) {
      lines.push(`${r.id}: ERROR — ${r.error}`);
      continue;
    }
    const risk = r.churnRisk !== 'none' ? ` [RISK: ${r.churnRisk.toUpperCase()}]` : '';
    lines.push(`*${r.name}* (${r.company}) — Health: ${r.healthScore}/100${risk}`);
    lines.push(`  Tasks: ${r.tasksCompleted} | Messages: ${r.messagesSent} | Last active: ${r.lastActivity ? r.lastActivity.slice(0, 10) : 'never'}`);
  }

  const atRisk = rows.filter(r => r.churnRisk && r.churnRisk !== 'none').length;
  const avgHealth = rows.filter(r => r.healthScore != null).length > 0
    ? Math.round(rows.reduce((s, r) => s + (r.healthScore ?? 0), 0) / rows.length)
    : 0;

  lines.push('');
  lines.push(`Avg health: ${avgHealth}/100 | At-risk: ${atRisk}/${rows.length}`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Telegram helper — raw HTTPS, same pattern as all other Your9 scripts
// ---------------------------------------------------------------------------

async function sendTelegramMessage(botToken, chatId, text) {
  if (!botToken || !chatId) {
    log('Telegram send skipped: missing botToken or chatId');
    return;
  }
  const MAX = 4000;
  const chunks = [];
  let remaining = String(text);
  while (remaining.length > MAX) {
    chunks.push(remaining.slice(0, MAX));
    remaining = remaining.slice(MAX);
  }
  chunks.push(remaining);

  for (const chunk of chunks) {
    await new Promise((resolve, reject) => {
      const body = JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'Markdown' });
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${botToken}/sendMessage`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        },
        res => {
          let data = '';
          res.on('data', d => { data += d; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
            } else {
              reject(new Error(`Telegram ${res.statusCode}: ${data}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

// ---------------------------------------------------------------------------
// Anthropic API helper
// ---------------------------------------------------------------------------

function callClaude(apiKey, model, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      },
      res => {
        let data = '';
        res.on('data', d => { data += d; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed.content?.[0]?.text || '');
            } catch {
              reject(new Error('Claude response parse error'));
            }
          } else {
            reject(new Error(`Claude API ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  // Aggregate report — no instance required
  if (args.report) {
    const report = aggregateReport();
    console.log(report);
    return;
  }

  // All other commands require --instance
  const customerId = args.instance;
  if (!customerId) {
    console.error('Usage: node scripts/your9-customer-success.mjs --instance <customer-id>');
    console.error('       node scripts/your9-customer-success.mjs --report');
    process.exit(1);
  }

  const { instanceDir, customer, botToken, ownerChatId, anthropicKey } = loadInstance(customerId);

  // --health-score
  if (args['health-score']) {
    const score = calculateHealthScore(instanceDir);
    const record = loadHealthRecord(instanceDir);
    console.log(`\nHealth Score: ${score}/100`);
    console.log('\nComponents:');
    for (const [key, val] of Object.entries(record.components)) {
      console.log(`  ${key}: ${val.score}/${val.max}`);
    }
    return;
  }

  // --check-churn
  if (args['check-churn']) {
    const risk = detectChurnRisk(instanceDir);
    console.log(`\nChurn Risk: ${risk.level.toUpperCase()} (${risk.score} pts)`);
    if (risk.reasons.length > 0) {
      console.log('\nSignals:');
      risk.reasons.forEach(r => console.log(`  - ${r}`));
    }
    return;
  }

  // --weekly-report
  if (args['weekly-report']) {
    if (botToken && ownerChatId) {
      const report = await sendWeeklyReport(instanceDir, customer, botToken, ownerChatId);
      console.log('\nReport sent via Telegram:\n');
      console.log(report);
    } else {
      const report = generateSuccessReport(instanceDir, customer);
      console.log('\nReport (no Telegram config — printing only):\n');
      console.log(report);
    }
    return;
  }

  // --outreach
  if (args.outreach) {
    const result = await sendProactiveOutreach(instanceDir, customer, botToken, ownerChatId, anthropicKey);
    if (result.sent) {
      console.log('\nOutreach sent:');
      console.log(result.message);
    } else {
      console.log(`\nOutreach not sent: ${result.reason}`);
    }
    return;
  }

  // --track-visit
  if (args['track-visit']) {
    recordDashboardVisit(instanceDir);
    console.log('Dashboard visit recorded.');
    return;
  }

  // Default: full status for the instance
  const score = calculateHealthScore(instanceDir);
  const risk = detectChurnRisk(instanceDir);
  const analytics = loadUsageAnalytics(instanceDir);
  const adoption = computeFeatureAdoption(instanceDir ? loadUsageAnalytics(instanceDir) : {});

  console.log(`\n=== Customer Success: ${customerId} ===`);
  console.log(`Health Score : ${score}/100`);
  console.log(`Churn Risk   : ${risk.level.toUpperCase()}`);
  console.log(`Messages Sent: ${analytics.messagesSent || 0}`);
  console.log(`Tasks Done   : ${analytics.tasksCompleted || 0}`);
  console.log(`Last Active  : ${analytics.lastActivity ? analytics.lastActivity.slice(0, 10) : 'never'}`);
  console.log(`Features Used: ${adoption.count}/${adoption.total}`);
  if (risk.reasons.length > 0) {
    console.log('\nRisk Signals:');
    risk.reasons.forEach(r => console.log(`  - ${r}`));
  }
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
