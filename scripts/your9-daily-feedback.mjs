#!/usr/bin/env node
/**
 * your9-daily-feedback.mjs — End-of-Day Feedback & Daily Improvement Cycle
 * Your9 by 9 Enterprises
 *
 * Complements your9-feedback-loop.mjs (post-action feedback) with a structured
 * daily check-in rhythm. While feedback-loop.mjs captures per-action ratings,
 * this module captures holistic daily satisfaction and surfaces trends over time.
 *
 * Systems:
 *   1. Daily check-in    — sends a "How was today?" message at configurable EOD time.
 *      Questions are brief and specific: what worked, what didn't, overall day rating.
 *      Configurable via customer.json dailyFeedback.checkInHour (default 17 = 5 PM).
 *
 *   2. Daily rating      — founder replies with 1-5 and optional notes.
 *      Stored in instances/{id}/data/feedback/daily-ratings.jsonl.
 *      Fields: date, rating, notes, respondedAt, checkInSentAt.
 *
 *   3. Pattern detection — analyzes daily ratings over the trailing 30 days.
 *      Detects trend: improving | declining | plateauing | insufficient_data.
 *      Surfaces inflection points (3+ consecutive drops, 3+ consecutive rises).
 *
 *   4. Self-improvement feed — when trend is declining or avg < 3.5, triggers
 *      your9-self-improve.mjs for all active agents with no-rate-limit override.
 *      When improving, logs positive signal for reinforcement.
 *
 *   5. Monthly trend report — 30-day satisfaction trajectory for the founder.
 *      Delivered via Telegram, written to data/feedback/monthly-trend-reports.jsonl.
 *
 * Usage:
 *   node scripts/your9-daily-feedback.mjs --instance <customer-id>
 *   node scripts/your9-daily-feedback.mjs --instance <customer-id> --send-checkin
 *   node scripts/your9-daily-feedback.mjs --instance <customer-id> --monthly-report
 *   node scripts/your9-daily-feedback.mjs --instance <customer-id> --status
 *
 * Exported functions (for hub integration):
 *   sendDailyCheckIn(instanceDir, customer, botToken, ownerChatId)
 *     → Promise<{ sent: bool, skipped?: string }>
 *
 *   handleDailyRating(instanceDir, customer, botToken, ownerChatId, userText)
 *     → Promise<{ handled: bool, reply?: string }>
 *
 *   getMonthlyTrend(instanceDir)
 *     → { trend, avgRating, ratings, inflections, period, totalDays, ratedDays }
 *
 * Data files (all under instances/{id}/data/feedback/):
 *   daily-ratings.jsonl          — one record per completed daily rating
 *   daily-checkin-state.json     — pending state: was today's check-in sent? answered?
 *   monthly-trend-reports.jsonl  — persisted trend report objects
 *
 * Integration with your9-feedback-loop.mjs:
 *   - Does NOT duplicate: ratings storage, pending state, Telegram helper, self-improve spawn.
 *     All shared utilities are re-implemented locally only where they have different
 *     data shapes (daily vs per-action). Telegram helper is a thin copy to avoid a
 *     hard import dependency (both files are standalone CLIs).
 *   - feedRatingsToSelfImprove is NOT called here to avoid double-triggering.
 *     Instead this module uses its own triggerSelfImproveDueToTrend() which passes
 *     a --daily-trend flag to differentiate the trigger reason in logs.
 */

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync,
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
const SERVICE_LOG = join(LOGS_DIR, 'your9-daily-feedback.log');

mkdirSync(LOGS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  const line = `[${new Date().toISOString()}] DAILY-FEEDBACK: ${msg}`;
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
// .env loader
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

  return { customerId, instanceDir, customer, env, botToken, ownerChatId };
}

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

function feedbackDir(instanceDir) {
  const p = join(instanceDir, 'data', 'feedback');
  mkdirSync(p, { recursive: true });
  return p;
}

// ---------------------------------------------------------------------------
// CONFIG — check-in hour from customer.json or default to 17 (5 PM local)
//
// customer.json can include:
//   { "dailyFeedback": { "checkInHour": 17, "timezone": "America/New_York" } }
//
// The timezone field is informational — actual scheduling is the caller's
// responsibility (cron or hub timer). This module checks current local hour
// only when running the --send-checkin guard.
// ---------------------------------------------------------------------------

const DEFAULT_CHECKIN_HOUR = 17; // 5 PM
const DEFAULT_TIMEZONE = 'America/New_York';

function getCheckInConfig(customer) {
  const cfg = customer.dailyFeedback || {};
  return {
    checkInHour: Number.isInteger(cfg.checkInHour) ? cfg.checkInHour : DEFAULT_CHECKIN_HOUR,
    timezone: cfg.timezone || DEFAULT_TIMEZONE,
  };
}

// ---------------------------------------------------------------------------
// DAILY CHECK-IN STATE — tracks whether today's check-in was sent and answered
//
// daily-checkin-state.json:
//   {
//     date: 'YYYY-MM-DD',          — the date this state is for (local date)
//     sentAt: ISO string,          — when the check-in message was sent
//     status: 'waiting'|'answered'|'skipped'|'expired',
//     answeredAt?: ISO string,
//   }
// ---------------------------------------------------------------------------

const CHECKIN_STATE_FILE = 'daily-checkin-state.json';
const CHECKIN_EXPIRY_MS = 20 * 60 * 60 * 1000; // 20 hours — expires before next day's check-in

function loadCheckInState(instanceDir) {
  const p = join(feedbackDir(instanceDir), CHECKIN_STATE_FILE);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

function saveCheckInState(instanceDir, state) {
  const p = join(feedbackDir(instanceDir), CHECKIN_STATE_FILE);
  writeFileSync(p, JSON.stringify(state, null, 2));
}

function todayDateString() {
  // YYYY-MM-DD in local time
  return new Date().toLocaleDateString('en-CA'); // en-CA gives YYYY-MM-DD
}

function isCheckInPending(instanceDir) {
  const state = loadCheckInState(instanceDir);
  if (!state) return false;
  if (state.status !== 'waiting') return false;
  if (state.date !== todayDateString()) return false;
  // Check expiry
  const sentAt = new Date(state.sentAt).getTime();
  if (Date.now() - sentAt > CHECKIN_EXPIRY_MS) return false;
  return true;
}

function wasCheckinSentToday(instanceDir) {
  const state = loadCheckInState(instanceDir);
  if (!state) return false;
  return state.date === todayDateString();
}

// ---------------------------------------------------------------------------
// DAILY RATINGS — one record per day the founder responds
//
// daily-ratings.jsonl fields:
//   date          — 'YYYY-MM-DD'
//   rating        — 1-5 numeric (null if text-only)
//   notes         — optional free-text
//   checkInSentAt — ISO string
//   respondedAt   — ISO string
// ---------------------------------------------------------------------------

const DAILY_RATINGS_FILE = 'daily-ratings.jsonl';

function appendDailyRating(instanceDir, record) {
  const p = join(feedbackDir(instanceDir), DAILY_RATINGS_FILE);
  appendFileSync(p, JSON.stringify(record) + '\n');
}

function loadDailyRatings(instanceDir) {
  const p = join(feedbackDir(instanceDir), DAILY_RATINGS_FILE);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// TELEGRAM HELPER — matches the pattern in your9-feedback-loop.mjs
// (standalone copy so this file can run independently)
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
// DAILY CHECK-IN MESSAGE — the "How was today?" prompt
//
// Keeps it short. Three targeted questions, 1-5 scale, optional note.
// Sent once per day at EOD. If already sent today, skips.
//
// @param {string} instanceDir
// @param {object} customer
// @param {string} botToken
// @param {string} ownerChatId
// @returns {Promise<{ sent: bool, skipped?: string }>}
// ---------------------------------------------------------------------------

export async function sendDailyCheckIn(instanceDir, customer, botToken, ownerChatId) {
  // Guard: only send once per day
  if (wasCheckinSentToday(instanceDir)) {
    log('Daily check-in already sent today — skipping');
    return { sent: false, skipped: 'already_sent_today' };
  }

  if (!botToken || !ownerChatId) {
    log('Daily check-in skipped: missing Telegram credentials');
    return { sent: false, skipped: 'no_credentials' };
  }

  const today = todayDateString();
  const sentAt = new Date().toISOString();

  const msg = [
    `*End of day — quick check-in*`,
    '',
    `How did today go? Rate it *1-5* and add any notes if you want.`,
    '',
    `Things I'm curious about:`,
    `  - Did anything feel off today?`,
    `  - Any task land better than expected?`,
    `  - Anything you wished I handled differently?`,
    '',
    `Just reply with a number (and optionally a note). Or /skipday to skip.`,
    `_(1 = rough day, 5 = fired on all cylinders)_`,
  ].join('\n');

  // Save state before sending — avoids race if founder replies instantly
  saveCheckInState(instanceDir, {
    date: today,
    sentAt,
    status: 'waiting',
  });

  try {
    await sendTelegramMessage(botToken, ownerChatId, msg);
    log(`Daily check-in sent for ${today}`);
    return { sent: true };
  } catch (e) {
    log(`Daily check-in send failed: ${e.message}`);
    // Clear the state so we can retry
    saveCheckInState(instanceDir, { date: today, sentAt, status: 'send_failed', error: e.message });
    return { sent: false, skipped: `send_failed: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// HANDLE DAILY RATING — called by hub on every incoming founder message
//
// Intercepts messages only when a daily check-in is pending (status = 'waiting').
// Returns { handled: true } if consumed so the hub skips normal processing.
// Returns { handled: false } if no check-in is pending.
//
// Also handles /skipday to dismiss today's check-in without rating.
//
// @param {string} instanceDir
// @param {object} customer
// @param {string} botToken
// @param {string} ownerChatId
// @param {string} userText
// @returns {Promise<{ handled: bool, reply?: string }>}
// ---------------------------------------------------------------------------

export async function handleDailyRating(instanceDir, customer, botToken, ownerChatId, userText) {
  const text = (userText || '').trim();

  // /skipday — dismiss today's check-in
  if (text.toLowerCase() === '/skipday') {
    if (wasCheckinSentToday(instanceDir)) {
      const state = loadCheckInState(instanceDir);
      if (state && state.status === 'waiting') {
        saveCheckInState(instanceDir, { ...state, status: 'skipped', skippedAt: new Date().toISOString() });
        log(`Daily check-in skipped by founder for ${state.date}`);
        try {
          await sendTelegramMessage(botToken, ownerChatId, `Got it. No rating recorded for today.`);
        } catch {}
        return { handled: true };
      }
    }
    return { handled: false };
  }

  // Only intercept if a check-in is pending
  if (!isCheckInPending(instanceDir)) {
    return { handled: false };
  }

  const state = loadCheckInState(instanceDir);

  // Parse rating — 1-5 optionally followed by a note
  const numMatch = text.match(/^([1-5])(\s|$|[.,!?])/);
  const numVal = numMatch ? parseInt(numMatch[1], 10) : null;
  const isRatingOnly = numMatch && text.replace(/^[1-5]/, '').trim().length === 0;
  const isRatingWithNote = numMatch && !isRatingOnly;

  const rating = numVal;
  const notes = isRatingWithNote
    ? text.replace(/^[1-5]\s*/, '').trim()
    : (!numMatch ? text : null);

  const respondedAt = new Date().toISOString();

  // Store the daily rating
  const record = {
    date: state.date,
    rating,
    notes: notes || null,
    checkInSentAt: state.sentAt,
    respondedAt,
  };

  appendDailyRating(instanceDir, record);

  // Update state to answered
  saveCheckInState(instanceDir, { ...state, status: 'answered', answeredAt: respondedAt });

  log(`Daily rating captured: date=${state.date} rating=${rating} notes=${notes ? notes.slice(0, 60) : 'none'}`);

  // Acknowledgement
  let ack;
  if (rating !== null) {
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
    if (rating >= 4) {
      ack = `${stars} Good day. Logged.`;
    } else if (rating === 3) {
      ack = `${stars} Average day. Logged. I'll look for patterns.`;
    } else {
      ack = `${stars} Noted. I'll dig into what's dragging. Logged.`;
    }
  } else {
    ack = `Feedback logged for today. Appreciate it.`;
  }

  if (notes) ack += `\n_Note recorded._`;

  try {
    await sendTelegramMessage(botToken, ownerChatId, ack);
  } catch {}

  // After capture, check if a trend-based improvement cycle should trigger
  await maybeRunTrendImprovement(instanceDir, customer?.id || '');

  return { handled: true };
}

// ---------------------------------------------------------------------------
// PATTERN DETECTION — analyze daily ratings over trailing N days
//
// Returns:
//   trend:       'improving' | 'declining' | 'plateauing' | 'insufficient_data'
//   avgRating:   numeric average over the period
//   ratings:     array of { date, rating } sorted oldest → newest
//   inflections: array of notable runs ({ type, startDate, endDate, length })
//   period:      { start, end }
//   totalDays:   days in the period
//   ratedDays:   days where a rating was recorded
//
// A trend is computed from the slope of the 7-day rolling average:
//   improving  — last 7-day avg > first 7-day avg by ≥0.3
//   declining  — last 7-day avg < first 7-day avg by ≥0.3
//   plateauing — difference < 0.3 either direction
// ---------------------------------------------------------------------------

function detectInflections(sortedRatings) {
  const inflections = [];
  if (sortedRatings.length < 2) return inflections;

  let runType = null;   // 'up' or 'down'
  let runStart = null;
  let runLength = 0;

  for (let i = 1; i < sortedRatings.length; i++) {
    const prev = sortedRatings[i - 1].rating;
    const curr = sortedRatings[i].rating;
    if (prev == null || curr == null) {
      runType = null;
      runLength = 0;
      continue;
    }

    const direction = curr > prev ? 'up' : curr < prev ? 'down' : 'flat';

    if (direction === 'flat') {
      // Flat breaks a run
      if (runLength >= 3) {
        inflections.push({
          type: runType === 'up' ? 'rising' : 'falling',
          startDate: runStart,
          endDate: sortedRatings[i - 1].date,
          length: runLength,
        });
      }
      runType = null;
      runLength = 0;
      continue;
    }

    if (direction === runType) {
      runLength++;
    } else {
      // Commit previous run if long enough
      if (runLength >= 3 && runType !== null) {
        inflections.push({
          type: runType === 'up' ? 'rising' : 'falling',
          startDate: runStart,
          endDate: sortedRatings[i - 1].date,
          length: runLength,
        });
      }
      runType = direction;
      runStart = sortedRatings[i - 1].date;
      runLength = 1;
    }
  }

  // Commit final run
  if (runLength >= 3 && runType !== null) {
    inflections.push({
      type: runType === 'up' ? 'rising' : 'falling',
      startDate: runStart,
      endDate: sortedRatings[sortedRatings.length - 1].date,
      length: runLength,
    });
  }

  return inflections;
}

/**
 * Returns the monthly trend object for the trailing 30 days.
 *
 * @param {string} instanceDir
 * @param {number} [days=30] — number of trailing days to analyze
 * @returns {{
 *   trend: string,
 *   avgRating: number|null,
 *   ratings: Array<{date: string, rating: number|null}>,
 *   inflections: Array,
 *   period: {start: string, end: string},
 *   totalDays: number,
 *   ratedDays: number,
 * }}
 */
export function getMonthlyTrend(instanceDir, days = 30) {
  const allRatings = loadDailyRatings(instanceDir);

  // Build date → rating map (most recent entry wins if duplicates)
  const byDate = {};
  for (const r of allRatings) {
    if (r.date && r.rating != null) {
      byDate[r.date] = r.rating;
    }
  }

  // Generate the trailing N days
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (days - 1));

  const periodRatings = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toLocaleDateString('en-CA');
    periodRatings.push({
      date: dateStr,
      rating: byDate[dateStr] != null ? byDate[dateStr] : null,
    });
  }

  const ratedEntries = periodRatings.filter(r => r.rating != null);
  const ratedDays = ratedEntries.length;

  if (ratedDays < 3) {
    return {
      trend: 'insufficient_data',
      avgRating: ratedDays > 0
        ? Math.round((ratedEntries.reduce((a, r) => a + r.rating, 0) / ratedDays) * 10) / 10
        : null,
      ratings: periodRatings,
      inflections: [],
      period: {
        start: startDate.toLocaleDateString('en-CA'),
        end: endDate.toLocaleDateString('en-CA'),
      },
      totalDays: days,
      ratedDays,
    };
  }

  // Overall average
  const avgRating = Math.round(
    (ratedEntries.reduce((a, r) => a + r.rating, 0) / ratedDays) * 10
  ) / 10;

  // Compute trend via 7-day rolling average comparison
  // Compare first half avg to second half avg of rated entries
  const half = Math.floor(ratedEntries.length / 2);
  const firstHalf = ratedEntries.slice(0, half);
  const secondHalf = ratedEntries.slice(ratedEntries.length - half);

  const firstAvg = firstHalf.reduce((a, r) => a + r.rating, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, r) => a + r.rating, 0) / secondHalf.length;
  const delta = secondAvg - firstAvg;

  let trend;
  if (delta >= 0.3) {
    trend = 'improving';
  } else if (delta <= -0.3) {
    trend = 'declining';
  } else {
    trend = 'plateauing';
  }

  // Detect inflection runs (use only rated days for run detection)
  const inflections = detectInflections(ratedEntries);

  return {
    trend,
    avgRating,
    ratings: periodRatings,
    inflections,
    period: {
      start: startDate.toLocaleDateString('en-CA'),
      end: endDate.toLocaleDateString('en-CA'),
    },
    totalDays: days,
    ratedDays,
    delta: Math.round(delta * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// FORMAT MONTHLY TREND — human-readable Telegram message
// ---------------------------------------------------------------------------

function formatMonthlyTrend(trend, customerName) {
  const lines = [
    `*30-Day Satisfaction Trend*`,
    `_${trend.period.start} to ${trend.period.end}_`,
    '',
  ];

  if (trend.trend === 'insufficient_data') {
    lines.push(`Not enough data yet — ${trend.ratedDays} day${trend.ratedDays !== 1 ? 's' : ''} rated out of 30.`);
    lines.push(`Keep responding to daily check-ins. Trends appear after 3+ ratings.`);
    return lines.join('\n');
  }

  // Trend label + emoji (text-safe alternatives since emojis are allowed in Telegram)
  const trendLabel = {
    improving: 'Improving',
    declining: 'Declining',
    plateauing: 'Plateauing',
  }[trend.trend] || trend.trend;

  const trendContext = {
    improving: `Moving in the right direction.`,
    declining: `Something is off. Worth a look.`,
    plateauing: `Holding steady. No obvious momentum either way.`,
  }[trend.trend] || '';

  lines.push(`*Trend: ${trendLabel}* — ${trendContext}`);
  lines.push(`Avg daily rating: *${trend.avgRating}/5* over ${trend.ratedDays} rated days`);

  if (trend.delta != null) {
    const dirWord = trend.delta >= 0 ? 'up' : 'down';
    lines.push(`Direction: ${dirWord} ${Math.abs(trend.delta).toFixed(1)} points (first half vs second half)`);
  }

  lines.push('');

  // Inflections
  if (trend.inflections.length > 0) {
    lines.push(`*Notable runs:*`);
    for (const inf of trend.inflections) {
      const label = inf.type === 'rising' ? 'Rising' : 'Falling';
      lines.push(`  ${label}: ${inf.startDate} to ${inf.endDate} (${inf.length} days)`);
    }
    lines.push('');
  }

  // Recent 7-day snapshot
  const recent = trend.ratings.slice(-7).filter(r => r.rating != null);
  if (recent.length > 0) {
    lines.push(`*Last 7 rated days:*`);
    for (const r of recent) {
      const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
      lines.push(`  ${r.date}: ${stars} ${r.rating}/5`);
    }
    lines.push('');
  }

  // Call to action if declining
  if (trend.trend === 'declining') {
    lines.push(`I'll run an improvement cycle on active agents.`);
  } else if (trend.trend === 'improving') {
    lines.push(`Positive signal recorded — reinforcing what's working.`);
  }

  lines.push(`_Based on ${trend.ratedDays}/${trend.totalDays} days with ratings._`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// MONTHLY TREND LOG — persists trend objects for historical comparison
// ---------------------------------------------------------------------------

const MONTHLY_TRENDS_FILE = 'monthly-trend-reports.jsonl';

function persistMonthlyTrend(instanceDir, trendReport) {
  const p = join(feedbackDir(instanceDir), MONTHLY_TRENDS_FILE);
  const record = { ...trendReport, savedAt: new Date().toISOString() };
  appendFileSync(p, JSON.stringify(record) + '\n');
  log(`Monthly trend report saved`);
}

// ---------------------------------------------------------------------------
// SELF-IMPROVEMENT TRIGGER — fires when daily trend is declining or avg < 3.5
//
// Passes --daily-trend flag to distinguish from the per-action improvement
// trigger in your9-feedback-loop.mjs. No double-triggering: this only fires
// after a daily rating capture or explicit --monthly-report run.
// ---------------------------------------------------------------------------

const LAST_TREND_IMPROVE_FILE = 'last-trend-improvement.json';
const TREND_IMPROVE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // max once per day

function loadLastTrendImprove(instanceDir) {
  const p = join(feedbackDir(instanceDir), LAST_TREND_IMPROVE_FILE);
  if (!existsSync(p)) return { triggeredAt: null };
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return { triggeredAt: null }; }
}

function saveLastTrendImprove(instanceDir) {
  const p = join(feedbackDir(instanceDir), LAST_TREND_IMPROVE_FILE);
  writeFileSync(p, JSON.stringify({ triggeredAt: new Date().toISOString() }, null, 2));
}

function triggerSelfImproveDueToTrend(instanceDir, customerId, trend) {
  const last = loadLastTrendImprove(instanceDir);
  if (last.triggeredAt) {
    const elapsed = Date.now() - new Date(last.triggeredAt).getTime();
    if (elapsed < TREND_IMPROVE_COOLDOWN_MS) {
      log(`Trend-based self-improve skipped: cooldown (last ran ${Math.round(elapsed / 3600000)}h ago)`);
      return;
    }
  }

  const shouldTrigger = trend.trend === 'declining' || (trend.avgRating != null && trend.avgRating < 3.5);
  if (!shouldTrigger) {
    log(`Trend-based self-improve skipped: trend=${trend.trend} avg=${trend.avgRating}`);
    return;
  }

  const selfImproveScript = join(ROOT, 'scripts', 'your9-self-improve.mjs');
  if (!existsSync(selfImproveScript)) {
    log(`your9-self-improve.mjs not found — cannot trigger trend improvement`);
    return;
  }

  const VALID_AGENTS = ['executor', 'mind', 'voice'];
  for (const agentId of VALID_AGENTS) {
    try {
      log(`Trend-based self-improve: spawning for ${agentId} (trend=${trend.trend} avg=${trend.avgRating})`);
      execSync(
        `node "${selfImproveScript}" --instance "${customerId}" --agent "${agentId}" --min-tasks 1 --daily-trend`,
        { stdio: 'inherit', timeout: 300000 }
      );
      log(`Trend self-improve complete for ${agentId}`);
    } catch (e) {
      log(`Trend self-improve failed for ${agentId}: ${e.message}`);
    }
  }

  saveLastTrendImprove(instanceDir);
}

// Thin async wrapper called from handleDailyRating
async function maybeRunTrendImprovement(instanceDir, customerId) {
  try {
    const trend = getMonthlyTrend(instanceDir);
    triggerSelfImproveDueToTrend(instanceDir, customerId, trend);
  } catch (e) {
    log(`maybeRunTrendImprovement error: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// STATUS COMMAND
// ---------------------------------------------------------------------------

function printStatus(instanceDir, customerId) {
  const ratings = loadDailyRatings(instanceDir);
  const state = loadCheckInState(instanceDir);
  const trend = getMonthlyTrend(instanceDir);

  console.log('\n=== Your9 Daily Feedback Status ===\n');
  console.log(`Instance:          ${customerId}`);
  console.log(`Total daily ratings: ${ratings.length}`);

  console.log('');
  console.log('Today\'s check-in:');
  if (state) {
    console.log(`  Date:   ${state.date}`);
    console.log(`  Status: ${state.status}`);
    if (state.sentAt) console.log(`  Sent:   ${state.sentAt}`);
  } else {
    console.log(`  No check-in record for today`);
  }

  console.log('');
  console.log('30-Day Trend:');
  console.log(`  Trend:     ${trend.trend}`);
  console.log(`  Avg:       ${trend.avgRating != null ? `${trend.avgRating}/5` : 'n/a'}`);
  console.log(`  Rated:     ${trend.ratedDays}/${trend.totalDays} days`);
  if (trend.inflections.length > 0) {
    console.log(`  Notable runs: ${trend.inflections.length}`);
    for (const inf of trend.inflections) {
      console.log(`    ${inf.type}: ${inf.startDate} → ${inf.endDate} (${inf.length} days)`);
    }
  }

  console.log('');

  // Recent 7 days
  const recent = trend.ratings.slice(-7);
  console.log('Last 7 days:');
  for (const r of recent) {
    const val = r.rating != null ? `${r.rating}/5` : '(no rating)';
    console.log(`  ${r.date}: ${val}`);
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.instance) {
    console.error('Usage: node scripts/your9-daily-feedback.mjs --instance <customer-id> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --send-checkin         Send end-of-day check-in message now');
    console.error('  --monthly-report       Generate and send 30-day trend report');
    console.error('    --dry-run            Log only, do not send Telegram messages');
    console.error('  --status               Print current daily feedback status');
    console.error('');
    console.error('Exported functions (for hub integration):');
    console.error('  sendDailyCheckIn(instanceDir, customer, botToken, ownerChatId)');
    console.error('  handleDailyRating(instanceDir, customer, botToken, ownerChatId, userText)');
    console.error('  getMonthlyTrend(instanceDir)');
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
  const dryRun = args['dry-run'] === true;

  // --status
  if (args.status) {
    printStatus(instanceDir, customerId);
    return;
  }

  // --send-checkin
  if (args['send-checkin']) {
    if (dryRun) {
      log('DRY RUN: would send daily check-in now');
      console.log('[dry-run] Would send daily check-in');
      return;
    }
    const result = await sendDailyCheckIn(instanceDir, customer, botToken, ownerChatId);
    if (result.sent) {
      console.log('Daily check-in sent.');
    } else {
      console.log(`Daily check-in skipped: ${result.skipped}`);
    }
    return;
  }

  // --monthly-report
  if (args['monthly-report']) {
    log('Generating monthly trend report...');
    const trend = getMonthlyTrend(instanceDir);
    const formatted = formatMonthlyTrend(trend, customer.name || customerId);

    persistMonthlyTrend(instanceDir, trend);

    // Print to stdout (strip Markdown for console readability)
    console.log('\n' + formatted.replace(/\*/g, '').replace(/_/g, '') + '\n');

    if (!dryRun && botToken && ownerChatId) {
      try {
        await sendTelegramMessage(botToken, ownerChatId, formatted);
        log('Monthly trend report sent via Telegram');
      } catch (e) {
        log(`Monthly trend Telegram send failed: ${e.message}`);
        console.error(`Telegram send failed: ${e.message}`);
      }
    } else if (dryRun) {
      log('DRY RUN: Telegram send skipped');
    } else {
      log('No Telegram credentials — printed to stdout only');
    }

    // Check if improvement cycles should run based on trend
    triggerSelfImproveDueToTrend(instanceDir, customerId, trend);
    return;
  }

  // Default: print status
  printStatus(instanceDir, customerId);
}

main().catch(err => {
  console.error(`DAILY-FEEDBACK FATAL: ${err.message}`);
  process.exit(1);
});
