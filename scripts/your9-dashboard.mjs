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
  existsSync, readFileSync, readdirSync
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
    hubHealth,
    velocityScore,
    dailyBriefing,
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

    /* ── Footer ── */
    footer {
      border-top: 1px solid var(--border);
      padding: 10px 20px;
      text-align: center;
      font-size: 11px;
      color: var(--text-dim);
    }

    footer a { color: var(--text-dim); text-decoration: none; }

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
  const hubHealth = await readHubHealth(hubPort);

  const velocityScore = computeVelocityScore(tasks, conversations);
  const dailyBriefing = buildDailyBriefing(tasks, conversations, customerConfig);

  const generatedAt = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true
  });

  return {
    customerConfig,
    ceoConfig,
    agentConfigs,
    conversations,
    tasks,
    hubHealth,
    velocityScore,
    dailyBriefing,
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

    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${dashboardPort}`);

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
