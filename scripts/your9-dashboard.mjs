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
    conversations,
    tasks,
    auditLog,
    hubHealth,
    velocityScore,
    dailyBriefing,
    roiData,
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
  const conversations = readConversationHistory(instanceDir, 50);
  const tasks = readTasks(instanceDir);
  const auditLog = readAuditLog(instanceDir, 100);
  const hubHealth = await readHubHealth(hubPort);

  const velocityScore = computeVelocityScore(tasks, conversations);
  const dailyBriefing = buildDailyBriefing(tasks, conversations, customerConfig);
  const roiData = computeRoiData(tasks, conversations, customerConfig);

  const generatedAt = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true
  });

  return {
    customerConfig,
    ceoConfig,
    agentConfigs,
    conversations,
    tasks,
    auditLog,
    hubHealth,
    velocityScore,
    dailyBriefing,
    roiData,
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

    // POST /challenge — founder pushes back on an audit entry
    if (req.method === 'POST' && url.pathname === '/challenge') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const { entryId, reason } = JSON.parse(body);
          if (!entryId || !reason || typeof reason !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'entryId and reason required' }));
            return;
          }
          writeChallenge(instanceDir, String(entryId), reason);
          console.log(`[your9-dashboard] Founder challenge submitted for entry: ${entryId}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, entryId }));
        } catch (e) {
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
