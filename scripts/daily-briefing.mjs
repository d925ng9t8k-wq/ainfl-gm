#!/usr/bin/env node
/**
 * Daily Briefing — 8:00 AM ET status report to Owner via Telegram
 *
 * Runs as a background daemon. Checks the time every 60 seconds.
 * At 8:00 AM ET (±2 min window), generates and sends one briefing.
 * Tracks last send date in /tmp/daily-briefing-last-send.txt.
 * Only sends once per calendar day (ET).
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LOG_FILE = join(ROOT, 'logs', 'daily-briefing.log');
const LAST_SEND_FILE = '/tmp/daily-briefing-last-send.txt';
const HUB_URL = 'http://localhost:3457';
const INTERVAL = 60 * 1000; // check every 60 seconds

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] briefing: ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function shell(cmd, timeout = 6000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, cwd: ROOT }).trim();
  } catch {
    return '';
  }
}

function getETDate() {
  // Returns YYYY-MM-DD and HH:MM in America/New_York
  const now = new Date();
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit' });
  // etStr format: "MM/DD/YYYY, HH:MM"
  const [datePart, timePart] = etStr.split(', ');
  const [mm, dd, yyyy] = datePart.split('/');
  return { date: `${yyyy}-${mm}-${dd}`, time: timePart };
}

function alreadySentToday(etDate) {
  try {
    const last = readFileSync(LAST_SEND_FILE, 'utf8').trim();
    return last === etDate;
  } catch {
    return false;
  }
}

function markSentToday(etDate) {
  try { writeFileSync(LAST_SEND_FILE, etDate); } catch {}
}

// ─── Briefing generation ─────────────────────────────────────────────────────

function getCompletedTasksOvernight() {
  const handoffPath = join(ROOT, 'memory', 'session-handoff.json');
  if (!existsSync(handoffPath)) return 'No handoff data found.';
  try {
    const data = JSON.parse(readFileSync(handoffPath, 'utf8'));
    const lines = [];

    // Recent git commits as proxy for overnight work
    if (data.gitLog && data.gitLog.length) {
      lines.push('Recent commits:');
      data.gitLog.slice(0, 3).forEach(c => lines.push(`  ${c}`));
    }

    // Team agent completed task counts
    if (data.teamAgents && Object.keys(data.teamAgents).length) {
      lines.push('Agent task counts:');
      for (const [name, h] of Object.entries(data.teamAgents)) {
        if (h && h.completedTasks !== undefined) {
          lines.push(`  ${name}: ${h.completedTasks} completed`);
        }
      }
    }

    return lines.length ? lines.join('\n') : 'Handoff data present — no tasks extracted.';
  } catch (e) {
    return `Could not parse handoff: ${e.message}`;
  }
}

function getProcessCount() {
  const out = shell("ps aux | grep -E 'node.*scripts/' | grep -v grep | wc -l");
  return parseInt(out, 10) || 0;
}

function getVPSAgentStatus() {
  const ports = { wendy: 3480, fort: 3481, tee: 3483, scout: 3484 };
  const results = [];
  for (const [name, port] of Object.entries(ports)) {
    const resp = shell(`curl -s --max-time 2 http://localhost:${port}/health 2>/dev/null`);
    if (resp) {
      try {
        const parsed = JSON.parse(resp);
        results.push(`  ${name}: online (${parsed.currentTask || 'idle'})`);
      } catch {
        results.push(`  ${name}: online`);
      }
    } else {
      results.push(`  ${name}: offline`);
    }
  }
  return results.join('\n');
}

function getLogErrors() {
  const hubLog = join(ROOT, 'logs', 'comms-hub.log');
  if (!existsSync(hubLog)) return 'Hub log not found.';
  const lines = shell(`tail -50 "${hubLog}" | grep -iE 'error|warn|fail|crash|unhandled' | tail -5`);
  return lines || 'No errors in last 50 lines.';
}

function getUniverseHealth() {
  const hubHealth = shell(`curl -s --max-time 3 ${HUB_URL}/health 2>/dev/null`);
  const voiceHealth = shell(`curl -s --max-time 3 http://localhost:3456/health 2>/dev/null`);

  const hubOk = hubHealth.includes('"status":"running"') || hubHealth.includes('"status":"ok"');
  const voiceOk = voiceHealth.includes('"status"');

  return `  Hub: ${hubOk ? 'healthy' : 'DOWN'}\n  Voice: ${voiceOk ? 'healthy' : 'DOWN or unreachable'}`;
}

function getTopPriority() {
  // Pull from SQLite tasks table if available
  const dbPath = join(ROOT, 'data', '9-memory.db');
  if (existsSync(dbPath)) {
    const topTask = shell(
      `/usr/bin/sqlite3 "${dbPath}" "SELECT title || ' [' || assigned_to || ']' FROM tasks WHERE status NOT IN ('completed','failed') ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END LIMIT 1;" 2>/dev/null`
    );
    if (topTask) return topTask;
  }
  return 'Check open tasks in database.';
}

async function buildAndSendBriefing(etDate) {
  const etNow = shell("TZ='America/New_York' date '+%A, %B %-d %Y'");

  const overnight = getCompletedTasksOvernight();
  const procCount = getProcessCount();
  const vpsStatus = getVPSAgentStatus();
  const errors = getLogErrors();
  const health = getUniverseHealth();
  const topPriority = getTopPriority();

  const message =
`GM — Daily Briefing ${etNow}

OVERNIGHT WORK
${overnight}

SYSTEM STATUS
  Background node processes: ${procCount}
  Universe health:
${health}

VPS AGENTS
${vpsStatus}

LOG ALERTS (last 50 lines)
${errors}

TODAY'S TOP PRIORITY
  ${topPriority}`;

  log(`Sending briefing for ${etDate}`);

  const resp = await fetch(`${HUB_URL}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: 'telegram', message })
  });

  if (resp.ok) {
    markSentToday(etDate);
    log(`Briefing sent for ${etDate}`);
  } else {
    log(`Send failed: HTTP ${resp.status}`);
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

log('Daily briefing daemon starting');

async function tick() {
  try {
    const { date, time } = getETDate();
    const [hourStr, minStr] = time.split(':');
    const hour = parseInt(hourStr, 10);
    const min = parseInt(minStr, 10);

    // 8:00 AM ET window: hour=8, minute 0-2
    const inWindow = (hour === 8 && min >= 0 && min <= 2);

    if (inWindow && !alreadySentToday(date)) {
      await buildAndSendBriefing(date);
    }
  } catch (e) {
    log(`Tick error: ${e.message}`);
  }
}

// Run once immediately (won't send unless it's 8 AM)
await tick();

setInterval(tick, INTERVAL);
