#!/usr/bin/env node
/**
 * your9-strategy-session.mjs — Weekly 1:1 Strategy Session System
 * Your9 by 9 Enterprises
 *
 * Automates weekly strategy sessions between the founder and their AI CEO.
 * The CEO prepares a data-driven agenda, runs a live Telegram conversation,
 * captures decisions, and converts every agreement into filed agent tasks.
 *
 * Modes:
 *   --prepare   Analyze past week and generate agenda only (no Telegram send).
 *   --start     Send agenda and enter interactive session mode via Telegram.
 *   --notes     View past session notes for this instance.
 *
 * Schedule:
 *   Weekly trigger configurable via STRATEGY_SESSION_DAY and STRATEGY_SESSION_HOUR
 *   in the instance .env (defaults: Monday, 9 AM local time).
 *   Run via cron: 0 9 * * 1 node /path/to/your9-strategy-session.mjs --instance X --start
 *
 * Storage:
 *   Sessions stored in instances/{id}/data/sessions/
 *   Tasks generated from agreements filed in instances/{id}/data/tasks/
 *
 * Usage:
 *   node scripts/your9-strategy-session.mjs --instance <customer-id> --prepare
 *   node scripts/your9-strategy-session.mjs --instance <customer-id> --start
 *   node scripts/your9-strategy-session.mjs --instance <customer-id> --notes
 *   node scripts/your9-strategy-session.mjs --instance <customer-id> --notes --limit 5
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync,
  appendFileSync, readdirSync,
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
const SESSION_LOG = join(ROOT, 'logs', 'your9-strategy-session.log');

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

// Opus for agenda prep (full strategic analysis) and decision synthesis.
// Sonnet for live session conversation (latency matters when founder is waiting).
const OPUS_MODEL = 'claude-opus-4-20250514';
const SONNET_MODEL = 'claude-sonnet-4-6';

// ---------------------------------------------------------------------------
// Session config
// ---------------------------------------------------------------------------

const DEFAULT_SESSION_DAY = 1;   // Monday (0=Sunday)
const DEFAULT_SESSION_HOUR = 9;  // 9 AM
const SESSION_TIMEOUT_MS = 45 * 60 * 1000;     // 45 min max session
const TELEGRAM_POLL_TIMEOUT_S = 25;             // Telegram long-poll timeout
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;        // 10 min idle before session auto-closes
const MAX_AGENDA_ITEMS = 7;

// Statuses we consider "done" for task counting
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'report-delivered', 'published']);
const ACTIVE_STATUSES = new Set(['running', 'researching']);

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
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] STRATEGY: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  try {
    if (!existsSync(join(ROOT, 'logs'))) mkdirSync(join(ROOT, 'logs'), { recursive: true });
    appendFileSync(SESSION_LOG, line + '\n');
  } catch { /* non-fatal */ }
}

function logSection(title) {
  const bar = '='.repeat(60);
  const line = `\n${bar}\n  ${title}\n${bar}`;
  try { process.stdout.write(line + '\n'); } catch {}
  try { appendFileSync(SESSION_LOG, line + '\n'); } catch {}
}

// ---------------------------------------------------------------------------
// .env loader — does not pollute process.env
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
// JSON response parser — strips markdown fencing if present
// ---------------------------------------------------------------------------

function parseJsonResponse(raw, context) {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    throw new Error(`${context}: JSON parse failed — ${e.message}\n\nRaw (first 500 chars):\n${raw.slice(0, 500)}`);
  }
}

// ---------------------------------------------------------------------------
// Raw HTTPS helpers — no SDK dependency, matches all other your9 scripts
// ---------------------------------------------------------------------------

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      res => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); }
          catch (e) { reject(new Error(`JSON parse failed: ${e.message} — body: ${buf.slice(0, 300)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('HTTPS request timed out after 120s')); });
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Anthropic API — raw HTTPS, no SDK
// ---------------------------------------------------------------------------

async function callClaude(anthropicKey, model, systemPrompt, messages, maxTokens = 4096) {
  log(`Calling ${model} (max_tokens: ${maxTokens})`);

  // messages can be an array (multi-turn) or a string (single-turn, converted here)
  const msgArray = typeof messages === 'string'
    ? [{ role: 'user', content: messages }]
    : messages;

  const result = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: msgArray,
    }
  );

  if (result.error) {
    throw new Error(`Anthropic API error: ${result.error.message || JSON.stringify(result.error)}`);
  }

  const text = result.content?.[0]?.text;
  if (!text) {
    throw new Error(`Anthropic returned no content: ${JSON.stringify(result).slice(0, 300)}`);
  }

  log(`Model responded (${text.length} chars)`);
  return text;
}

// ---------------------------------------------------------------------------
// Telegram API helpers
// ---------------------------------------------------------------------------

async function telegramReq(botToken, method, params = {}) {
  const result = await httpsPost('api.telegram.org', `/bot${botToken}/${method}`, {}, params);
  if (result.ok === false) {
    throw new Error(`Telegram ${method} error: ${result.description || JSON.stringify(result)}`);
  }
  return result;
}

async function telegramGetUpdates(botToken, offset) {
  const path = `/bot${botToken}/getUpdates?offset=${offset}&timeout=${TELEGRAM_POLL_TIMEOUT_S}&allowed_updates=["message"]`;
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: 'api.telegram.org', path, method: 'GET' },
      res => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); }
          catch (e) { reject(new Error(`getUpdates parse failed: ${e.message}`)); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout((TELEGRAM_POLL_TIMEOUT_S + 10) * 1000, () => {
      req.destroy();
      resolve({ ok: true, result: [] });
    });
    req.end();
  });
}

async function sendTelegramMessage(botToken, chatId, text) {
  const MAX = 4000;
  const chunks = [];
  let remaining = String(text);
  while (remaining.length > MAX) {
    const boundary = remaining.lastIndexOf('\n', MAX);
    const cut = boundary > 500 ? boundary : MAX;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.trim()) chunks.push(remaining);

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    try {
      await telegramReq(botToken, 'sendMessage', {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
      });
    } catch {
      // Markdown parse failure — retry plain text
      try {
        await telegramReq(botToken, 'sendMessage', { chat_id: chatId, text: chunk });
      } catch (e2) {
        log(`sendMessage failed: ${e2.message}`);
        throw e2;
      }
    }
  }
}

async function sendTypingIndicator(botToken, chatId) {
  try {
    await telegramReq(botToken, 'sendChatAction', { chat_id: chatId, action: 'typing' });
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Instance loader — consistent with planner.mjs pattern
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
  const instanceConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

  const envPath = join(instanceDir, 'config', '.env');
  const env = loadEnvFile(envPath);

  const anthropicKey = (env.ANTHROPIC_API_KEY && !env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER'))
    ? env.ANTHROPIC_API_KEY
    : (process.env.ANTHROPIC_API_KEY || null);

  // Note: anthropicKey is validated at mode entry — not here — so --notes works without a key.

  const botToken = (env.TELEGRAM_BOT_TOKEN && !env.TELEGRAM_BOT_TOKEN.startsWith('PLACEHOLDER'))
    ? env.TELEGRAM_BOT_TOKEN
    : (process.env.TELEGRAM_BOT_TOKEN || null);

  const ownerChatId = (env.TELEGRAM_OWNER_CHAT_ID && !env.TELEGRAM_OWNER_CHAT_ID.startsWith('PLACEHOLDER'))
    ? env.TELEGRAM_OWNER_CHAT_ID
    : (process.env.TELEGRAM_OWNER_CHAT_ID || null);

  // Schedule config — defaults: Monday 9 AM
  const sessionDay = parseInt(env.STRATEGY_SESSION_DAY ?? DEFAULT_SESSION_DAY, 10);
  const sessionHour = parseInt(env.STRATEGY_SESSION_HOUR ?? DEFAULT_SESSION_HOUR, 10);

  // Ensure required data directories exist
  const dirs = ['data/tasks', 'data/sessions', 'data/conversation', 'logs'];
  for (const d of dirs) {
    const full = join(instanceDir, d);
    if (!existsSync(full)) mkdirSync(full, { recursive: true });
  }

  return {
    customerId,
    instanceDir,
    instanceConfig,
    anthropicKey,
    botToken,
    ownerChatId,
    sessionDay,
    sessionHour,
    taskDir: join(instanceDir, 'data', 'tasks'),
    sessionsDir: join(instanceDir, 'data', 'sessions'),
    convDir: join(instanceDir, 'data', 'conversation'),
  };
}

// ---------------------------------------------------------------------------
// Task reader — consistent with planner.mjs
// ---------------------------------------------------------------------------

function readAllTasks(taskDir) {
  if (!existsSync(taskDir)) return [];
  let files;
  try {
    files = readdirSync(taskDir).filter(f => f.endsWith('-task.json')).sort();
  } catch { return []; }

  const tasks = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(taskDir, f), 'utf-8'));
      const tsMatch = f.match(/^(\d+)/);
      tasks.push({ ...raw, _fileTs: tsMatch ? parseInt(tsMatch[1], 10) : 0, _file: f });
    } catch { /* skip malformed */ }
  }
  return tasks;
}

// ---------------------------------------------------------------------------
// Goal reader — loads from initial-reasoning.json + evolved-goals.json
// ---------------------------------------------------------------------------

function loadGoals(instanceDir) {
  const goals = [];

  const reasoningPath = join(instanceDir, 'data', 'initial-reasoning.json');
  if (existsSync(reasoningPath)) {
    try {
      const r = JSON.parse(readFileSync(reasoningPath, 'utf-8'));
      if (Array.isArray(r.goals)) {
        for (const g of r.goals) goals.push({ ...g, source: 'initial-reasoning' });
      }
    } catch { /* non-fatal */ }
  }

  const evolvedPath = join(instanceDir, 'data', 'evolved-goals.json');
  if (existsSync(evolvedPath)) {
    try {
      const evolved = JSON.parse(readFileSync(evolvedPath, 'utf-8'));
      if (Array.isArray(evolved)) {
        for (const eg of evolved) {
          const idx = goals.findIndex(g => g.id === eg.id);
          if (idx >= 0) {
            goals[idx] = { ...goals[idx], ...eg, source: 'evolved' };
          } else {
            goals.push({ ...eg, source: 'evolved' });
          }
        }
      }
    } catch { /* non-fatal */ }
  }

  return goals;
}

// ---------------------------------------------------------------------------
// Conversation reader — last N messages from conversation history JSONL
// ---------------------------------------------------------------------------

function readConversationHistory(convDir, limit = 60) {
  const histPath = join(convDir, 'history.jsonl');
  if (!existsSync(histPath)) return [];
  try {
    const lines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Session file management
// ---------------------------------------------------------------------------

function generateSessionId() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6);
  return `${dateStr}-${rand}`;
}

function getSessionPath(sessionsDir, sessionId) {
  return join(sessionsDir, `${sessionId}-session.json`);
}

function saveSession(sessionsDir, session) {
  const path = getSessionPath(sessionsDir, session.id);
  writeFileSync(path, JSON.stringify(session, null, 2));
  return path;
}

function loadSession(sessionsDir, sessionId) {
  const path = getSessionPath(sessionsDir, sessionId);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

function listSessions(sessionsDir) {
  if (!existsSync(sessionsDir)) return [];
  try {
    return readdirSync(sessionsDir)
      .filter(f => f.endsWith('-session.json'))
      .sort()
      .reverse()
      .map(f => {
        try { return JSON.parse(readFileSync(join(sessionsDir, f), 'utf-8')); } catch { return null; }
      })
      .filter(Boolean);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Task file writer — matches pattern from ceo-reasoning.mjs
// ---------------------------------------------------------------------------

async function writeTaskFile(taskDir, task) {
  if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });
  await new Promise(resolve => setTimeout(resolve, 2)); // ensure unique timestamp
  const timestamp = Date.now();
  const taskPath = join(taskDir, `${timestamp}-${task.agentId || 'executor'}-task.json`);
  const entry = {
    ...task,
    status: 'pending',
    createdBy: 'strategy-session',
    loggedAt: new Date().toISOString(),
  };
  writeFileSync(taskPath, JSON.stringify(entry, null, 2));
  log(`Task written: ${taskPath}`);
  return taskPath;
}

// ---------------------------------------------------------------------------
// Activity data builder — aggregates the past week for agenda preparation
// ---------------------------------------------------------------------------

function buildActivityData(instance, weeksBack = 1) {
  const { taskDir, instanceDir, convDir } = instance;
  const cutoffMs = Date.now() - (weeksBack * 7 * 24 * 60 * 60 * 1000);

  const allTasks = readAllTasks(taskDir);
  const goals = loadGoals(instanceDir);
  const recentConversation = readConversationHistory(convDir, 80);

  // Task stats for the period
  const periodTasks = allTasks.filter(t => (t._fileTs || 0) >= cutoffMs);
  const completedThisPeriod = periodTasks.filter(t => TERMINAL_STATUSES.has((t.status || '').toLowerCase()));
  const pendingAll = allTasks.filter(t => !TERMINAL_STATUSES.has((t.status || '').toLowerCase()));
  const stalledTasks = pendingAll.filter(t => {
    const age = Date.now() - (t._fileTs || 0);
    return age > 7 * 24 * 60 * 60 * 1000;
  });

  // Goal progress
  const goalProgress = goals.map(goal => {
    const goalTasks = allTasks.filter(t => t.goalId === goal.id);
    const total = goalTasks.length;
    const completed = goalTasks.filter(t => TERMINAL_STATUSES.has((t.status || '').toLowerCase())).length;
    const active = goalTasks.filter(t => ACTIVE_STATUSES.has((t.status || '').toLowerCase())).length;
    const pending = total - completed - active;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const recentActivity = goalTasks.filter(t => (t._fileTs || 0) >= cutoffMs);
    return {
      id: goal.id,
      title: goal.title,
      priority: goal.priority,
      successCriteria: goal.successCriteria,
      targetDays: goal.targetDays,
      total,
      completed,
      active,
      pending,
      completionRate: rate,
      recentActivityCount: recentActivity.length,
      stalled: !recentActivity.length && pending > 0,
    };
  });

  // Conversation summary — last N messages
  const conversationSummary = recentConversation.slice(-40).map(m => ({
    role: m.role,
    snippet: (m.content || '').slice(0, 200),
    timestamp: m.timestamp || null,
  }));

  // Proactive scan results (from proactive.mjs if they exist)
  const proactivePath = join(instanceDir, 'data', 'proactive-scan-latest.json');
  let proactiveScan = null;
  if (existsSync(proactivePath)) {
    try { proactiveScan = JSON.parse(readFileSync(proactivePath, 'utf-8')); } catch { /* non-fatal */ }
  }

  return {
    periodDays: weeksBack * 7,
    tasksStartedThisPeriod: periodTasks.length,
    tasksCompletedThisPeriod: completedThisPeriod.length,
    totalPending: pendingAll.length,
    stalledTaskCount: stalledTasks.length,
    stalledTaskSamples: stalledTasks.slice(0, 5).map(t => ({
      title: t.title || t.task || '(no title)',
      goalTitle: t.goalTitle,
      ageDays: Math.floor((Date.now() - (t._fileTs || 0)) / 86400000),
    })),
    goalProgress,
    conversationSummary,
    proactiveScan,
  };
}

// ---------------------------------------------------------------------------
// Agenda preparation — Opus analyzes past week and generates structured agenda
// ---------------------------------------------------------------------------

const AGENDA_SYSTEM_PROMPT = `You are an AI CEO preparing for a weekly 1:1 strategy session with your founder.

Your job is to analyze the past week's activity data, goal progress, conversation history, and any proactive intelligence, then generate a focused, structured agenda for the session.

This is NOT a template. Every agenda item must be grounded in the actual data you receive. You are the CEO — speak with authority, name specific issues, and propose real decisions.

Guiding principles:
- Lead with what matters most. Bury nothing.
- 3-7 agenda items. Quality over quantity.
- Each item should have a clear purpose: inform, decide, or align.
- Flag stalls, risks, and opportunities — not just progress.
- Propose recommendations. The founder makes final calls, but you bring the direction.
- Be direct. No corporate language. No filler.

Output ONLY valid JSON:

{
  "sessionTitle": "Weekly Strategy Session — [Date]",
  "weekSummary": "3-5 sentence honest assessment of the week. What moved? What stalled? What surprised you?",
  "agenda": [
    {
      "itemId": "item-1",
      "type": "decision|inform|align|escalation",
      "title": "Short item title",
      "context": "What happened / what the data shows. Be specific.",
      "ceoPosition": "What the CEO recommends or has done.",
      "openQuestion": "The specific question for the founder, or null if this is inform-only.",
      "urgency": "critical|high|medium",
      "linkedGoalId": "goal-id or null"
    }
  ],
  "proposedDecisions": [
    {
      "decisionId": "dec-1",
      "linkedItemId": "item-id",
      "description": "Decision to be made. One sentence.",
      "options": ["Option A", "Option B"],
      "ceoRecommendation": "Which option and why."
    }
  ],
  "openQuestions": ["Question 1 for the founder to answer during the session"],
  "ceoNote": "One direct sentence from the CEO about where their head is at going into this session."
}`;

async function prepareAgenda(instance, weeksBack = 1) {
  const { anthropicKey, instanceConfig, instanceDir, sessionsDir } = instance;

  logSection('AGENDA PREPARATION');
  log(`Building activity data (last ${weeksBack * 7} days)...`);

  const activityData = buildActivityData(instance, weeksBack);
  log(`Activity: ${activityData.tasksCompletedThisPeriod} completed, ${activityData.totalPending} pending, ${activityData.stalledTaskCount} stalled`);

  const ceoSystemPromptPath = join(instanceDir, 'prompts', 'ceo-system-prompt.md');
  const ceoSystemPrompt = existsSync(ceoSystemPromptPath)
    ? readFileSync(ceoSystemPromptPath, 'utf-8')
    : '';

  const fullSystem = ceoSystemPromptPath
    ? `${AGENDA_SYSTEM_PROMPT}\n\n---\n\n## CEO Personality & Voice\n${ceoSystemPrompt}`
    : AGENDA_SYSTEM_PROMPT;

  const userPrompt = buildAgendaUserPrompt(instanceConfig, activityData, weeksBack);

  log(`Calling Opus for agenda generation...`);
  const raw = await callClaude(anthropicKey, OPUS_MODEL, fullSystem, userPrompt, 8192);

  let agenda;
  try {
    agenda = parseJsonResponse(raw, 'agenda preparation');
  } catch (e) {
    // Write raw for debugging
    const debugPath = join(sessionsDir, `agenda-debug-${Date.now()}.txt`);
    writeFileSync(debugPath, raw);
    throw new Error(`Agenda parse failed: ${e.message}. Raw response saved to ${debugPath}`);
  }

  // Validate structure
  if (!agenda.agenda || !Array.isArray(agenda.agenda) || agenda.agenda.length === 0) {
    throw new Error('Agenda preparation returned no agenda items');
  }

  // Cap agenda items
  if (agenda.agenda.length > MAX_AGENDA_ITEMS) {
    agenda.agenda = agenda.agenda.slice(0, MAX_AGENDA_ITEMS);
  }

  log(`Agenda prepared: ${agenda.agenda.length} items, ${(agenda.proposedDecisions || []).length} proposed decisions`);
  return { agenda, activityData };
}

function buildAgendaUserPrompt(instanceConfig, data, weeksBack) {
  const { name, industry, industryContext } = instanceConfig;
  const weekLabel = weeksBack === 1 ? 'Past 7 days' : `Past ${weeksBack * 7} days`;

  let prompt = `Business: ${name}
Industry: ${industryContext?.label || industry}
Session date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

## ${weekLabel} — Activity Summary

Tasks started this period: ${data.tasksStartedThisPeriod}
Tasks completed this period: ${data.tasksCompletedThisPeriod}
Total pending tasks: ${data.totalPending}
Stalled tasks (7+ days without progress): ${data.stalledTaskCount}`;

  if (data.stalledTaskSamples.length > 0) {
    prompt += `\n\nStalled task samples:`;
    for (const t of data.stalledTaskSamples) {
      prompt += `\n  - "${t.title}" (Goal: ${t.goalTitle || 'unknown'}, Age: ${t.ageDays}d)`;
    }
  }

  if (data.goalProgress.length > 0) {
    prompt += `\n\n## Goal Progress\n`;
    for (const g of data.goalProgress) {
      const stallTag = g.stalled ? ' [STALLED]' : '';
      prompt += `\n[${(g.priority || 'unknown').toUpperCase()}] ${g.title}${stallTag}`;
      prompt += `\n  Progress: ${g.completed}/${g.total} tasks (${g.completionRate}%)`;
      prompt += `\n  Active: ${g.active} | Pending: ${g.pending}`;
      if (g.successCriteria) prompt += `\n  Success criteria: ${g.successCriteria}`;
      if (g.recentActivityCount === 0 && g.pending > 0) prompt += `\n  WARNING: No activity this period`;
    }
  }

  if (data.conversationSummary.length > 0) {
    prompt += `\n\n## Recent Conversation Signals (last ${data.conversationSummary.length} messages)\n`;
    prompt += `(These are snippets — look for recurring themes, founder urgency, pivots, new ideas)\n`;
    for (const m of data.conversationSummary.slice(-20)) {
      const role = m.role === 'user' ? 'FOUNDER' : 'CEO';
      prompt += `\n[${role}]: ${m.snippet.slice(0, 150)}`;
    }
  }

  if (data.proactiveScan) {
    prompt += `\n\n## Proactive Intelligence (from automated scans)\n`;
    prompt += JSON.stringify(data.proactiveScan, null, 2).slice(0, 1500);
  }

  prompt += `\n\nGenerate the weekly strategy session agenda now. Return JSON only. No preamble.`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Agenda formatter — converts the agenda JSON into a Telegram-ready message
// ---------------------------------------------------------------------------

function formatAgendaForTelegram(agenda, instanceConfig) {
  const urgencyMark = { critical: '[CRITICAL]', high: '[HIGH]', medium: '[MEDIUM]' };
  const typeMark = { decision: 'DECIDE:', inform: 'UPDATE:', align: 'ALIGN:', escalation: 'ESCALATE:' };

  let msg = `*${agenda.sessionTitle}*\n`;
  msg += `_${instanceConfig.name}_\n\n`;
  msg += `${agenda.weekSummary}\n\n`;
  msg += `---\n\n`;
  msg += `*Agenda (${agenda.agenda.length} items)*\n\n`;

  for (let i = 0; i < agenda.agenda.length; i++) {
    const item = agenda.agenda[i];
    const mark = urgencyMark[item.urgency] || '';
    const type = typeMark[item.type] || '';
    msg += `*${i + 1}. ${item.title}* ${mark}\n`;
    msg += `${type} ${item.context}\n`;
    if (item.ceoPosition) {
      msg += `CEO position: ${item.ceoPosition}\n`;
    }
    if (item.openQuestion) {
      msg += `Question: _${item.openQuestion}_\n`;
    }
    msg += `\n`;
  }

  if (agenda.openQuestions && agenda.openQuestions.length > 0) {
    msg += `---\n\n*Open questions for this session:*\n`;
    for (const q of agenda.openQuestions) {
      msg += `- ${q}\n`;
    }
    msg += `\n`;
  }

  if (agenda.ceoNote) {
    msg += `---\n\n_CEO note: ${agenda.ceoNote}_\n\n`;
  }

  msg += `---\n`;
  msg += `Reply to start working through the agenda, or ask me to jump to any item.\n`;
  msg += `When we're done, I'll generate session notes and file action items automatically.\n`;
  msg += `_Type "done" or "wrap up" to close the session at any time._`;

  return msg;
}

// ---------------------------------------------------------------------------
// SESSION CONVERSATION SYSTEM PROMPT — used during live session mode
// ---------------------------------------------------------------------------

function buildSessionSystemPrompt(instanceConfig, agenda, sessionTranscript) {
  const ceoVoice = instanceConfig.personalityConfig?.voiceStyle || 'Direct, professional, action-first.';

  const agendaText = agenda.agenda.map((item, i) =>
    `${i + 1}. [${item.type.toUpperCase()}] ${item.title}\n   Context: ${item.context}\n   CEO position: ${item.ceoPosition || 'N/A'}\n   Question: ${item.openQuestion || 'None'}`
  ).join('\n\n');

  const decisionsText = (agenda.proposedDecisions || []).map(d =>
    `- ${d.description} | CEO recommends: ${d.ceoRecommendation}`
  ).join('\n');

  return `You are the AI CEO of ${instanceConfig.name}, running a live weekly strategy session with your founder via Telegram.

## Your voice
${ceoVoice}

## This session's agenda
${agendaText}

${decisionsText ? `## Proposed decisions\n${decisionsText}\n` : ''}

## Session rules
- Work through agenda items in order unless the founder redirects you.
- For decision items: present options, state your recommendation, ask for a clear answer.
- For inform items: give a tight update, check for questions, move on.
- Capture every agreement and decision in your responses explicitly: prefix with "DECISION:" or "AGREED:".
- When you sense all items are covered, or the founder says "done" / "wrap up", say: "SESSION COMPLETE — I'll file the notes now."
- Stay in character. You are the CEO. The founder is your partner.
- Concise. No filler. This is a working session, not a report.
- If the founder raises something outside the agenda, address it and note it for the session notes.

## What you must track
Every time the founder agrees to something, confirms a decision, or assigns a task, output it in this format (inline with your response):
DECISION: [what was decided]
AGREED: [what was agreed — task or commitment]

These will be extracted automatically for the session notes.`;
}

// ---------------------------------------------------------------------------
// Session notes extractor — Opus reads full transcript and extracts structured notes
// ---------------------------------------------------------------------------

const NOTES_EXTRACTION_SYSTEM = `You are extracting session notes from a completed strategy session transcript.

Your job is to produce a clean, structured record of what was decided, agreed, and assigned. This becomes the permanent record for this week.

Output ONLY valid JSON:

{
  "summary": "2-4 sentence summary of the session. What was the key theme? What was the biggest decision?",
  "decisionsLog": [
    {
      "decisionId": "d-1",
      "description": "What was decided.",
      "decidedBy": "founder|ceo|joint",
      "context": "Why this decision was made."
    }
  ],
  "agreementsLog": [
    {
      "agreementId": "a-1",
      "description": "What was agreed.",
      "assignedTo": "executor|mind|voice|founder",
      "dueInDays": 7,
      "linkedGoalId": "goal-id or null"
    }
  ],
  "newTopics": [
    "Any new topics raised outside the original agenda that need follow-up."
  ],
  "founderPriority": "The founder's #1 priority coming out of this session, in one sentence.",
  "nextSessionFocus": "What the CEO should focus the NEXT session on, based on what wasn't covered or what needs a follow-up."
}`;

async function extractSessionNotes(anthropicKey, transcript, agenda, instanceConfig) {
  log('Extracting session notes with Opus...');

  const transcriptText = transcript.map(m =>
    `[${m.role === 'user' ? 'FOUNDER' : 'CEO'}]: ${m.content}`
  ).join('\n\n');

  const userPrompt = `Business: ${instanceConfig.name}
Session date: ${new Date().toLocaleDateString()}

Agenda covered:
${agenda.agenda.map((item, i) => `${i + 1}. ${item.title} (${item.type})`).join('\n')}

Full session transcript:

${transcriptText}

Extract the session notes. Return JSON only.`;

  const raw = await callClaude(anthropicKey, OPUS_MODEL, NOTES_EXTRACTION_SYSTEM, userPrompt, 6144);
  return parseJsonResponse(raw, 'session notes extraction');
}

// ---------------------------------------------------------------------------
// Task generator — turns every agreement into a filed task
// ---------------------------------------------------------------------------

async function generateTasksFromAgreements(taskDir, notes, sessionId, instanceConfig) {
  const { agreementsLog = [] } = notes;
  const taskPaths = [];

  for (const agreement of agreementsLog) {
    // Only generate agent tasks (skip "founder" assignments — those are founder's actions)
    if (agreement.assignedTo === 'founder') continue;

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (agreement.dueInDays || 7));

    const task = {
      agentId: agreement.assignedTo || 'executor',
      title: agreement.description,
      brief: agreement.description,
      goalId: agreement.linkedGoalId || null,
      goalTitle: agreement.linkedGoalId ? `Session agreement (${sessionId})` : null,
      goalPriority: 'high',
      dueInDays: agreement.dueInDays || 7,
      dueDate: dueDate.toISOString(),
      source: 'strategy-session',
      sessionId,
      agreementId: agreement.agreementId,
    };

    const path = await writeTaskFile(taskDir, task);
    taskPaths.push(path);
  }

  log(`Generated ${taskPaths.length} task(s) from ${agreementsLog.length} agreement(s)`);
  return taskPaths;
}

// ---------------------------------------------------------------------------
// Session notes formatter — Telegram-ready summary
// ---------------------------------------------------------------------------

function formatSessionNotesForTelegram(notes, taskPaths, session) {
  const durationMin = session.endedAt
    ? Math.round((new Date(session.endedAt) - new Date(session.startedAt)) / 60000)
    : null;

  let msg = `*Strategy Session Complete*\n`;
  msg += `_${session.instanceConfig?.name || ''} — ${new Date(session.startedAt).toLocaleDateString()}_\n`;
  if (durationMin) msg += `_Duration: ${durationMin} min_\n`;
  msg += `\n${notes.summary}\n\n`;

  if (notes.decisionsLog && notes.decisionsLog.length > 0) {
    msg += `---\n\n*Decisions (${notes.decisionsLog.length})*\n`;
    for (const d of notes.decisionsLog) {
      msg += `\n- ${d.description}`;
      if (d.context) msg += ` _(${d.context.slice(0, 80)})_`;
    }
    msg += `\n`;
  }

  if (notes.agreementsLog && notes.agreementsLog.length > 0) {
    msg += `\n---\n\n*Action Items (${notes.agreementsLog.length})*\n`;
    for (const a of notes.agreementsLog) {
      const agent = a.assignedTo === 'founder' ? 'You' : a.assignedTo;
      const due = a.dueInDays ? ` (${a.dueInDays}d)` : '';
      msg += `\n- [${agent}] ${a.description}${due}`;
    }
    msg += `\n`;
  }

  if (taskPaths.length > 0) {
    msg += `\n---\n\n*${taskPaths.length} task(s) filed to agent queue automatically.*\n`;
  }

  if (notes.founderPriority) {
    msg += `\n---\n\n*Your #1 priority this week:*\n${notes.founderPriority}\n`;
  }

  if (notes.nextSessionFocus) {
    msg += `\n_Next session focus: ${notes.nextSessionFocus}_\n`;
  }

  msg += `\n---\n_Session notes saved. See you next week._`;

  return msg;
}

// ---------------------------------------------------------------------------
// MODE: --prepare — generate agenda only, print to stdout, no Telegram send
// ---------------------------------------------------------------------------

async function runPrepare(instance) {
  logSection(`PREPARE — ${instance.instanceConfig.name}`);
  if (!instance.anthropicKey) {
    throw new Error(`ANTHROPIC_API_KEY required for --prepare mode. Set it in instances/${instance.customerId}/config/.env or environment.`);
  }
  log('Preparing agenda (no Telegram send)...');

  const { agenda, activityData } = await prepareAgenda(instance);

  // Save draft agenda to sessions dir
  const sessionId = generateSessionId();
  const draft = {
    id: sessionId,
    mode: 'prepare',
    status: 'draft',
    instanceConfig: { name: instance.instanceConfig.name, customerId: instance.customerId },
    preparedAt: new Date().toISOString(),
    agenda,
    activityData,
  };
  const draftPath = join(instance.sessionsDir, `${sessionId}-session.json`);
  writeFileSync(draftPath, JSON.stringify(draft, null, 2));
  log(`Draft saved: ${draftPath}`);

  // Print human-readable agenda to stdout
  console.log('\n');
  console.log('='.repeat(60));
  console.log(`  ${agenda.sessionTitle}`);
  console.log('='.repeat(60));
  console.log(`\n${agenda.weekSummary}\n`);
  console.log(`Agenda (${agenda.agenda.length} items):\n`);
  for (let i = 0; i < agenda.agenda.length; i++) {
    const item = agenda.agenda[i];
    console.log(`${i + 1}. [${item.urgency.toUpperCase()}] [${item.type}] ${item.title}`);
    console.log(`   ${item.context}`);
    if (item.ceoPosition) console.log(`   CEO: ${item.ceoPosition}`);
    if (item.openQuestion) console.log(`   ? ${item.openQuestion}`);
    console.log('');
  }
  if (agenda.ceoNote) {
    console.log(`CEO note: ${agenda.ceoNote}`);
  }
  console.log(`\nDraft session ID: ${sessionId}`);
  console.log(`To run the live session: node scripts/your9-strategy-session.mjs --instance ${instance.customerId} --start`);
  console.log('');
}

// ---------------------------------------------------------------------------
// MODE: --start — send agenda via Telegram, run interactive session, file notes
// ---------------------------------------------------------------------------

async function runStart(instance) {
  const { botToken, ownerChatId, anthropicKey, instanceConfig, taskDir, sessionsDir, convDir } = instance;

  if (!anthropicKey) {
    throw new Error(`ANTHROPIC_API_KEY required for --start mode. Set it in instances/${instance.customerId}/config/.env or environment.`);
  }
  if (!botToken || !ownerChatId) {
    throw new Error('Telegram credentials required for --start mode. Set TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_CHAT_ID.');
  }

  logSection(`SESSION START — ${instanceConfig.name}`);

  // --- Step 1: Prepare agenda ---
  log('Preparing agenda...');
  const { agenda, activityData } = await prepareAgenda(instance);

  // --- Step 2: Create session record ---
  const sessionId = generateSessionId();
  const session = {
    id: sessionId,
    mode: 'active',
    status: 'active',
    instanceConfig: { name: instanceConfig.name, customerId: instance.customerId },
    startedAt: new Date().toISOString(),
    agenda,
    activityData,
    transcript: [],
    decisions: [],
    agreements: [],
    notes: null,
    taskPaths: [],
  };
  saveSession(sessionsDir, session);

  // --- Step 3: Send agenda to founder ---
  log('Sending agenda to founder via Telegram...');
  const agendaMsg = formatAgendaForTelegram(agenda, instanceConfig);
  await sendTelegramMessage(botToken, ownerChatId, agendaMsg);
  log('Agenda sent. Entering session conversation mode...');

  // --- Step 4: Interactive Telegram conversation ---
  let telegramOffset = 0;

  // Get current offset to avoid processing old messages
  try {
    const initialUpdates = await telegramGetUpdates(botToken, 0);
    if (initialUpdates.ok && initialUpdates.result.length > 0) {
      const lastId = initialUpdates.result[initialUpdates.result.length - 1].update_id;
      telegramOffset = lastId + 1;
    }
  } catch (e) {
    log(`Initial offset fetch failed (non-fatal): ${e.message}`);
  }

  const sessionMessages = []; // Claude-compatible multi-turn messages
  let sessionActive = true;
  let lastMessageAt = Date.now();
  let sessionStartedAt = Date.now();

  // Send typing indicator to signal we're live
  await sendTypingIndicator(botToken, ownerChatId);

  // Build the CEO's opening message — first agenda item
  const firstItem = agenda.agenda[0];
  const openingMsg = `Let's get into it.\n\n*${agenda.agenda.length === 1 ? 'One item' : `Starting with item 1 of ${agenda.agenda.length}`}: ${firstItem.title}*\n\n${firstItem.context}\n\n${firstItem.ceoPosition ? `My position: ${firstItem.ceoPosition}\n\n` : ''}${firstItem.openQuestion ? `${firstItem.openQuestion}` : ''}`;

  await sendTelegramMessage(botToken, ownerChatId, openingMsg);

  // Track opening as part of transcript
  session.transcript.push({ role: 'assistant', content: openingMsg, timestamp: new Date().toISOString() });
  sessionMessages.push({ role: 'assistant', content: openingMsg });
  saveSession(sessionsDir, session);

  log('Session loop active. Waiting for founder messages...');

  while (sessionActive) {
    // Check timeouts
    const now = Date.now();
    if (now - sessionStartedAt > SESSION_TIMEOUT_MS) {
      log('Session timeout reached (45 min). Closing session.');
      await sendTelegramMessage(botToken, ownerChatId, '_Session timed out after 45 minutes. Filing notes now..._');
      sessionActive = false;
      break;
    }
    if (now - lastMessageAt > IDLE_TIMEOUT_MS) {
      log('Idle timeout reached (10 min). Closing session.');
      await sendTelegramMessage(botToken, ownerChatId, '_Session idle for 10 minutes. Filing notes now..._');
      sessionActive = false;
      break;
    }

    // Poll for new messages
    let updates;
    try {
      updates = await telegramGetUpdates(botToken, telegramOffset);
    } catch (e) {
      log(`Telegram poll error: ${e.message}. Retrying...`);
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    if (!updates.ok) {
      log(`Telegram getUpdates returned not-ok: ${JSON.stringify(updates)}`);
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    const newMessages = (updates.result || []).filter(u => {
      if (!u.message?.text) return false;
      // Only accept messages from the owner's chat
      return String(u.message.chat.id) === String(ownerChatId);
    });

    if (updates.result && updates.result.length > 0) {
      telegramOffset = updates.result[updates.result.length - 1].update_id + 1;
    }

    if (newMessages.length === 0) continue;

    // Process each new message in sequence
    for (const update of newMessages) {
      const founderText = update.message.text.trim();
      log(`Founder message: ${founderText.slice(0, 80)}`);
      lastMessageAt = Date.now();

      // Check for session close signal
      const closeSignals = ['done', 'wrap up', 'wrap it up', 'that\'s all', 'thats all', 'end session', 'close session', 'finish'];
      if (closeSignals.some(s => founderText.toLowerCase().includes(s))) {
        log('Session close signal received.');
        sessionActive = false;

        // Add to transcript
        session.transcript.push({ role: 'user', content: founderText, timestamp: new Date().toISOString() });
        sessionMessages.push({ role: 'user', content: founderText });

        await sendTypingIndicator(botToken, ownerChatId);
        await sendTelegramMessage(botToken, ownerChatId, '_Got it. Wrapping up — extracting session notes now..._');
        break;
      }

      // Add founder message to transcript + conversation context
      session.transcript.push({ role: 'user', content: founderText, timestamp: new Date().toISOString() });
      sessionMessages.push({ role: 'user', content: founderText });

      // Generate CEO response with Sonnet (latency-sensitive in live session)
      await sendTypingIndicator(botToken, ownerChatId);

      const systemPrompt = buildSessionSystemPrompt(instanceConfig, agenda, session.transcript);

      let ceoResponse;
      try {
        ceoResponse = await callClaude(anthropicKey, SONNET_MODEL, systemPrompt, sessionMessages, 2048);
      } catch (e) {
        log(`Claude call failed: ${e.message}`);
        ceoResponse = `Something went wrong on my end — ${e.message}. Continuing session.`;
      }

      // Extract decisions and agreements from response
      const decisionMatches = ceoResponse.match(/DECISION:\s*(.+)/gi) || [];
      const agreedMatches = ceoResponse.match(/AGREED:\s*(.+)/gi) || [];

      for (const dm of decisionMatches) {
        const desc = dm.replace(/^DECISION:\s*/i, '').trim();
        session.decisions.push({ description: desc, timestamp: new Date().toISOString() });
      }
      for (const am of agreedMatches) {
        const desc = am.replace(/^AGREED:\s*/i, '').trim();
        session.agreements.push({ description: desc, timestamp: new Date().toISOString() });
      }

      // Check if CEO signaled session complete
      if (ceoResponse.includes('SESSION COMPLETE')) {
        sessionActive = false;
      }

      // Add to transcript and send
      session.transcript.push({ role: 'assistant', content: ceoResponse, timestamp: new Date().toISOString() });
      sessionMessages.push({ role: 'assistant', content: ceoResponse });

      await sendTelegramMessage(botToken, ownerChatId, ceoResponse);

      // Persist session state after each exchange
      saveSession(sessionsDir, session);

      if (!sessionActive) break;
    }
  }

  // --- Step 5: Extract session notes with Opus ---
  logSection('EXTRACTING SESSION NOTES');
  session.endedAt = new Date().toISOString();
  session.status = 'complete';

  let notes;
  try {
    notes = await extractSessionNotes(anthropicKey, session.transcript, agenda, instanceConfig);
    session.notes = notes;
    log('Notes extracted successfully');
  } catch (e) {
    log(`Notes extraction failed: ${e.message}`);
    // Fallback minimal notes
    notes = {
      summary: `Session completed. ${session.decisions.length} decisions, ${session.agreements.length} agreements.`,
      decisionsLog: session.decisions.map((d, i) => ({ decisionId: `d-${i + 1}`, description: d.description, decidedBy: 'joint', context: '' })),
      agreementsLog: session.agreements.map((a, i) => ({ agreementId: `a-${i + 1}`, description: a.description, assignedTo: 'executor', dueInDays: 7, linkedGoalId: null })),
      newTopics: [],
      founderPriority: '',
      nextSessionFocus: '',
    };
    session.notes = notes;
  }

  // --- Step 6: Generate tasks from agreements ---
  logSection('GENERATING TASKS');
  let taskPaths = [];
  try {
    taskPaths = await generateTasksFromAgreements(taskDir, notes, sessionId, instanceConfig);
    session.taskPaths = taskPaths;
  } catch (e) {
    log(`Task generation failed: ${e.message}`);
  }

  // --- Step 7: Save final session record ---
  saveSession(sessionsDir, session);
  log(`Session saved: ${getSessionPath(sessionsDir, sessionId)}`);

  // --- Step 8: Send session notes to founder ---
  logSection('SENDING SESSION NOTES');
  const notesMsg = formatSessionNotesForTelegram(notes, taskPaths, session);
  try {
    await sendTelegramMessage(botToken, ownerChatId, notesMsg);
    log('Session notes sent to founder');
  } catch (e) {
    log(`Failed to send session notes: ${e.message}`);
  }

  // Summary
  logSection('SESSION COMPLETE');
  console.log('');
  console.log(`  Session ID:      ${sessionId}`);
  console.log(`  Duration:        ${Math.round((new Date(session.endedAt) - new Date(session.startedAt)) / 60000)} min`);
  console.log(`  Transcript:      ${session.transcript.length} messages`);
  console.log(`  Decisions:       ${(notes.decisionsLog || []).length}`);
  console.log(`  Agreements:      ${(notes.agreementsLog || []).length}`);
  console.log(`  Tasks filed:     ${taskPaths.length}`);
  console.log(`  Session file:    ${getSessionPath(sessionsDir, sessionId)}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// MODE: --notes — view past session notes
// ---------------------------------------------------------------------------

function runNotes(instance, limit = 5) {
  const { sessionsDir, instanceConfig } = instance;
  logSection(`SESSION NOTES — ${instanceConfig.name}`);

  const sessions = listSessions(sessionsDir);
  if (sessions.length === 0) {
    console.log('\nNo session records found.\n');
    console.log(`Sessions dir: ${sessionsDir}`);
    console.log(`Run --start to begin a session.\n`);
    return;
  }

  const toShow = sessions.slice(0, Math.max(1, limit));
  console.log(`\nShowing ${toShow.length} of ${sessions.length} session(s):\n`);

  for (const session of toShow) {
    const date = session.startedAt ? new Date(session.startedAt).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }) : 'Unknown date';
    const duration = session.endedAt && session.startedAt
      ? `${Math.round((new Date(session.endedAt) - new Date(session.startedAt)) / 60000)} min`
      : 'N/A';
    const status = session.status || 'unknown';

    console.log(`${'='.repeat(60)}`);
    console.log(`  Session: ${session.id}  |  ${date}`);
    console.log(`  Status: ${status}  |  Duration: ${duration}`);
    console.log(`  Messages: ${session.transcript?.length || 0}  |  Tasks filed: ${session.taskPaths?.length || 0}`);

    if (session.notes?.summary) {
      console.log(`\n  Summary:\n  ${session.notes.summary}\n`);
    }

    if (session.notes?.decisionsLog?.length > 0) {
      console.log(`  Decisions (${session.notes.decisionsLog.length}):`);
      for (const d of session.notes.decisionsLog) {
        console.log(`    - ${d.description}`);
      }
    }

    if (session.notes?.agreementsLog?.length > 0) {
      console.log(`\n  Action Items (${session.notes.agreementsLog.length}):`);
      for (const a of session.notes.agreementsLog) {
        const agent = a.assignedTo === 'founder' ? 'You' : a.assignedTo;
        const due = a.dueInDays ? ` (${a.dueInDays}d)` : '';
        console.log(`    [${agent}] ${a.description}${due}`);
      }
    }

    if (session.notes?.founderPriority) {
      console.log(`\n  Founder priority: ${session.notes.founderPriority}`);
    }

    if (session.notes?.nextSessionFocus) {
      console.log(`  Next session: ${session.notes.nextSessionFocus}`);
    }

    console.log('');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.instance) {
    console.error('Usage: node scripts/your9-strategy-session.mjs --instance <customer-id> --prepare|--start|--notes');
    console.error('');
    console.error('  --prepare   Generate agenda only (no Telegram send)');
    console.error('  --start     Send agenda and run interactive session via Telegram');
    console.error('  --notes     View past session notes');
    console.error('  --limit N   Number of sessions to show in --notes mode (default: 5)');
    process.exit(1);
  }

  // Validate mode
  const mode = args.prepare ? 'prepare' : args.start ? 'start' : args.notes ? 'notes' : null;
  if (!mode) {
    console.error('Specify a mode: --prepare, --start, or --notes');
    process.exit(1);
  }

  const customerId = args.instance;
  let instance;
  try {
    instance = loadInstance(customerId);
  } catch (e) {
    console.error(`Instance load failed: ${e.message}`);
    process.exit(1);
  }

  log(`Mode: ${mode} | Instance: ${customerId} | Business: ${instance.instanceConfig.name}`);

  if (mode === 'prepare') {
    await runPrepare(instance);
  } else if (mode === 'start') {
    await runStart(instance);
  } else if (mode === 'notes') {
    const limit = parseInt(args.limit || '5', 10);
    runNotes(instance, limit);
  }
}

main().catch(err => {
  console.error(`STRATEGY SESSION FAILED: ${err.message}`);
  log(`FATAL: ${err.message}`);
  if (err.stack) log(err.stack);
  process.exit(1);
});
