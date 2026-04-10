#!/usr/bin/env node
/**
 * your9-dashboard.mjs — Founder Transparency Dashboard
 * Your9 by 9 Enterprises
 *
 * A lightweight HTTP dashboard served per-instance. Shows the founder exactly
 * what their AI team is doing in real time: CEO activity, agent status, task
 * pipeline, daily briefing, and velocity score.
 *
 * Read-only. The founder watches. Agents work.
 *
 * Usage:
 *   node scripts/your9-dashboard.mjs --instance <customer-id>
 *   node scripts/your9-dashboard.mjs --instance <customer-id> --port 4200
 *
 * Port default: hub port + 100 (derived the same way your9-hub.mjs does it)
 * Binds to 127.0.0.1 only.
 */

import {
  existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer, request as httpRequest } from 'http';
import { addAgent } from './your9-add-agent.mjs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');

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
// .env loader — reads key=value without polluting process.env
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
// Port derivation — mirrors your9-hub.mjs derivePort, then adds 100
// ---------------------------------------------------------------------------

function deriveHubPort(customerId) {
  let hash = 0;
  for (let i = 0; i < customerId.length; i++) {
    hash = (hash * 31 + customerId.charCodeAt(i)) >>> 0;
  }
  return 4000 + (hash % 900);
}

function deriveDashboardPort(customerId, instanceEnv) {
  let hubPort;
  if (
    instanceEnv.YOUR9_HUB_PORT &&
    !instanceEnv.YOUR9_HUB_PORT.startsWith('PLACEHOLDER_')
  ) {
    hubPort = parseInt(instanceEnv.YOUR9_HUB_PORT);
  } else {
    hubPort = deriveHubPort(customerId);
  }
  return hubPort + 100;
}

// ---------------------------------------------------------------------------
// Data readers — read-only, never write
// ---------------------------------------------------------------------------

function readCustomerConfig(instanceDir) {
  try {
    return JSON.parse(readFileSync(join(instanceDir, 'config', 'customer.json'), 'utf-8'));
  } catch {
    return null;
  }
}

function readCeoConfig(instanceDir) {
  try {
    return JSON.parse(readFileSync(join(instanceDir, 'config', 'ceo.json'), 'utf-8'));
  } catch {
    return null;
  }
}

function readAgentConfigs(instanceDir) {
  const agentsDir = join(instanceDir, 'agents');
  const configs = {};
  if (!existsSync(agentsDir)) return configs;
  try {
    for (const agentId of readdirSync(agentsDir)) {
      const configPath = join(agentsDir, agentId, 'config.json');
      if (existsSync(configPath)) {
        try {
          configs[agentId] = JSON.parse(readFileSync(configPath, 'utf-8'));
        } catch {}
      }
    }
  } catch {}
  return configs;
}

/**
 * Read conversation history from instances/{id}/data/conversations/history.jsonl
 * Returns last N entries, newest-first for the feed.
 */
function readConversationHistory(instanceDir, limit = 50) {
  const histPath = join(instanceDir, 'data', 'conversations', 'history.jsonl');
  if (!existsSync(histPath)) return [];
  try {
    const lines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
    const parsed = lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    return parsed.slice(-limit).reverse(); // newest first
  } catch {
    return [];
  }
}

/**
 * Read task files from instances/{id}/data/tasks/
 * Returns all tasks sorted by creation time, newest-first.
 */
function readTasks(instanceDir) {
  const taskDir = join(instanceDir, 'data', 'tasks');
  if (!existsSync(taskDir)) return [];
  try {
    const files = readdirSync(taskDir)
      .filter(f => f.endsWith('-task.json'))
      .sort()
      .reverse(); // newest first

    return files
      .map(f => {
        try {
          return JSON.parse(readFileSync(join(taskDir, f), 'utf-8'));
        } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Read audit log entries from instances/{id}/data/audit/
 * Each file is a JSON object per decision. Returns newest-first.
 */
function readAuditLog(instanceDir, limit = 100) {
  const auditDir = join(instanceDir, 'data', 'audit');
  if (!existsSync(auditDir)) return [];
  try {
    const files = readdirSync(auditDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse(); // newest first by filename (ISO timestamp prefix)

    const entries = [];
    for (const f of files.slice(0, limit)) {
      try {
        const entry = JSON.parse(readFileSync(join(auditDir, f), 'utf-8'));
        entry._file = f;
        entries.push(entry);
      } catch {}
    }
    return entries;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Founder control writers — write control files that the hub picks up
// ---------------------------------------------------------------------------

/**
 * Read agent state file — instances/{id}/data/agent-states.json
 * Returns { [agentId]: 'paused' | 'running' | 'idle' }
 */
function readAgentStates(instanceDir) {
  const p = join(instanceDir, 'data', 'agent-states.json');
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return {}; }
}

/**
 * Write a control directive for an agent.
 * action: 'pause' | 'resume' | 'override'
 * Writes to instances/{id}/data/controls/{ts}-{agentId}-{action}.json
 * Also updates agent-states.json so the dashboard reflects immediately.
 */
function writeAgentControl(instanceDir, agentId, action, note) {
  const controlsDir = join(instanceDir, 'data', 'controls');
  mkdirSync(controlsDir, { recursive: true });

  const ts = Date.now();
  const filename = `${ts}-${agentId}-${action}.json`;
  const record = {
    type: 'agent_control',
    agentId,
    action,
    note: (note || '').slice(0, 500),
    submittedAt: new Date().toISOString(),
    status: 'pending',
  };
  writeFileSync(join(controlsDir, filename), JSON.stringify(record, null, 2));

  // Update agent-states so dashboard reflects immediately
  const statesPath = join(instanceDir, 'data', 'agent-states.json');
  let states = readAgentStates(instanceDir);
  if (action === 'pause') states[agentId] = 'paused';
  if (action === 'resume') states[agentId] = 'running';
  writeFileSync(statesPath, JSON.stringify(states, null, 2));
}

/**
 * Write a direct instruction to an agent or the CEO.
 * Writes to instances/{id}/data/tasks/{ts}-instruct-task.json
 * Also writes to shared context so all agents see it.
 */
function writeInstruction(instanceDir, targetId, instruction) {
  const tasksDir = join(instanceDir, 'data', 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  const ts = Date.now();
  const taskId = `${ts}-instruct`;
  const task = {
    id: taskId,
    type: 'founder_instruction',
    agentId: targetId,
    task: instruction.slice(0, 4000),
    source: 'founder_dashboard',
    status: 'queued',
    loggedAt: new Date().toISOString(),
  };
  writeFileSync(join(tasksDir, `${taskId}-task.json`), JSON.stringify(task, null, 2));

  // Also write to shared context so hub picks it up via context scan
  const ctxPath = join(instanceDir, 'data', 'shared-context.json');
  let ctx = { lastUpdated: null, entries: {} };
  if (existsSync(ctxPath)) {
    try { ctx = JSON.parse(readFileSync(ctxPath, 'utf-8')); } catch {}
  }
  if (!ctx.entries) ctx.entries = {};
  ctx.entries[`founder_instruction_${ts}`] = {
    value: `Founder instruction to ${targetId}: ${instruction.slice(0, 300)}`,
    writtenBy: 'founder',
    writtenAt: new Date().toISOString(),
  };
  ctx.lastUpdated = new Date().toISOString();
  writeFileSync(ctxPath, JSON.stringify(ctx, null, 2));
}

/**
 * Edit a queued task — replace its task text.
 * Only works on tasks with status 'queued' (cannot edit running/completed).
 */
function editTask(instanceDir, taskId, newTaskText) {
  const tasksDir = join(instanceDir, 'data', 'tasks');
  const taskFile = join(tasksDir, `${taskId}-task.json`);

  if (!existsSync(taskFile)) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const task = JSON.parse(readFileSync(taskFile, 'utf-8'));
  if (task.status !== 'queued') {
    throw new Error(`Cannot edit task with status "${task.status}" — only queued tasks can be edited`);
  }

  task.task = newTaskText.slice(0, 4000);
  task.editedAt = new Date().toISOString();
  task.editedBy = 'founder';
  writeFileSync(taskFile, JSON.stringify(task, null, 2));
}

/**
 * Cancel a queued task — sets status to 'cancelled'.
 * Only works on tasks with status 'queued'.
 */
function cancelTask(instanceDir, taskId) {
  const tasksDir = join(instanceDir, 'data', 'tasks');
  const taskFile = join(tasksDir, `${taskId}-task.json`);

  if (!existsSync(taskFile)) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const task = JSON.parse(readFileSync(taskFile, 'utf-8'));
  if (task.status !== 'queued') {
    throw new Error(`Cannot cancel task with status "${task.status}" — only queued tasks can be cancelled`);
  }

  task.status = 'cancelled';
  task.cancelledAt = new Date().toISOString();
  task.cancelledBy = 'founder';
  writeFileSync(taskFile, JSON.stringify(task, null, 2));
}

/**
 * Write a challenge task to instances/{id}/data/audit/{entryId}-challenge.json
 * The hub picks this up as a pending task for CEO reconsideration.
 */
function writeChallenge(instanceDir, entryId, reason) {
  const auditDir = join(instanceDir, 'data', 'audit');
  mkdirSync(auditDir, { recursive: true });

  const challengeFile = join(auditDir, `${entryId}-challenge.json`);
  const challenge = {
    type: 'founder_challenge',
    originalEntryId: entryId,
    reason: reason.slice(0, 2000), // cap size
    submittedAt: new Date().toISOString(),
    status: 'pending',
  };
  writeFileSync(challengeFile, JSON.stringify(challenge, null, 2), 'utf-8');

  // Also write to tasks dir so the hub picks it up
  const tasksDir = join(instanceDir, 'data', 'tasks');
  mkdirSync(tasksDir, { recursive: true });
  const taskId = `${Date.now()}-challenge`;
  const taskFile = join(tasksDir, `${taskId}-task.json`);
  const task = {
    id: taskId,
    type: 'reconsider',
    agentId: 'ceo',
    task: `Founder challenged decision: ${entryId}. Reason: ${reason.slice(0, 500)}`,
    challengeEntryId: entryId,
    challengeReason: reason.slice(0, 2000),
    status: 'queued',
    loggedAt: new Date().toISOString(),
  };
  writeFileSync(taskFile, JSON.stringify(task, null, 2), 'utf-8');
}

/**
 * Read hub health from the hub HTTP endpoint.
 * Falls back to null if hub is not running.
 */
function readHubHealth(hubPort) {
  return new Promise(resolve => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port: hubPort, path: '/health', method: 'GET' },
      res => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(2000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Velocity score calculation
//
// Simple 0-100 metric based on:
//   - Tasks completed today (up to 40 pts)
//   - Tasks in the last 7 days (up to 30 pts)
//   - Conversation activity today (up to 20 pts)
//   - Agent utilization — how many agents have been used (up to 10 pts)
// ---------------------------------------------------------------------------

function computeVelocityScore(tasks, conversations) {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const completedToday = tasks.filter(t => {
    if (t.status !== 'completed') return false;
    const ts = t.completedAt || t.loggedAt;
    return ts && new Date(ts) >= todayStart;
  }).length;

  const completedWeek = tasks.filter(t => {
    if (t.status !== 'completed') return false;
    const ts = t.completedAt || t.loggedAt;
    return ts && new Date(ts).getTime() >= weekAgo;
  }).length;

  const convoToday = conversations.filter(c => {
    return c.timestamp && new Date(c.timestamp) >= todayStart;
  }).length;

  const agentsUsed = new Set(tasks.map(t => t.agentId).filter(Boolean)).size;
  const totalAgents = Math.max(1, 3); // baseline of 3 starter agents

  const pts =
    Math.min(40, completedToday * 10) +
    Math.min(30, completedWeek * 3) +
    Math.min(20, convoToday * 4) +
    Math.round((agentsUsed / totalAgents) * 10);

  return Math.min(100, pts);
}

// ---------------------------------------------------------------------------
// ROI data builder — computes real value indicators from task + convo data
// ---------------------------------------------------------------------------

/**
 * Time-savings estimate per task complexity tier.
 * "Complexity" is inferred from task description length and keywords.
 * Conservative estimates — these are minimums, not highs.
 */
const COMPLEXITY_HOURS = {
  high: 2.5,    // research, draft, analyze, build, deploy, integrate
  medium: 0.75, // summarize, respond, schedule, review, monitor
  low: 0.25,    // lookup, notify, log, ping, check
};

const HIGH_KEYWORDS = /research|draft|analyz|build|deploy|integrat|implement|creat|design|generat|report|plan|strat/i;
const MED_KEYWORDS  = /summar|respond|schedul|review|monitor|updat|send|follow|compil|prepar/i;

function inferTaskComplexity(task) {
  if (!task) return 'low';
  if (HIGH_KEYWORDS.test(task)) return 'high';
  if (MED_KEYWORDS.test(task)) return 'medium';
  return 'low';
}

/**
 * Classify a task description into a key action category.
 * Returns a short label used in the key actions breakdown.
 */
const ACTION_PATTERNS = [
  { label: 'Emails sent',        re: /\bemail|send.*message|outreach|follow.?up/i },
  { label: 'Research delivered', re: /\bresearch|analyz|investigat|look.?up|find|gather/i },
  { label: 'Content drafted',    re: /\bdraft|writ|creat.*post|content|copy|caption/i },
  { label: 'Reports generated',  re: /\breport|summar|brief|digest/i },
  { label: 'Data processed',     re: /\bdata|import|export|sync|log|parse|extract/i },
  { label: 'Plans created',      re: /\bplan|strateg|roadmap|schedul|agenda/i },
  { label: 'Systems checked',    re: /\bmonitor|check|health|status|verif|test/i },
  { label: 'Responses handled',  re: /\brespond|reply|answer|handle|address/i },
];

function classifyAction(taskDescription) {
  if (!taskDescription) return null;
  for (const { label, re } of ACTION_PATTERNS) {
    if (re.test(taskDescription)) return label;
  }
  return null;
}

/**
 * Generate a Business Impact summary from real data signals.
 * Written as if from the AI CEO perspective — honest, concrete, no fluff.
 */
function generateBusinessImpactSummary(completedToday, timeSavedHours, agentBreakdown, keyActions, businessName) {
  const name = businessName || 'your business';
  const totalActions = Object.values(keyActions).reduce((a, b) => a + b, 0);

  // Zero activity case
  if (completedToday === 0 && totalActions === 0) {
    return `No tasks logged yet today. Your AI team is active and standing by — send a message via Telegram to get work moving.`;
  }

  const lines = [];

  // Time savings headline
  if (timeSavedHours >= 1) {
    lines.push(`Today your AI team saved you an estimated ${timeSavedHours.toFixed(1)} hours of manual work — time you kept for the decisions only a founder can make.`);
  } else if (timeSavedHours > 0) {
    lines.push(`Today your AI team handled ${completedToday} task${completedToday !== 1 ? 's' : ''}, freeing up roughly ${Math.round(timeSavedHours * 60)} minutes.`);
  }

  // What was accomplished
  const actionLabels = Object.entries(keyActions)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${count} ${label.toLowerCase()}`);

  if (actionLabels.length > 0) {
    const summary = actionLabels.slice(0, 3).join(', ');
    lines.push(`Work completed: ${summary}${actionLabels.length > 3 ? `, and ${actionLabels.length - 3} more` : ''}.`);
  }

  // Agent utilization
  const agentNames = Object.keys(agentBreakdown);
  if (agentNames.length > 1) {
    lines.push(`${agentNames.length} agents contributed across different functions — no single point of failure.`);
  } else if (agentNames.length === 1) {
    lines.push(`${agentNames[0]} handled all work today.`);
  }

  // Forward-looking close
  if (completedToday > 0) {
    lines.push(`At this pace: ${(timeSavedHours * 5).toFixed(0)} hours saved this week, ${(timeSavedHours * 22).toFixed(0)} this month.`);
  }

  return lines.join(' ');
}

function computeRoiData(tasks, conversations, customerConfig) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const completedToday = tasks.filter(t => {
    if (t.status !== 'completed') return false;
    const ts = t.completedAt || t.loggedAt;
    return ts && new Date(ts) >= todayStart;
  });

  // Time saved — sum complexity estimates for each completed task
  let timeSavedHours = 0;
  for (const t of completedToday) {
    const complexity = t.complexity || inferTaskComplexity(t.task);
    timeSavedHours += COMPLEXITY_HOURS[complexity] || COMPLEXITY_HOURS.low;
  }

  // Breakdown by agent
  const agentBreakdown = {};
  for (const t of completedToday) {
    const aid = t.agentId || 'ceo';
    agentBreakdown[aid] = (agentBreakdown[aid] || 0) + 1;
  }

  // Key actions tally
  const keyActions = {};
  for (const t of completedToday) {
    const label = classifyAction(t.task);
    if (label) keyActions[label] = (keyActions[label] || 0) + 1;
  }

  // Also scan conversation messages for action keywords (CEO outbound messages)
  const todayConvos = conversations.filter(c => {
    return c.role === 'assistant' && c.timestamp && new Date(c.timestamp) >= todayStart;
  });
  for (const c of todayConvos) {
    const label = classifyAction(c.content?.slice(0, 200));
    if (label) keyActions[label] = (keyActions[label] || 0) + 1;
  }

  const businessName = customerConfig?.name || 'your business';
  const businessImpact = generateBusinessImpactSummary(
    completedToday.length,
    timeSavedHours,
    agentBreakdown,
    keyActions,
    businessName
  );

  return {
    completedToday: completedToday.length,
    timeSavedHours: Math.round(timeSavedHours * 10) / 10, // 1 decimal
    agentBreakdown,
    keyActions,
    businessImpact,
  };
}

// ---------------------------------------------------------------------------
// Billing data readers — read-only, never write
// ---------------------------------------------------------------------------

/**
 * Read billing state from instances/{id}/data/billing.json (written by your9-billing.mjs)
 */
function readBillingData(instanceDir) {
  const p = join(instanceDir, 'data', 'billing.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

/**
 * Read usage analytics from instances/{id}/data/analytics/usage.json (written by your9-beta-feedback.mjs)
 */
function readUsageData(instanceDir) {
  const p = join(instanceDir, 'data', 'analytics', 'usage.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

// Tier definitions mirrored from your9-billing.mjs — used for limit enforcement and comparison.
// Keep in sync with TIERS in your9-billing.mjs.
const BILLING_TIERS = {
  starter: {
    label: 'Starter',
    priceMonthly: 499,
    maxAgents: 3,
    monthlyCallLimit: 100,
    storageGB: 5,
    features: ['3 AI agents', '100 API calls/mo', '5GB storage', 'Telegram channel'],
  },
  growth: {
    label: 'Growth',
    priceMonthly: 999,
    maxAgents: 6,
    monthlyCallLimit: 500,
    storageGB: 25,
    features: ['6 AI agents', '500 API calls/mo', '25GB storage', 'Telegram + Email + Voice'],
  },
  enterprise: {
    label: 'Enterprise',
    priceMonthly: 2499,
    maxAgents: 12,
    monthlyCallLimit: -1, // unlimited
    storageGB: 100,
    features: ['12 AI agents', 'Unlimited API calls', '100GB storage', 'All channels + SMS'],
  },
};

// Action cost table — what each common action type costs in approximate API calls.
// Used to explain to founders what their spend is actually buying.
const ACTION_COSTS = [
  { label: 'Telegram message replied',  calls: 1,  description: 'CEO reads and responds to a single message' },
  { label: 'Research query completed',  calls: 4,  description: 'CEO researches a topic and delivers a brief' },
  { label: 'Email drafted + sent',      calls: 3,  description: 'CEO drafts, reviews, and sends an outbound email' },
  { label: 'Social post drafted',       calls: 2,  description: 'CEO writes a platform-ready social post' },
  { label: 'Task delegated to agent',   calls: 2,  description: 'CEO breaks down a task and assigns it to a specialist' },
  { label: 'Audit log entry recorded',  calls: 1,  description: 'CEO logs a decision with reasoning chain' },
];

/**
 * Compute billing panel data from billing.json + usage.json + tier config.
 * Returns a structured object for the HTML renderer.
 */
function computeBillingPanel(instanceDir, customerConfig) {
  const billing = readBillingData(instanceDir);
  const usage   = readUsageData(instanceDir);

  const tierKey = billing?.tier || customerConfig?.tier || 'starter';
  const tier    = BILLING_TIERS[tierKey] || BILLING_TIERS.starter;

  // Usage this period — prefer billing.json (authoritative), fall back to usage.json
  const apiCallsUsed     = billing?.usage?.apiCalls     ?? usage?.messagesSent        ?? 0;
  const tasksCompleted   = billing?.usage?.tasksCompleted ?? usage?.tasksCompleted     ?? 0;
  const periodStart      = billing?.usage?.periodStart   ?? billing?.currentPeriodStart ?? null;
  const periodEnd        = billing?.usage?.periodEnd     ?? billing?.currentPeriodEnd   ?? null;

  // Monthly call limit (-1 = unlimited)
  const callLimit        = tier.monthlyCallLimit;
  const isUnlimited      = callLimit === -1;
  const callsUsedPct     = isUnlimited ? 0 : Math.min(100, (apiCallsUsed / Math.max(1, callLimit)) * 100);

  // Alert level: 0=ok, 70=warn, 90=critical, 100=at-cap
  const alertLevel = isUnlimited ? 0
    : callsUsedPct >= 100 ? 100
    : callsUsedPct >= 90  ? 90
    : callsUsedPct >= 70  ? 70
    : 0;

  // Projected monthly spend based on daily burn rate
  let projectedMonthlyApiCalls = null;
  if (periodStart && apiCallsUsed > 0) {
    const startTs   = new Date(periodStart).getTime();
    const nowTs     = Date.now();
    const daysIn    = Math.max(1, (nowTs - startTs) / (1000 * 60 * 60 * 24));
    const dailyRate = apiCallsUsed / daysIn;
    projectedMonthlyApiCalls = Math.round(dailyRate * 30);
  }

  // Cost context — projected bill is flat subscription; show what % of their sub is being utilized
  const monthlyPrice = tier.priceMonthly;
  const costPerCall  = isUnlimited ? null : (monthlyPrice / Math.max(1, callLimit));
  const estimatedCallCost = costPerCall !== null
    ? (costPerCall * apiCallsUsed).toFixed(2)
    : null;

  // Daily active breakdown from usage.json
  const dailyActive = usage?.dailyActive || {};
  const dailyEntries = Object.entries(dailyActive)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14); // last 14 days

  // Tier upgrade suggestion
  const tierKeys    = Object.keys(BILLING_TIERS);
  const currentIdx  = tierKeys.indexOf(tierKey);
  const nextTierKey = currentIdx < tierKeys.length - 1 ? tierKeys[currentIdx + 1] : null;
  const nextTier    = nextTierKey ? BILLING_TIERS[nextTierKey] : null;

  // Feature usage from usage.json
  const featureUsage = usage?.featureUsage || {};

  return {
    tier,
    tierKey,
    billing,
    apiCallsUsed,
    tasksCompleted,
    callLimit,
    isUnlimited,
    callsUsedPct,
    alertLevel,
    periodStart,
    periodEnd,
    projectedMonthlyApiCalls,
    monthlyPrice,
    estimatedCallCost,
    dailyEntries,
    nextTier,
    nextTierKey,
    featureUsage,
    actionCosts: ACTION_COSTS,
  };
}

// ---------------------------------------------------------------------------
// Daily briefing builder — synthesizes today's activity into human text
// ---------------------------------------------------------------------------

function buildDailyBriefing(tasks, conversations, customerConfig) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayTasks = tasks.filter(t => {
    const ts = t.loggedAt || t.startedAt;
    return ts && new Date(ts) >= todayStart;
  });

  const completedToday = todayTasks.filter(t => t.status === 'completed');
  const failedToday = todayTasks.filter(t => t.status === 'failed');
  const runningNow = tasks.filter(t => t.status === 'running');

  const convoToday = conversations.filter(c => {
    return c.timestamp && new Date(c.timestamp) >= todayStart;
  });

  const agentsActive = [...new Set(todayTasks.map(t => t.agentId).filter(Boolean))];

  const lines = [];

  if (todayTasks.length === 0 && convoToday.length === 0) {
    lines.push('No activity logged yet today.');
    lines.push('');
    lines.push('Your AI CEO and agents are standing by. Send a message via Telegram to get started.');
  } else {
    // Today's summary
    if (completedToday.length > 0) {
      lines.push(`${completedToday.length} task${completedToday.length > 1 ? 's' : ''} completed today.`);
    }
    if (runningNow.length > 0) {
      lines.push(`${runningNow.length} task${runningNow.length > 1 ? 's' : ''} currently in progress.`);
    }
    if (convoToday.length > 0) {
      lines.push(`${convoToday.length} message${convoToday.length > 1 ? 's' : ''} exchanged with the CEO.`);
    }
    if (agentsActive.length > 0) {
      lines.push(`Active agents today: ${agentsActive.join(', ')}.`);
    }
    if (failedToday.length > 0) {
      lines.push(`${failedToday.length} task${failedToday.length > 1 ? 's' : ''} failed — check the pipeline for details.`);
    }

    lines.push('');

    // Last CEO message as "what's top of mind"
    const lastAssistant = conversations.find(c => c.role === 'assistant');
    if (lastAssistant) {
      const preview = lastAssistant.content.slice(0, 200).replace(/\n+/g, ' ');
      lines.push('Last CEO output:');
      lines.push(preview + (lastAssistant.content.length > 200 ? '...' : ''));
    }
  }

  // Tomorrow placeholder
  lines.push('');
  lines.push('Standing agenda: pipeline review, task delegation, owner check-in.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// HTML renderer — all styles and JS inlined, no external dependencies
// ---------------------------------------------------------------------------

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRelativeTime(isoString) {
  if (!isoString) return '—';
  const diff = Date.now() - new Date(isoString).getTime();
  if (isNaN(diff)) return isoString;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatTimestamp(isoString) {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  } catch { return isoString; }
}

function statusBadge(status) {
  const map = {
    completed: { color: '#22c55e', label: 'Completed' },
    running: { color: '#3b82f6', label: 'Running' },
    failed: { color: '#ef4444', label: 'Failed' },
    queued: { color: '#f59e0b', label: 'Queued' },
    idle: { color: '#64748b', label: 'Idle' },
    active: { color: '#22c55e', label: 'Active' },
    error: { color: '#ef4444', label: 'Error' },
    starting: { color: '#f59e0b', label: 'Starting' },
  };
  const s = map[status] || { color: '#64748b', label: status || 'Unknown' };
  return `<span class="badge" style="background:${s.color}20;color:${s.color};border:1px solid ${s.color}40">${escHtml(s.label)}</span>`;
}

function agentIcon(agentId) {
  const icons = {
    executor: '&#9889;', // lightning bolt
    mind: '&#129504;',  // brain
    voice: '&#128172;', // speech bubble
  };
  return icons[agentId] || '&#129302;'; // robot fallback
}

function velocityColor(score) {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function renderDashboard(data) {
  const {
    customerConfig,
    ceoConfig,
    agentConfigs,
    agentStates,
    conversations,
    tasks,
    auditLog,
    hubHealth,
    velocityScore,
    dailyBriefing,
    roiData,
    billingData,
    dashboardPort,
    hubPort,
    generatedAt,
  } = data;

  const businessName = escHtml(customerConfig?.name || 'Your Business');
  const industry = escHtml(customerConfig?.industryContext?.label || customerConfig?.industry || '');
  const tier = escHtml(customerConfig?.tierConfig?.label || customerConfig?.tier || '');
  const personality = escHtml(customerConfig?.personalityConfig?.label || customerConfig?.personality || '');
  const ceoModel = escHtml(ceoConfig?.model || '');

  // Hub status
  const hubOnline = !!hubHealth;
  const hubStatusColor = hubOnline ? '#22c55e' : '#ef4444';
  const hubStatusLabel = hubOnline ? 'Online' : 'Offline';
  const uptimeStr = hubHealth ? `${Math.round(hubHealth.uptimeSeconds / 60)}m uptime` : '';
  const messagesHandled = hubHealth?.messagesHandled ?? '—';
  const lastActivity = hubHealth?.lastActivity
    ? formatRelativeTime(hubHealth.lastActivity)
    : '—';

  // CEO activity feed — last 20 conversation entries
  const feedItems = conversations.slice(0, 20);

  // Agent panel — infer current status from recent tasks
  const agentIds = Object.keys(agentConfigs);
  const agentStatuses = {};
  for (const aid of agentIds) {
    const recentTask = tasks.find(t => t.agentId === aid);
    if (recentTask?.status === 'running') {
      agentStatuses[aid] = 'running';
    } else if (recentTask?.status === 'completed') {
      agentStatuses[aid] = 'idle';
    } else {
      agentStatuses[aid] = 'idle';
    }
  }

  // Agent cap from tier config
  const maxAgents = customerConfig?.tierConfig?.maxAgents ?? 3;
  const currentAgentCount = agentIds.length;
  const atAgentCap = currentAgentCount >= maxAgents;

  // Pre-built agent library definitions
  const AGENT_LIBRARY = [
    { role: 'Sales Agent',     icon: '&#128200;', description: 'Outbound prospecting, lead follow-up, pipeline tracking, and deal velocity monitoring.' },
    { role: 'Finance Agent',   icon: '&#128181;', description: 'Invoice tracking, expense categorization, budget variance alerts, and cash flow forecasting.' },
    { role: 'Product Agent',   icon: '&#128736;', description: 'Feature backlog management, roadmap coordination, bug triage, and release tracking.' },
    { role: 'Legal Agent',     icon: '&#9878;',   description: 'Regulatory deadline monitoring, policy gap identification, and compliance audit documentation.' },
    { role: 'HR Agent',        icon: '&#128101;', description: 'Hiring pipeline, candidate summaries, onboarding checklists, and team capacity tracking.' },
    { role: 'Marketing Agent', icon: '&#128227;', description: 'Campaign planning, content briefs, performance monitoring, and competitor tracking.' },
  ];

  // Task pipeline — group into active, completed, failed
  const activeTasks = tasks.filter(t => t.status === 'running');
  const completedTasks = tasks.filter(t => t.status === 'completed').slice(0, 10);
  const failedTasks = tasks.filter(t => t.status === 'failed').slice(0, 5);

  // Velocity ring
  const vColor = velocityColor(velocityScore);
  const circumference = 2 * Math.PI * 40; // r=40
  const dashOffset = circumference * (1 - velocityScore / 100);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${businessName} — Your9 Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0f172a;
      --surface: #1e293b;
      --surface2: #263347;
      --border: #334155;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --accent: #6366f1;
      --accent-glow: #6366f130;
      --green: #22c55e;
      --yellow: #f59e0b;
      --red: #ef4444;
      --blue: #3b82f6;
    }

    html, body {
      height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }

    /* ── Layout ── */
    .shell {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      padding: 0 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      height: 56px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .logo {
      font-size: 18px;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: -0.5px;
      white-space: nowrap;
    }

    .logo span {
      color: var(--text-muted);
      font-weight: 400;
      font-size: 13px;
    }

    .business-name {
      font-weight: 600;
      font-size: 15px;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .divider-v { width: 1px; height: 20px; background: var(--border); flex-shrink: 0; }

    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .hub-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot.live { background: var(--green); box-shadow: 0 0 6px var(--green); animation: pulse 2s infinite; }
    .status-dot.offline { background: var(--red); }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .refresh-info {
      font-size: 11px;
      color: var(--text-dim);
    }

    main {
      flex: 1;
      padding: 20px;
      max-width: 1400px;
      width: 100%;
      margin: 0 auto;
    }

    /* ── Grid ── */
    .grid-top {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }

    .grid-bottom {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 16px;
    }

    @media (max-width: 1024px) {
      .grid-top { grid-template-columns: 1fr 1fr; }
      .grid-bottom { grid-template-columns: 1fr; }
    }

    @media (max-width: 640px) {
      .grid-top { grid-template-columns: 1fr; }
      main { padding: 12px; }
    }

    /* ── Cards ── */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 10px;
      border-bottom: 1px solid var(--border);
    }

    .card-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
    }

    .card-body { padding: 16px; }
    .card-body.compact { padding: 10px 16px; }
    .card-body.scroll {
      padding: 0;
      max-height: 420px;
      overflow-y: auto;
    }

    .card-body.scroll::-webkit-scrollbar { width: 4px; }
    .card-body.scroll::-webkit-scrollbar-track { background: transparent; }
    .card-body.scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    /* ── Badge ── */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;
    }

    /* ── Stat blocks ── */
    .stat-row {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }

    .stat {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .stat-value {
      font-size: 22px;
      font-weight: 700;
      color: var(--text);
      line-height: 1;
    }

    .stat-label {
      font-size: 11px;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* ── Velocity ring ── */
    .velocity-wrap {
      display: flex;
      align-items: center;
      gap: 20px;
    }

    .velocity-ring {
      position: relative;
      width: 96px;
      height: 96px;
      flex-shrink: 0;
    }

    .velocity-ring svg {
      transform: rotate(-90deg);
      width: 96px;
      height: 96px;
    }

    .velocity-ring .ring-bg {
      fill: none;
      stroke: var(--border);
      stroke-width: 8;
    }

    .velocity-ring .ring-fill {
      fill: none;
      stroke-width: 8;
      stroke-linecap: round;
      transition: stroke-dashoffset 0.6s ease;
    }

    .velocity-label {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0;
    }

    .velocity-number {
      font-size: 22px;
      font-weight: 700;
      line-height: 1;
    }

    .velocity-unit {
      font-size: 10px;
      color: var(--text-dim);
    }

    .velocity-meta {
      flex: 1;
    }

    .velocity-meta h3 {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 6px;
    }

    .velocity-meta p {
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.5;
    }

    /* ── Agent cards ── */
    .agent-list { display: flex; flex-direction: column; gap: 10px; }

    .agent-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: var(--surface2);
      border-radius: 8px;
      border: 1px solid var(--border);
    }

    .agent-icon {
      font-size: 22px;
      width: 36px;
      text-align: center;
      flex-shrink: 0;
    }

    .agent-info { flex: 1; min-width: 0; }

    .agent-name {
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 2px;
    }

    .agent-role {
      font-size: 11px;
      color: var(--text-dim);
    }

    .agent-model {
      font-size: 10px;
      color: var(--text-dim);
      font-family: 'SF Mono', 'Fira Mono', monospace;
      margin-top: 2px;
    }

    /* ── Activity feed ── */
    .feed-item {
      display: flex;
      gap: 10px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }

    .feed-item:last-child { border-bottom: none; }

    .feed-role {
      flex-shrink: 0;
      width: 56px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding-top: 2px;
    }

    .feed-role.ceo { color: var(--accent); }
    .feed-role.you { color: var(--text-dim); }

    .feed-content {
      flex: 1;
      min-width: 0;
    }

    .feed-text {
      font-size: 13px;
      color: var(--text);
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.5;
    }

    .feed-meta {
      font-size: 11px;
      color: var(--text-dim);
      margin-top: 4px;
    }

    .feed-empty {
      padding: 32px 16px;
      text-align: center;
      color: var(--text-dim);
      font-size: 13px;
    }

    /* ── Task pipeline ── */
    .task-section { padding: 12px 16px; }
    .task-section-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-dim);
      margin-bottom: 8px;
    }

    .task-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
    }

    .task-item:last-child { border-bottom: none; }

    .task-agent-tag {
      flex-shrink: 0;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--accent);
      background: var(--accent-glow);
      padding: 2px 6px;
      border-radius: 4px;
      margin-top: 1px;
    }

    .task-body { flex: 1; min-width: 0; }

    .task-text {
      font-size: 12px;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .task-meta {
      font-size: 11px;
      color: var(--text-dim);
      margin-top: 2px;
    }

    .task-empty {
      padding: 16px 0;
      color: var(--text-dim);
      font-size: 12px;
    }

    /* ── Briefing ── */
    .briefing-text {
      font-size: 13px;
      color: var(--text-muted);
      white-space: pre-wrap;
      line-height: 1.7;
    }

    /* ── Instance meta ── */
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 16px;
    }

    .meta-item { display: flex; flex-direction: column; gap: 2px; }
    .meta-key { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); }
    .meta-val { font-size: 12px; color: var(--text); font-weight: 500; }

    /* ── ROI Panel ── */
    .roi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }

    .roi-stat {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }

    .roi-stat-value {
      font-size: 28px;
      font-weight: 700;
      line-height: 1;
      color: var(--accent);
      margin-bottom: 4px;
    }

    .roi-stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-dim);
    }

    .roi-stat-sub {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    .roi-breakdown {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 14px;
    }

    .roi-breakdown-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
    }

    .roi-breakdown-label {
      color: var(--text-muted);
    }

    .roi-breakdown-val {
      font-weight: 600;
      color: var(--text);
    }

    .roi-agent-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 14px;
    }

    .roi-agent-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: var(--accent-glow);
      border: 1px solid var(--accent)40;
      border-radius: 999px;
      padding: 3px 10px;
      font-size: 11px;
      color: var(--accent);
    }

    .roi-impact {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }

    .roi-impact-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-dim);
      margin-bottom: 8px;
    }

    .roi-impact-text {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.7;
    }

    /* ── Billing Transparency Panel ── */
    .billing-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }

    .billing-stat {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }

    .billing-stat-value {
      font-size: 26px;
      font-weight: 700;
      line-height: 1;
      color: var(--text);
      margin-bottom: 4px;
    }

    .billing-stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-dim);
    }

    .billing-stat-sub {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    /* Usage meter bar */
    .usage-meter-wrap {
      margin-bottom: 16px;
    }

    .usage-meter-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
      font-size: 12px;
    }

    .usage-meter-label {
      color: var(--text-muted);
    }

    .usage-meter-value {
      font-weight: 600;
      color: var(--text);
    }

    .usage-meter-bg {
      height: 8px;
      background: var(--border);
      border-radius: 4px;
      overflow: hidden;
    }

    .usage-meter-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.4s ease;
    }

    .usage-meter-sub {
      margin-top: 5px;
      font-size: 11px;
      color: var(--text-dim);
    }

    /* Alert banner */
    .billing-alert {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      border-radius: 8px;
      padding: 12px 14px;
      font-size: 12px;
      line-height: 1.5;
      margin-bottom: 16px;
    }

    .billing-alert.warn {
      background: #f59e0b18;
      border: 1px solid #f59e0b50;
      color: #f59e0b;
    }

    .billing-alert.critical {
      background: #ef444418;
      border: 1px solid #ef444450;
      color: #ef4444;
    }

    .billing-alert.cap {
      background: #ef444428;
      border: 1px solid #ef4444;
      color: #ef4444;
    }

    .billing-alert-icon {
      font-size: 15px;
      flex-shrink: 0;
      margin-top: 1px;
    }

    /* Action cost table */
    .action-cost-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 16px;
    }

    .action-cost-table th {
      text-align: left;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-dim);
      padding: 0 10px 8px 0;
      border-bottom: 1px solid var(--border);
    }

    .action-cost-table td {
      padding: 8px 10px 8px 0;
      border-bottom: 1px solid var(--border);
      color: var(--text-muted);
      vertical-align: top;
    }

    .action-cost-table tr:last-child td {
      border-bottom: none;
    }

    .action-cost-calls {
      white-space: nowrap;
      font-weight: 600;
      color: var(--accent);
      font-family: 'SF Mono', 'Fira Mono', monospace;
    }

    /* Daily activity sparkline area */
    .billing-daily {
      display: flex;
      align-items: flex-end;
      gap: 3px;
      height: 48px;
      margin-bottom: 4px;
    }

    .billing-daily-bar {
      flex: 1;
      min-width: 4px;
      border-radius: 2px 2px 0 0;
      background: var(--accent);
      opacity: 0.7;
      transition: opacity 0.12s;
      position: relative;
    }

    .billing-daily-bar:hover {
      opacity: 1;
    }

    .billing-daily-label {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: var(--text-dim);
      margin-top: 2px;
    }

    /* Tier comparison table */
    .tier-compare-wrap {
      overflow-x: auto;
      margin-top: 4px;
    }

    .tier-compare-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      min-width: 400px;
    }

    .tier-compare-table th {
      text-align: left;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-dim);
      padding: 0 12px 8px 0;
      border-bottom: 1px solid var(--border);
    }

    .tier-compare-table th.current-tier {
      color: var(--accent);
    }

    .tier-compare-table td {
      padding: 9px 12px 9px 0;
      border-bottom: 1px solid var(--border);
      color: var(--text-muted);
      vertical-align: top;
    }

    .tier-compare-table tr:last-child td {
      border-bottom: none;
    }

    .tier-compare-table td.current-tier {
      color: var(--text);
      font-weight: 600;
    }

    .tier-current-badge {
      display: inline-block;
      background: var(--accent-glow);
      border: 1px solid var(--accent)50;
      color: var(--accent);
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      margin-left: 6px;
      vertical-align: middle;
    }

    .tier-upgrade-note {
      margin-top: 12px;
      font-size: 12px;
      color: var(--text-dim);
      line-height: 1.5;
    }

    .billing-section-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-dim);
      margin-bottom: 10px;
    }

    /* ── Footer ── */
    footer {
      border-top: 1px solid var(--border);
      padding: 10px 20px;
      text-align: center;
      font-size: 11px;
      color: var(--text-dim);
    }

    footer a { color: var(--text-dim); text-decoration: none; }

    /* ── Transparency / Audit layer ── */
    .audit-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }

    .audit-search {
      flex: 1;
      min-width: 160px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 12px;
      padding: 6px 10px;
      outline: none;
    }

    .audit-search:focus {
      border-color: var(--accent);
    }

    .audit-search::placeholder {
      color: var(--text-dim);
    }

    .audit-filter {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 12px;
      padding: 6px 10px;
      outline: none;
    }

    .audit-filter:focus {
      border-color: var(--accent);
    }

    .audit-count {
      font-size: 11px;
      color: var(--text-dim);
      white-space: nowrap;
    }

    .audit-list {
      padding: 0;
      max-height: 560px;
      overflow-y: auto;
    }

    .audit-list::-webkit-scrollbar { width: 4px; }
    .audit-list::-webkit-scrollbar-track { background: transparent; }
    .audit-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    .audit-entry {
      border-bottom: 1px solid var(--border);
    }

    .audit-entry:last-child {
      border-bottom: none;
    }

    .audit-entry-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      cursor: pointer;
      user-select: none;
      transition: background 0.12s;
    }

    .audit-entry-header:hover {
      background: var(--surface2);
    }

    .audit-actor {
      flex-shrink: 0;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      background: var(--accent-glow);
      color: var(--accent);
      border: 1px solid var(--accent)40;
      border-radius: 4px;
      padding: 2px 7px;
    }

    .audit-actor.agent {
      background: #0ea5e920;
      color: #38bdf8;
      border-color: #38bdf840;
    }

    .audit-action-text {
      flex: 1;
      min-width: 0;
      font-size: 13px;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .audit-confidence {
      flex-shrink: 0;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
    }

    .audit-meta-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .audit-timestamp {
      font-size: 11px;
      color: var(--text-dim);
      white-space: nowrap;
    }

    .why-btn {
      background: none;
      border: 1px solid var(--border);
      border-radius: 5px;
      color: var(--text-muted);
      font-size: 11px;
      padding: 2px 8px;
      cursor: pointer;
      transition: border-color 0.12s, color 0.12s;
      white-space: nowrap;
    }

    .why-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
    }

    .audit-expand {
      display: none;
      padding: 0 16px 14px 16px;
      background: var(--surface2);
      border-top: 1px solid var(--border);
    }

    .audit-expand.open {
      display: block;
    }

    .audit-section-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-dim);
      margin: 12px 0 6px;
    }

    .audit-reasoning {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.7;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* Decision tree */
    .decision-tree {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .tree-node {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .tree-connector {
      flex-shrink: 0;
      width: 16px;
      color: var(--text-dim);
      font-family: monospace;
      margin-top: 1px;
    }

    .tree-label {
      flex-shrink: 0;
      font-weight: 600;
      color: var(--text-dim);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      min-width: 72px;
    }

    .tree-value {
      flex: 1;
      color: var(--text);
      font-size: 12px;
    }

    .confidence-bar-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }

    .confidence-bar-bg {
      flex: 1;
      height: 6px;
      background: var(--border);
      border-radius: 3px;
      overflow: hidden;
    }

    .confidence-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.4s ease;
    }

    .confidence-pct {
      font-size: 12px;
      font-weight: 700;
      min-width: 36px;
    }

    /* Sources list */
    .source-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }

    .source-chip {
      font-size: 11px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 2px 8px;
      color: var(--text-muted);
    }

    /* Outcome */
    .outcome-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 999px;
      margin-top: 2px;
    }

    /* Challenge section */
    .challenge-zone {
      margin-top: 14px;
      border-top: 1px solid var(--border);
      padding-top: 12px;
    }

    .challenge-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-dim);
      margin-bottom: 8px;
    }

    .challenge-textarea {
      width: 100%;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 12px;
      padding: 8px 10px;
      resize: vertical;
      min-height: 60px;
      font-family: inherit;
      line-height: 1.5;
      outline: none;
      margin-bottom: 8px;
    }

    .challenge-textarea:focus {
      border-color: #f59e0b;
    }

    .challenge-btn {
      background: #f59e0b20;
      border: 1px solid #f59e0b60;
      border-radius: 6px;
      color: #f59e0b;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 14px;
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s;
    }

    .challenge-btn:hover {
      background: #f59e0b30;
      border-color: #f59e0b;
    }

    .challenge-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .challenge-status {
      display: inline-block;
      margin-left: 10px;
      font-size: 12px;
      color: var(--text-dim);
    }

    .audit-empty {
      padding: 32px 16px;
      text-align: center;
      color: var(--text-dim);
      font-size: 13px;
    }

    /* ── Add Agent Panel ── */
    .add-agent-panel {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .add-agent-section-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-dim);
      margin-bottom: 10px;
    }

    /* Library cards */
    .agent-library {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 10px;
    }

    .library-card {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: border-color 0.15s;
    }

    .library-card:hover {
      border-color: var(--accent);
    }

    .library-card-icon {
      font-size: 20px;
      line-height: 1;
    }

    .library-card-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
    }

    .library-card-desc {
      font-size: 11px;
      color: var(--text-muted);
      line-height: 1.5;
      flex: 1;
    }

    .library-add-btn {
      margin-top: 6px;
      background: var(--accent-glow);
      border: 1px solid var(--accent)60;
      border-radius: 5px;
      color: var(--accent);
      font-size: 12px;
      font-weight: 600;
      padding: 5px 10px;
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s;
      text-align: center;
    }

    .library-add-btn:hover {
      background: var(--accent)30;
      border-color: var(--accent);
    }

    .library-add-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    /* Divider */
    .add-agent-divider {
      border: none;
      border-top: 1px solid var(--border);
    }

    /* Custom role form */
    .add-agent-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .add-agent-form-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .add-agent-field {
      display: flex;
      flex-direction: column;
      gap: 5px;
      flex: 1;
      min-width: 140px;
    }

    .add-agent-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-dim);
    }

    .add-agent-input,
    .add-agent-select {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 13px;
      padding: 8px 10px;
      outline: none;
      font-family: inherit;
      transition: border-color 0.12s;
    }

    .add-agent-input:focus,
    .add-agent-select:focus {
      border-color: var(--accent);
    }

    .add-agent-input::placeholder {
      color: var(--text-dim);
    }

    .add-agent-textarea {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 13px;
      padding: 8px 10px;
      outline: none;
      font-family: inherit;
      resize: vertical;
      min-height: 72px;
      line-height: 1.5;
      transition: border-color 0.12s;
    }

    .add-agent-textarea:focus {
      border-color: var(--accent);
    }

    .add-agent-textarea::placeholder {
      color: var(--text-dim);
    }

    .add-agent-submit-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .add-agent-submit-btn {
      background: var(--accent);
      border: none;
      border-radius: 6px;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      padding: 9px 20px;
      cursor: pointer;
      transition: opacity 0.12s;
    }

    .add-agent-submit-btn:hover {
      opacity: 0.88;
    }

    .add-agent-submit-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .add-agent-status {
      font-size: 13px;
      color: var(--text-dim);
    }

    .add-agent-status.success {
      color: var(--green);
    }

    .add-agent-status.error {
      color: var(--red);
    }

    /* Cap warning */
    .tier-cap-notice {
      background: #f59e0b20;
      border: 1px solid #f59e0b50;
      border-radius: 8px;
      padding: 12px 14px;
      font-size: 12px;
      color: #f59e0b;
    }

    /* ── Founder Control Center ── */
    .control-center {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .control-section-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-dim);
      margin-bottom: 10px;
    }

    /* Agent control rows */
    .ctrl-agent-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .ctrl-agent-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    .ctrl-agent-icon {
      font-size: 18px;
      width: 28px;
      text-align: center;
      flex-shrink: 0;
    }

    .ctrl-agent-name {
      flex: 1;
      font-size: 13px;
      font-weight: 600;
      min-width: 0;
    }

    .ctrl-agent-state {
      font-size: 11px;
      color: var(--text-dim);
      min-width: 50px;
      text-align: right;
    }

    .ctrl-agent-state.paused { color: #f59e0b; }
    .ctrl-agent-state.running { color: var(--green); }

    .ctrl-btn-group {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }

    .ctrl-btn {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 5px;
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s, color 0.12s;
      white-space: nowrap;
    }

    .ctrl-btn:hover { border-color: var(--accent); color: var(--accent); }
    .ctrl-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .ctrl-btn.pause:hover { border-color: #f59e0b; color: #f59e0b; }
    .ctrl-btn.resume:hover { border-color: var(--green); color: var(--green); }
    .ctrl-btn.override:hover { border-color: var(--red); color: var(--red); }

    /* Direct instruction panel */
    .instruct-panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .instruct-target-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .instruct-select {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 13px;
      padding: 8px 10px;
      outline: none;
      font-family: inherit;
      flex: 1;
      min-width: 140px;
      transition: border-color 0.12s;
    }

    .instruct-select:focus { border-color: var(--accent); }

    .instruct-textarea {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 13px;
      padding: 8px 10px;
      outline: none;
      font-family: inherit;
      resize: vertical;
      min-height: 80px;
      line-height: 1.5;
      transition: border-color 0.12s;
    }

    .instruct-textarea:focus { border-color: var(--accent); }
    .instruct-textarea::placeholder { color: var(--text-dim); }

    .instruct-submit-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .instruct-submit-btn {
      background: var(--accent);
      border: none;
      border-radius: 6px;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      padding: 8px 18px;
      cursor: pointer;
      transition: opacity 0.12s;
    }

    .instruct-submit-btn:hover { opacity: 0.88; }
    .instruct-submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .instruct-status {
      font-size: 12px;
      color: var(--text-dim);
    }

    .instruct-status.success { color: var(--green); }
    .instruct-status.error { color: var(--red); }

    /* CEO reconsider */
    .ceo-reconsider-panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .ceo-reconsider-desc {
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.6;
    }

    .ceo-reconsider-btn {
      display: inline-block;
      background: #f59e0b20;
      border: 1px solid #f59e0b60;
      border-radius: 6px;
      color: #f59e0b;
      font-size: 13px;
      font-weight: 600;
      padding: 8px 18px;
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s;
      align-self: flex-start;
    }

    .ceo-reconsider-btn:hover { background: #f59e0b30; border-color: #f59e0b; }
    .ceo-reconsider-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .ceo-reconsider-status {
      font-size: 12px;
      color: var(--text-dim);
    }

    .ceo-reconsider-status.success { color: var(--green); }
    .ceo-reconsider-status.error { color: var(--red); }

    /* Task queue editor */
    .task-queue-editor {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .tqe-empty {
      font-size: 12px;
      color: var(--text-dim);
      padding: 8px 0;
    }

    .tqe-row {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
    }

    .tqe-top {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .tqe-agent {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--accent);
      background: var(--accent-glow);
      padding: 2px 6px;
      border-radius: 4px;
      flex-shrink: 0;
    }

    .tqe-id {
      font-size: 10px;
      color: var(--text-dim);
      font-family: monospace;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tqe-edit-input {
      width: 100%;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 5px;
      color: var(--text);
      font-size: 12px;
      padding: 6px 8px;
      outline: none;
      font-family: inherit;
      resize: vertical;
      min-height: 48px;
      line-height: 1.5;
      margin-bottom: 8px;
      transition: border-color 0.12s;
    }

    .tqe-edit-input:focus { border-color: var(--accent); }

    .tqe-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .tqe-save-btn {
      background: var(--accent-glow);
      border: 1px solid var(--accent)60;
      border-radius: 5px;
      color: var(--accent);
      font-size: 11px;
      font-weight: 600;
      padding: 4px 12px;
      cursor: pointer;
      transition: background 0.12s;
    }

    .tqe-save-btn:hover { background: var(--accent)30; }
    .tqe-save-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .tqe-cancel-btn {
      background: #ef444420;
      border: 1px solid #ef444440;
      border-radius: 5px;
      color: #ef4444;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 12px;
      cursor: pointer;
      transition: background 0.12s;
    }

    .tqe-cancel-btn:hover { background: #ef444430; }
    .tqe-cancel-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .tqe-msg {
      font-size: 11px;
      color: var(--text-dim);
      margin-left: 6px;
    }

    .tqe-msg.success { color: var(--green); }
    .tqe-msg.error { color: var(--red); }

    /* ── Spinner for refresh countdown ── */
    .countdown {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--text-dim);
    }

    .spinner {
      width: 10px;
      height: 10px;
      border: 1.5px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
<div class="shell">

  <header>
    <div class="header-left">
      <div class="logo">Your9 <span>by 9 Enterprises</span></div>
      <div class="divider-v"></div>
      <div class="business-name">${businessName}</div>
    </div>
    <div class="header-right">
      <div class="hub-status">
        <div class="status-dot ${hubOnline ? 'live' : 'offline'}"></div>
        <span>Hub ${hubStatusLabel}</span>
        ${uptimeStr ? `<span style="color:var(--text-dim)">· ${escHtml(uptimeStr)}</span>` : ''}
      </div>
      <div class="divider-v"></div>
      <div class="countdown" id="countdown">
        <div class="spinner"></div>
        <span id="countdown-label">Refreshing in 30s</span>
      </div>
    </div>
  </header>

  <main>

    <!-- Top row: Velocity, Hub Stats, Instance Info -->
    <div class="grid-top">

      <!-- Velocity Score -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Velocity Score</span>
        </div>
        <div class="card-body">
          <div class="velocity-wrap">
            <div class="velocity-ring">
              <svg viewBox="0 0 96 96">
                <circle class="ring-bg" cx="48" cy="48" r="40"/>
                <circle class="ring-fill"
                  cx="48" cy="48" r="40"
                  stroke="${escHtml(vColor)}"
                  stroke-dasharray="${circumference.toFixed(2)}"
                  stroke-dashoffset="${dashOffset.toFixed(2)}"/>
              </svg>
              <div class="velocity-label">
                <span class="velocity-number" style="color:${escHtml(vColor)}">${velocityScore}</span>
                <span class="velocity-unit">/ 100</span>
              </div>
            </div>
            <div class="velocity-meta">
              <h3 style="color:${escHtml(vColor)}">${velocityScore >= 70 ? 'High Velocity' : velocityScore >= 40 ? 'Building Momentum' : 'Getting Started'}</h3>
              <p>Based on tasks completed, conversation activity, and agent utilization today.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Hub Stats -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Activity</span>
          <span style="font-size:11px;color:${hubStatusColor}">${hubStatusLabel}</span>
        </div>
        <div class="card-body">
          <div class="stat-row">
            <div class="stat">
              <span class="stat-value">${escHtml(String(messagesHandled))}</span>
              <span class="stat-label">Messages</span>
            </div>
            <div class="stat">
              <span class="stat-value">${tasks.filter(t => t.status === 'completed').length}</span>
              <span class="stat-label">Tasks Done</span>
            </div>
            <div class="stat">
              <span class="stat-value">${tasks.filter(t => t.status === 'running').length}</span>
              <span class="stat-label">In Progress</span>
            </div>
          </div>
          <div style="margin-top:14px;font-size:12px;color:var(--text-dim)">
            Last activity: <span style="color:var(--text)">${escHtml(lastActivity)}</span>
          </div>
          <div style="margin-top:4px;font-size:12px;color:var(--text-dim)">
            Hub port: <code style="color:var(--text-muted);font-family:monospace">${hubPort}</code>
            &nbsp;·&nbsp;
            Dashboard: <code style="color:var(--text-muted);font-family:monospace">${dashboardPort}</code>
          </div>
        </div>
      </div>

      <!-- Instance Info -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Instance</span>
          ${statusBadge('active')}
        </div>
        <div class="card-body">
          <div class="meta-grid">
            <div class="meta-item">
              <span class="meta-key">Industry</span>
              <span class="meta-val">${industry}</span>
            </div>
            <div class="meta-item">
              <span class="meta-key">Tier</span>
              <span class="meta-val">${tier}</span>
            </div>
            <div class="meta-item">
              <span class="meta-key">Personality</span>
              <span class="meta-val">${personality}</span>
            </div>
            <div class="meta-item">
              <span class="meta-key">CEO Model</span>
              <span class="meta-val" style="font-family:monospace;font-size:11px">${ceoModel}</span>
            </div>
            <div class="meta-item" style="grid-column:1/-1">
              <span class="meta-key">Channels</span>
              <span class="meta-val">${escHtml((customerConfig?.tierConfig?.channels || []).join(', '))}</span>
            </div>
          </div>
        </div>
      </div>

    </div><!-- /grid-top -->

    <!-- Agent status -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <span class="card-title">Agent Team</span>
        <span style="font-size:11px;color:var(--text-dim)">${agentIds.length} agent${agentIds.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="card-body" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
        ${agentIds.length === 0
          ? `<div style="color:var(--text-dim);font-size:12px;padding:8px 0">No agents provisioned.</div>`
          : agentIds.map(aid => {
              const a = agentConfigs[aid];
              const s = agentStatuses[aid] || 'idle';
              return `
              <div class="agent-item">
                <div class="agent-icon">${agentIcon(aid)}</div>
                <div class="agent-info">
                  <div class="agent-name">${escHtml(a.name || aid)}</div>
                  <div class="agent-role">${escHtml(a.role || '')}</div>
                  <div class="agent-model">${escHtml(a.model || '')}</div>
                </div>
                <div>${statusBadge(s)}</div>
              </div>`;
            }).join('')
        }
      </div>
    </div>

    <!-- Founder Control Center -->
    <div class="card" style="margin-bottom:16px" id="control-center-card">
      <div class="card-header">
        <span class="card-title">Founder Controls</span>
        <span style="font-size:11px;color:var(--text-dim)">Pause · Direct · Override</span>
      </div>
      <div class="card-body">
        <div class="control-center">

          <!-- 1. Agent Controls -->
          <div>
            <div class="control-section-label">Agent Controls</div>
            <div class="ctrl-agent-list" id="ctrl-agent-list">
              ${agentIds.length === 0
                ? `<div style="color:var(--text-dim);font-size:12px">No agents provisioned.</div>`
                : agentIds.map(aid => {
                    const a = agentConfigs[aid];
                    const state = agentStates[aid] || 'idle';
                    return `
                    <div class="ctrl-agent-row" id="ctrl-row-${escHtml(aid)}">
                      <div class="ctrl-agent-icon">${agentIcon(aid)}</div>
                      <div class="ctrl-agent-name">${escHtml(a.name || aid)}</div>
                      <div class="ctrl-agent-state ${escHtml(state)}" id="ctrl-state-${escHtml(aid)}">${escHtml(state)}</div>
                      <div class="ctrl-btn-group">
                        <button class="ctrl-btn pause" onclick="sendAgentControl('${escHtml(aid)}', 'pause', this)">Pause</button>
                        <button class="ctrl-btn resume" onclick="sendAgentControl('${escHtml(aid)}', 'resume', this)">Resume</button>
                        <button class="ctrl-btn override" onclick="sendAgentControl('${escHtml(aid)}', 'override', this)">Override</button>
                      </div>
                    </div>`;
                  }).join('')
              }
            </div>
          </div>

          <!-- 2. Direct Instruction Panel -->
          <div>
            <div class="control-section-label">Direct Instruction</div>
            <div class="instruct-panel">
              <div class="instruct-target-row">
                <select id="instruct-target" class="instruct-select" aria-label="Instruction target">
                  <option value="ceo">CEO</option>
                  ${agentIds.map(aid => `<option value="${escHtml(aid)}">${escHtml(agentConfigs[aid]?.name || aid)}</option>`).join('')}
                </select>
              </div>
              <textarea
                id="instruct-text"
                class="instruct-textarea"
                placeholder="Type your instruction here. The selected agent or CEO will act on it immediately..."
                maxlength="4000"
              ></textarea>
              <div class="instruct-submit-row">
                <button class="instruct-submit-btn" id="instruct-submit-btn" onclick="submitInstruction()">Send Instruction</button>
                <span class="instruct-status" id="instruct-status"></span>
              </div>
            </div>
          </div>

          <!-- 3. CEO Reconsider -->
          <div>
            <div class="control-section-label">CEO Reconsider</div>
            <div class="ceo-reconsider-panel">
              <div class="ceo-reconsider-desc">
                Force the AI CEO to reconsider its last decision. The CEO will re-evaluate its most recent action in the audit log and provide a revised assessment. Use this when you disagree with a strategic call.
              </div>
              <textarea
                id="ceo-reconsider-text"
                class="challenge-textarea"
                placeholder="Optional: Explain what you'd like the CEO to reconsider and why..."
                maxlength="2000"
                style="min-height:60px;margin-bottom:8px"
              ></textarea>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <button class="ceo-reconsider-btn" id="ceo-reconsider-btn" onclick="submitCeoReconsider()">Force Reconsideration</button>
                <span class="ceo-reconsider-status" id="ceo-reconsider-status"></span>
              </div>
            </div>
          </div>

          <!-- 4. Task Queue Editor -->
          <div>
            <div class="control-section-label">Task Queue Editor — Queued Tasks</div>
            <div class="task-queue-editor" id="task-queue-editor">
              ${(() => {
                const queued = tasks.filter(t => t.status === 'queued');
                if (queued.length === 0) {
                  return `<div class="tqe-empty">No tasks queued. Queued tasks appear here and can be edited or cancelled before they execute.</div>`;
                }
                return queued.map((t, qi) => {
                  const safeId = escHtml(t.id || '');
                  return `
                  <div class="tqe-row" id="tqe-${qi}">
                    <div class="tqe-top">
                      <div class="tqe-agent">${escHtml(t.agentId || 'ceo')}</div>
                      <div class="tqe-id">${safeId}</div>
                      ${statusBadge('queued')}
                    </div>
                    <textarea
                      class="tqe-edit-input"
                      id="tqe-text-${qi}"
                      data-taskid="${safeId}"
                    >${escHtml(t.task || '')}</textarea>
                    <div class="tqe-actions">
                      <button class="tqe-save-btn" onclick="saveTaskEdit('${safeId}', ${qi})">Save Edit</button>
                      <button class="tqe-cancel-btn" onclick="cancelQueuedTask('${safeId}', ${qi})">Cancel Task</button>
                      <span class="tqe-msg" id="tqe-msg-${qi}"></span>
                    </div>
                  </div>`;
                }).join('');
              })()}
            </div>
          </div>

        </div>
      </div>
    </div>

    <!-- Add Agent Panel -->
    <div class="card" style="margin-bottom:16px" id="add-agent-card">
      <div class="card-header">
        <span class="card-title">Add Agent</span>
        <span style="font-size:11px;color:var(--text-dim)">${currentAgentCount} / ${maxAgents} agents${atAgentCap ? ' — tier cap reached' : ''}</span>
      </div>
      <div class="card-body">
        <div class="add-agent-panel">

          ${atAgentCap ? `
          <div class="tier-cap-notice">
            Your ${escHtml(tier)} tier allows up to ${maxAgents} agent${maxAgents !== 1 ? 's' : ''}. You have ${currentAgentCount} active.
            Upgrade your tier to add more agents.
          </div>
          ` : `

          <!-- Pre-built library -->
          <div>
            <div class="add-agent-section-label">Quick Add — Common Roles</div>
            <div class="agent-library" id="agent-library">
              ${AGENT_LIBRARY.map(lib => `
              <div class="library-card">
                <div class="library-card-icon">${lib.icon}</div>
                <div class="library-card-name">${escHtml(lib.role)}</div>
                <div class="library-card-desc">${escHtml(lib.description)}</div>
                <button
                  class="library-add-btn"
                  onclick="addLibraryAgent(${JSON.stringify(escHtml(lib.role))}, ${JSON.stringify(escHtml(lib.description))}, this)"
                >+ Add</button>
              </div>`).join('')}
            </div>
          </div>

          <hr class="add-agent-divider">

          <!-- Custom role form -->
          <div>
            <div class="add-agent-section-label">Custom Role</div>
            <div class="add-agent-form" id="add-agent-form">
              <div class="add-agent-form-row">
                <div class="add-agent-field" style="flex:2">
                  <label class="add-agent-label" for="aa-role">Role Name</label>
                  <input
                    type="text"
                    id="aa-role"
                    class="add-agent-input"
                    placeholder="e.g. Operations Manager"
                    maxlength="60"
                    autocomplete="off"
                  >
                </div>
                <div class="add-agent-field">
                  <label class="add-agent-label" for="aa-personality">Personality</label>
                  <select id="aa-personality" class="add-agent-select">
                    <option value="direct">Direct</option>
                    <option value="analytical">Analytical</option>
                    <option value="collaborative">Collaborative</option>
                    <option value="visionary">Visionary</option>
                    <option value="supportive">Supportive</option>
                  </select>
                </div>
              </div>
              <div class="add-agent-field">
                <label class="add-agent-label" for="aa-description">Description</label>
                <textarea
                  id="aa-description"
                  class="add-agent-textarea"
                  placeholder="What does this agent do? Be specific — this shapes its behavior."
                  maxlength="500"
                ></textarea>
              </div>
              <div class="add-agent-submit-row">
                <button class="add-agent-submit-btn" id="aa-submit-btn" onclick="submitCustomAgent()">
                  Add Agent
                </button>
                <span class="add-agent-status" id="aa-status"></span>
              </div>
            </div>
          </div>
          `}

        </div>
      </div>
    </div>

    <!-- ROI / Business Impact Panel -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <span class="card-title">ROI &amp; Business Impact</span>
        <span style="font-size:11px;color:var(--text-dim)">Today</span>
      </div>
      <div class="card-body">

        <!-- Four headline stats -->
        <div class="roi-grid">
          <div class="roi-stat">
            <div class="roi-stat-value">${roiData.timeSavedHours >= 1
              ? roiData.timeSavedHours.toFixed(1) + 'h'
              : Math.round(roiData.timeSavedHours * 60) + 'm'}</div>
            <div class="roi-stat-label">Time Saved</div>
            <div class="roi-stat-sub">est. founder hours recovered</div>
          </div>
          <div class="roi-stat">
            <div class="roi-stat-value">${roiData.completedToday}</div>
            <div class="roi-stat-label">Tasks Done</div>
            <div class="roi-stat-sub">completed by AI team today</div>
          </div>
          <div class="roi-stat">
            <div class="roi-stat-value">${Object.values(roiData.keyActions).reduce((a, b) => a + b, 0)}</div>
            <div class="roi-stat-label">Key Actions</div>
            <div class="roi-stat-sub">emails, research, drafts &amp; more</div>
          </div>
          <div class="roi-stat">
            <div class="roi-stat-value">${Object.keys(roiData.agentBreakdown).length || '—'}</div>
            <div class="roi-stat-label">Agents Active</div>
            <div class="roi-stat-sub">contributing agents today</div>
          </div>
        </div>

        ${Object.keys(roiData.keyActions).length > 0 ? `
        <!-- Key Actions breakdown -->
        <div style="margin-bottom:6px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)">Actions Breakdown</div>
        <div class="roi-breakdown">
          ${Object.entries(roiData.keyActions)
            .sort((a, b) => b[1] - a[1])
            .map(([label, count]) => `
          <div class="roi-breakdown-row">
            <span class="roi-breakdown-label">${escHtml(label)}</span>
            <span class="roi-breakdown-val">${count}</span>
          </div>`).join('')}
        </div>` : ''}

        ${Object.keys(roiData.agentBreakdown).length > 0 ? `
        <!-- Agent contribution chips -->
        <div style="margin-bottom:6px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)">Agent Contributions</div>
        <div class="roi-agent-chips">
          ${Object.entries(roiData.agentBreakdown)
            .sort((a, b) => b[1] - a[1])
            .map(([aid, count]) => `
          <div class="roi-agent-chip">
            ${agentIcon(aid)} ${escHtml(agentConfigs[aid]?.name || aid)} &middot; ${count} task${count !== 1 ? 's' : ''}
          </div>`).join('')}
        </div>` : ''}

        <!-- AI CEO Business Impact summary -->
        <div class="roi-impact">
          <div class="roi-impact-label">Business Impact — AI CEO Assessment</div>
          <div class="roi-impact-text">${escHtml(roiData.businessImpact)}</div>
        </div>

      </div>
    </div>

    <!-- Billing Transparency Panel -->
    ${(() => {
      const bd = billingData;
      if (!bd) return '';

      // Alert banner
      const alertBanner = (bd.alertLevel >= 70 && !bd.isUnlimited) ? (() => {
        const lvl = bd.alertLevel;
        const cls = lvl >= 100 ? 'cap' : lvl >= 90 ? 'critical' : 'warn';
        const icon = lvl >= 100 ? '&#9940;' : lvl >= 90 ? '&#9888;' : '&#8505;';
        const remaining = Math.max(0, bd.callLimit - bd.apiCallsUsed).toLocaleString();
        const msg = lvl >= 100
          ? 'You have reached your ' + bd.tier.label + ' tier API call limit (' + bd.callLimit.toLocaleString() + ' calls/mo). New calls may be blocked. Upgrade to continue without interruption.'
          : lvl >= 90
          ? 'You are at ' + Math.round(bd.callsUsedPct) + '% of your ' + bd.tier.label + ' tier limit (' + bd.apiCallsUsed.toLocaleString() + ' / ' + bd.callLimit.toLocaleString() + ' calls). Consider upgrading before the period ends.'
          : 'You are at ' + Math.round(bd.callsUsedPct) + '% of your ' + bd.tier.label + ' tier API call limit. You have ' + remaining + ' calls remaining this period.';
        return '<div class="billing-alert ' + cls + '"><span class="billing-alert-icon">' + icon + '</span><span>' + msg + '</span></div>';
      })() : '';

      // Usage meter color
      const meterColor = bd.alertLevel >= 90 ? '#ef4444' : bd.alertLevel >= 70 ? '#f59e0b' : '#6366f1';

      // Daily sparkline
      const maxDailyVal = Math.max(1, ...bd.dailyEntries.map(function(e) { return e[1]; }));
      const sparklineHtml = bd.dailyEntries.length > 0 ? (
        '<div class="billing-section-label" style="margin-top:16px">Daily Activity \u2014 Last ' + bd.dailyEntries.length + ' Days</div>' +
        '<div class="billing-daily">' +
          bd.dailyEntries.map(function(e) {
            const h = Math.max(4, Math.round((e[1] / maxDailyVal) * 100));
            return '<div class="billing-daily-bar" style="height:' + h + '%" title="' + escHtml(e[0]) + ': ' + e[1] + ' msgs"></div>';
          }).join('') +
        '</div>' +
        '<div class="billing-daily-label"><span>' + escHtml(bd.dailyEntries[0][0]) + '</span><span>' + escHtml(bd.dailyEntries[bd.dailyEntries.length - 1][0]) + '</span></div>'
      ) : '';

      // Action costs rows
      const actionCostRows = bd.actionCosts.map(function(a) {
        return '<tr><td>' + escHtml(a.label) + '</td><td class="action-cost-calls">' + a.calls + ' call' + (a.calls !== 1 ? 's' : '') + '</td><td style="color:var(--text-dim)">' + escHtml(a.description) + '</td></tr>';
      }).join('');

      // Tier comparison
      const tierKeys = Object.keys(BILLING_TIERS);
      const tierHeaderCells = tierKeys.map(function(k) {
        const isCurrent = k === bd.tierKey;
        return '<th class="' + (isCurrent ? 'current-tier' : '') + '">' + escHtml(BILLING_TIERS[k].label) + (isCurrent ? '<span class="tier-current-badge">Current</span>' : '') + '</th>';
      }).join('');

      const compareRows = [
        { label: 'Price / mo',   fmt: function(t) { return '$' + t.priceMonthly.toLocaleString(); } },
        { label: 'AI agents',    fmt: function(t) { return String(t.maxAgents); } },
        { label: 'API calls/mo', fmt: function(t) { return t.monthlyCallLimit === -1 ? 'Unlimited' : t.monthlyCallLimit.toLocaleString(); } },
        { label: 'Storage',      fmt: function(t) { return t.storageGB + 'GB'; } },
        { label: 'Channels',     fmt: function(t) { return t.features[t.features.length - 1]; } },
      ];
      const tierDataRows = compareRows.map(function(row) {
        return '<tr><td style="color:var(--text-dim);font-weight:600">' + escHtml(row.label) + '</td>' +
          tierKeys.map(function(k) {
            const isCurrent = k === bd.tierKey;
            return '<td class="' + (isCurrent ? 'current-tier' : '') + '">' + escHtml(row.fmt(BILLING_TIERS[k])) + '</td>';
          }).join('') + '</tr>';
      }).join('');

      // Build HTML
      const periodEndStr = bd.periodEnd
        ? ' \xb7 Period ends ' + new Date(bd.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '';
      const projectedStat = (bd.projectedMonthlyApiCalls !== null && !bd.isUnlimited)
        ? '<div class="billing-stat"><div class="billing-stat-value" style="color:' + meterColor + '">' + bd.projectedMonthlyApiCalls.toLocaleString() + '</div><div class="billing-stat-label">Projected API Calls</div><div class="billing-stat-sub">at current daily rate</div></div>'
        : '';
      const upgradeLine = bd.nextTier
        ? '<div class="tier-upgrade-note">Upgrading to <strong style="color:var(--text)">' + escHtml(bd.nextTier.label) + '</strong> adds ' + (bd.nextTier.maxAgents - bd.tier.maxAgents) + ' more AI agents, ' + (bd.nextTier.monthlyCallLimit === -1 ? 'unlimited API calls' : (bd.nextTier.monthlyCallLimit - bd.tier.monthlyCallLimit).toLocaleString() + ' more API calls/mo') + ', and ' + (bd.nextTier.storageGB - bd.tier.storageGB) + 'GB additional storage for $' + (bd.nextTier.priceMonthly - bd.tier.priceMonthly).toLocaleString() + '/mo more. Contact your account manager to upgrade.</div>'
        : '<div class="tier-upgrade-note" style="color:var(--accent)">You are on the Enterprise plan \u2014 the highest tier. All features are included.</div>';

      return '<div class="card" style="margin-bottom:16px" id="billing-panel">' +
        '<div class="card-header">' +
          '<span class="card-title">Billing &amp; Usage Transparency</span>' +
          '<span style="font-size:11px;color:var(--text-dim)">' + escHtml(bd.tier.label) + ' Plan \u2014 $' + bd.monthlyPrice.toLocaleString() + '/mo</span>' +
        '</div>' +
        '<div class="card-body">' +
          alertBanner +
          '<div class="billing-grid">' +
            '<div class="billing-stat"><div class="billing-stat-value">' + bd.apiCallsUsed.toLocaleString() + '</div><div class="billing-stat-label">API Calls Used</div><div class="billing-stat-sub">' + (bd.isUnlimited ? 'Unlimited plan' : 'of ' + bd.callLimit.toLocaleString() + ' this period') + '</div></div>' +
            '<div class="billing-stat"><div class="billing-stat-value">' + bd.tasksCompleted.toLocaleString() + '</div><div class="billing-stat-label">Tasks Completed</div><div class="billing-stat-sub">this billing period</div></div>' +
            '<div class="billing-stat"><div class="billing-stat-value">$' + bd.monthlyPrice.toLocaleString() + '</div><div class="billing-stat-label">Monthly Subscription</div><div class="billing-stat-sub">flat rate \u2014 no overages</div></div>' +
            projectedStat +
          '</div>' +
          (!bd.isUnlimited
            ? '<div class="usage-meter-wrap">' +
                '<div class="usage-meter-header"><span class="usage-meter-label">API Call Usage \u2014 This Period</span><span class="usage-meter-value">' + Math.round(bd.callsUsedPct) + '%</span></div>' +
                '<div class="usage-meter-bg"><div class="usage-meter-fill" style="width:' + Math.min(100, bd.callsUsedPct).toFixed(1) + '%;background:' + meterColor + '"></div></div>' +
                '<div class="usage-meter-sub">' + bd.apiCallsUsed.toLocaleString() + ' used \xb7 ' + Math.max(0, bd.callLimit - bd.apiCallsUsed).toLocaleString() + ' remaining' + periodEndStr + '</div>' +
              '</div>' +
              '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:16px;font-size:11px;color:var(--text-dim)">' +
                '<span><span style="color:#6366f1;font-weight:600">0\u201369%</span> Normal</span>' +
                '<span><span style="color:#f59e0b;font-weight:600">70\u201389%</span> Warning</span>' +
                '<span><span style="color:#ef4444;font-weight:600">90\u201399%</span> Critical</span>' +
                '<span><span style="color:#ef4444;font-weight:600">100%</span> At cap</span>' +
              '</div>'
            : '<div style="margin-bottom:16px;padding:10px 14px;background:var(--accent-glow);border:1px solid var(--accent)30;border-radius:8px;font-size:12px;color:var(--accent)">Enterprise plan \u2014 unlimited API calls. No usage limits apply.</div>') +
          sparklineHtml +
          '<div class="billing-section-label" style="margin-top:' + (bd.dailyEntries.length > 0 ? '16px' : '0') + '">What Each Action Costs</div>' +
          '<div style="overflow-x:auto"><table class="action-cost-table"><thead><tr><th>Action</th><th>API Calls</th><th>What Happens</th></tr></thead><tbody>' + actionCostRows + '</tbody></table></div>' +
          '<div class="billing-section-label" style="margin-top:20px">Tier Comparison</div>' +
          '<div class="tier-compare-wrap"><table class="tier-compare-table"><thead><tr><th>Feature</th>' + tierHeaderCells + '</tr></thead><tbody>' + tierDataRows + '</tbody></table></div>' +
          upgradeLine +
        '</div></div>';
    })()}

    <!-- Transparency & Audit Layer -->
    <div class="card" style="margin-bottom:16px" id="audit-card">
      <div class="card-header">
        <span class="card-title">Transparency &amp; Audit Log</span>
        <span style="font-size:11px;color:var(--text-dim)" id="audit-visible-count">${auditLog.length} decision${auditLog.length !== 1 ? 's' : ''}</span>
      </div>

      <div class="audit-toolbar">
        <input
          type="search"
          class="audit-search"
          id="audit-search"
          placeholder="Search decisions, actions, reasoning..."
          aria-label="Search audit log"
        >
        <select class="audit-filter" id="audit-actor-filter" aria-label="Filter by actor">
          <option value="">All actors</option>
          <option value="ceo">CEO</option>
          <option value="agent">Agent</option>
        </select>
        <select class="audit-filter" id="audit-outcome-filter" aria-label="Filter by outcome">
          <option value="">All outcomes</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
          <option value="challenged">Challenged</option>
        </select>
        <span class="audit-count" id="audit-count-label"></span>
      </div>

      <div class="audit-list" id="audit-list">
        ${auditLog.length === 0
          ? `<div class="audit-empty">No audit entries yet. Decisions made by the AI CEO and agents will appear here automatically.<br>
             <br>To seed an entry for testing, create a JSON file in <code>instances/{id}/data/audit/</code> with fields:<br>
             <code>timestamp, actor, action, reasoning, confidence, sources, outcome</code></div>`
          : auditLog.map((entry, idx) => {
              const entryId = entry.id || entry._file?.replace('.json', '') || `entry-${idx}`;
              const actor = entry.actor || 'ceo';
              const actorLabel = actor === 'ceo' ? 'CEO' : (entry.agentId || actor);
              const action = entry.action || '—';
              const confidence = typeof entry.confidence === 'number' ? entry.confidence : null;
              const confidencePct = confidence !== null ? Math.round(confidence * 100) : null;
              const confColor = confidencePct === null ? '#64748b'
                : confidencePct >= 75 ? '#22c55e'
                : confidencePct >= 50 ? '#f59e0b'
                : '#ef4444';
              const reasoning = entry.reasoning || '';
              const sources = Array.isArray(entry.sources) ? entry.sources : (entry.sources ? [entry.sources] : []);
              const outcome = entry.outcome || '';
              const outcomeColor = outcome === 'success' ? '#22c55e'
                : outcome === 'failed' ? '#ef4444'
                : outcome === 'challenged' ? '#f59e0b'
                : '#64748b';
              const ts = entry.timestamp || '';

              // Decision tree nodes — inferred from entry fields
              const treeNodes = [];
              if (entry.trigger) treeNodes.push({ label: 'Trigger', value: entry.trigger });
              if (entry.options && Array.isArray(entry.options)) {
                treeNodes.push({ label: 'Options', value: entry.options.join(' / ') });
              }
              if (entry.chosen !== undefined) treeNodes.push({ label: 'Chosen', value: String(entry.chosen) });
              if (entry.rationale) treeNodes.push({ label: 'Rationale', value: entry.rationale });

              return `
              <div class="audit-entry"
                   data-actor="${escHtml(actor)}"
                   data-outcome="${escHtml(outcome)}"
                   data-searchtext="${escHtml((action + ' ' + reasoning + ' ' + sources.join(' ')).toLowerCase())}">

                <div class="audit-entry-header" onclick="toggleAudit('ae-${idx}')">
                  <div class="audit-actor ${actor !== 'ceo' ? 'agent' : ''}">${escHtml(actorLabel)}</div>
                  <div class="audit-action-text" title="${escHtml(action)}">${escHtml(action)}</div>
                  ${confidencePct !== null ? `
                  <div class="audit-confidence" style="background:${confColor}20;color:${confColor};border:1px solid ${confColor}40">
                    ${confidencePct}%
                  </div>` : ''}
                  <div class="audit-meta-row">
                    <span class="audit-timestamp">${escHtml(formatRelativeTime(ts))}</span>
                    <button class="why-btn" onclick="event.stopPropagation();toggleAudit('ae-${idx}')">Why?</button>
                  </div>
                </div>

                <div class="audit-expand" id="ae-${idx}">

                  <!-- Reasoning chain -->
                  ${reasoning ? `
                  <div class="audit-section-label">Reasoning Chain</div>
                  <div class="audit-reasoning">${escHtml(reasoning)}</div>` : ''}

                  <!-- Decision tree -->
                  ${(treeNodes.length > 0 || confidencePct !== null) ? `
                  <div class="audit-section-label">Decision Tree</div>
                  <div class="decision-tree">
                    ${treeNodes.map((n, ni) => `
                    <div class="tree-node">
                      <span class="tree-connector">${ni === treeNodes.length - 1 ? '└─' : '├─'}</span>
                      <span class="tree-label">${escHtml(n.label)}</span>
                      <span class="tree-value">${escHtml(n.value)}</span>
                    </div>`).join('')}
                    ${confidencePct !== null ? `
                    <div class="tree-node" style="margin-top:8px;flex-direction:column;gap:4px">
                      <span class="tree-label">Confidence</span>
                      <div class="confidence-bar-wrap">
                        <div class="confidence-bar-bg">
                          <div class="confidence-bar-fill"
                               style="width:${confidencePct}%;background:${confColor}">
                          </div>
                        </div>
                        <span class="confidence-pct" style="color:${confColor}">${confidencePct}%</span>
                      </div>
                    </div>` : ''}
                  </div>` : ''}

                  <!-- Sources -->
                  ${sources.length > 0 ? `
                  <div class="audit-section-label">Sources Used</div>
                  <div class="source-chips">
                    ${sources.map(s => `<span class="source-chip">${escHtml(String(s))}</span>`).join('')}
                  </div>` : ''}

                  <!-- Outcome -->
                  ${outcome ? `
                  <div class="audit-section-label">Outcome</div>
                  <span class="outcome-badge" style="background:${outcomeColor}20;color:${outcomeColor};border:1px solid ${outcomeColor}40">
                    ${escHtml(outcome)}
                  </span>` : ''}

                  <!-- Challenge section -->
                  <div class="challenge-zone">
                    <div class="challenge-label">Challenge This Decision</div>
                    <textarea
                      class="challenge-textarea"
                      id="challenge-text-${idx}"
                      placeholder="Explain why you disagree with this decision. The CEO will reconsider and respond..."
                    ></textarea>
                    <button
                      class="challenge-btn"
                      id="challenge-btn-${idx}"
                      onclick="submitChallenge('${escHtml(entryId)}', ${idx})"
                    >Push Back</button>
                    <span class="challenge-status" id="challenge-status-${idx}"></span>
                  </div>

                </div>
              </div>`;
            }).join('')
        }
      </div>
    </div>

    <!-- Bottom: Feed + Pipeline/Briefing -->
    <div class="grid-bottom">

      <!-- CEO Activity Feed -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">CEO Activity Feed</span>
          <span style="font-size:11px;color:var(--text-dim)">${conversations.length} entries · live</span>
        </div>
        <div class="card-body scroll">
          ${feedItems.length === 0
            ? `<div class="feed-empty">No conversations yet. Send a message via Telegram to get started.</div>`
            : feedItems.map(entry => {
                const isCeo = entry.role === 'assistant';
                const preview = entry.content
                  ? entry.content.slice(0, 400) + (entry.content.length > 400 ? '...' : '')
                  : '';
                return `
                <div class="feed-item">
                  <div class="feed-role ${isCeo ? 'ceo' : 'you'}">${isCeo ? 'CEO' : 'You'}</div>
                  <div class="feed-content">
                    <div class="feed-text">${escHtml(preview)}</div>
                    <div class="feed-meta">${formatRelativeTime(entry.timestamp)}</div>
                  </div>
                </div>`;
              }).join('')
          }
        </div>
      </div>

      <!-- Right column: Pipeline + Briefing -->
      <div style="display:flex;flex-direction:column;gap:16px">

        <!-- Task Pipeline -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Task Pipeline</span>
            <span style="font-size:11px;color:var(--text-dim)">${tasks.length} total</span>
          </div>
          <div class="card-body scroll" style="max-height:280px">
            ${activeTasks.length > 0 ? `
            <div class="task-section">
              <div class="task-section-label">In Progress</div>
              ${activeTasks.map(t => `
              <div class="task-item">
                <div class="task-agent-tag">${escHtml(t.agentId || '?')}</div>
                <div class="task-body">
                  <div class="task-text">${escHtml(t.task || '—')}</div>
                  <div class="task-meta">Started ${formatRelativeTime(t.startedAt)}</div>
                </div>
                ${statusBadge('running')}
              </div>`).join('')}
            </div>` : ''}

            ${completedTasks.length > 0 ? `
            <div class="task-section">
              <div class="task-section-label">Completed</div>
              ${completedTasks.map(t => `
              <div class="task-item">
                <div class="task-agent-tag">${escHtml(t.agentId || '?')}</div>
                <div class="task-body">
                  <div class="task-text">${escHtml(t.task || '—')}</div>
                  <div class="task-meta">${formatRelativeTime(t.completedAt || t.loggedAt)}</div>
                </div>
                ${statusBadge('completed')}
              </div>`).join('')}
            </div>` : ''}

            ${failedTasks.length > 0 ? `
            <div class="task-section">
              <div class="task-section-label">Failed</div>
              ${failedTasks.map(t => `
              <div class="task-item">
                <div class="task-agent-tag">${escHtml(t.agentId || '?')}</div>
                <div class="task-body">
                  <div class="task-text">${escHtml(t.task || '—')}</div>
                  <div class="task-meta">${escHtml(t.error?.slice(0, 60) || '')} · ${formatRelativeTime(t.failedAt || t.loggedAt)}</div>
                </div>
                ${statusBadge('failed')}
              </div>`).join('')}
            </div>` : ''}

            ${tasks.length === 0 ? `
            <div class="task-section">
              <div class="task-empty">No tasks yet. Your AI team is standing by.</div>
            </div>` : ''}
          </div>
        </div>

        <!-- Daily Briefing -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Daily Briefing</span>
            <span style="font-size:11px;color:var(--text-dim)">${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          </div>
          <div class="card-body">
            <div class="briefing-text">${escHtml(dailyBriefing)}</div>
          </div>
        </div>

      </div><!-- /right column -->

    </div><!-- /grid-bottom -->

  </main>

  <footer>
    Your9 by 9 Enterprises &nbsp;·&nbsp; Read-only founder view &nbsp;·&nbsp;
    Generated ${escHtml(generatedAt)} &nbsp;·&nbsp;
    <a href="javascript:location.reload()">Refresh now</a>
  </footer>

</div><!-- /shell -->

<script>
  // Auto-refresh countdown — reloads every 30 seconds
  (function() {
    var INTERVAL = 30;
    var remaining = INTERVAL;
    var label = document.getElementById('countdown-label');

    function tick() {
      remaining--;
      if (remaining <= 0) {
        location.reload();
        return;
      }
      if (label) label.textContent = 'Refreshing in ' + remaining + 's';
      setTimeout(tick, 1000);
    }

    setTimeout(tick, 1000);
  })();

  // ── Transparency / Audit layer JS ──────────────────────────────────────────

  // Toggle expand/collapse for a single audit entry
  function toggleAudit(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('open');
  }

  // Filter + search the audit list
  (function() {
    var searchEl = document.getElementById('audit-search');
    var actorEl = document.getElementById('audit-actor-filter');
    var outcomeEl = document.getElementById('audit-outcome-filter');
    var countEl = document.getElementById('audit-count-label');
    var list = document.getElementById('audit-list');

    if (!searchEl || !list) return;

    function applyFilters() {
      var q = searchEl.value.toLowerCase().trim();
      var actor = actorEl ? actorEl.value : '';
      var outcome = outcomeEl ? outcomeEl.value : '';
      var entries = list.querySelectorAll('.audit-entry');
      var visible = 0;

      entries.forEach(function(entry) {
        var matchSearch = !q || (entry.dataset.searchtext || '').indexOf(q) !== -1;
        var matchActor = !actor || (entry.dataset.actor || '') === actor;
        var matchOutcome = !outcome || (entry.dataset.outcome || '') === outcome;
        var show = matchSearch && matchActor && matchOutcome;
        entry.style.display = show ? '' : 'none';
        if (show) visible++;
      });

      if (countEl) {
        countEl.textContent = visible + ' of ' + entries.length + ' shown';
      }
    }

    if (searchEl) searchEl.addEventListener('input', applyFilters);
    if (actorEl) actorEl.addEventListener('change', applyFilters);
    if (outcomeEl) outcomeEl.addEventListener('change', applyFilters);

    // Init count label
    applyFilters();
  })();

  // ── Add Agent JS ──────────────────────────────────────────────────────────

  // Shared POST helper for /add-agent endpoint
  function postAddAgent(role, description, personality, onSuccess, onError, onFinally) {
    fetch('/add-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: role, description: description, personality: personality }),
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) {
          onSuccess(data);
        } else {
          onError(data.error || 'Failed to add agent.');
        }
      })
      .catch(function(e) {
        onError('Network error. Check connection and try again.');
      })
      .finally(function() {
        if (onFinally) onFinally();
      });
  }

  // Inject a new agent card into the agent team panel without a full page reload
  function injectAgentCard(agentName, role, model) {
    var list = document.querySelector('#add-agent-card').closest('main').querySelector('.card .card-body[style*="grid"]');
    if (!list) return;
    var card = document.createElement('div');
    card.className = 'agent-item';
    card.innerHTML =
      '<div class="agent-icon">&#129302;</div>' +
      '<div class="agent-info">' +
        '<div class="agent-name">' + agentName + '</div>' +
        '<div class="agent-role">' + role + '</div>' +
        '<div class="agent-model">' + (model || '') + '</div>' +
      '</div>' +
      '<span class="badge" style="background:#22c55e20;color:#22c55e;border:1px solid #22c55e40">Idle</span>';
    list.appendChild(card);

    // Update agent count label in agent team card header
    var teamCountEl = list.closest('.card').querySelector('.card-header span:last-child');
    if (teamCountEl) {
      var current = list.querySelectorAll('.agent-item').length;
      teamCountEl.textContent = current + ' agent' + (current !== 1 ? 's' : '');
    }
  }

  // Library quick-add button handler
  function addLibraryAgent(role, description, btnEl) {
    if (btnEl.disabled) return;
    btnEl.disabled = true;
    btnEl.textContent = 'Adding...';

    postAddAgent(role, description, 'direct',
      function(data) {
        btnEl.textContent = 'Added';
        btnEl.style.background = '#22c55e20';
        btnEl.style.borderColor = '#22c55e60';
        btnEl.style.color = '#22c55e';
        injectAgentCard(data.agentName, role, data.model);
        updateAddAgentCounter(1);
      },
      function(errMsg) {
        btnEl.textContent = '+ Add';
        btnEl.disabled = false;
        // Surface error in custom form status if present, else alert
        var statusEl = document.getElementById('aa-status');
        if (statusEl) {
          statusEl.className = 'add-agent-status error';
          statusEl.textContent = errMsg;
        } else {
          alert(errMsg);
        }
      }
    );
  }

  // Update the agent count display in the add-agent card header
  function updateAddAgentCounter(delta) {
    var headerSpan = document.querySelector('#add-agent-card .card-header span:last-child');
    if (!headerSpan) return;
    var match = headerSpan.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) return;
    var current = parseInt(match[1]) + delta;
    var max = parseInt(match[2]);
    headerSpan.textContent = current + ' / ' + max + ' agents' + (current >= max ? ' \u2014 tier cap reached' : '');
  }

  // Custom form submit
  function submitCustomAgent() {
    var roleEl = document.getElementById('aa-role');
    var descEl = document.getElementById('aa-description');
    var personalityEl = document.getElementById('aa-personality');
    var submitBtn = document.getElementById('aa-submit-btn');
    var statusEl = document.getElementById('aa-status');

    if (!roleEl || !descEl || !submitBtn) return;

    var role = roleEl.value.trim();
    var description = descEl.value.trim();
    var personality = personalityEl ? personalityEl.value : 'direct';

    if (!role) {
      statusEl.className = 'add-agent-status error';
      statusEl.textContent = 'Role name is required.';
      roleEl.focus();
      return;
    }
    if (!description) {
      statusEl.className = 'add-agent-status error';
      statusEl.textContent = 'Description is required.';
      descEl.focus();
      return;
    }

    submitBtn.disabled = true;
    statusEl.className = 'add-agent-status';
    statusEl.textContent = 'Adding agent...';

    postAddAgent(role, description, personality,
      function(data) {
        statusEl.className = 'add-agent-status success';
        statusEl.textContent = data.agentName + ' added. Delegation key: [DELEGATE:' + data.slug + ']';
        roleEl.value = '';
        descEl.value = '';
        injectAgentCard(data.agentName, role, data.model);
        updateAddAgentCounter(1);
        submitBtn.disabled = false;
      },
      function(errMsg) {
        statusEl.className = 'add-agent-status error';
        statusEl.textContent = errMsg;
        submitBtn.disabled = false;
      }
    );
  }

  // Submit a founder challenge for an audit entry
  function submitChallenge(entryId, idx) {
    var textarea = document.getElementById('challenge-text-' + idx);
    var btn = document.getElementById('challenge-btn-' + idx);
    var statusEl = document.getElementById('challenge-status-' + idx);

    if (!textarea || !btn) return;
    var reason = textarea.value.trim();
    if (!reason) {
      if (statusEl) statusEl.textContent = 'Please enter a reason before submitting.';
      textarea.focus();
      return;
    }

    btn.disabled = true;
    if (statusEl) statusEl.textContent = 'Submitting...';

    fetch('/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId: entryId, reason: reason }),
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) {
          if (statusEl) statusEl.textContent = 'Challenge submitted. CEO will reconsider.';
          textarea.value = '';
          textarea.disabled = true;
        } else {
          if (statusEl) statusEl.textContent = 'Error: ' + (data.error || 'unknown');
          btn.disabled = false;
        }
      })
      .catch(function(e) {
        if (statusEl) statusEl.textContent = 'Network error. Try again.';
        btn.disabled = false;
      });
  }

  // ── Founder Control Center JS ──────────────────────────────────────────────

  // Generic POST helper
  function postControl(endpoint, payload, onSuccess, onError) {
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) { onSuccess(data); } else { onError(data.error || 'Unknown error'); }
      })
      .catch(function() { onError('Network error. Check connection.'); });
  }

  // Agent pause / resume / override
  function sendAgentControl(agentId, action, btnEl) {
    if (btnEl && btnEl.disabled) return;
    if (btnEl) btnEl.disabled = true;

    var note = '';
    if (action === 'override') {
      note = window.prompt('Optional override note (what should this agent do instead?):') || '';
      if (note === null) { if (btnEl) btnEl.disabled = false; return; } // cancelled
    }

    postControl('/agent/' + action, { agentId: agentId, note: note },
      function(data) {
        var stateEl = document.getElementById('ctrl-state-' + agentId);
        if (stateEl) {
          var newState = action === 'pause' ? 'paused' : action === 'resume' ? 'running' : 'overridden';
          stateEl.textContent = newState;
          stateEl.className = 'ctrl-agent-state ' + (action === 'pause' ? 'paused' : 'running');
        }
        if (btnEl) btnEl.disabled = false;
      },
      function(errMsg) {
        alert('Agent control error: ' + errMsg);
        if (btnEl) btnEl.disabled = false;
      }
    );
  }

  // Direct instruction
  function submitInstruction() {
    var targetEl = document.getElementById('instruct-target');
    var textEl = document.getElementById('instruct-text');
    var btnEl = document.getElementById('instruct-submit-btn');
    var statusEl = document.getElementById('instruct-status');

    if (!targetEl || !textEl || !btnEl) return;

    var targetId = targetEl.value.trim();
    var instruction = textEl.value.trim();

    if (!instruction) {
      statusEl.className = 'instruct-status error';
      statusEl.textContent = 'Enter an instruction first.';
      textEl.focus();
      return;
    }

    btnEl.disabled = true;
    statusEl.className = 'instruct-status';
    statusEl.textContent = 'Sending...';

    postControl('/instruct', { targetId: targetId, instruction: instruction },
      function() {
        statusEl.className = 'instruct-status success';
        statusEl.textContent = 'Instruction queued for ' + targetId + '.';
        textEl.value = '';
        btnEl.disabled = false;
      },
      function(errMsg) {
        statusEl.className = 'instruct-status error';
        statusEl.textContent = 'Error: ' + errMsg;
        btnEl.disabled = false;
      }
    );
  }

  // CEO force reconsider
  function submitCeoReconsider() {
    var textEl = document.getElementById('ceo-reconsider-text');
    var btnEl = document.getElementById('ceo-reconsider-btn');
    var statusEl = document.getElementById('ceo-reconsider-status');

    if (!btnEl) return;
    var note = textEl ? textEl.value.trim() : '';

    btnEl.disabled = true;
    if (statusEl) { statusEl.className = 'ceo-reconsider-status'; statusEl.textContent = 'Submitting...'; }

    // Finds the most recent audit entry and challenges it with the provided note
    // Falls back to a synthetic entry ID if no audit entries exist
    var entries = document.querySelectorAll('.audit-entry');
    var entryId = entries.length > 0 ? (entries[0].querySelector('[id^="challenge-text-"]') || {}).id : null;
    // Extract the numeric idx from challenge-text-{idx}
    var idx = entryId ? parseInt(entryId.replace('challenge-text-', '')) : null;
    var challengeEntryId = 'ceo-reconsider-' + Date.now();

    // If we have a real audit entry, piggyback on /challenge; otherwise create synthetic
    if (idx !== null && !isNaN(idx)) {
      var realTextArea = document.getElementById('challenge-text-' + idx);
      if (realTextArea && note) realTextArea.value = note;
      // Re-use submitChallenge with the first entry
      var challengeBtn = document.getElementById('challenge-btn-' + idx);
      if (challengeBtn) {
        if (note && realTextArea) realTextArea.value = note;
        submitChallenge(challengeEntryId, -1);
      }
      // For simplicity, also post directly
    }

    // Always post directly to /challenge with the synthetic ID
    postControl('/challenge', { entryId: challengeEntryId, reason: note || 'Founder requested CEO reconsideration of most recent decision.' },
      function() {
        if (statusEl) { statusEl.className = 'ceo-reconsider-status success'; statusEl.textContent = 'Reconsideration queued. CEO will re-evaluate.'; }
        if (textEl) textEl.value = '';
        if (btnEl) btnEl.disabled = false;
      },
      function(errMsg) {
        if (statusEl) { statusEl.className = 'ceo-reconsider-status error'; statusEl.textContent = 'Error: ' + errMsg; }
        if (btnEl) btnEl.disabled = false;
      }
    );
  }

  // Task queue editor — save edit
  function saveTaskEdit(taskId, qi) {
    var textEl = document.getElementById('tqe-text-' + qi);
    var msgEl = document.getElementById('tqe-msg-' + qi);
    if (!textEl) return;

    var newText = textEl.value.trim();
    if (!newText) {
      if (msgEl) { msgEl.className = 'tqe-msg error'; msgEl.textContent = 'Task text cannot be empty.'; }
      return;
    }

    var saveBtn = textEl.closest('.tqe-row').querySelector('.tqe-save-btn');
    if (saveBtn) saveBtn.disabled = true;
    if (msgEl) { msgEl.className = 'tqe-msg'; msgEl.textContent = 'Saving...'; }

    postControl('/task/edit', { taskId: taskId, task: newText },
      function() {
        if (msgEl) { msgEl.className = 'tqe-msg success'; msgEl.textContent = 'Saved.'; }
        if (saveBtn) saveBtn.disabled = false;
      },
      function(errMsg) {
        if (msgEl) { msgEl.className = 'tqe-msg error'; msgEl.textContent = 'Error: ' + errMsg; }
        if (saveBtn) saveBtn.disabled = false;
      }
    );
  }

  // Task queue editor — cancel task
  function cancelQueuedTask(taskId, qi) {
    var msgEl = document.getElementById('tqe-msg-' + qi);
    var row = document.getElementById('tqe-' + qi);
    var cancelBtn = row ? row.querySelector('.tqe-cancel-btn') : null;

    if (!confirm('Cancel this task? It will not execute.')) return;

    if (cancelBtn) cancelBtn.disabled = true;
    if (msgEl) { msgEl.className = 'tqe-msg'; msgEl.textContent = 'Cancelling...'; }

    postControl('/task/cancel', { taskId: taskId },
      function() {
        if (row) {
          row.style.opacity = '0.4';
          row.style.pointerEvents = 'none';
        }
        if (msgEl) { msgEl.className = 'tqe-msg success'; msgEl.textContent = 'Cancelled.'; }
      },
      function(errMsg) {
        if (msgEl) { msgEl.className = 'tqe-msg error'; msgEl.textContent = 'Error: ' + errMsg; }
        if (cancelBtn) cancelBtn.disabled = false;
      }
    );
  }
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Data aggregation — gather everything the dashboard needs
// ---------------------------------------------------------------------------

async function gatherData(instanceDir, customerId, hubPort, dashboardPort) {
  const customerConfig = readCustomerConfig(instanceDir);
  const ceoConfig = readCeoConfig(instanceDir);
  const agentConfigs = readAgentConfigs(instanceDir);
  const agentStates = readAgentStates(instanceDir);
  const conversations = readConversationHistory(instanceDir, 50);
  const tasks = readTasks(instanceDir);
  const auditLog = readAuditLog(instanceDir, 100);
  const hubHealth = await readHubHealth(hubPort);

  const velocityScore = computeVelocityScore(tasks, conversations);
  const dailyBriefing = buildDailyBriefing(tasks, conversations, customerConfig);
  const roiData = computeRoiData(tasks, conversations, customerConfig);
  const billingData = computeBillingPanel(instanceDir, customerConfig);

  const generatedAt = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true
  });

  return {
    customerConfig,
    ceoConfig,
    agentConfigs,
    agentStates,
    conversations,
    tasks,
    auditLog,
    hubHealth,
    velocityScore,
    dailyBriefing,
    roiData,
    billingData,
    dashboardPort,
    hubPort,
    generatedAt,
  };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function startDashboardServer(instanceDir, customerId, hubPort, dashboardPort) {
  const server = createServer(async (req, res) => {
    // Reject non-localhost requests at the application layer (belt + suspenders)
    const remoteAddr = req.socket?.remoteAddress || '';
    if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${dashboardPort}`);

    // Shared helpers for POST handlers
    function readBody(cb) {
      let raw = '';
      req.on('data', chunk => (raw += chunk));
      req.on('end', () => { try { cb(raw); } catch (e) { sendErr(e.message); } });
      req.on('error', () => sendErr('request error', 500));
    }
    function sendErr(msg, code) {
      res.writeHead(code || 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: msg }));
    }

    // POST /challenge — founder pushes back on an audit entry
    if (req.method === 'POST' && url.pathname === '/challenge') {
      readBody(raw => {
        const { entryId, reason } = JSON.parse(raw);
        if (!entryId || !reason || typeof reason !== 'string') return sendErr('entryId and reason required');
        writeChallenge(instanceDir, String(entryId), reason);
        console.log(`[your9-dashboard] Founder challenge submitted for entry: ${entryId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, entryId }));
      });
      return;
    }

    // POST /agent/pause|resume|override — founder agent controls
    if (req.method === 'POST' && ['pause','resume','override'].some(a => url.pathname === '/agent/' + a)) {
      const action = url.pathname.split('/').pop();
      readBody(raw => {
        const { agentId, note } = JSON.parse(raw);
        if (!agentId || typeof agentId !== 'string') return sendErr('agentId required');
        writeAgentControl(instanceDir, agentId.trim(), action, note || '');
        console.log(`[your9-dashboard] Agent control: ${action} → ${agentId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, agentId, action }));
      });
      return;
    }

    // POST /instruct — founder sends direct instruction to agent or CEO
    if (req.method === 'POST' && url.pathname === '/instruct') {
      readBody(raw => {
        const { targetId, instruction } = JSON.parse(raw);
        if (!targetId || typeof targetId !== 'string') return sendErr('targetId required');
        if (!instruction || typeof instruction !== 'string' || !instruction.trim()) return sendErr('instruction required');
        writeInstruction(instanceDir, targetId.trim(), instruction.trim());
        console.log(`[your9-dashboard] Instruction → ${targetId}: "${instruction.slice(0, 60)}"`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, targetId }));
      });
      return;
    }

    // POST /task/edit — founder edits a queued task
    if (req.method === 'POST' && url.pathname === '/task/edit') {
      readBody(raw => {
        const { taskId, task: newText } = JSON.parse(raw);
        if (!taskId || typeof taskId !== 'string') return sendErr('taskId required');
        if (!newText || typeof newText !== 'string' || !newText.trim()) return sendErr('task text required');
        editTask(instanceDir, taskId.trim(), newText.trim());
        console.log(`[your9-dashboard] Task edited: ${taskId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, taskId }));
      });
      return;
    }

    // POST /task/cancel — founder cancels a queued task
    if (req.method === 'POST' && url.pathname === '/task/cancel') {
      readBody(raw => {
        const { taskId } = JSON.parse(raw);
        if (!taskId || typeof taskId !== 'string') return sendErr('taskId required');
        cancelTask(instanceDir, taskId.trim());
        console.log(`[your9-dashboard] Task cancelled: ${taskId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, taskId }));
      });
      return;
    }

    // POST /add-agent — founder provisions a new agent role
    if (req.method === 'POST' && url.pathname === '/add-agent') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', async () => {
        try {
          const { role, description, personality } = JSON.parse(body);
          if (!role || typeof role !== 'string' || !role.trim()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'role is required' }));
            return;
          }
          if (!description || typeof description !== 'string' || !description.trim()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'description is required' }));
            return;
          }

          console.log(`[your9-dashboard] Add agent request: role="${role.trim()}" personality="${personality || 'direct'}"`);

          const result = await addAgent({
            instanceId: customerId,
            role: role.trim().slice(0, 80),
            description: description.trim().slice(0, 500),
          });

          if (!result.success) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: result.message }));
            return;
          }

          console.log(`[your9-dashboard] Agent added: ${result.agentName} (${result.slug})`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            slug: result.slug,
            agentName: result.agentName,
            role: result.role,
            model: result.model,
            message: result.message,
          }));
        } catch (e) {
          console.error(`[your9-dashboard] Add agent error: ${e.message}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      req.on('error', () => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'request error' }));
      });
      return;
    }

    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    if (url.pathname === '/health') {
      const body = JSON.stringify({
        status: 'ok',
        service: 'your9-dashboard',
        customerId,
        dashboardPort,
        hubPort,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    if (url.pathname === '/' || url.pathname === '/dashboard') {
      try {
        const data = await gatherData(instanceDir, customerId, hubPort, dashboardPort);
        const html = renderDashboard(data);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Frame-Options': 'DENY',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(html);
      } catch (e) {
        console.error(`Dashboard render error: ${e.message}`);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Dashboard error: ${e.message}`);
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(dashboardPort, '127.0.0.1', () => {
    console.log(`[your9-dashboard] Listening on http://127.0.0.1:${dashboardPort}`);
    console.log(`[your9-dashboard] Instance: ${customerId}`);
    console.log(`[your9-dashboard] Hub port:  ${hubPort}`);
    console.log(`[your9-dashboard] Open: http://127.0.0.1:${dashboardPort}/`);
  });

  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error(`FATAL: Port ${dashboardPort} is already in use.`);
      console.error(`  Use --port to specify a different dashboard port.`);
      process.exit(1);
    }
    console.error(`Dashboard server error: ${e.message}`);
  });

  return server;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.instance) {
    console.error('Usage: node scripts/your9-dashboard.mjs --instance <customer-id>');
    console.error('       node scripts/your9-dashboard.mjs --instance <customer-id> --port 4200');
    process.exit(1);
  }

  const customerId = args.instance;
  const instanceDir = join(INSTANCES_DIR, customerId);

  if (!existsSync(instanceDir)) {
    console.error(`FATAL: Instance directory not found: ${instanceDir}`);
    console.error(`Provision first: node scripts/your9-provision.mjs --name "..." --industry "..." --id ${customerId}`);
    process.exit(1);
  }

  const configPath = join(instanceDir, 'config', 'customer.json');
  if (!existsSync(configPath)) {
    console.error(`FATAL: Customer config missing at ${configPath}`);
    process.exit(1);
  }

  // Load instance env to resolve hub port
  const instanceEnv = loadEnvFile(join(instanceDir, 'config', '.env'));

  // Resolve hub port and dashboard port
  const hubPort = (
    instanceEnv.YOUR9_HUB_PORT &&
    !instanceEnv.YOUR9_HUB_PORT.startsWith('PLACEHOLDER_')
  )
    ? parseInt(instanceEnv.YOUR9_HUB_PORT)
    : deriveHubPort(customerId);

  const dashboardPort = args.port
    ? parseInt(args.port)
    : deriveDashboardPort(customerId, instanceEnv);

  if (isNaN(dashboardPort) || dashboardPort < 1024 || dashboardPort > 65535) {
    console.error(`FATAL: Invalid dashboard port ${dashboardPort}`);
    process.exit(1);
  }

  // Start server
  startDashboardServer(instanceDir, customerId, hubPort, dashboardPort);

  // Graceful shutdown
  const doShutdown = () => {
    console.log('[your9-dashboard] Shutting down');
    process.exit(0);
  };
  process.on('SIGINT', doShutdown);
  process.on('SIGTERM', doShutdown);
}

main().catch(err => {
  console.error(`DASHBOARD FATAL: ${err.message}`);
  process.exit(1);
});
