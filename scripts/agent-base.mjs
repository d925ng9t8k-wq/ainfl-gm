#!/usr/bin/env node
/**
 * Agent Base — Shared infrastructure for all persistent team agents.
 * Each agent imports this and provides: name, port, work queue, evidence gatherers.
 * Handles: logging, state, health endpoint, Claude API, hub reporting, work loop.
 *
 * Apr 5 rule: Sonnet minimum for all quality-sensitive roles.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import http from 'http';
import { CLAUDE_QUALITY_MODEL, CLAUDE_FLAGSHIP_MODEL } from './model-constants.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');
export const ENV = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);

export const API_KEY = ENV.ANTHROPIC_API_KEY;
export const HUB_URL = 'http://localhost:3457';
export const MODEL_EXECUTE = CLAUDE_QUALITY_MODEL;
export const MODEL_STRATEGY = CLAUDE_FLAGSHIP_MODEL;

if (!existsSync(join(ROOT, 'logs'))) mkdirSync(join(ROOT, 'logs'), { recursive: true });

export function shell(cmd, timeout = 10000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, cwd: ROOT }).trim();
  } catch (e) {
    return `[ERROR: ${e.message.substring(0, 200)}]`;
  }
}

export async function callClaude(prompt, model = MODEL_EXECUTE, maxTokens = 4096) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.substring(0, 200)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

/**
 * Create and run a persistent agent.
 * @param {object} config
 * @param {string} config.name - Agent name (e.g. 'fort', 'watch')
 * @param {string} config.displayName - Display name (e.g. 'FORT')
 * @param {number} config.port - Health endpoint port
 * @param {string} config.role - One-line role description for Claude prompts
 * @param {Array} config.workQueue - Array of {id, priority, title, description, dimension}
 * @param {function} config.gatherEvidence - async (taskId) => object
 * @param {string} [config.model] - Override model for all tasks
 */
export async function runAgent(config) {
  const { name, displayName, port, role, workQueue, gatherEvidence, model } = config;
  const LOG_FILE = join(ROOT, 'logs', `${name}.log`);
  const STATE_FILE = join(ROOT, 'logs', `${name}-state.json`);

  function log(msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${displayName}: ${msg}`;
    console.log(line);
    appendFileSync(LOG_FILE, line + '\n');
  }

  function loadState() {
    if (existsSync(STATE_FILE)) {
      try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { /* fresh */ }
    }
    return { cycles: 0, lastCycle: null, currentTask: null, completedTasks: [], errors: [], startedAt: new Date().toISOString() };
  }

  function saveState(state) {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }

  async function reportToHub(key, value) {
    try {
      await fetch(`${HUB_URL}/context`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-secret': ENV.HUB_API_SECRET || ''
        },
        body: JSON.stringify({ key, value: typeof value === 'string' ? value : JSON.stringify(value) })
      });
    } catch (e) {
      log(`Hub report failed: ${e.message}`);
    }
  }

  async function executeTask(task) {
    log(`Starting task: ${task.title} (${task.id})`);
    const evidence = await gatherEvidence(task.id);
    log(`Evidence gathered: ${Object.keys(evidence).length} data points`);

    const systemContext = `You are ${displayName}, a specialist agent for 9 Enterprises. Role: ${role}

CRITICAL RULE: You may ONLY reference data in the EVIDENCE section. Do NOT invent findings.
If evidence is insufficient, say so and list what additional data you need.

Standards: Enterprise gold bar = 85/100. Kyle Shea (CIO) is the yardstick. No hand-waving.
Keep response under 2000 words. End with FINDINGS and RECOMMENDED ACTIONS sections.
Sign as: — ${displayName}, 9 Enterprises`;

    const taskModel = model || MODEL_EXECUTE;
    const prompt = `${systemContext}

TASK: ${task.title}
DESCRIPTION: ${task.description}
DIMENSION: ${task.dimension}

EVIDENCE (gathered from live system — ONLY source of truth):
${JSON.stringify(evidence, null, 2)}

Analyze this evidence and produce your report.`;

    return await callClaude(prompt, taskModel, 4096);
  }

  async function workCycle(state) {
    state.cycles++;
    state.lastCycle = new Date().toISOString();
    log(`=== Work cycle #${state.cycles} ===`);

    const completed = new Set(state.completedTasks.map(t => t.id));
    const task = workQueue.find(t => !completed.has(t.id));
    if (!task) {
      log('All tasks complete. Maintenance mode.');
      await reportToHub(`${name}Status`, { status: 'maintenance', completedTasks: state.completedTasks.length, lastCycle: state.lastCycle });
      return;
    }

    state.currentTask = task.id;
    saveState(state);
    await reportToHub(`${name}Status`, { status: 'working', currentTask: task.title, cycle: state.cycles });

    try {
      const result = await executeTask(task);
      const outputFile = join(ROOT, 'logs', `${name}-task-${task.id}.md`);
      const header = `# ${displayName} Task Report: ${task.title}\n**Date:** ${new Date().toISOString()}\n**Dimension:** ${task.dimension}\n**Task ID:** ${task.id}\n\n---\n\n`;
      writeFileSync(outputFile, header + result);

      state.completedTasks.push({ id: task.id, title: task.title, completedAt: new Date().toISOString(), outputFile: `logs/${name}-task-${task.id}.md` });
      state.currentTask = null;
      log(`Task complete: ${task.title}`);
      await reportToHub(`${name}Latest`, `Completed: ${task.title}. ${state.completedTasks.length}/${workQueue.length} done.`);
    } catch (e) {
      log(`Task FAILED: ${task.id} — ${e.message}`);
      state.errors.push({ taskId: task.id, error: e.message, timestamp: new Date().toISOString() });
      const failCount = state.errors.filter(err => err.taskId === task.id).length;
      if (failCount >= 3) {
        log(`Task ${task.id} failed 3x. Skipping.`);
        state.completedTasks.push({ id: task.id, title: task.title, completedAt: new Date().toISOString(), status: 'failed', reason: e.message });
      }
    }
    saveState(state);
  }

  // Health endpoint
  const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      const state = loadState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        agent: name, displayName, status: 'running',
        uptime: Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000),
        cycles: state.cycles, currentTask: state.currentTask,
        completedTasks: state.completedTasks.length, totalTasks: workQueue.length,
        errors: state.errors.length, lastCycle: state.lastCycle
      }));
    } else { res.writeHead(404); res.end('Not found'); }
  });
  healthServer.listen(port, () => log(`Health endpoint on port ${port}`));

  // Main loop
  log(`=== ${displayName} starting ===`);
  log(`Model: ${model || MODEL_EXECUTE} | Tasks: ${workQueue.length} | Port: ${port}`);
  const state = loadState();
  log(`Resuming: ${state.completedTasks.length} done, ${state.cycles} prior cycles`);
  await reportToHub(`${name}Status`, { status: 'starting', completedTasks: state.completedTasks.length, totalTasks: workQueue.length });

  try { await workCycle(state); } catch (e) { log(`Cycle error: ${e.message}`); }

  // Work loop — 30s between tasks when work remains, 10min when idle
  while (true) {
    const currentState = loadState();
    const pending = workQueue.length - currentState.completedTasks.length;
    await new Promise(r => setTimeout(r, pending > 0 ? 30000 : 600000));
    try { await workCycle(loadState()); } catch (e) { log(`Cycle error: ${e.message}`); await new Promise(r => setTimeout(r, 60000)); }
  }
}
