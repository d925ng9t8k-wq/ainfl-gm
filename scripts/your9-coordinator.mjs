#!/usr/bin/env node
/**
 * your9-coordinator.mjs — Multi-Agent Coordination & Execution Layer
 * Your9 by 9 Enterprises
 *
 * The nervous system between the CEO brain and the agent team hands.
 * Takes high-level goals, decomposes them into agent-assignable tasks,
 * routes each task to the best available agent, tracks progress, manages
 * inter-agent handoffs, and resolves conflicts.
 *
 * Usage:
 *   node scripts/your9-coordinator.mjs --instance <customer-id>
 *
 * Flags:
 *   --instance    Customer ID (required). Instance must be provisioned.
 *   --goal        High-level goal string to coordinate (optional — for CLI testing).
 *   --dry-run     Decompose and route but do not execute agent tasks.
 *
 * HTTP endpoint added to the hub's health server:
 *   GET /coordination/status  — All active task chains for this instance.
 *
 * Exports (for hub integration):
 *   coordinateGoal(instanceDir, goal, agents)
 *   routeTask(task, agents)
 *   trackProgress(instanceDir)
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync,
  readdirSync, renameSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import {
  writeSharedContext,
  readSharedContext,
  buildContextSummary,
  readRecentHandoffs,
} from './your9-agent-collab.mjs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Maximum tasks the coordinator will decompose from a single goal.
// Prevents runaway decomposition on vague goals.
const MAX_TASKS_PER_GOAL = 8;

// Maximum depth of inter-agent pipeline chains tracked at once.
const MAX_PIPELINE_DEPTH = 4;

// How long (ms) before a running task is considered stalled.
const TASK_STALL_MS = 10 * 60 * 1000; // 10 minutes

// Directory inside the instance for coordination state.
const COORD_DIR_NAME = join('data', 'coordination');

// ---------------------------------------------------------------------------
// Agent capability registry
//
// Each agent's strengths are described here so routeTask can score task fit
// without a round-trip to the AI. Scoring is keyword-based — fast and zero-cost.
// The AI is used for ambiguous cases where scores are tied.
// ---------------------------------------------------------------------------

const AGENT_CAPABILITIES = {
  executor: {
    label: 'Executor',
    strengths: [
      'schedule', 'calendar', 'crm', 'pipeline', 'log', 'track', 'record',
      'update', 'follow up', 'follow-up', 'remind', 'task', 'action item',
      'organize', 'manage', 'process', 'automate', 'system', 'workflow',
      'data entry', 'database', 'spreadsheet', 'report', 'status',
    ],
    description: 'Operations, scheduling, CRM, pipeline management, follow-ups, data tasks.',
  },
  mind: {
    label: 'Mind',
    strengths: [
      'research', 'analyze', 'analysis', 'competitor', 'market', 'intel',
      'intelligence', 'find', 'investigate', 'survey', 'compare', 'benchmark',
      'study', 'data', 'insight', 'trend', 'forecast', 'review', 'evaluate',
      'assess', 'audit', 'discover', 'explore', 'look into', 'learn',
      'background', 'profile', 'due diligence',
    ],
    description: 'Research, analysis, competitive intel, market data, discovery.',
  },
  voice: {
    label: 'Voice',
    strengths: [
      'email', 'outreach', 'draft', 'write', 'message', 'communicate',
      'contact', 'reach out', 'introduce', 'pitch', 'proposal', 'follow up',
      'follow-up', 'reply', 'respond', 'social', 'post', 'content', 'copy',
      'announcement', 'newsletter', 'linkedin', 'twitter', 'instagram',
      'press', 'blog', 'script', 'narrative', 'story',
    ],
    description: 'Communications, outreach, email, social content, written copy.',
  },
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

let _coordLogPath = null;

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] COORD: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  if (_coordLogPath) {
    try { appendFileSync(_coordLogPath, line + '\n'); } catch {}
  }
}

// ---------------------------------------------------------------------------
// .env loader — does NOT pollute process.env
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
// Raw HTTPS helpers — matches hub pattern, no SDK
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
          catch (e) { reject(new Error(`JSON parse failed: ${e.message} — body: ${buf.slice(0, 200)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(90000, () => { req.destroy(); reject(new Error('HTTPS request timed out')); });
    req.write(data);
    req.end();
  });
}

async function callClaude(anthropicKey, model, systemPrompt, userPrompt, maxTokens = 4096) {
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
      messages: [{ role: 'user', content: userPrompt }],
    }
  );

  if (result.error) {
    throw new Error(`Anthropic API error: ${result.error.message || JSON.stringify(result.error)}`);
  }
  const text = result.content?.[0]?.text;
  if (!text) throw new Error(`Anthropic returned no content: ${JSON.stringify(result).slice(0, 200)}`);
  return text;
}

// ---------------------------------------------------------------------------
// Coordination state directory
// ---------------------------------------------------------------------------

function ensureCoordDir(instanceDir) {
  const dir = join(instanceDir, COORD_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Chain store — one JSON file per goal coordination chain
//
// Structure:
// {
//   chainId: string,
//   goal: string,
//   status: 'active' | 'completed' | 'conflict' | 'stalled',
//   createdAt: ISO string,
//   updatedAt: ISO string,
//   tasks: [
//     {
//       taskId: string,
//       agentId: string,
//       title: string,
//       brief: string,
//       status: 'pending' | 'running' | 'completed' | 'failed' | 'stalled',
//       dependsOn: [taskId],
//       startedAt?: ISO,
//       completedAt?: ISO,
//       result?: string,
//       error?: string,
//     }
//   ],
//   conflicts: [ { taskId, description, escalatedAt } ],
//   handoffs: [ { fromTaskId, toTaskId, status } ],
// }
// ---------------------------------------------------------------------------

function chainPath(instanceDir, chainId) {
  return join(ensureCoordDir(instanceDir), `${chainId}.json`);
}

function readChain(instanceDir, chainId) {
  const p = chainPath(instanceDir, chainId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function writeChain(instanceDir, chain) {
  chain.updatedAt = new Date().toISOString();
  const p = chainPath(instanceDir, chain.chainId);
  const tmp = p + '.tmp';
  try {
    writeFileSync(tmp, JSON.stringify(chain, null, 2));
    renameSync(tmp, p);
  } catch (e) {
    log(`Chain write failed (non-fatal): ${e.message}`);
  }
}

function listChains(instanceDir) {
  const dir = join(instanceDir, COORD_DIR_NAME);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
      .sort()
      .reverse()
      .map(f => {
        try { return JSON.parse(readFileSync(join(dir, f), 'utf-8')); }
        catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Task decomposition
//
// Takes a high-level goal string and breaks it into concrete, agent-assignable
// tasks using a Sonnet call. The output is a JSON array of task objects.
// Falls back to a single-task decomposition if the AI call fails.
// ---------------------------------------------------------------------------

const DECOMPOSITION_SYSTEM = `You are a task decomposition engine for a small-business AI CEO system.
Your job: take a high-level business goal and break it into specific, executable tasks — one task per agent.

Available agents and their roles:
- executor: operations, scheduling, CRM updates, pipeline management, data tasks, follow-ups
- mind: research, competitive analysis, market intel, due diligence, discovery
- voice: email drafting, outreach, social content, written communications, copy

Rules:
1. Maximum ${MAX_TASKS_PER_GOAL} tasks total.
2. Each task must be assignable to exactly one agent (executor, mind, or voice).
3. Tasks must be specific enough that the agent can execute without clarifying questions.
4. If one task's output feeds into another, note the dependency.
5. Return ONLY valid JSON — no preamble, no explanation.

Output format:
{
  "tasks": [
    {
      "taskId": "t1",
      "agentId": "mind|executor|voice",
      "title": "Short task title",
      "brief": "Full task brief. Specific. Actionable. No placeholders.",
      "dependsOn": [],
      "priority": "critical|high|medium"
    }
  ]
}`;

/**
 * Decompose a high-level goal into specific agent tasks.
 *
 * @param {string} anthropicKey
 * @param {string} goal          - The high-level goal from the CEO or owner.
 * @param {Object} agents        - Available agent configs { agentId: config }.
 * @param {string} [businessCtx] - Optional business context for better decomposition.
 * @returns {Promise<Array>}     - Array of task objects.
 */
export async function decomposeGoal(anthropicKey, goal, agents, businessCtx = '') {
  log(`Decomposing goal: "${goal.slice(0, 100)}"`);

  const availableAgents = Object.keys(agents)
    .filter(id => AGENT_CAPABILITIES[id])
    .map(id => `- ${id}: ${AGENT_CAPABILITIES[id].description}`)
    .join('\n');

  const prompt = [
    businessCtx ? `Business context: ${businessCtx}` : '',
    `Available agents in this instance:\n${availableAgents || 'executor, mind, voice'}`,
    '',
    `Goal to decompose: ${goal}`,
    '',
    'Break this goal into specific tasks. Return JSON only.',
  ].filter(Boolean).join('\n');

  let raw;
  try {
    raw = await callClaude(
      anthropicKey,
      'claude-sonnet-4-5',
      DECOMPOSITION_SYSTEM,
      prompt,
      2048
    );
  } catch (e) {
    log(`Decomposition AI call failed — using single-task fallback: ${e.message}`);
    // Fallback: treat the goal itself as a single task, route to best agent
    const agent = scoreAgentForTask(goal, agents);
    return [{
      taskId: generateId('t'),
      agentId: agent.agentId,
      title: goal.slice(0, 80),
      brief: goal,
      dependsOn: [],
      priority: 'high',
    }];
  }

  // Strip markdown fencing if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Try to extract JSON block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); }
      catch { parsed = null; }
    }
  }

  if (!parsed?.tasks || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    log(`Decomposition returned no tasks — using single-task fallback`);
    const agent = scoreAgentForTask(goal, agents);
    return [{
      taskId: generateId('t'),
      agentId: agent.agentId,
      title: goal.slice(0, 80),
      brief: goal,
      dependsOn: [],
      priority: 'high',
    }];
  }

  const tasks = parsed.tasks.slice(0, MAX_TASKS_PER_GOAL).map(t => ({
    taskId: t.taskId || generateId('t'),
    agentId: t.agentId || scoreAgentForTask(t.brief || t.title || goal, agents).agentId,
    title: (t.title || '').slice(0, 120),
    brief: t.brief || t.title || goal,
    dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
    priority: t.priority || 'high',
    status: 'pending',
    createdAt: new Date().toISOString(),
  }));

  log(`Decomposed into ${tasks.length} task(s): ${tasks.map(t => `[${t.agentId}] ${t.title}`).join(' | ')}`);
  return tasks;
}

// ---------------------------------------------------------------------------
// Smart task routing — keyword scoring
//
// Scores each available agent for a given task string using keyword matching.
// Returns { agentId, score, label, reason } for the best match.
// If all scores tie (or no agents match), falls back to 'executor'.
// ---------------------------------------------------------------------------

/**
 * Score all agents for a task and return the best match.
 *
 * @param {string} taskText   - Task brief or title.
 * @param {Object} agents     - Available agent configs { agentId: config }.
 * @returns {{ agentId, score, label, reason }}
 */
export function routeTask(taskText, agents) {
  const lower = taskText.toLowerCase();
  const scores = {};

  for (const [agentId, cap] of Object.entries(AGENT_CAPABILITIES)) {
    // Only score agents that are actually provisioned in this instance
    if (!agents[agentId]) continue;
    let score = 0;
    const matched = [];
    for (const keyword of cap.strengths) {
      if (lower.includes(keyword)) {
        score += 1;
        matched.push(keyword);
      }
    }
    scores[agentId] = { score, matched };
  }

  // Pick highest scorer
  let bestId = null;
  let bestScore = -1;
  for (const [id, s] of Object.entries(scores)) {
    if (s.score > bestScore) {
      bestScore = s.score;
      bestId = id;
    }
  }

  // Fallback to first available agent if no keywords matched
  if (!bestId || bestScore === 0) {
    const available = Object.keys(agents).filter(id => AGENT_CAPABILITIES[id]);
    bestId = available[0] || 'executor';
    return {
      agentId: bestId,
      score: 0,
      label: AGENT_CAPABILITIES[bestId]?.label || bestId,
      reason: 'No keyword match — fallback to first available agent.',
    };
  }

  const cap = AGENT_CAPABILITIES[bestId];
  return {
    agentId: bestId,
    score: bestScore,
    label: cap.label,
    reason: `Matched ${bestScore} keyword(s): ${scores[bestId].matched.slice(0, 5).join(', ')}.`,
  };
}

// Internal alias used by decomposeGoal fallback
function scoreAgentForTask(taskText, agents) {
  return routeTask(taskText, agents);
}

// ---------------------------------------------------------------------------
// Progress tracking
//
// Reads all chain files for an instance and returns a structured summary.
// Used by the /coordination/status endpoint and by the hub's pipeline view.
// ---------------------------------------------------------------------------

/**
 * Read and return the current coordination state for an instance.
 *
 * @param {string} instanceDir
 * @returns {{
 *   chains: Array,
 *   summary: { total, active, completed, stalled, conflict },
 *   stalledTasks: Array,
 * }}
 */
export function trackProgress(instanceDir) {
  const chains = listChains(instanceDir);
  const now = Date.now();

  const summary = { total: 0, active: 0, completed: 0, stalled: 0, conflict: 0 };
  const stalledTasks = [];

  for (const chain of chains) {
    summary.total++;
    if (chain.status === 'active') summary.active++;
    else if (chain.status === 'completed') summary.completed++;
    else if (chain.status === 'stalled') summary.stalled++;
    else if (chain.status === 'conflict') summary.conflict++;

    // Detect stalled tasks within active chains
    if (chain.status === 'active') {
      for (const task of chain.tasks || []) {
        if (task.status === 'running' && task.startedAt) {
          const runningMs = now - new Date(task.startedAt).getTime();
          if (runningMs > TASK_STALL_MS) {
            stalledTasks.push({
              chainId: chain.chainId,
              taskId: task.taskId,
              agentId: task.agentId,
              title: task.title,
              runningMs,
              goal: chain.goal?.slice(0, 80),
            });
          }
        }
      }
    }
  }

  return { chains, summary, stalledTasks };
}

// ---------------------------------------------------------------------------
// Conflict detection
//
// Compares the results of two tasks. If they contradict on a key claim,
// that is flagged as a conflict to be escalated to the CEO.
// ---------------------------------------------------------------------------

/**
 * Check two task results for conflicts.
 * Returns null if no conflict, or a conflict object if one is detected.
 *
 * Detection is heuristic: we look for antonym patterns in the text.
 * This is intentionally conservative — false negatives are acceptable.
 * The CEO escalation path handles undetected conflicts too.
 */
function detectConflict(taskA, taskB) {
  if (!taskA.result || !taskB.result) return null;

  const a = taskA.result.toLowerCase();
  const b = taskB.result.toLowerCase();

  // Simple heuristic: if one result contains "yes"/"confirmed"/"positive" and
  // the other contains "no"/"denied"/"negative" on the same topic, flag it.
  const positiveTerms = ['yes', 'confirmed', 'approved', 'positive', 'viable', 'recommended'];
  const negativeTerms = ['no', 'denied', 'rejected', 'negative', 'not viable', 'not recommended'];

  const aPositive = positiveTerms.some(t => a.includes(t));
  const aPositive2 = negativeTerms.some(t => a.includes(t));
  const bPositive = positiveTerms.some(t => b.includes(t));
  const bNegative = negativeTerms.some(t => b.includes(t));

  if ((aPositive && bNegative) || (aPositive2 && bPositive)) {
    return {
      type: 'directional-conflict',
      description: `${taskA.agentId} and ${taskB.agentId} produced contradictory assessments.`,
      taskAId: taskA.taskId,
      taskBId: taskB.taskId,
      taskAResult: taskA.result.slice(0, 200),
      taskBResult: taskB.result.slice(0, 200),
      detectedAt: new Date().toISOString(),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Handoff coordinator
//
// When a task completes and has downstream dependents in the same chain,
// this function queues those downstream tasks with the completed task's
// output prepended to the brief.
// ---------------------------------------------------------------------------

function queueDependentTasks(chain, completedTaskId, completedResult) {
  const queued = [];
  for (const task of chain.tasks) {
    if (task.status !== 'pending') continue;
    if (!task.dependsOn.includes(completedTaskId)) continue;

    // Prepend the upstream output to the brief
    const upstreamContext = completedResult
      ? `## Output from upstream task (${completedTaskId})\n${completedResult.slice(0, 800)}\n\n## Your Task\n`
      : '';
    task.brief = upstreamContext + task.brief;
    task.status = 'ready';
    task.unlockedAt = new Date().toISOString();
    task.unlockedBy = completedTaskId;
    queued.push(task);
  }
  return queued;
}

// ---------------------------------------------------------------------------
// Main export: coordinateGoal
//
// Orchestrates the full lifecycle:
//   1. Decompose the goal into tasks
//   2. Route each task to the best agent (or use the AI's assignment)
//   3. Create a chain record and write it to disk
//   4. Execute tasks respecting dependency order
//   5. On completion of each task, queue dependents
//   6. Detect conflicts between completed tasks
//   7. Write shared context with all outputs
//   8. Return the chain result
//
// @param {string} instanceDir     - Path to the instance directory.
// @param {string} goal            - High-level goal string.
// @param {Object} agents          - Available agent configs { agentId: config }.
// @param {Object} [opts]          - Options.
// @param {string} [opts.anthropicKey]    - Anthropic API key (required for decomposition).
// @param {string} [opts.businessCtx]     - Business context for better decomposition.
// @param {boolean} [opts.dryRun]         - If true, plan but do not execute.
// @param {Function} [opts.executeTask]   - Injected task runner from hub. Signature:
//                                          (anthropicKey, agentId, agentConf, instanceDir, brief, taskDir, hub) => Promise<string>
// @param {Object} [opts.hub]             - Hub state object (needed if executeTask is provided).
// @returns {Promise<Object>}       - The chain object after all tasks complete (or on dryRun, planned).
// ---------------------------------------------------------------------------

export async function coordinateGoal(instanceDir, goal, agents, opts = {}) {
  const {
    anthropicKey,
    businessCtx = '',
    dryRun = false,
    executeTask = null,
    hub = null,
  } = opts;

  log(`coordinateGoal: "${goal.slice(0, 100)}"`);

  const chainId = generateId('chain');
  const taskDir = join(instanceDir, 'data', 'tasks');
  mkdirSync(taskDir, { recursive: true });

  // Step 1: Decompose goal into tasks
  let tasks;
  if (anthropicKey) {
    tasks = await decomposeGoal(anthropicKey, goal, agents, businessCtx);
  } else {
    // No key — single-task fallback using keyword routing
    const route = routeTask(goal, agents);
    tasks = [{
      taskId: generateId('t'),
      agentId: route.agentId,
      title: goal.slice(0, 80),
      brief: goal,
      dependsOn: [],
      priority: 'high',
      status: 'pending',
      createdAt: new Date().toISOString(),
    }];
    log(`No API key — single-task fallback to agent: ${route.agentId}`);
  }

  // Step 2: Validate and re-route any tasks assigned to unavailable agents
  for (const task of tasks) {
    if (!agents[task.agentId]) {
      const reroute = routeTask(task.brief || task.title, agents);
      log(`Task "${task.title}" — agent "${task.agentId}" not available, rerouting to "${reroute.agentId}"`);
      task.agentId = reroute.agentId;
      task.reroutedReason = `Original agent not provisioned. ${reroute.reason}`;
    }
  }

  // Step 3: Build chain record
  const chain = {
    chainId,
    goal: goal.slice(0, 500),
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dryRun,
    tasks: tasks.map(t => ({ ...t, status: t.dependsOn.length === 0 ? 'pending' : 'waiting' })),
    conflicts: [],
    handoffs: [],
    completedTaskResults: {},
  };

  writeChain(instanceDir, chain);
  log(`Chain ${chainId} created with ${tasks.length} task(s)`);

  if (dryRun) {
    log(`Dry run — skipping execution`);
    chain.status = 'dry-run';
    writeChain(instanceDir, chain);
    return chain;
  }

  if (!executeTask) {
    log(`No executeTask function provided — chain is planned but not executed`);
    return chain;
  }

  // Step 4: Execute tasks — respecting dependency order via iterative passes
  let maxPasses = MAX_TASKS_PER_GOAL + 2;
  let pass = 0;

  while (pass < maxPasses) {
    pass++;

    // Check if everything is done or failed
    const remaining = chain.tasks.filter(t => !['completed', 'failed', 'stalled'].includes(t.status));
    if (remaining.length === 0) break;

    // Find tasks that are ready to run (no unresolved dependencies)
    const runnable = chain.tasks.filter(t => {
      if (t.status !== 'pending' && t.status !== 'ready') return false;
      // All dependsOn tasks must be completed
      return t.dependsOn.every(depId => {
        const dep = chain.tasks.find(d => d.taskId === depId);
        return dep && dep.status === 'completed';
      });
    });

    if (runnable.length === 0) {
      // No runnable tasks but still have pending — check for stalled deps
      const waitingTasks = chain.tasks.filter(t => t.status === 'waiting' || t.status === 'pending');
      const hasFailedDep = waitingTasks.some(t =>
        t.dependsOn.some(depId => {
          const dep = chain.tasks.find(d => d.taskId === depId);
          return dep && dep.status === 'failed';
        })
      );
      if (hasFailedDep) {
        log(`Chain ${chainId}: dependency failure detected — marking chain stalled`);
        chain.status = 'stalled';
        writeChain(instanceDir, chain);
        break;
      }
      // Otherwise wait for running tasks to complete (shouldn't happen in serial execution)
      break;
    }

    // Execute runnable tasks (serial — preserves conversation order and avoids rate limits)
    for (const task of runnable) {
      const agentConf = agents[task.agentId];
      if (!agentConf) {
        task.status = 'failed';
        task.error = `Agent "${task.agentId}" not found in instance configs`;
        task.failedAt = new Date().toISOString();
        writeChain(instanceDir, chain);
        continue;
      }

      task.status = 'running';
      task.startedAt = new Date().toISOString();
      writeChain(instanceDir, chain);

      // Prepend shared context so agents have team knowledge
      const ctxSummary = buildContextSummary(instanceDir);
      const fullBrief = ctxSummary
        ? `${ctxSummary}\n\n## Task\n${task.brief}`
        : task.brief;

      log(`Executing task [${task.agentId}]: "${task.title}"`);

      let result;
      try {
        result = await executeTask(
          anthropicKey,
          task.agentId,
          agentConf,
          instanceDir,
          fullBrief,
          taskDir,
          hub
        );
        task.status = 'completed';
        task.result = (result || '').slice(0, 2000);
        task.completedAt = new Date().toISOString();
        chain.completedTaskResults[task.taskId] = task.result;
        log(`Task [${task.agentId}] "${task.title}" completed`);
      } catch (e) {
        task.status = 'failed';
        task.error = e.message;
        task.failedAt = new Date().toISOString();
        log(`Task [${task.agentId}] "${task.title}" failed: ${e.message}`);
        writeChain(instanceDir, chain);
        continue;
      }

      // Write task result to shared context
      writeSharedContext(instanceDir, task.agentId, {
        [`coord_${task.taskId}_output`]: task.result.slice(0, 500),
      });

      // Queue dependent tasks with upstream output
      const readied = queueDependentTasks(chain, task.taskId, task.result);
      if (readied.length > 0) {
        log(`Queued ${readied.length} dependent task(s) after ${task.taskId}`);
        chain.handoffs.push(...readied.map(r => ({
          fromTaskId: task.taskId,
          toTaskId: r.taskId,
          status: 'queued',
          queuedAt: new Date().toISOString(),
        })));
      }

      writeChain(instanceDir, chain);
    }
  }

  // Step 5: Detect conflicts across completed tasks
  const completedTasks = chain.tasks.filter(t => t.status === 'completed');
  for (let i = 0; i < completedTasks.length - 1; i++) {
    for (let j = i + 1; j < completedTasks.length; j++) {
      const conflict = detectConflict(completedTasks[i], completedTasks[j]);
      if (conflict) {
        chain.conflicts.push(conflict);
        chain.status = 'conflict';
        log(`Conflict detected between tasks ${completedTasks[i].taskId} and ${completedTasks[j].taskId}`);
      }
    }
  }

  // Mark chain completed if all tasks reached terminal state and no conflict
  if (chain.status !== 'conflict' && chain.status !== 'stalled') {
    const allDone = chain.tasks.every(t => ['completed', 'failed'].includes(t.status));
    if (allDone) {
      const anyFailed = chain.tasks.some(t => t.status === 'failed');
      chain.status = anyFailed ? 'partial' : 'completed';
    }
  }

  writeChain(instanceDir, chain);
  log(`Chain ${chainId} finished with status: ${chain.status}`);
  return chain;
}

// ---------------------------------------------------------------------------
// /coordination/status response builder
//
// Produces the JSON body for the hub's HTTP health server endpoint.
// ---------------------------------------------------------------------------

/**
 * Build the response body for GET /coordination/status.
 *
 * @param {string} instanceDir
 * @returns {Object}
 */
export function buildStatusResponse(instanceDir) {
  const progress = trackProgress(instanceDir);
  const recentHandoffs = readRecentHandoffs(instanceDir, 10);
  const sharedCtx = readSharedContext(instanceDir);

  const activePipelines = progress.chains
    .filter(c => c.status === 'active')
    .map(c => ({
      chainId: c.chainId,
      goal: c.goal,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      taskCount: c.tasks?.length || 0,
      taskStatuses: (c.tasks || []).reduce((acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
      }, {}),
      currentTasks: (c.tasks || [])
        .filter(t => t.status === 'running')
        .map(t => ({ taskId: t.taskId, agentId: t.agentId, title: t.title, startedAt: t.startedAt })),
      conflicts: c.conflicts || [],
    }));

  const recentCompleted = progress.chains
    .filter(c => ['completed', 'partial', 'stalled', 'conflict'].includes(c.status))
    .slice(0, 5)
    .map(c => ({
      chainId: c.chainId,
      goal: c.goal,
      status: c.status,
      completedAt: c.updatedAt,
      taskCount: c.tasks?.length || 0,
    }));

  return {
    summary: progress.summary,
    stalledTasks: progress.stalledTasks,
    activePipelines,
    recentCompleted,
    recentHandoffs,
    sharedContextKeys: Object.keys(sharedCtx),
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Hub integration helper
//
// Call this from the hub's startHealthServer to wire in the coordination
// endpoint without modifying hub internals beyond the server handler.
//
// Usage in hub's HTTP server (add as an additional route check):
//
//   import { handleCoordinationRequest } from './your9-coordinator.mjs';
//   ...
//   const coordHandled = handleCoordinationRequest(req, res, hub.instanceDir);
//   if (coordHandled) return;
//
// ---------------------------------------------------------------------------

/**
 * Handle a coordination HTTP request if the URL matches.
 * Returns true if the request was handled, false if the caller should handle it.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} instanceDir
 * @returns {boolean}
 */
export function handleCoordinationRequest(req, res, instanceDir) {
  if (req.method !== 'GET' || !req.url?.startsWith('/coordination/')) return false;

  if (req.url === '/coordination/status') {
    try {
      const body = JSON.stringify(buildStatusResponse(instanceDir), null, 2);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  if (req.url.startsWith('/coordination/chain/')) {
    const chainId = req.url.split('/coordination/chain/')[1];
    const chain = chainId ? readChain(instanceDir, chainId) : null;
    if (chain) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(chain, null, 2));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Chain not found: ${chainId}` }));
    }
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Standalone CLI — for testing and direct invocation
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const isDryRun = !!args['dry-run'];

  if (!args.instance) {
    console.error('Usage: node scripts/your9-coordinator.mjs --instance <customer-id> [--goal "..."] [--dry-run]');
    process.exit(1);
  }

  const customerId = args.instance;
  const instanceDir = join(INSTANCES_DIR, customerId);

  if (!existsSync(instanceDir)) {
    console.error(`Instance not found: ${instanceDir}`);
    process.exit(1);
  }

  // Set up log path
  const logDir = join(instanceDir, 'logs');
  mkdirSync(logDir, { recursive: true });
  _coordLogPath = join(logDir, `coordinator-${new Date().toISOString().slice(0, 10)}.log`);

  // Load credentials
  const envPath = join(instanceDir, 'config', '.env');
  const instanceEnv = loadEnvFile(envPath);
  const platformEnv = loadEnvFile(join(ROOT, '.env'));
  const anthropicKey = (instanceEnv.ANTHROPIC_API_KEY && !instanceEnv.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER'))
    ? instanceEnv.ANTHROPIC_API_KEY
    : platformEnv.ANTHROPIC_API_KEY;

  // Load agent configs
  const agentsDir = join(instanceDir, 'agents');
  const agents = {};
  if (existsSync(agentsDir)) {
    for (const agentId of readdirSync(agentsDir)) {
      const cfgPath = join(agentsDir, agentId, 'config.json');
      if (existsSync(cfgPath)) {
        try { agents[agentId] = JSON.parse(readFileSync(cfgPath, 'utf-8')); } catch {}
      }
    }
  }

  // Load customer config for business context
  let businessCtx = '';
  const custPath = join(instanceDir, 'config', 'customer.json');
  if (existsSync(custPath)) {
    try {
      const cust = JSON.parse(readFileSync(custPath, 'utf-8'));
      businessCtx = `Business: ${cust.name}. Industry: ${cust.industry}.`;
    } catch {}
  }

  // --goal mode: run one coordination
  if (args.goal) {
    const goal = args.goal;
    log(`--- Coordinator CLI ---`);
    log(`Instance: ${customerId}`);
    log(`Goal: "${goal}"`);
    log(`Dry run: ${isDryRun}`);
    log(`Agents: ${Object.keys(agents).join(', ') || '(none provisioned)'}`);

    const chain = await coordinateGoal(instanceDir, goal, agents, {
      anthropicKey,
      businessCtx,
      dryRun: isDryRun,
      executeTask: null, // CLI mode — plan only, no hub
    });

    console.log('\n=== COORDINATION PLAN ===\n');
    console.log(`Chain ID:  ${chain.chainId}`);
    console.log(`Status:    ${chain.status}`);
    console.log(`Tasks (${chain.tasks.length}):`);
    for (const t of chain.tasks) {
      console.log(`  [${t.agentId}] ${t.title}`);
      if (t.dependsOn.length > 0) console.log(`            depends on: ${t.dependsOn.join(', ')}`);
    }
    console.log('');
    return;
  }

  // --status mode: show current coordination state
  if (args.status) {
    const status = buildStatusResponse(instanceDir);
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  // Default: show usage and current status
  console.log('Usage:');
  console.log('  node scripts/your9-coordinator.mjs --instance <id> --goal "..." [--dry-run]');
  console.log('  node scripts/your9-coordinator.mjs --instance <id> --status');
  console.log('');
  const progress = trackProgress(instanceDir);
  console.log(`Current coordination state for ${customerId}:`);
  console.log(`  Total chains: ${progress.summary.total}`);
  console.log(`  Active:       ${progress.summary.active}`);
  console.log(`  Completed:    ${progress.summary.completed}`);
  console.log(`  Stalled:      ${progress.summary.stalled}`);
  console.log(`  Conflicts:    ${progress.summary.conflict}`);
  if (progress.stalledTasks.length > 0) {
    console.log(`\nStalled tasks:`);
    for (const t of progress.stalledTasks) {
      console.log(`  [${t.agentId}] ${t.title} (${Math.round(t.runningMs / 60000)}m)`);
    }
  }
}

// Run only when called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(`COORDINATOR FATAL: ${err.message}`);
    process.exit(1);
  });
}
