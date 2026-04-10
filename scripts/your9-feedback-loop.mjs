#!/usr/bin/env node
/**
 * your9-feedback-loop.mjs — Founder Feedback & Agent Improvement Loop
 * Your9 by 9 Enterprises
 *
 * Closes the loop between founder satisfaction and agent evolution.
 *
 * Systems:
 *   1. Auto-feedback prompts  — after key actions (email, research, social post),
 *      asks the founder "How was this? 1-5 or any notes" via Telegram.
 *      Rating is captured on the next message and stored.
 *
 *   2. Performance ratings    — founder rates any agent output (1-5 scale + notes).
 *      Stored in instances/{id}/data/feedback/ratings.jsonl.
 *      Each rating is linked to a specific action/task and agent.
 *
 *   3. Self-improvement feed  — aggregates ratings per agent, formats them as
 *      founderNote + rating metadata on the relevant task records, then triggers
 *      your9-self-improve.mjs so agents evolve from real satisfaction signals.
 *
 *   4. Weekly summary         — "How is Your9 doing?" report combining:
 *      NPS (from beta-feedback surveys), per-agent rating averages, task
 *      completion rate, engagement streak, top complaints, top wins.
 *      Delivered via Telegram and written to data/feedback/weekly-summaries.jsonl.
 *
 * Usage:
 *   node scripts/your9-feedback-loop.mjs --instance <customer-id>
 *   node scripts/your9-feedback-loop.mjs --instance <customer-id> --weekly-report
 *   node scripts/your9-feedback-loop.mjs --instance <customer-id> --prompt-feedback --action-id <id>
 *   node scripts/your9-feedback-loop.mjs --instance <customer-id> --run-improvement --agent executor
 *   node scripts/your9-feedback-loop.mjs --instance <customer-id> --status
 *
 * Exported functions (for hub integration):
 *   handleFeedbackMessage(instanceDir, customer, botToken, ownerChatId, userText)
 *     → { handled: bool, reply?: string }
 *
 *   promptForFeedback(instanceDir, customer, botToken, ownerChatId, actionSummary, agentId, actionId)
 *     → void (sends Telegram prompt, sets pending state)
 *
 *   recordActionCompleted(instanceDir, actionId, agentId, summary)
 *     → void (records action for feedback tracking)
 *
 *   getWeeklyReport(instanceDir)
 *     → { nps, agentRatings, taskCompletionRate, engagementStreak, topComplaints, topWins, period }
 */

import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
  appendFileSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import https from 'https';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');
const LOGS_DIR = join(ROOT, 'logs');
const SERVICE_LOG = join(LOGS_DIR, 'your9-feedback-loop.log');

mkdirSync(LOGS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  const line = `[${new Date().toISOString()}] FEEDBACK-LOOP: ${msg}`;
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
// Instance loader
// ---------------------------------------------------------------------------

function loadInstance(customerId) {
  const instanceDir = join(INSTANCES_DIR, customerId);
  if (!existsSync(instanceDir)) {
    throw new Error(`Instance not found: ${customerId} (looked in ${INSTANCES_DIR})`);
  }

  const configPath = join(instanceDir, 'config', 'customer.json');
  if (!existsSync(configPath)) {
    throw new Error(`Customer config missing: ${configPath}`);
  }
  const customer = JSON.parse(readFileSync(configPath, 'utf-8'));

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

function feedbackDir(instanceDir) {
  const p = join(instanceDir, 'data', 'feedback');
  mkdirSync(p, { recursive: true });
  return p;
}

function tasksDir(instanceDir) {
  return join(instanceDir, 'data', 'tasks');
}

// ---------------------------------------------------------------------------
// RATINGS — per-action, per-agent ratings from the founder
//
// ratings.jsonl fields:
//   id          — unique rating ID
//   actionId    — the action/task being rated
//   agentId     — which agent produced the output
//   rating      — numeric 1-5 (null if text-only note)
//   note        — optional free-text note from founder
//   actionSummary — short description of what was rated
//   timestamp   — ISO string
// ---------------------------------------------------------------------------

const RATINGS_FILE = 'ratings.jsonl';

function appendRating(instanceDir, rating) {
  const p = join(feedbackDir(instanceDir), RATINGS_FILE);
  appendFileSync(p, JSON.stringify(rating) + '\n');
}

function loadRatings(instanceDir) {
  const p = join(feedbackDir(instanceDir), RATINGS_FILE);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// PENDING FEEDBACK STATE — tracks which action is waiting for a rating
//
// When the system prompts for feedback after an action, it writes a pending
// state record. The next non-command message from the founder is captured
// as the rating. After capture, the state is cleared.
//
// pending-feedback.json:
//   { actionId, agentId, actionSummary, promptedAt, status: 'waiting'|'captured' }
// ---------------------------------------------------------------------------

const PENDING_FEEDBACK_FILE = 'pending-feedback.json';

function loadPendingFeedback(instanceDir) {
  const p = join(feedbackDir(instanceDir), PENDING_FEEDBACK_FILE);
  if (!existsSync(p)) return null;
  try {
    const state = JSON.parse(readFileSync(p, 'utf-8'));
    if (state.status !== 'waiting') return null;
    return state;
  } catch { return null; }
}

function savePendingFeedback(instanceDir, state) {
  const p = join(feedbackDir(instanceDir), PENDING_FEEDBACK_FILE);
  writeFileSync(p, JSON.stringify(state, null, 2));
}

function clearPendingFeedback(instanceDir) {
  const p = join(feedbackDir(instanceDir), PENDING_FEEDBACK_FILE);
  if (existsSync(p)) {
    writeFileSync(p, JSON.stringify({ status: 'captured', clearedAt: new Date().toISOString() }, null, 2));
  }
}

// ---------------------------------------------------------------------------
// PENDING FEEDBACK EXPIRY — if founder ignores the prompt for >24h, clear it
// ---------------------------------------------------------------------------

const FEEDBACK_PROMPT_EXPIRY_MS = 24 * 60 * 60 * 1000;

function isPendingExpired(pending) {
  if (!pending?.promptedAt) return true;
  const promptedAt = new Date(pending.promptedAt).getTime();
  return Date.now() - promptedAt > FEEDBACK_PROMPT_EXPIRY_MS;
}

// ---------------------------------------------------------------------------
// ACTIONS LOG — records key actions taken, for feedback tracking and weekly report
//
// actions.jsonl:
//   { id, agentId, type, summary, completedAt, ratingId? }
//
// Types: email_sent | research_delivered | social_posted | task_completed | briefing_delivered
// ---------------------------------------------------------------------------

const ACTIONS_FILE = 'actions.jsonl';

function appendAction(instanceDir, action) {
  const p = join(feedbackDir(instanceDir), ACTIONS_FILE);
  appendFileSync(p, JSON.stringify(action) + '\n');
}

function loadActions(instanceDir) {
  const p = join(feedbackDir(instanceDir), ACTIONS_FILE);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch { return []; }
}

/**
 * Record a completed action for feedback tracking.
 * Call this from the hub whenever a key action finishes.
 *
 * @param {string} instanceDir
 * @param {string} actionId    - unique ID for this action
 * @param {string} agentId     - which agent did it (executor|mind|voice)
 * @param {string} type        - email_sent|research_delivered|social_posted|task_completed|briefing_delivered
 * @param {string} summary     - short human-readable description
 */
export function recordActionCompleted(instanceDir, actionId, agentId, type, summary) {
  const action = {
    id: actionId || `action-${Date.now()}`,
    agentId: agentId || 'unknown',
    type: type || 'task_completed',
    summary: (summary || 'Task completed').slice(0, 200),
    completedAt: new Date().toISOString(),
  };
  appendAction(instanceDir, action);
  log(`Action recorded: ${action.id} (${action.type}) by ${action.agentId}`);
}

// ---------------------------------------------------------------------------
// FEEDBACK PROMPT DECISION — not every action gets a prompt
//
// Rules:
//   - Only prompt for action types that warrant founder attention
//   - Max 1 prompt per 2 hours (avoid prompt fatigue)
//   - Never prompt if another feedback is pending
//   - Never prompt if founder has rated >80% of recent actions (engagement is healthy)
// ---------------------------------------------------------------------------

const PROMPT_ELIGIBLE_TYPES = new Set([
  'email_sent',
  'research_delivered',
  'social_posted',
  'briefing_delivered',
]);

const PROMPT_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours between prompts

function loadLastPromptTime(instanceDir) {
  const p = join(feedbackDir(instanceDir), 'last-prompt-time.json');
  if (!existsSync(p)) return 0;
  try {
    const d = JSON.parse(readFileSync(p, 'utf-8'));
    return d.ts || 0;
  } catch { return 0; }
}

function saveLastPromptTime(instanceDir) {
  const p = join(feedbackDir(instanceDir), 'last-prompt-time.json');
  writeFileSync(p, JSON.stringify({ ts: Date.now() }));
}

function shouldPromptForFeedback(instanceDir, actionType) {
  // Only eligible types
  if (!PROMPT_ELIGIBLE_TYPES.has(actionType)) return false;

  // Don't prompt if there's already one pending
  const pending = loadPendingFeedback(instanceDir);
  if (pending && !isPendingExpired(pending)) return false;

  // Cooldown check
  const lastPrompt = loadLastPromptTime(instanceDir);
  if (Date.now() - lastPrompt < PROMPT_COOLDOWN_MS) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Telegram helper — raw HTTPS, matches existing hub pattern
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
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        res => {
          let buf = '';
          res.on('data', c => (buf += c));
          res.on('end', () => {
            try {
              const d = JSON.parse(buf);
              if (!d.ok) reject(new Error(`Telegram error: ${d.description}`));
              else resolve(d);
            } catch (e) { reject(e); }
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Telegram send timed out')); });
      req.write(body);
      req.end();
    });
  }
}

// ---------------------------------------------------------------------------
// PROMPT FOR FEEDBACK — send a Telegram prompt after a key action
//
// Exported for hub integration. Called by the hub immediately after
// a qualifying action completes.
//
// @param {string} instanceDir
// @param {object} customer         - customer.json object
// @param {string} botToken
// @param {string} ownerChatId
// @param {string} actionSummary    - what was just done ("Sent follow-up email to Kyle")
// @param {string} agentId          - which agent did it
// @param {string} actionId         - the action's unique ID
// ---------------------------------------------------------------------------

export async function promptForFeedback(instanceDir, customer, botToken, ownerChatId, actionSummary, agentId, actionId) {
  const id = actionId || `action-${Date.now()}`;

  // Write pending state before sending — avoids race where founder responds instantly
  savePendingFeedback(instanceDir, {
    actionId: id,
    agentId: agentId || 'unknown',
    actionSummary: (actionSummary || 'Recent task').slice(0, 200),
    promptedAt: new Date().toISOString(),
    status: 'waiting',
  });
  saveLastPromptTime(instanceDir);

  const agentLabel = agentId ? ` (${agentId})` : '';
  const msg = [
    `*Quick feedback${agentLabel}*`,
    '',
    `Just completed: _${actionSummary}_`,
    '',
    `How was this? Reply with *1-5* or just type a note.`,
    `_(1 = missed the mark, 5 = nailed it. Or skip with /skip)_`,
  ].join('\n');

  try {
    await sendTelegramMessage(botToken, ownerChatId, msg);
    log(`Feedback prompt sent for action ${id} (${agentId}): ${actionSummary}`);
  } catch (e) {
    log(`Feedback prompt send failed: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// HANDLE FEEDBACK MESSAGE — called by hub on every incoming founder message
//
// Checks if a feedback response is pending. If yes, captures the rating.
// Returns { handled: true } if the message was a feedback response.
// Returns { handled: false } if the message should pass to the CEO normally.
//
// Also handles /skip to dismiss a pending feedback prompt.
// ---------------------------------------------------------------------------

export async function handleFeedbackMessage(instanceDir, customer, botToken, ownerChatId, userText) {
  const text = (userText || '').trim();

  // Handle /skip — dismiss pending feedback
  if (text.toLowerCase() === '/skip') {
    const pending = loadPendingFeedback(instanceDir);
    if (pending && !isPendingExpired(pending)) {
      clearPendingFeedback(instanceDir);
      log(`Feedback skipped for action ${pending.actionId}`);
      try {
        await sendTelegramMessage(botToken, ownerChatId, 'Got it, skipped. No problem.');
      } catch {}
      return { handled: true };
    }
    return { handled: false };
  }

  // Check if there's a pending feedback prompt waiting for a response
  const pending = loadPendingFeedback(instanceDir);
  if (!pending || isPendingExpired(pending)) {
    if (pending && isPendingExpired(pending)) {
      clearPendingFeedback(instanceDir);
      log(`Pending feedback for action ${pending.actionId} expired — cleared`);
    }
    return { handled: false };
  }

  // Parse the response — numeric rating (1-5) or free text note
  const numMatch = text.match(/^([1-5])(\s|$|[.,!?])/);
  const numVal = numMatch ? parseInt(numMatch[1], 10) : null;

  // If purely numeric 1-5 (possibly with trailing punctuation/space) — capture as rating
  // If longer text — capture as note (rating = null)
  const isRatingOnly = numMatch && text.replace(/^[1-5]/, '').trim().length === 0;
  const isRatingWithNote = numMatch && !isRatingOnly;

  const rating = numVal;
  const note = isRatingWithNote
    ? text.replace(/^[1-5]\s*/, '').trim()
    : (!numMatch ? text : null);

  // Store rating
  const ratingRecord = {
    id: `rating-${Date.now()}`,
    actionId: pending.actionId,
    agentId: pending.agentId,
    actionSummary: pending.actionSummary,
    rating,
    note: note || null,
    timestamp: new Date().toISOString(),
  };

  appendRating(instanceDir, ratingRecord);
  clearPendingFeedback(instanceDir);

  // Also annotate the task file if we can find it by actionId
  annotateTaskWithRating(instanceDir, pending.actionId, pending.agentId, rating, note);

  // Acknowledge
  let ack;
  if (rating !== null) {
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
    if (rating >= 4) {
      ack = `${stars} Logged. Glad that landed.`;
    } else if (rating === 3) {
      ack = `${stars} Logged. I'll look at what to sharpen.`;
    } else {
      ack = `${stars} Logged. Noted — will dig into what went wrong.`;
    }
  } else {
    ack = 'Feedback logged. Appreciate it.';
  }

  if (note) ack += `\n_Note recorded._`;

  try {
    await sendTelegramMessage(botToken, ownerChatId, ack);
  } catch {}

  log(`Rating captured: action=${pending.actionId} agent=${pending.agentId} rating=${rating} note=${note ? note.slice(0, 60) : 'none'}`);
  return { handled: true };
}

// ---------------------------------------------------------------------------
// ANNOTATE TASK — backfill rating data onto the task record
// This is what feeds your9-self-improve.mjs — it reads founderNote + rating
// from the task JSON during performance analysis
// ---------------------------------------------------------------------------

function annotateTaskWithRating(instanceDir, actionId, agentId, rating, note) {
  const dir = tasksDir(instanceDir);
  if (!existsSync(dir)) return;

  let files;
  try {
    files = readdirSync(dir).filter(f => f.endsWith('-task.json'));
  } catch { return; }

  for (const f of files) {
    const p = join(dir, f);
    try {
      const task = JSON.parse(readFileSync(p, 'utf-8'));
      // Match by actionId stored on the task, or by matching agentId + recent completion
      if (task.actionId === actionId || task.id === actionId) {
        if (rating !== null) task.founderRating = rating;
        if (note) task.founderNote = note;
        task.ratedAt = new Date().toISOString();
        writeFileSync(p, JSON.stringify(task, null, 2));
        log(`Task annotated: ${f} rating=${rating}`);
        return;
      }
    } catch { /* skip malformed */ }
  }

  // No matching task file found — log but don't error
  log(`No matching task file for actionId=${actionId} — rating stored in ratings.jsonl only`);
}

// ---------------------------------------------------------------------------
// PER-AGENT RATING AGGREGATION
// Reads all ratings, groups by agent, returns averages and counts
// ---------------------------------------------------------------------------

function aggregateRatingsByAgent(ratings) {
  const byAgent = {};

  for (const r of ratings) {
    if (r.rating == null) continue;
    const agent = r.agentId || 'unknown';
    if (!byAgent[agent]) {
      byAgent[agent] = { ratings: [], notes: [] };
    }
    byAgent[agent].ratings.push(Number(r.rating));
    if (r.note) byAgent[agent].notes.push(r.note);
  }

  const result = {};
  for (const [agent, data] of Object.entries(byAgent)) {
    const sum = data.ratings.reduce((a, b) => a + b, 0);
    const avg = Math.round((sum / data.ratings.length) * 10) / 10;
    result[agent] = {
      avgRating: avg,
      count: data.ratings.length,
      notes: data.notes,
      distribution: [1, 2, 3, 4, 5].map(v => data.ratings.filter(r => r === v).length),
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// NPS READER — reads from beta-feedback surveys.jsonl produced by your9-beta-feedback.mjs
// ---------------------------------------------------------------------------

function readNpsFromBetaFeedback(instanceDir) {
  const surveysPath = join(instanceDir, 'data', 'feedback', 'surveys.jsonl');
  if (!existsSync(surveysPath)) return null;
  try {
    const surveys = readFileSync(surveysPath, 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l));

    const scores = surveys
      .map(s => s.answers?.nps)
      .filter(v => v != null && !isNaN(Number(v)))
      .map(Number);

    if (scores.length === 0) return null;

    const promoters = scores.filter(s => s >= 9).length;
    const passives = scores.filter(s => s >= 7 && s < 9).length;
    const detractors = scores.filter(s => s < 7).length;
    const total = scores.length;
    const nps = Math.round(((promoters - detractors) / total) * 100);

    return { nps, promoters, passives, detractors, responses: total };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// TASK COMPLETION RATE — reads tasks dir, computes completion %
// ---------------------------------------------------------------------------

function computeTaskCompletionRate(instanceDir) {
  const dir = tasksDir(instanceDir);
  if (!existsSync(dir)) return { rate: null, completed: 0, total: 0 };

  let files;
  try {
    files = readdirSync(dir).filter(f => f.endsWith('-task.json'));
  } catch { return { rate: null, completed: 0, total: 0 }; }

  let completed = 0;
  let failed = 0;
  let total = 0;

  for (const f of files) {
    try {
      const task = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      const status = (task.status || '').toLowerCase();
      if (['completed', 'report-delivered'].includes(status)) completed++;
      else if (status === 'failed') failed++;
      total++;
    } catch { /* skip */ }
  }

  const rate = total > 0 ? Math.round((completed / total) * 100) : null;
  return { rate, completed, failed, total };
}

// ---------------------------------------------------------------------------
// ENGAGEMENT STREAK — how many consecutive days the founder sent at least 1 message
// Uses daily active data from analytics/usage.json (written by your9-beta-feedback.mjs)
// ---------------------------------------------------------------------------

function computeEngagementStreak(instanceDir) {
  const usagePath = join(instanceDir, 'data', 'analytics', 'usage.json');
  if (!existsSync(usagePath)) return { streak: 0, totalActiveDays: 0 };

  let usage;
  try {
    usage = JSON.parse(readFileSync(usagePath, 'utf-8'));
  } catch { return { streak: 0, totalActiveDays: 0 }; }

  const dailyActive = usage.dailyActive || {};
  const activeDates = Object.keys(dailyActive).sort();
  const totalActiveDays = activeDates.length;

  // Compute consecutive streak ending today
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    if (dailyActive[dateStr]) {
      streak++;
    } else {
      break;
    }
  }

  return { streak, totalActiveDays };
}

// ---------------------------------------------------------------------------
// WEEKLY REPORT — aggregate everything into a single satisfaction report
// Exported for programmatic use. CLI --weekly-report also calls this.
// ---------------------------------------------------------------------------

/**
 * Returns a structured weekly report object.
 *
 * @param {string} instanceDir
 * @returns {{
 *   period: string,
 *   nps: object|null,
 *   agentRatings: object,
 *   taskCompletionRate: object,
 *   engagementStreak: object,
 *   topComplaints: string[],
 *   topWins: string[],
 *   totalRatings: number,
 *   avgRatingOverall: number|null,
 * }}
 */
export function getWeeklyReport(instanceDir) {
  const ratings = loadRatings(instanceDir);
  const agentRatings = aggregateRatingsByAgent(ratings);
  const nps = readNpsFromBetaFeedback(instanceDir);
  const taskStats = computeTaskCompletionRate(instanceDir);
  const engagement = computeEngagementStreak(instanceDir);

  // Filter to last 7 days for the weekly slice
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekRatings = ratings.filter(r => new Date(r.timestamp).getTime() > sevenDaysAgo);

  // Top complaints = notes from ratings <= 2 (last 7 days)
  const topComplaints = weekRatings
    .filter(r => r.note && r.rating !== null && r.rating <= 2)
    .map(r => r.note)
    .slice(0, 5);

  // Top wins = notes from ratings >= 5 OR action summaries with rating 5
  const topWins = weekRatings
    .filter(r => r.rating === 5)
    .map(r => r.note || r.actionSummary)
    .filter(Boolean)
    .slice(0, 5);

  // Overall average rating across all agents
  const allNumericRatings = ratings.filter(r => r.rating != null).map(r => Number(r.rating));
  const avgRatingOverall = allNumericRatings.length > 0
    ? Math.round((allNumericRatings.reduce((a, b) => a + b, 0) / allNumericRatings.length) * 10) / 10
    : null;

  const periodEnd = new Date().toISOString().slice(0, 10);
  const periodStart = new Date(sevenDaysAgo).toISOString().slice(0, 10);

  return {
    period: `${periodStart} to ${periodEnd}`,
    nps,
    agentRatings,
    taskCompletionRate: taskStats,
    engagementStreak: engagement,
    topComplaints,
    topWins,
    totalRatings: ratings.length,
    weekRatings: weekRatings.length,
    avgRatingOverall,
  };
}

// ---------------------------------------------------------------------------
// FORMAT WEEKLY REPORT — turns the report object into a readable Telegram message
// ---------------------------------------------------------------------------

function formatWeeklyReport(report, customerName) {
  const lines = [
    `*How is Your9 doing?*`,
    `_${report.period}_`,
    '',
  ];

  // NPS
  if (report.nps) {
    const { nps, promoters, detractors, responses } = report.nps;
    let npsLabel;
    if (nps >= 50) npsLabel = 'Excellent';
    else if (nps >= 20) npsLabel = 'Good';
    else if (nps >= 0) npsLabel = 'Needs work';
    else npsLabel = 'Critical';
    lines.push(`*NPS:* ${nps} (${npsLabel}) — ${responses} response${responses !== 1 ? 's' : ''}`);
    lines.push(`Promoters: ${promoters}  Detractors: ${detractors}`);
  } else {
    lines.push(`*NPS:* Not enough survey data yet`);
  }

  lines.push('');

  // Agent ratings
  const agents = Object.entries(report.agentRatings);
  if (agents.length > 0) {
    lines.push('*Agent Ratings (1-5 scale):*');
    for (const [agent, data] of agents) {
      const bar = '★'.repeat(Math.round(data.avgRating)) + '☆'.repeat(5 - Math.round(data.avgRating));
      lines.push(`  ${agent}: ${bar} ${data.avgRating}/5 (${data.count} rating${data.count !== 1 ? 's' : ''})`);
    }
  } else {
    lines.push('*Agent Ratings:* No ratings yet this period');
  }

  if (report.avgRatingOverall !== null) {
    lines.push(`Overall avg: *${report.avgRatingOverall}/5*`);
  }

  lines.push('');

  // Task completion
  const tc = report.taskCompletionRate;
  if (tc.total > 0) {
    lines.push(`*Task completion:* ${tc.rate}% (${tc.completed}/${tc.total} tasks)`);
    if (tc.failed > 0) lines.push(`Failed tasks: ${tc.failed}`);
  } else {
    lines.push(`*Task completion:* No tasks tracked yet`);
  }

  lines.push('');

  // Engagement
  const eng = report.engagementStreak;
  lines.push(`*Engagement streak:* ${eng.streak} day${eng.streak !== 1 ? 's' : ''} in a row`);
  lines.push(`Active days total: ${eng.totalActiveDays}`);

  lines.push('');

  // Top complaints
  if (report.topComplaints.length > 0) {
    lines.push(`*Things to fix:*`);
    for (const c of report.topComplaints) {
      lines.push(`  - ${c.slice(0, 100)}`);
    }
    lines.push('');
  }

  // Top wins
  if (report.topWins.length > 0) {
    lines.push(`*Wins this week:*`);
    for (const w of report.topWins) {
      lines.push(`  - ${w.slice(0, 100)}`);
    }
    lines.push('');
  }

  // Week ratings count
  lines.push(`_Based on ${report.weekRatings} founder rating${report.weekRatings !== 1 ? 's' : ''} this week._`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// WEEKLY SUMMARY LOG — persists report JSON for trend tracking
// ---------------------------------------------------------------------------

const WEEKLY_SUMMARIES_FILE = 'weekly-summaries.jsonl';

function persistWeeklyReport(instanceDir, report) {
  const p = join(feedbackDir(instanceDir), WEEKLY_SUMMARIES_FILE);
  const record = { ...report, savedAt: new Date().toISOString() };
  appendFileSync(p, JSON.stringify(record) + '\n');
  log(`Weekly report saved to ${WEEKLY_SUMMARIES_FILE}`);
}

// ---------------------------------------------------------------------------
// SELF-IMPROVEMENT FEED — triggers your9-self-improve.mjs for each agent
// with low ratings or enough new data to warrant a review cycle
//
// Threshold: agent avg rating < 3.5 OR >= 5 new ratings since last improvement run
// ---------------------------------------------------------------------------

const LAST_IMPROVE_FILE = 'last-improvement-trigger.json';
const IMPROVEMENT_RATING_THRESHOLD = 5; // new ratings needed before triggering
const IMPROVEMENT_AVG_THRESHOLD = 3.5;  // avg below this triggers immediately

function loadLastImproveTrigger(instanceDir) {
  const p = join(feedbackDir(instanceDir), LAST_IMPROVE_FILE);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return {}; }
}

function saveLastImproveTrigger(instanceDir, agentId, count) {
  const p = join(feedbackDir(instanceDir), LAST_IMPROVE_FILE);
  let state = {};
  try { state = JSON.parse(readFileSync(p, 'utf-8')); } catch {}
  state[agentId] = { triggeredAt: new Date().toISOString(), ratingCount: count };
  writeFileSync(p, JSON.stringify(state, null, 2));
}

/**
 * Check each rated agent — if thresholds are met, spawn your9-self-improve.mjs.
 * Called after each weekly report or after capturing a batch of ratings.
 *
 * @param {string} instanceDir
 * @param {string} customerId
 * @param {boolean} dryRun - pass true to log but not actually spawn
 */
export function feedRatingsToSelfImprove(instanceDir, customerId, dryRun = false) {
  const ratings = loadRatings(instanceDir);
  const agentRatings = aggregateRatingsByAgent(ratings);
  const lastTrigger = loadLastImproveTrigger(instanceDir);

  const VALID_AGENTS = ['executor', 'mind', 'voice'];

  for (const agentId of VALID_AGENTS) {
    const data = agentRatings[agentId];
    if (!data) continue;

    const lastState = lastTrigger[agentId] || { ratingCount: 0 };
    const newRatings = data.count - (lastState.ratingCount || 0);
    const belowThreshold = data.avgRating < IMPROVEMENT_AVG_THRESHOLD;
    const enoughNewData = newRatings >= IMPROVEMENT_RATING_THRESHOLD;

    if (!belowThreshold && !enoughNewData) {
      log(`Self-improve skip: ${agentId} (avg=${data.avgRating}, new ratings=${newRatings})`);
      continue;
    }

    const reason = belowThreshold
      ? `avg rating ${data.avgRating} below ${IMPROVEMENT_AVG_THRESHOLD}`
      : `${newRatings} new ratings since last run`;

    log(`Self-improve trigger: ${agentId} — ${reason}`);

    if (!dryRun) {
      try {
        const selfImproveScript = join(ROOT, 'scripts', 'your9-self-improve.mjs');
        if (!existsSync(selfImproveScript)) {
          log(`your9-self-improve.mjs not found — skipping spawn for ${agentId}`);
          continue;
        }
        execSync(
          `node "${selfImproveScript}" --instance "${customerId}" --agent "${agentId}" --min-tasks 3`,
          { stdio: 'inherit', timeout: 300000 }
        );
        saveLastImproveTrigger(instanceDir, agentId, data.count);
        log(`Self-improve run complete for ${agentId}`);
      } catch (e) {
        log(`Self-improve spawn failed for ${agentId}: ${e.message}`);
      }
    } else {
      log(`DRY RUN: would spawn self-improve for ${agentId} (reason: ${reason})`);
    }
  }
}

// ---------------------------------------------------------------------------
// STATUS COMMAND — quick read of current feedback health
// ---------------------------------------------------------------------------

function printStatus(instanceDir, customerId) {
  const ratings = loadRatings(instanceDir);
  const agentRatings = aggregateRatingsByAgent(ratings);
  const nps = readNpsFromBetaFeedback(instanceDir);
  const pending = loadPendingFeedback(instanceDir);
  const taskStats = computeTaskCompletionRate(instanceDir);
  const engagement = computeEngagementStreak(instanceDir);

  console.log('\n=== Your9 Feedback Loop Status ===\n');
  console.log(`Instance:          ${customerId}`);
  console.log(`Total ratings:     ${ratings.length}`);
  console.log(`Pending feedback:  ${pending ? `YES (action: ${pending.actionId})` : 'none'}`);
  console.log(`Task completion:   ${taskStats.rate !== null ? `${taskStats.rate}% (${taskStats.completed}/${taskStats.total})` : 'no tasks'}`);
  console.log(`Engagement streak: ${engagement.streak} days`);
  console.log(`NPS:               ${nps ? `${nps.nps} (${nps.responses} responses)` : 'no survey data'}`);
  console.log('');
  if (Object.keys(agentRatings).length > 0) {
    console.log('Agent Ratings:');
    for (const [agent, data] of Object.entries(agentRatings)) {
      console.log(`  ${agent}: ${data.avgRating}/5 (${data.count} ratings)`);
    }
  } else {
    console.log('Agent Ratings:     none yet');
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.instance) {
    console.error('Usage: node scripts/your9-feedback-loop.mjs --instance <customer-id> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --weekly-report          Generate and send weekly "How is Your9 doing?" report');
    console.error('  --prompt-feedback        Send a feedback prompt for a recent action');
    console.error('    --action-id <id>       Action ID to prompt about');
    console.error('    --agent-id <id>        Agent who performed the action (executor|mind|voice)');
    console.error('    --action-summary <s>   Description of the action');
    console.error('  --run-improvement        Trigger self-improvement for agents based on ratings');
    console.error('    --agent <id>           Specific agent (optional, defaults to all eligible)');
    console.error('    --dry-run              Log what would happen without actually running');
    console.error('  --status                 Print current feedback health summary');
    process.exit(1);
  }

  const customerId = args.instance;
  let instance;
  try {
    instance = loadInstance(customerId);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }

  const { instanceDir, customer, botToken, ownerChatId } = instance;

  // --status
  if (args.status) {
    printStatus(instanceDir, customerId);
    return;
  }

  // --weekly-report
  if (args['weekly-report']) {
    log('Generating weekly report...');
    const report = getWeeklyReport(instanceDir);
    const formatted = formatWeeklyReport(report, customer.name || customerId);
    persistWeeklyReport(instanceDir, report);

    console.log('\n' + formatted.replace(/\*/g, '').replace(/_/g, '') + '\n');

    if (botToken && ownerChatId) {
      try {
        await sendTelegramMessage(botToken, ownerChatId, formatted);
        log('Weekly report sent via Telegram');
      } catch (e) {
        log(`Weekly report Telegram send failed: ${e.message}`);
        console.error(`Telegram send failed: ${e.message}`);
      }
    } else {
      log('No Telegram credentials — printed to stdout only');
    }

    // After weekly report, check if improvement cycles should run
    log('Checking if self-improvement cycles should trigger...');
    feedRatingsToSelfImprove(instanceDir, customerId, args['dry-run'] === true);
    return;
  }

  // --prompt-feedback
  if (args['prompt-feedback']) {
    const actionId = args['action-id'] || `action-${Date.now()}`;
    const agentId = args['agent-id'] || 'executor';
    const actionSummary = args['action-summary'] || 'Recent task';

    if (!botToken || !ownerChatId) {
      console.error('Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID required to send prompt');
      process.exit(1);
    }

    await promptForFeedback(instanceDir, customer, botToken, ownerChatId, actionSummary, agentId, actionId);
    console.log(`Feedback prompt sent for action: ${actionId}`);
    return;
  }

  // --run-improvement
  if (args['run-improvement']) {
    const dryRun = args['dry-run'] === true;
    log(`Running self-improvement feed (dry-run: ${dryRun})...`);
    feedRatingsToSelfImprove(instanceDir, customerId, dryRun);
    return;
  }

  // Default: print status
  printStatus(instanceDir, customerId);
}

main().catch(err => {
  console.error(`FEEDBACK-LOOP FATAL: ${err.message}`);
  process.exit(1);
});
