#!/usr/bin/env node
/**
 * your9-beta-feedback.mjs — Beta Testing Framework & Customer Feedback Loop
 * Your9 by 9 Enterprises
 *
 * Manages the full feedback lifecycle for Your9 beta customers:
 *   - Usage analytics tracking per instance
 *   - 7-day automated survey delivery via Telegram
 *   - /bug and /feature Telegram commands for in-chat reporting
 *   - NPS score calculation from survey responses
 *   - Aggregate beta report across all instances
 *   - Admin panel data endpoint for the feedback dashboard section
 *
 * Usage:
 *   node scripts/your9-beta-feedback.mjs --instance <customer-id>   # Per-instance ops
 *   node scripts/your9-beta-feedback.mjs --report                   # Aggregate beta report
 *   node scripts/your9-beta-feedback.mjs --send-survey <customer-id> # Force send survey now
 *   node scripts/your9-beta-feedback.mjs --serve                    # Run as HTTP service (port 3492)
 *
 * Analytics are stored in: instances/{id}/data/analytics/
 * Feedback (bugs, features, surveys) in: instances/{id}/data/feedback/
 *
 * Integrates with your9-hub.mjs: hub calls handleFeedbackCommand() when it sees
 * /bug or /feature in the Telegram message stream, before routing to the CEO.
 *
 * Integrates with your9-admin.mjs: the admin panel fetches /api/feedback from
 * this service (port 3492) to render the feedback dashboard section.
 */

import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import https from 'https';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');
const LOGS_DIR = join(ROOT, 'logs');
const SERVICE_LOG = join(LOGS_DIR, 'your9-beta-feedback.log');

mkdirSync(LOGS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  const line = `[${new Date().toISOString()}] FEEDBACK: ${msg}`;
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
    .filter(d => d.isDirectory())
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

function getInstanceById(instanceId) {
  const all = discoverInstances();
  const inst = all.find(i => i.id === instanceId);
  if (!inst) throw new Error(`Instance not found: ${instanceId}`);
  return inst;
}

// ---------------------------------------------------------------------------
// Directory helpers — ensures data directories exist
// ---------------------------------------------------------------------------

function analyticsDir(instanceDir) {
  const p = join(instanceDir, 'data', 'analytics');
  mkdirSync(p, { recursive: true });
  return p;
}

function feedbackDir(instanceDir) {
  const p = join(instanceDir, 'data', 'feedback');
  mkdirSync(p, { recursive: true });
  return p;
}

// ---------------------------------------------------------------------------
// Analytics — per-instance usage metrics
//
// Tracked metrics:
//   messagesSent       — Number of messages the founder sent to the CEO
//   tasksCompleted     — Agent tasks that reached 'completed' status
//   agentsUsed         — Set of agent IDs that handled at least one task
//   sessionCount       — Number of polling sessions (hub restarts)
//   featureUsage       — Map of feature name -> count
//   dailyActive        — Map of date string (YYYY-MM-DD) -> message count
//   lastActivity       — ISO timestamp of most recent founder message
//   createdAt          — When this analytics record was first written
// ---------------------------------------------------------------------------

const ANALYTICS_FILE = 'usage.json';

function loadAnalytics(instanceDir) {
  const p = join(analyticsDir(instanceDir), ANALYTICS_FILE);
  if (!existsSync(p)) {
    return {
      messagesSent: 0,
      tasksCompleted: 0,
      agentsUsed: [],
      sessionCount: 0,
      featureUsage: {},
      dailyActive: {},
      lastActivity: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

function saveAnalytics(instanceDir, data) {
  const p = join(analyticsDir(instanceDir), ANALYTICS_FILE);
  data.updatedAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(data, null, 2));
}

/**
 * Record a founder message. Called by the hub when it receives a Telegram message.
 * Safe to call externally — reads, updates, writes.
 */
export function recordMessage(instanceDir, featureName = null) {
  const data = loadAnalytics(instanceDir);
  data.messagesSent = (data.messagesSent || 0) + 1;
  data.lastActivity = new Date().toISOString();

  const today = new Date().toISOString().slice(0, 10);
  data.dailyActive = data.dailyActive || {};
  data.dailyActive[today] = (data.dailyActive[today] || 0) + 1;

  if (featureName) {
    data.featureUsage = data.featureUsage || {};
    data.featureUsage[featureName] = (data.featureUsage[featureName] || 0) + 1;
  }

  saveAnalytics(instanceDir, data);
}

/**
 * Record a completed agent task.
 */
export function recordTaskCompleted(instanceDir, agentId) {
  const data = loadAnalytics(instanceDir);
  data.tasksCompleted = (data.tasksCompleted || 0) + 1;
  if (agentId) {
    data.agentsUsed = data.agentsUsed || [];
    if (!data.agentsUsed.includes(agentId)) {
      data.agentsUsed.push(agentId);
    }
  }
  saveAnalytics(instanceDir, data);
}

/**
 * Record a hub session start.
 */
export function recordSessionStart(instanceDir) {
  const data = loadAnalytics(instanceDir);
  data.sessionCount = (data.sessionCount || 0) + 1;
  saveAnalytics(instanceDir, data);
}

/**
 * Record use of a specific named feature (e.g., 'briefing', 'pipeline', 'research').
 */
export function recordFeatureUse(instanceDir, featureName) {
  const data = loadAnalytics(instanceDir);
  data.featureUsage = data.featureUsage || {};
  data.featureUsage[featureName] = (data.featureUsage[featureName] || 0) + 1;
  saveAnalytics(instanceDir, data);
}

// ---------------------------------------------------------------------------
// Bug reports — JSONL append, one record per report
// ---------------------------------------------------------------------------

const BUGS_FILE = 'bugs.jsonl';

function appendBug(instanceDir, report) {
  const p = join(feedbackDir(instanceDir), BUGS_FILE);
  appendFileSync(p, JSON.stringify(report) + '\n');
}

function loadBugs(instanceDir) {
  const p = join(feedbackDir(instanceDir), BUGS_FILE);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l));
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Feature requests — JSONL append, one record per request
// ---------------------------------------------------------------------------

const FEATURES_FILE = 'feature-requests.jsonl';

function appendFeatureRequest(instanceDir, request) {
  const p = join(feedbackDir(instanceDir), FEATURES_FILE);
  appendFileSync(p, JSON.stringify(request) + '\n');
}

function loadFeatureRequests(instanceDir) {
  const p = join(feedbackDir(instanceDir), FEATURES_FILE);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l));
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Survey system
//
// The 7-day survey sends 5 questions, one at a time, via Telegram.
// Responses are recorded as they come in. The hub calls handleFeedbackCommand()
// on every message — if a survey session is active, it captures the response
// before the message reaches the CEO.
//
// Questions (1-10 scale + optional open text):
//   1. Overall: How satisfied are you with your AI CEO? (1-10)
//   2. Value: How much value has it delivered this week? (1-10)
//   3. Ease: How easy is it to use? (1-10)
//   4. Reliability: How reliable has it been? (1-10)
//   5. Recommend: How likely are you to recommend Your9? (1-10) — NPS driver
//      + What is the single most important thing we could improve? (open text)
//
// Survey state machine per instance:
//   idle         — no survey active
//   active       — survey in progress, waiting for next answer
//   complete     — all answers recorded
// ---------------------------------------------------------------------------

const SURVEYS_FILE = 'surveys.jsonl';
const SURVEY_STATE_FILE = 'survey-state.json';

const SURVEY_QUESTIONS = [
  {
    id: 'satisfaction',
    text: '*Your9 Beta Survey (1/5)*\n\nHow satisfied are you with your AI CEO overall?\n\nReply with a number from *1* (not at all) to *10* (extremely satisfied).',
    type: 'scale',
  },
  {
    id: 'value',
    text: '*Your9 Beta Survey (2/5)*\n\nHow much value has your AI CEO delivered this week?\n\nReply with a number from *1* (none) to *10* (significant value every day).',
    type: 'scale',
  },
  {
    id: 'ease_of_use',
    text: '*Your9 Beta Survey (3/5)*\n\nHow easy is Your9 to use?\n\nReply with a number from *1* (very confusing) to *10* (effortless).',
    type: 'scale',
  },
  {
    id: 'reliability',
    text: '*Your9 Beta Survey (4/5)*\n\nHow reliable has your AI CEO been?\n\nReply with a number from *1* (frequent errors/delays) to *10* (flawless).',
    type: 'scale',
  },
  {
    id: 'nps',
    text: '*Your9 Beta Survey (5/5)*\n\nHow likely are you to recommend Your9 to another founder?\n\nReply with a number from *1* (would not recommend) to *10* (would strongly recommend).',
    type: 'scale',
  },
  {
    id: 'open_feedback',
    text: 'Last question — *no number needed*.\n\nWhat is the single most important thing we could improve?\n\nJust type your answer.',
    type: 'text',
  },
];

function loadSurveyState(instanceDir) {
  const p = join(feedbackDir(instanceDir), SURVEY_STATE_FILE);
  if (!existsSync(p)) return { status: 'idle', questionIndex: 0, answers: {}, surveyId: null };
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return { status: 'idle', questionIndex: 0, answers: {}, surveyId: null }; }
}

function saveSurveyState(instanceDir, state) {
  const p = join(feedbackDir(instanceDir), SURVEY_STATE_FILE);
  writeFileSync(p, JSON.stringify(state, null, 2));
}

function appendSurveyResult(instanceDir, result) {
  const p = join(feedbackDir(instanceDir), SURVEYS_FILE);
  appendFileSync(p, JSON.stringify(result) + '\n');
}

function loadSurveys(instanceDir) {
  const p = join(feedbackDir(instanceDir), SURVEYS_FILE);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l));
  } catch { return []; }
}

/**
 * Check if 7 days have passed since provisioning and no survey has been sent yet.
 * Returns true if a survey should be triggered.
 */
function shouldTriggerSurvey(instanceDir, customer) {
  if (!customer?.provisionedAt) return false;

  const state = loadSurveyState(instanceDir);
  // If survey is already active or complete, don't re-trigger
  if (state.status === 'active') return false;
  if (state.status === 'complete') return false;

  const provisionedDate = new Date(customer.provisionedAt);
  const sevenDaysLater = new Date(provisionedDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  return new Date() >= sevenDaysLater;
}

// ---------------------------------------------------------------------------
// Telegram helper — raw HTTPS (same pattern as your9-hub.mjs, no SDK)
// ---------------------------------------------------------------------------

async function sendTelegramMessage(botToken, chatId, text) {
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
              const data = JSON.parse(buf);
              if (!data.ok) reject(new Error(`Telegram error: ${data.description}`));
              else resolve(data);
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
// NPS calculation
//
// Standard NPS: based on the 0-10 "recommend" question.
// We use 1-10 scale. Map: 9-10 = Promoter, 7-8 = Passive, 1-6 = Detractor.
// NPS = %Promoters - %Detractors (range -100 to +100)
// ---------------------------------------------------------------------------

function calculateNps(surveys) {
  const scores = surveys
    .map(s => s.answers?.nps)
    .filter(v => v != null && !isNaN(Number(v)))
    .map(Number);

  if (scores.length === 0) return { nps: null, promoters: 0, passives: 0, detractors: 0, responses: 0 };

  const promoters = scores.filter(s => s >= 9).length;
  const passives = scores.filter(s => s >= 7 && s < 9).length;
  const detractors = scores.filter(s => s < 7).length;
  const total = scores.length;

  const nps = Math.round(((promoters - detractors) / total) * 100);

  return { nps, promoters, passives, detractors, responses: total };
}

// ---------------------------------------------------------------------------
// Average score helper across a set of surveys for a given question ID
// ---------------------------------------------------------------------------

function avgScore(surveys, questionId) {
  const vals = surveys
    .map(s => s.answers?.[questionId])
    .filter(v => v != null && !isNaN(Number(v)))
    .map(Number);
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Feedback command handler — exported for use by your9-hub.mjs
//
// Call this BEFORE routing a message to the CEO. Returns:
//   { handled: true }  — message was a /bug, /feature, or survey response
//   { handled: false } — not a feedback message, pass to CEO normally
//
// The hub must also call checkAndTriggerSurvey() on each Telegram poll loop
// iteration so the 7-day survey fires automatically.
// ---------------------------------------------------------------------------

export async function handleFeedbackCommand(instanceDir, customer, botToken, ownerChatId, userText) {
  const text = userText.trim();

  // --- /bug command ---
  if (text.startsWith('/bug')) {
    const description = text.slice(4).trim() || null;

    if (!description) {
      await sendTelegramMessage(botToken, ownerChatId,
        '*Bug Report*\n\nDescribe the bug after the command:\n\n`/bug The briefing command hangs and never responds`');
      return { handled: true };
    }

    const report = {
      id: `bug-${Date.now()}`,
      description,
      reportedAt: new Date().toISOString(),
      instanceId: customer?.customerId || 'unknown',
      customerName: customer?.name || 'unknown',
      status: 'open',
    };

    appendBug(instanceDir, report);
    log(`Bug report filed: ${report.id} — "${description.slice(0, 80)}"`);

    await sendTelegramMessage(botToken, ownerChatId,
      `*Bug filed* (ID: \`${report.id}\`)\n\n"${description}"\n\nLogged and escalated to the engineering team. We will follow up.`);

    // Escalate to internal log — admin panel polls this
    return { handled: true, escalate: true, report };
  }

  // --- /feature command ---
  if (text.startsWith('/feature')) {
    const description = text.slice(8).trim() || null;

    if (!description) {
      await sendTelegramMessage(botToken, ownerChatId,
        '*Feature Request*\n\nDescribe the feature after the command:\n\n`/feature I want my CEO to monitor my email inbox`');
      return { handled: true };
    }

    const request = {
      id: `feat-${Date.now()}`,
      description,
      requestedAt: new Date().toISOString(),
      instanceId: customer?.customerId || 'unknown',
      customerName: customer?.name || 'unknown',
      status: 'submitted',
    };

    appendFeatureRequest(instanceDir, request);
    log(`Feature request filed: ${request.id} — "${description.slice(0, 80)}"`);

    await sendTelegramMessage(botToken, ownerChatId,
      `*Feature request received* (ID: \`${request.id}\`)\n\n"${description}"\n\nAdded to the product backlog. We review all requests weekly.`);

    return { handled: true };
  }

  // --- Survey response capture ---
  const state = loadSurveyState(instanceDir);

  if (state.status === 'active') {
    const currentQuestion = SURVEY_QUESTIONS[state.questionIndex];

    if (!currentQuestion) {
      // Shouldn't happen — reset state
      saveSurveyState(instanceDir, { ...state, status: 'complete' });
      return { handled: false };
    }

    let answer = text;

    // Validate scale responses
    if (currentQuestion.type === 'scale') {
      const num = parseInt(text, 10);
      if (isNaN(num) || num < 1 || num > 10) {
        await sendTelegramMessage(botToken, ownerChatId,
          'Please reply with a number from *1* to *10*.');
        return { handled: true };
      }
      answer = num;
    }

    // Record the answer
    state.answers[currentQuestion.id] = answer;
    state.questionIndex++;
    log(`Survey ${state.surveyId}: answered "${currentQuestion.id}" = ${answer}`);

    if (state.questionIndex >= SURVEY_QUESTIONS.length) {
      // Survey complete
      state.status = 'complete';
      saveSurveyState(instanceDir, state);

      const result = {
        surveyId: state.surveyId,
        instanceId: customer?.customerId || 'unknown',
        customerName: customer?.name || 'unknown',
        answers: state.answers,
        completedAt: new Date().toISOString(),
      };
      appendSurveyResult(instanceDir, result);

      const npsData = calculateNps([result]);
      const npsLabel = npsData.nps === null ? 'N/A'
        : npsData.nps >= 50 ? `${npsData.nps} (Excellent)`
        : npsData.nps >= 0 ? `${npsData.nps} (Good)`
        : `${npsData.nps} (Needs work)`;

      await sendTelegramMessage(botToken, ownerChatId,
        `*Survey complete — thank you!*\n\nYour NPS score: *${npsLabel}*\n\nYour feedback goes directly to the product team. We will use it to make Your9 better.`);

      log(`Survey ${state.surveyId} complete. NPS: ${npsData.nps}`);
      return { handled: true };
    }

    // Send next question
    saveSurveyState(instanceDir, state);
    const nextQ = SURVEY_QUESTIONS[state.questionIndex];

    await sendTelegramMessage(botToken, ownerChatId, nextQ.text);
    return { handled: true };
  }

  return { handled: false };
}

/**
 * Check if the 7-day survey should fire and send the first question.
 * Safe to call on every poll loop iteration — no-op if survey already active/complete.
 * The hub calls this once per polling cycle.
 */
export async function checkAndTriggerSurvey(instanceDir, customer, botToken, ownerChatId) {
  if (!shouldTriggerSurvey(instanceDir, customer)) return;

  const surveyId = `survey-${Date.now()}`;
  const state = {
    status: 'active',
    surveyId,
    questionIndex: 0,
    answers: {},
    startedAt: new Date().toISOString(),
  };
  saveSurveyState(instanceDir, state);
  log(`Triggering 7-day survey for instance ${customer?.customerId || 'unknown'} (survey ${surveyId})`);

  await sendTelegramMessage(botToken, ownerChatId,
    `*You have been using Your9 for a week!*\n\nWe have a quick 5-question survey to make sure we are delivering value. Takes about 60 seconds.\n\nType /skip at any point to skip the survey.`);

  // Brief pause then send first question
  await new Promise(r => setTimeout(r, 2000));
  await sendTelegramMessage(botToken, ownerChatId, SURVEY_QUESTIONS[0].text);
}

// ---------------------------------------------------------------------------
// Per-instance feedback summary — used by --instance flag and admin endpoint
// ---------------------------------------------------------------------------

function buildInstanceFeedbackSummary(instanceDir, customer) {
  const analytics = loadAnalytics(instanceDir);
  const bugs = loadBugs(instanceDir);
  const features = loadFeatureRequests(instanceDir);
  const surveys = loadSurveys(instanceDir);
  const surveyState = loadSurveyState(instanceDir);
  const npsData = calculateNps(surveys);

  // Most-used features
  const featureUsage = analytics.featureUsage || {};
  const topFeatures = Object.entries(featureUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // Days active (number of distinct days with messages)
  const daysActive = Object.keys(analytics.dailyActive || {}).length;

  // Survey averages
  const avgSatisfaction = avgScore(surveys, 'satisfaction');
  const avgValue = avgScore(surveys, 'value');
  const avgEaseOfUse = avgScore(surveys, 'ease_of_use');
  const avgReliability = avgScore(surveys, 'reliability');

  // Open feedback text from surveys
  const openFeedback = surveys
    .filter(s => s.answers?.open_feedback)
    .map(s => ({ text: s.answers.open_feedback, completedAt: s.completedAt }));

  return {
    instanceId: customer?.customerId || 'unknown',
    customerName: customer?.name || 'unknown',
    industry: customer?.industry || 'unknown',
    tier: customer?.tier || 'unknown',
    provisionedAt: customer?.provisionedAt || null,
    analytics: {
      messagesSent: analytics.messagesSent || 0,
      tasksCompleted: analytics.tasksCompleted || 0,
      agentsUsed: analytics.agentsUsed || [],
      sessionCount: analytics.sessionCount || 0,
      daysActive,
      topFeatures,
      lastActivity: analytics.lastActivity || null,
    },
    feedback: {
      bugsTotal: bugs.length,
      bugsOpen: bugs.filter(b => b.status === 'open').length,
      featuresTotal: features.length,
      bugs: bugs.slice(-10).reverse(),      // Last 10, newest first
      features: features.slice(-10).reverse(),
    },
    surveys: {
      surveysCompleted: surveys.length,
      surveyStatus: surveyState.status,
      nps: npsData,
      avgSatisfaction,
      avgValue,
      avgEaseOfUse,
      avgReliability,
      openFeedback,
    },
  };
}

// ---------------------------------------------------------------------------
// Aggregate beta report — all instances combined
// ---------------------------------------------------------------------------

function buildBetaReport() {
  const instances = discoverInstances();
  const summaries = instances.map(inst => {
    try {
      return buildInstanceFeedbackSummary(inst.instanceDir, inst.customer);
    } catch (e) {
      return { instanceId: inst.id, error: e.message };
    }
  });

  // Fleet-wide NPS
  const allSurveys = instances.flatMap(inst => {
    try { return loadSurveys(inst.instanceDir); } catch { return []; }
  });
  const fleetNps = calculateNps(allSurveys);

  // Fleet-wide bug/feature counts
  const totalBugs = summaries.reduce((n, s) => n + (s.feedback?.bugsTotal || 0), 0);
  const openBugs = summaries.reduce((n, s) => n + (s.feedback?.bugsOpen || 0), 0);
  const totalFeatures = summaries.reduce((n, s) => n + (s.feedback?.featuresTotal || 0), 0);
  const totalMessages = summaries.reduce((n, s) => n + (s.analytics?.messagesSent || 0), 0);
  const totalTasks = summaries.reduce((n, s) => n + (s.analytics?.tasksCompleted || 0), 0);
  const surveysCompleted = summaries.reduce((n, s) => n + (s.surveys?.surveysCompleted || 0), 0);

  // Average scores across all completed surveys
  const avgSatisfaction = avgScore(allSurveys, 'satisfaction');
  const avgValue = avgScore(allSurveys, 'value');
  const avgEaseOfUse = avgScore(allSurveys, 'ease_of_use');
  const avgReliability = avgScore(allSurveys, 'reliability');

  // All open feedback text
  const allOpenFeedback = allSurveys
    .filter(s => s.answers?.open_feedback)
    .map(s => ({
      customerName: s.customerName || 'unknown',
      text: s.answers.open_feedback,
      completedAt: s.completedAt,
    }));

  // All bug reports (newest first, limit 50)
  const allBugs = instances.flatMap(inst => {
    try { return loadBugs(inst.instanceDir); } catch { return []; }
  }).sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt)).slice(0, 50);

  // All feature requests (newest first, limit 50)
  const allFeatures = instances.flatMap(inst => {
    try { return loadFeatureRequests(inst.instanceDir); } catch { return []; }
  }).sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt)).slice(0, 50);

  return {
    generatedAt: new Date().toISOString(),
    betaCustomers: instances.length,
    fleet: {
      totalMessages,
      totalTasks,
      totalBugs,
      openBugs,
      totalFeatures,
      surveysCompleted,
      nps: fleetNps,
      avgSatisfaction,
      avgValue,
      avgEaseOfUse,
      avgReliability,
    },
    openFeedback: allOpenFeedback,
    recentBugs: allBugs,
    recentFeatures: allFeatures,
    instances: summaries,
  };
}

// ---------------------------------------------------------------------------
// Text report renderer — for --report CLI flag
// ---------------------------------------------------------------------------

function renderTextReport(report) {
  const lines = [];
  const hr = '─'.repeat(60);

  lines.push('');
  lines.push('YOUR9 BETA REPORT');
  lines.push(`Generated: ${new Date(report.generatedAt).toLocaleString()}`);
  lines.push(hr);

  lines.push('');
  lines.push('FLEET OVERVIEW');
  lines.push(`  Beta customers:    ${report.betaCustomers}`);
  lines.push(`  Total messages:    ${report.fleet.totalMessages}`);
  lines.push(`  Tasks completed:   ${report.fleet.totalTasks}`);
  lines.push(`  Surveys received:  ${report.fleet.surveysCompleted}`);
  lines.push(`  Bugs filed:        ${report.fleet.totalBugs} (${report.fleet.openBugs} open)`);
  lines.push(`  Feature requests:  ${report.fleet.totalFeatures}`);

  lines.push('');
  lines.push('NPS & SCORES');
  const nps = report.fleet.nps;
  lines.push(`  NPS:              ${nps.nps !== null ? nps.nps : 'No data'}`);
  if (nps.responses > 0) {
    lines.push(`  Promoters:        ${nps.promoters} / Passives: ${nps.passives} / Detractors: ${nps.detractors}`);
  }
  lines.push(`  Satisfaction:     ${report.fleet.avgSatisfaction ?? 'No data'}`);
  lines.push(`  Value delivered:  ${report.fleet.avgValue ?? 'No data'}`);
  lines.push(`  Ease of use:      ${report.fleet.avgEaseOfUse ?? 'No data'}`);
  lines.push(`  Reliability:      ${report.fleet.avgReliability ?? 'No data'}`);

  if (report.openFeedback.length > 0) {
    lines.push('');
    lines.push('OPEN FEEDBACK');
    for (const fb of report.openFeedback) {
      lines.push(`  [${fb.customerName}] "${fb.text}"`);
    }
  }

  if (report.recentBugs.length > 0) {
    lines.push('');
    lines.push('RECENT BUGS');
    for (const bug of report.recentBugs.slice(0, 10)) {
      const ts = new Date(bug.reportedAt).toLocaleDateString();
      lines.push(`  [${ts}] [${bug.customerName}] ${bug.id} — ${bug.description.slice(0, 80)}`);
    }
  }

  if (report.recentFeatures.length > 0) {
    lines.push('');
    lines.push('FEATURE REQUESTS');
    for (const feat of report.recentFeatures.slice(0, 10)) {
      const ts = new Date(feat.requestedAt).toLocaleDateString();
      lines.push(`  [${ts}] [${feat.customerName}] ${feat.id} — ${feat.description.slice(0, 80)}`);
    }
  }

  lines.push('');
  lines.push('PER-INSTANCE BREAKDOWN');
  for (const inst of report.instances) {
    if (inst.error) {
      lines.push(`  ${inst.instanceId}: ERROR — ${inst.error}`);
      continue;
    }
    const nps = inst.surveys?.nps?.nps;
    const npsStr = nps !== null && nps !== undefined ? `NPS ${nps}` : 'NPS N/A';
    lines.push(`  ${inst.customerName} (${inst.tier}) — msgs:${inst.analytics?.messagesSent || 0} tasks:${inst.analytics?.tasksCompleted || 0} bugs:${inst.feedback?.bugsTotal || 0} ${npsStr}`);
  }

  lines.push('');
  lines.push(hr);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// HTTP service — port 3492, used by your9-admin.mjs feedback panel
//
// Endpoints (all require token via ?token= or X-Admin-Token header):
//   GET  /api/feedback         — Aggregate report (JSON)
//   GET  /api/feedback/:id     — Per-instance summary (JSON)
//   GET  /health               — No auth required
// ---------------------------------------------------------------------------

const FEEDBACK_PORT = 3492;

function startServer() {
  const rootEnv = loadEnvFile(join(ROOT, '.env'));
  const TOKEN = process.env.YOUR9_ADMIN_TOKEN || rootEnv.YOUR9_ADMIN_TOKEN || null;

  if (!TOKEN) {
    log('WARNING: YOUR9_ADMIN_TOKEN not set — feedback API is unauthenticated. Set it in .env.');
  }

  function isAuthorized(req) {
    if (!TOKEN) return true; // No token configured — open (warn logged above)
    const header = req.headers['x-admin-token'] || '';
    const url = new URL(req.url || '/', `http://127.0.0.1:${FEEDBACK_PORT}`);
    const query = url.searchParams.get('token') || '';
    return header === TOKEN || query === TOKEN;
  }

  function json(res, status, data) {
    const body = JSON.stringify(data, null, 2);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'http://127.0.0.1:3491', // Admin panel only
    });
    res.end(body);
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${FEEDBACK_PORT}`);
    const path = url.pathname;

    if (path === '/health') {
      return json(res, 200, { ok: true, service: 'your9-beta-feedback', port: FEEDBACK_PORT });
    }

    if (!isAuthorized(req)) {
      return json(res, 401, { error: 'Unauthorized — provide X-Admin-Token header or ?token= query param' });
    }

    // Aggregate report
    if (path === '/api/feedback' && req.method === 'GET') {
      try {
        const report = buildBetaReport();
        return json(res, 200, report);
      } catch (e) {
        log(`/api/feedback error: ${e.message}`);
        return json(res, 500, { error: e.message });
      }
    }

    // Per-instance summary — /api/feedback/:instanceId
    const instanceMatch = path.match(/^\/api\/feedback\/(.+)$/);
    if (instanceMatch && req.method === 'GET') {
      const instanceId = instanceMatch[1];
      try {
        const inst = getInstanceById(instanceId);
        const summary = buildInstanceFeedbackSummary(inst.instanceDir, inst.customer);
        return json(res, 200, summary);
      } catch (e) {
        return json(res, 404, { error: e.message });
      }
    }

    return json(res, 404, { error: 'Not found' });
  });

  server.listen(FEEDBACK_PORT, '127.0.0.1', () => {
    log(`Feedback service listening on http://127.0.0.1:${FEEDBACK_PORT}`);
  });

  server.on('error', err => {
    log(`Server error: ${err.message}`);
    process.exit(1);
  });

  return server;
}

// ---------------------------------------------------------------------------
// Admin panel HTML fragment — injects feedback section into your9-admin.mjs
//
// your9-admin.mjs can import buildFeedbackPanelHtml() and include it in the
// dashboard HTML. The fragment fetches from the feedback service on load.
// ---------------------------------------------------------------------------

export function buildFeedbackPanelHtml(adminToken) {
  return `
<!-- ===== FEEDBACK PANEL (your9-beta-feedback.mjs) ===== -->
<div id="panel-feedback" class="panel">
  <div class="section-header">
    <h2>BETA FEEDBACK</h2>
    <div class="actions">
      <span id="fb-refresh-ts" style="color:var(--muted);font-size:10px;"></span>
      <button class="btn sm" onclick="loadFeedback()">Refresh</button>
    </div>
  </div>

  <!-- Fleet NPS + scores -->
  <div class="stat-grid" id="fb-stats">
    <div class="stat-card"><div class="label">NPS Score</div><div class="value" id="fb-nps">--</div><div class="sub" id="fb-nps-sub"></div></div>
    <div class="stat-card"><div class="label">Satisfaction</div><div class="value" id="fb-sat">--</div><div class="sub">avg / 10</div></div>
    <div class="stat-card"><div class="label">Value Delivered</div><div class="value" id="fb-val">--</div><div class="sub">avg / 10</div></div>
    <div class="stat-card"><div class="label">Ease of Use</div><div class="value" id="fb-ease">--</div><div class="sub">avg / 10</div></div>
    <div class="stat-card"><div class="label">Reliability</div><div class="value" id="fb-rel">--</div><div class="sub">avg / 10</div></div>
    <div class="stat-card"><div class="label">Surveys</div><div class="value" id="fb-surveys">--</div><div class="sub">completed</div></div>
    <div class="stat-card"><div class="label">Open Bugs</div><div class="value" id="fb-bugs">--</div><div class="sub" id="fb-bugs-sub"></div></div>
    <div class="stat-card"><div class="label">Feature Requests</div><div class="value" id="fb-feats">--</div><div class="sub">submitted</div></div>
  </div>

  <!-- Per-instance table -->
  <div class="section-header" style="margin-top:20px"><h2>PER CUSTOMER</h2></div>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Customer</th><th>Tier</th><th>Messages</th><th>Tasks</th>
        <th>NPS</th><th>Surveys</th><th>Bugs</th><th>Features</th><th>Last Active</th>
      </tr></thead>
      <tbody id="fb-instances-tbody">
        <tr><td colspan="9" class="empty">Loading...</td></tr>
      </tbody>
    </table>
  </div>

  <!-- Open feedback -->
  <div class="section-header" style="margin-top:20px"><h2>OPEN FEEDBACK</h2></div>
  <div class="alert-log" id="fb-open-feedback">
    <div class="empty">No survey feedback yet.</div>
  </div>

  <!-- Recent bugs -->
  <div class="section-header" style="margin-top:20px"><h2>RECENT BUGS</h2></div>
  <div class="alert-log" id="fb-bug-log">
    <div class="empty">No bugs reported yet.</div>
  </div>

  <!-- Recent feature requests -->
  <div class="section-header" style="margin-top:20px"><h2>FEATURE REQUESTS</h2></div>
  <div class="alert-log" id="fb-feat-log">
    <div class="empty">No feature requests yet.</div>
  </div>
</div>

<script>
(function() {
  const FB_TOKEN = ${JSON.stringify(adminToken)};
  const FB_URL = 'http://127.0.0.1:3492/api/feedback';

  async function loadFeedback() {
    try {
      const res = await fetch(FB_URL + '?token=' + FB_TOKEN);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      renderFeedback(d);
      document.getElementById('fb-refresh-ts').textContent = 'Updated ' + new Date().toLocaleTimeString();
    } catch (e) {
      document.getElementById('fb-instances-tbody').innerHTML =
        '<tr><td colspan="9" class="empty">Feedback service unreachable — is your9-beta-feedback.mjs running on port 3492?</td></tr>';
    }
  }

  function renderFeedback(d) {
    const f = d.fleet || {};
    const nps = f.nps || {};

    // Stats
    document.getElementById('fb-nps').textContent = nps.nps !== null && nps.nps !== undefined ? nps.nps : '--';
    document.getElementById('fb-nps-sub').textContent = nps.responses ? nps.responses + ' responses' : 'No surveys yet';
    document.getElementById('fb-sat').textContent = f.avgSatisfaction ?? '--';
    document.getElementById('fb-val').textContent = f.avgValue ?? '--';
    document.getElementById('fb-ease').textContent = f.avgEaseOfUse ?? '--';
    document.getElementById('fb-rel').textContent = f.avgReliability ?? '--';
    document.getElementById('fb-surveys').textContent = f.surveysCompleted ?? '--';
    document.getElementById('fb-bugs').textContent = f.openBugs ?? '--';
    document.getElementById('fb-bugs-sub').textContent = 'of ' + (f.totalBugs || 0) + ' total';
    document.getElementById('fb-feats').textContent = f.totalFeatures ?? '--';

    // Per-instance table
    const tbody = document.getElementById('fb-instances-tbody');
    if (!d.instances || d.instances.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">No instances found.</td></tr>';
    } else {
      tbody.innerHTML = d.instances.map(inst => {
        if (inst.error) return '<tr><td colspan="9" style="color:var(--red);padding:11px 14px">' + inst.instanceId + ': ' + inst.error + '</td></tr>';
        const npsVal = inst.surveys?.nps?.nps;
        const npsStr = npsVal !== null && npsVal !== undefined ? npsVal : '--';
        const lastAct = inst.analytics?.lastActivity ? new Date(inst.analytics.lastActivity).toLocaleDateString() : '--';
        return '<tr>'
          + '<td>' + (inst.customerName || inst.instanceId) + '</td>'
          + '<td><span class="tier ' + (inst.tier || 'unknown') + '">' + (inst.tier || '--') + '</span></td>'
          + '<td>' + (inst.analytics?.messagesSent || 0) + '</td>'
          + '<td>' + (inst.analytics?.tasksCompleted || 0) + '</td>'
          + '<td>' + npsStr + '</td>'
          + '<td>' + (inst.surveys?.surveysCompleted || 0) + '</td>'
          + '<td>' + (inst.feedback?.bugsOpen || 0) + ' / ' + (inst.feedback?.bugsTotal || 0) + '</td>'
          + '<td>' + (inst.feedback?.featuresTotal || 0) + '</td>'
          + '<td>' + lastAct + '</td>'
          + '</tr>';
      }).join('');
    }

    // Open feedback
    const fbEl = document.getElementById('fb-open-feedback');
    if (!d.openFeedback || d.openFeedback.length === 0) {
      fbEl.innerHTML = '<div class="empty">No survey feedback yet.</div>';
    } else {
      fbEl.innerHTML = d.openFeedback.map(f =>
        '<div class="alert-item info">'
        + '<span class="indicator">FEEDBACK</span>'
        + '<span class="inst">' + f.customerName + '</span>'
        + '<span class="msg">' + f.text + '</span>'
        + '<span class="ts">' + new Date(f.completedAt).toLocaleDateString() + '</span>'
        + '</div>'
      ).join('');
    }

    // Bugs
    const bugEl = document.getElementById('fb-bug-log');
    if (!d.recentBugs || d.recentBugs.length === 0) {
      bugEl.innerHTML = '<div class="empty">No bugs reported yet.</div>';
    } else {
      bugEl.innerHTML = d.recentBugs.slice(0, 20).map(b =>
        '<div class="alert-item error">'
        + '<span class="indicator">BUG</span>'
        + '<span class="inst">' + b.customerName + '</span>'
        + '<span class="msg">' + b.description + '</span>'
        + '<span class="ts">' + new Date(b.reportedAt).toLocaleDateString() + '</span>'
        + '</div>'
      ).join('');
    }

    // Features
    const featEl = document.getElementById('fb-feat-log');
    if (!d.recentFeatures || d.recentFeatures.length === 0) {
      featEl.innerHTML = '<div class="empty">No feature requests yet.</div>';
    } else {
      featEl.innerHTML = d.recentFeatures.slice(0, 20).map(f =>
        '<div class="alert-item warn">'
        + '<span class="indicator">FEATURE</span>'
        + '<span class="inst">' + f.customerName + '</span>'
        + '<span class="msg">' + f.description + '</span>'
        + '<span class="ts">' + new Date(f.requestedAt).toLocaleDateString() + '</span>'
        + '</div>'
      ).join('');
    }
  }

  // Expose globally for sidebar nav and refresh button
  window.loadFeedback = loadFeedback;

  // Auto-load when this panel becomes active
  const origShowPanel = window.showPanel;
  window.showPanel = function(id) {
    origShowPanel && origShowPanel(id);
    if (id === 'feedback') loadFeedback();
  };

  // Auto-refresh every 60s while panel is visible
  setInterval(() => {
    const panel = document.getElementById('panel-feedback');
    if (panel && panel.classList.contains('active')) loadFeedback();
  }, 60000);
})();
</script>
`;
}

// ---------------------------------------------------------------------------
// Main — CLI entrypoint
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  // --serve: run the HTTP feedback service
  if (args.serve) {
    log('Starting Your9 Beta Feedback service...');
    startServer();
    return;
  }

  // --report: print aggregate report to stdout
  if (args.report) {
    const report = buildBetaReport();
    process.stdout.write(renderTextReport(report) + '\n');
    return;
  }

  // --send-survey <id>: force-send survey to a specific instance now
  if (args['send-survey']) {
    const instanceId = args['send-survey'];
    try {
      const inst = getInstanceById(instanceId);
      const env = inst.env;
      const botToken = env.TELEGRAM_BOT_TOKEN;
      const ownerChatId = env.TELEGRAM_OWNER_CHAT_ID;

      if (!botToken || !ownerChatId) {
        console.error(`ERROR: No TELEGRAM_BOT_TOKEN or TELEGRAM_OWNER_CHAT_ID for instance ${instanceId}`);
        process.exit(1);
      }

      // Override shouldTriggerSurvey by directly writing active state
      const surveyId = `survey-${Date.now()}`;
      const state = {
        status: 'active',
        surveyId,
        questionIndex: 0,
        answers: {},
        startedAt: new Date().toISOString(),
        forcedAt: new Date().toISOString(),
      };
      saveSurveyState(inst.instanceDir, state);

      await sendTelegramMessage(botToken, ownerChatId,
        `*You have been using Your9!*\n\nWe have a quick 5-question survey. Takes about 60 seconds.\n\nType /skip at any point to skip.`);
      await new Promise(r => setTimeout(r, 2000));
      await sendTelegramMessage(botToken, ownerChatId, SURVEY_QUESTIONS[0].text);

      console.log(`Survey triggered for ${inst.customer?.name || instanceId}`);
    } catch (e) {
      console.error(`ERROR: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // --instance <id>: per-instance summary
  if (args.instance) {
    const instanceId = args.instance;
    try {
      const inst = getInstanceById(instanceId);
      const summary = buildInstanceFeedbackSummary(inst.instanceDir, inst.customer);
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    } catch (e) {
      console.error(`ERROR: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // Default: show usage
  console.log([
    '',
    'your9-beta-feedback.mjs — Beta Feedback Framework',
    '',
    'Usage:',
    '  node scripts/your9-beta-feedback.mjs --instance <customer-id>   Per-instance summary (JSON)',
    '  node scripts/your9-beta-feedback.mjs --report                   Aggregate beta report (text)',
    '  node scripts/your9-beta-feedback.mjs --send-survey <id>         Force send survey now',
    '  node scripts/your9-beta-feedback.mjs --serve                    Run HTTP service on port 3492',
    '',
    'Analytics stored in:  instances/{id}/data/analytics/',
    'Feedback stored in:   instances/{id}/data/feedback/',
    '',
    'Integration:',
    '  your9-hub.mjs calls handleFeedbackCommand() before routing to CEO',
    '  your9-hub.mjs calls checkAndTriggerSurvey() in each poll loop',
    '  your9-admin.mjs includes buildFeedbackPanelHtml() in the dashboard',
    '',
  ].join('\n'));
}

main().catch(e => {
  log(`Fatal: ${e.message}`);
  process.exit(1);
});
