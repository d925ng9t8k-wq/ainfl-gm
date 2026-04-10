#!/usr/bin/env node
/**
 * your9-planner.mjs — AI CEO Strategic Planning Engine
 * Your9 by 9 Enterprises
 *
 * The strategic layer that makes the AI CEO a real planning partner, not just a
 * task executor. Three operating modes:
 *
 *   --plan    Generate a weekly plan from active goals + conversation context.
 *             Opus analyzes goals and extracts the founder's true priorities.
 *             Sonnet decomposes each goal into concrete daily tasks.
 *             Writes plan to instances/{id}/data/plans/{date}-weekly-plan.json.
 *
 *   --review  Weekly summary: goals advanced, tasks completed, blockers found,
 *             next-week priorities. Opus writes the summary in CEO voice.
 *             Sends via Telegram unless --dry-run.
 *
 *   --backlog Show current task backlog — all pending/stalled tasks sorted by
 *             priority and staleness. Prints to stdout. No Telegram send.
 *
 * Goal lifecycle:
 *   Goals start from initial-reasoning.json (set at onboarding).
 *   They evolve via conversation analysis — Opus extracts goal mutations from
 *   conversation history (new priorities, pivots, dropped objectives).
 *   Stall detection: any goal with no completed tasks in 7+ days is flagged.
 *
 * Usage:
 *   node scripts/your9-planner.mjs --instance <customer-id> --plan
 *   node scripts/your9-planner.mjs --instance <customer-id> --review
 *   node scripts/your9-planner.mjs --instance <customer-id> --backlog
 *
 * Flags:
 *   --instance    Customer ID (required). Must exist in instances/ directory.
 *   --plan        Generate the weekly plan (Opus + Sonnet).
 *   --review      Generate weekly review summary (Opus) and send via Telegram.
 *   --backlog     Print the current task backlog to stdout.
 *   --dry-run     Skip Telegram send in --review mode. Print to stdout only.
 *   --weeks-back  How many weeks to look back for --review (default: 1).
 */

import {
  existsSync, readFileSync, writeFileSync, readdirSync,
  appendFileSync, mkdirSync
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
const PLANNER_LOG = join(ROOT, 'logs', 'your9-planner.log');

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const OPUS_MODEL = 'claude-opus-4-20250514';    // Strategic planning, goal extraction, review
const SONNET_MODEL = 'claude-sonnet-4-5';        // Daily task decomposition

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
  const line = `[${ts}] PLANNER: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  try {
    if (!existsSync(join(ROOT, 'logs'))) mkdirSync(join(ROOT, 'logs'), { recursive: true });
    appendFileSync(PLANNER_LOG, line + '\n');
  } catch { /* non-fatal */ }
}

function logSection(title) {
  const bar = '='.repeat(60);
  const line = `\n${bar}\n  ${title}\n${bar}`;
  console.log(line);
  try { appendFileSync(PLANNER_LOG, line + '\n'); } catch {}
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
// Raw HTTPS — same pattern as all other your9 scripts, no SDK dependency
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
// Anthropic API
// ---------------------------------------------------------------------------

async function callClaude(anthropicKey, model, systemPrompt, userPrompt, maxTokens = 4096) {
  log(`Calling ${model} (max_tokens: ${maxTokens})`);

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
  if (!text) {
    throw new Error(`Anthropic returned no content: ${JSON.stringify(result).slice(0, 300)}`);
  }

  log(`Model responded (${text.length} chars)`);
  return text;
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
// Telegram — chunked send with Markdown fallback, same as other your9 scripts
// ---------------------------------------------------------------------------

async function sendTelegramMessage(botToken, chatId, text) {
  const MAX = 4000;
  const chunks = [];
  let remaining = String(text);
  while (remaining.length > MAX) {
    const cutAt = remaining.lastIndexOf('\n', MAX);
    const pos = cutAt > 500 ? cutAt : MAX;
    chunks.push(remaining.slice(0, pos));
    remaining = remaining.slice(pos).trimStart();
  }
  if (remaining.trim()) chunks.push(remaining);

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    try {
      const r = await httpsPost('api.telegram.org', `/bot${botToken}/sendMessage`, {}, {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
      });
      if (!r.ok) throw new Error(r.description || 'Unknown error');
    } catch {
      // Fallback plain text
      await httpsPost('api.telegram.org', `/bot${botToken}/sendMessage`, {}, {
        chat_id: chatId,
        text: chunk,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Instance loader — matches pattern from your9-daily-briefing.mjs
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

  const anthropicKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey || anthropicKey.startsWith('PLACEHOLDER')) {
    throw new Error(`ANTHROPIC_API_KEY not set or is placeholder in ${envPath}`);
  }

  const botToken = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const ownerChatId = env.TELEGRAM_OWNER_CHAT_ID || process.env.TELEGRAM_OWNER_CHAT_ID;

  // Ensure all data directories exist
  const dirs = ['data/tasks', 'data/plans', 'data/conversation', 'logs'];
  for (const d of dirs) {
    const full = join(instanceDir, d);
    if (!existsSync(full)) mkdirSync(full, { recursive: true });
  }

  return {
    customerId,
    instanceDir,
    instanceConfig,
    anthropicKey,
    botToken: botToken && !botToken.startsWith('PLACEHOLDER') ? botToken : null,
    ownerChatId: ownerChatId && !ownerChatId.startsWith('PLACEHOLDER') ? ownerChatId : null,
    taskDir: join(instanceDir, 'data', 'tasks'),
    plansDir: join(instanceDir, 'data', 'plans'),
    convDir: join(instanceDir, 'data', 'conversation'),
  };
}

// ---------------------------------------------------------------------------
// Task reader — reads all task JSON files, consistent with daily-briefing pattern
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'report-delivered']);
const ACTIVE_STATUSES = new Set(['running', 'researching']);

function readAllTasks(taskDir) {
  if (!existsSync(taskDir)) return [];
  let files;
  try {
    files = readdirSync(taskDir).filter(f => f.endsWith('-task.json')).sort();
  } catch {
    return [];
  }

  const tasks = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(taskDir, f), 'utf-8'));
      const tsMatch = f.match(/^(\d+)-task/);
      tasks.push({ ...raw, _fileTs: tsMatch ? parseInt(tsMatch[1], 10) : 0, _file: f });
    } catch { /* skip malformed */ }
  }
  return tasks;
}

// ---------------------------------------------------------------------------
// Goal reader — loads from initial-reasoning.json + any evolved goal snapshots
// ---------------------------------------------------------------------------

function loadGoals(instanceDir) {
  const goals = [];

  // Primary source: initial reasoning
  const reasoningPath = join(instanceDir, 'data', 'initial-reasoning.json');
  if (existsSync(reasoningPath)) {
    try {
      const r = JSON.parse(readFileSync(reasoningPath, 'utf-8'));
      if (Array.isArray(r.goals)) {
        for (const g of r.goals) {
          goals.push({ ...g, source: 'initial-reasoning' });
        }
      }
    } catch { /* non-fatal */ }
  }

  // Supplemental source: evolved goals (written by --plan mode's goal extraction)
  const evolvedGoalsPath = join(instanceDir, 'data', 'evolved-goals.json');
  if (existsSync(evolvedGoalsPath)) {
    try {
      const evolved = JSON.parse(readFileSync(evolvedGoalsPath, 'utf-8'));
      if (Array.isArray(evolved)) {
        // Evolved goals override or supplement initial ones by ID
        for (const eg of evolved) {
          const existingIdx = goals.findIndex(g => g.id === eg.id);
          if (existingIdx >= 0) {
            goals[existingIdx] = { ...goals[existingIdx], ...eg, source: 'evolved' };
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
// Conversation reader — consistent with daily-briefing.mjs
// ---------------------------------------------------------------------------

function readConversationHistory(convDir, limit = 50) {
  const histPath = join(convDir, 'history.jsonl');
  if (!existsSync(histPath)) return [];
  try {
    const lines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Stall detection — any goal with no completed tasks in the last N days
// ---------------------------------------------------------------------------

const STALL_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function detectStalledGoals(goals, tasks) {
  const now = Date.now();
  const stalledIds = [];

  for (const goal of goals) {
    const goalTasks = tasks.filter(t => t.goalId === goal.id);
    if (goalTasks.length === 0) {
      // No tasks at all — check how old the goal is
      stalledIds.push({ goalId: goal.id, title: goal.title, reason: 'no-tasks' });
      continue;
    }

    const lastCompleted = goalTasks
      .filter(t => TERMINAL_STATUSES.has((t.status || '').toLowerCase()) && t.completedAt)
      .map(t => new Date(t.completedAt).getTime())
      .sort((a, b) => b - a)[0];

    if (!lastCompleted) {
      // Has tasks but none completed — check if pending tasks are old
      const oldestPending = goalTasks
        .filter(t => !TERMINAL_STATUSES.has((t.status || '').toLowerCase()))
        .map(t => t._fileTs || 0)
        .sort((a, b) => a - b)[0];

      if (oldestPending && (now - oldestPending) > STALL_THRESHOLD_MS) {
        stalledIds.push({ goalId: goal.id, title: goal.title, reason: 'pending-tasks-stale' });
      }
    } else if ((now - lastCompleted) > STALL_THRESHOLD_MS) {
      stalledIds.push({ goalId: goal.id, title: goal.title, reason: 'no-recent-progress' });
    }
  }

  return stalledIds;
}

// ---------------------------------------------------------------------------
// Completion rate per goal
// ---------------------------------------------------------------------------

function goalCompletionRates(goals, tasks) {
  return goals.map(goal => {
    const goalTasks = tasks.filter(t => t.goalId === goal.id);
    const total = goalTasks.length;
    const completed = goalTasks.filter(t => TERMINAL_STATUSES.has((t.status || '').toLowerCase())).length;
    const pending = goalTasks.filter(t => !TERMINAL_STATUSES.has((t.status || '').toLowerCase()) && !ACTIVE_STATUSES.has((t.status || '').toLowerCase())).length;
    const active = goalTasks.filter(t => ACTIVE_STATUSES.has((t.status || '').toLowerCase())).length;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return {
      goalId: goal.id,
      title: goal.title,
      priority: goal.priority,
      total,
      completed,
      active,
      pending,
      completionRate: rate,
    };
  });
}

// ---------------------------------------------------------------------------
// MODE: --backlog
// Show current pending/stalled tasks sorted by priority then staleness
// ---------------------------------------------------------------------------

function runBacklog(instance) {
  const { instanceConfig, taskDir, instanceDir } = instance;
  logSection(`BACKLOG — ${instanceConfig.name} (${instance.customerId})`);

  const allTasks = readAllTasks(taskDir);
  const goals = loadGoals(instanceDir);

  // Filter to active and pending tasks only
  const backlog = allTasks.filter(t => {
    const s = (t.status || '').toLowerCase();
    return !TERMINAL_STATUSES.has(s);
  });

  if (backlog.length === 0) {
    console.log('\nBacklog is empty. No pending tasks found.\n');
    return;
  }

  // Sort: critical > high > medium > other, then oldest first
  const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2 };
  backlog.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.goalPriority] ?? 3;
    const pb = PRIORITY_ORDER[b.goalPriority] ?? 3;
    if (pa !== pb) return pa - pb;
    return (a._fileTs || 0) - (b._fileTs || 0);
  });

  // Stall detection
  const stalled = detectStalledGoals(goals, allTasks);
  const stalledGoalIds = new Set(stalled.map(s => s.goalId));

  // Completion rates per goal
  const rates = goalCompletionRates(goals, allTasks);
  const rateMap = {};
  for (const r of rates) rateMap[r.goalId] = r;

  console.log(`\n  Instance:  ${instanceConfig.name}`);
  console.log(`  Date:      ${new Date().toLocaleDateString()}`);
  console.log(`  Backlog:   ${backlog.length} task(s)\n`);

  let currentGoalId = null;
  for (const task of backlog) {
    if (task.goalId !== currentGoalId) {
      currentGoalId = task.goalId;
      const rate = rateMap[currentGoalId];
      const isStalled = stalledGoalIds.has(currentGoalId);
      const stalledTag = isStalled ? ' [STALLED]' : '';
      const rateStr = rate ? ` (${rate.completionRate}% complete)` : '';
      const priority = (task.goalPriority || 'unknown').toUpperCase();
      console.log(`\n  [${priority}] ${task.goalTitle || currentGoalId}${rateStr}${stalledTag}`);
      console.log(`  ${'─'.repeat(55)}`);
    }

    const agent = task.agentId || 'team';
    const status = task.status || 'pending';
    const age = task._fileTs
      ? `${Math.floor((Date.now() - task._fileTs) / 86400000)}d old`
      : 'age unknown';
    const due = task.dueDate ? `due ${new Date(task.dueDate).toLocaleDateString()}` : '';
    const dueStr = due ? ` | ${due}` : '';

    console.log(`    [${status}] [${agent}] ${task.title || task.task || '(no title)'}`);
    console.log(`      Age: ${age}${dueStr}`);
    if (task.brief && task.brief.length > 0) {
      console.log(`      Brief: ${task.brief.slice(0, 120)}${task.brief.length > 120 ? '...' : ''}`);
    }
  }

  if (stalled.length > 0) {
    console.log(`\n  STALLED GOALS (no progress in 7+ days):`);
    for (const s of stalled) {
      console.log(`    - ${s.title} (${s.reason})`);
    }
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// MODE: --plan
// Goal extraction from conversation + weekly plan generation
// ---------------------------------------------------------------------------

const GOAL_EXTRACTION_SYSTEM = `You are an AI CEO's strategic planning engine.

Your job is to analyze the founder's recent conversation history and identify how their priorities have shifted, evolved, or been clarified since the initial goal-setting session.

You are NOT looking for surface-level topics. You are looking for:
- New problems the founder keeps coming back to
- Objectives they express urgency around
- Goals that have been explicitly dropped or deprioritized
- Priorities that have shifted based on outcomes or new information
- Anything they've asked the CEO to track or measure

Output ONLY valid JSON. No preamble. No explanation. Structure:

{
  "extractedPriorities": [
    {
      "signal": "What the founder said or implied",
      "implication": "What this means for the CEO's agenda",
      "urgency": "high|medium|low",
      "actionable": true|false
    }
  ],
  "goalUpdates": [
    {
      "id": "goal-id-to-update-or-null-for-new",
      "action": "reinforce|reprioritize|drop|add",
      "title": "Goal title",
      "newPriority": "critical|high|medium|null",
      "reason": "Why this change"
    }
  ],
  "founderFocusArea": "A single sentence: what the founder is most focused on right now."
}

If conversation history is empty or too thin to extract signals, return the same structure with empty arrays and founderFocusArea set to "Insufficient conversation data — relying on initial goals."`;

const WEEKLY_PLAN_SYSTEM = `You are an AI CEO generating a weekly strategic plan.

You receive:
- Current active goals (with priorities and success criteria)
- Conversation-extracted founder priorities
- Stalled goals that need attention
- Completion rates per goal

Generate a concrete, actionable weekly plan. This is NOT a template. Every item must be specific to this business.

Think like a real CEO who has to ship results this week. What are the 3-5 things that actually move the needle? What needs a push? What is stalling that must not stall?

Output ONLY valid JSON:

{
  "weekOf": "ISO date string for Monday of this week",
  "ceoFocus": "1-2 sentences: where the CEO is personally putting energy this week.",
  "weeklyObjectives": [
    {
      "objectiveId": "obj-1",
      "title": "Objective title",
      "linkedGoalId": "goal-id or null",
      "rationale": "Why this week. Why now.",
      "successCriteria": "What done looks like by Friday.",
      "priority": "critical|high|medium"
    }
  ],
  "dailyTasks": [
    {
      "day": "Monday|Tuesday|Wednesday|Thursday|Friday",
      "objectiveId": "obj-id",
      "agentId": "executor|mind|voice",
      "title": "Task title",
      "brief": "Full brief — enough for the agent to execute without clarifying questions.",
      "estimatedMinutes": 30
    }
  ],
  "stalledGoalActions": [
    {
      "goalId": "goal-id",
      "action": "What the CEO is doing to unblock this goal this week.",
      "assignedTo": "executor|mind|voice|founder"
    }
  ],
  "founderAsk": "What the CEO needs from the founder this week, if anything. If nothing, null."
}

Rules:
- 3-5 weekly objectives. Quality over quantity.
- Daily tasks are concrete. No vague placeholders.
- Stalled goals must appear in stalledGoalActions — do not ignore them.
- founderAsk should only contain things the CEO genuinely cannot do alone.`;

async function runPlan(instance, args) {
  const { customerId, instanceConfig, instanceDir, anthropicKey, taskDir, convDir, plansDir } = instance;
  logSection(`WEEKLY PLAN — ${instanceConfig.name} (${customerId})`);

  const goals = loadGoals(instanceDir);
  const allTasks = readAllTasks(taskDir);
  const conversation = readConversationHistory(convDir, 50);

  log(`Loaded ${goals.length} goal(s), ${allTasks.length} task(s), ${conversation.length} conversation entries`);

  // Step 1: Opus extracts evolving founder priorities from conversation
  logSection('STEP 1 — Goal extraction from conversation (Opus)');

  const convContext = conversation.length > 0
    ? conversation.map(e => `[${e.role || 'unknown'}] ${(e.content || '').slice(0, 300)}`).join('\n')
    : 'No conversation history available.';

  const goalContext = goals.map(g =>
    `Goal [${g.id}] [${g.priority}]: ${g.title}\n  Success: ${g.successCriteria || 'not defined'}\n  Target days: ${g.targetDays || 'unknown'}`
  ).join('\n\n');

  let extractionResult;
  try {
    const raw = await callClaude(
      anthropicKey,
      OPUS_MODEL,
      GOAL_EXTRACTION_SYSTEM,
      `Current goals:\n${goalContext}\n\nRecent conversation:\n${convContext}\n\nExtract priority signals and goal updates now.`,
      2048
    );
    extractionResult = parseJsonResponse(raw, 'goal-extraction');
    log(`Extracted ${extractionResult.extractedPriorities?.length || 0} priority signal(s), ${extractionResult.goalUpdates?.length || 0} goal update(s)`);
  } catch (e) {
    log(`Goal extraction failed (non-fatal): ${e.message} — proceeding with existing goals`);
    extractionResult = { extractedPriorities: [], goalUpdates: [], founderFocusArea: 'Using initial goals — no conversation data.' };
  }

  // Apply non-destructive goal updates (reinforce/reprioritize only — never drop without human confirmation)
  const evolvedGoals = [...goals];
  for (const update of (extractionResult.goalUpdates || [])) {
    if (update.action === 'drop') {
      log(`Skipping "drop" for goal ${update.id} — requires founder confirmation`);
      continue;
    }
    if (update.action === 'add' && update.id === null) {
      const newGoal = {
        id: `goal-extracted-${Date.now()}`,
        title: update.title,
        priority: update.newPriority || 'medium',
        rationale: update.reason,
        successCriteria: '',
        targetDays: 30,
        tasks: [],
        source: 'extracted',
      };
      evolvedGoals.push(newGoal);
      log(`New goal extracted from conversation: "${newGoal.title}"`);
    } else if (update.id) {
      const idx = evolvedGoals.findIndex(g => g.id === update.id);
      if (idx >= 0 && update.newPriority) {
        evolvedGoals[idx] = { ...evolvedGoals[idx], priority: update.newPriority, source: 'evolved' };
        log(`Goal "${evolvedGoals[idx].title}" reprioritized to ${update.newPriority}`);
      }
    }
  }

  // Save evolved goals for future runs
  const evolvedGoalsPath = join(instanceDir, 'data', 'evolved-goals.json');
  writeFileSync(evolvedGoalsPath, JSON.stringify(evolvedGoals.filter(g => g.source === 'evolved' || g.source === 'extracted'), null, 2));
  log(`Evolved goals saved: ${evolvedGoalsPath}`);

  // Step 2: Stall detection + completion rates
  const stalled = detectStalledGoals(evolvedGoals, allTasks);
  const rates = goalCompletionRates(evolvedGoals, allTasks);
  log(`Stalled goals: ${stalled.length}, Completion rates computed for ${rates.length} goal(s)`);

  // Step 3: Sonnet generates weekly plan (daily task decomposition)
  logSection('STEP 2 — Weekly plan generation (Sonnet)');

  const ratesContext = rates.map(r =>
    `[${r.goalId}] ${r.title}: ${r.completionRate}% (${r.completed}/${r.total} tasks done, ${r.pending} pending)`
  ).join('\n');

  const stalledContext = stalled.length > 0
    ? stalled.map(s => `- ${s.title} (${s.reason})`).join('\n')
    : 'None';

  const prioritiesContext = (extractionResult.extractedPriorities || []).map(p =>
    `[${p.urgency}] ${p.signal} => ${p.implication}`
  ).join('\n') || 'No signals extracted from conversation.';

  const planUserPrompt = `Business: ${instanceConfig.name}
Industry: ${instanceConfig.industryContext?.label || instanceConfig.industry}

Founder's current focus: ${extractionResult.founderFocusArea}

Active goals:
${evolvedGoals.filter(g => g.priority !== 'dropped').map(g => `[${g.id}] [${g.priority}] ${g.title}\n  Success: ${g.successCriteria || 'TBD'}`).join('\n\n')}

Completion rates:
${ratesContext}

Stalled goals (7+ days no progress):
${stalledContext}

Founder priority signals from conversation:
${prioritiesContext}

Generate the weekly plan now. Return JSON only.`;

  let weeklyPlan;
  try {
    const raw = await callClaude(anthropicKey, SONNET_MODEL, WEEKLY_PLAN_SYSTEM, planUserPrompt, 4096);
    weeklyPlan = parseJsonResponse(raw, 'weekly-plan');
    log(`Weekly plan generated: ${weeklyPlan.weeklyObjectives?.length || 0} objective(s), ${weeklyPlan.dailyTasks?.length || 0} daily task(s)`);
  } catch (e) {
    log(`FATAL: Weekly plan generation failed — ${e.message}`);
    throw e;
  }

  // Write plan to disk
  const dateStr = new Date().toISOString().slice(0, 10);
  const planPath = join(plansDir, `${dateStr}-weekly-plan.json`);
  const planRecord = {
    generatedAt: new Date().toISOString(),
    customerId,
    instanceName: instanceConfig.name,
    founderFocusArea: extractionResult.founderFocusArea,
    goalCount: evolvedGoals.length,
    stalledCount: stalled.length,
    stalled,
    completionRates: rates,
    weeklyPlan,
  };
  writeFileSync(planPath, JSON.stringify(planRecord, null, 2));
  log(`Plan written: ${planPath}`);

  // Write individual task files for each daily task
  logSection('STEP 3 — Writing task files');
  const taskWriteDir = instance.taskDir;
  let tasksWritten = 0;
  for (const dt of (weeklyPlan.dailyTasks || [])) {
    await new Promise(resolve => setTimeout(resolve, 1)); // ensure unique timestamps
    const ts = Date.now();
    const taskEntry = {
      goalId: dt.objectiveId || null,
      goalTitle: weeklyPlan.weeklyObjectives?.find(o => o.objectiveId === dt.objectiveId)?.title || dt.title,
      goalPriority: weeklyPlan.weeklyObjectives?.find(o => o.objectiveId === dt.objectiveId)?.priority || 'medium',
      agentId: dt.agentId,
      title: dt.title,
      brief: dt.brief,
      scheduledDay: dt.day,
      estimatedMinutes: dt.estimatedMinutes,
      dueDate: getDateForDay(dt.day).toISOString(),
      status: 'pending',
      createdBy: 'ceo-planner',
      loggedAt: new Date().toISOString(),
      source: 'weekly-plan',
    };
    const taskPath = join(taskWriteDir, `${ts}-${dt.agentId || 'team'}-task.json`);
    writeFileSync(taskPath, JSON.stringify(taskEntry, null, 2));
    tasksWritten++;
  }
  log(`${tasksWritten} task file(s) written for this week's plan`);

  // Print summary
  logSection('PLAN COMPLETE');
  console.log(`\n  Instance:    ${instanceConfig.name}`);
  console.log(`  Week of:     ${weeklyPlan.weekOf || dateStr}`);
  console.log(`  CEO focus:   ${weeklyPlan.ceoFocus}`);
  console.log(`  Objectives:  ${weeklyPlan.weeklyObjectives?.length || 0}`);
  console.log(`  Tasks filed: ${tasksWritten}`);
  console.log(`  Stalled:     ${stalled.length > 0 ? stalled.map(s => s.title).join(', ') : 'none'}`);
  if (weeklyPlan.founderAsk) {
    console.log(`\n  FOUNDER ACTION NEEDED: ${weeklyPlan.founderAsk}`);
  }
  console.log(`\n  Plan file: ${planPath}\n`);
}

function getDateForDay(dayName) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date();
  const todayDay = today.getDay();
  const targetDay = days.indexOf(dayName);
  if (targetDay < 0) return today;
  const diff = targetDay - todayDay;
  const target = new Date(today);
  target.setDate(today.getDate() + (diff >= 0 ? diff : diff + 7));
  return target;
}

// ---------------------------------------------------------------------------
// MODE: --review
// Weekly summary: what was accomplished, what stalled, next week priorities
// ---------------------------------------------------------------------------

const REVIEW_SYSTEM = `You are an AI CEO writing a weekly review report to your founder.

This is a real executive review. Not a status list. Not a template. Write it the way a sharp, honest operator talks to the person who hired them.

The review must cover:
1. What actually moved this week (specific, not vague)
2. What stalled and why — honest assessment
3. Completion rates across active goals — if a goal is behind, say so directly
4. What you are prioritizing next week and why the order is what it is
5. What you need from the founder, if anything (be precise — no hand-wavy asks)

Rules:
- Be direct. No corporate language.
- If it was a bad week, say it was a bad week and explain what's being done about it.
- Do not pad. Every sentence should inform or direct.
- Max 400 words.
- Write in the CEO's voice — use the personality config.
- Do not use bullet headers like "Section 1:" — use natural paragraph breaks.
- End with a clear statement of the one thing the founder should know going into next week.`;

async function runReview(instance, args) {
  const { customerId, instanceConfig, instanceDir, anthropicKey, botToken, ownerChatId, taskDir, plansDir, convDir } = instance;
  const isDryRun = args['dry-run'] === true || args['dry-run'] === 'true';
  const weeksBack = parseInt(args['weeks-back'] || '1', 10);

  logSection(`WEEKLY REVIEW — ${instanceConfig.name} (${customerId})`);

  if (!isDryRun && (!botToken || !ownerChatId)) {
    throw new Error('Telegram credentials not configured. Use --dry-run or set TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_CHAT_ID.');
  }

  const allTasks = readAllTasks(taskDir);
  const goals = loadGoals(instanceDir);
  const stalled = detectStalledGoals(goals, allTasks);
  const rates = goalCompletionRates(goals, allTasks);

  // Time window for this review
  const now = Date.now();
  const weekStart = now - (weeksBack * 7 * 24 * 60 * 60 * 1000);

  const completedThisWeek = allTasks.filter(t => {
    const s = (t.status || '').toLowerCase();
    if (!TERMINAL_STATUSES.has(s)) return false;
    const completedAt = t.completedAt ? new Date(t.completedAt).getTime() : null;
    return completedAt && completedAt >= weekStart;
  });

  const activeThisWeek = allTasks.filter(t => {
    const s = (t.status || '').toLowerCase();
    return ACTIVE_STATUSES.has(s) || (!TERMINAL_STATUSES.has(s) && !ACTIVE_STATUSES.has(s));
  });

  log(`Review window: last ${weeksBack} week(s) | completed: ${completedThisWeek.length} | still active: ${activeThisWeek.length}`);

  // Load the most recent weekly plan for context
  let recentPlan = null;
  if (existsSync(plansDir)) {
    const planFiles = readdirSync(plansDir).filter(f => f.endsWith('-weekly-plan.json')).sort().reverse();
    if (planFiles.length > 0) {
      try {
        recentPlan = JSON.parse(readFileSync(join(plansDir, planFiles[0]), 'utf-8'));
        log(`Loaded recent plan: ${planFiles[0]}`);
      } catch { /* non-fatal */ }
    }
  }

  const completedContext = completedThisWeek.length > 0
    ? completedThisWeek.map(t => `[${t.agentId || 'team'}] ${t.title || t.task || '(no title)'}: ${(t.result || t.summary || 'completed').slice(0, 200)}`).join('\n')
    : 'No tasks completed this week.';

  const ratesContext = rates.map(r =>
    `[${r.priority || 'unknown'}] ${r.title}: ${r.completionRate}% (${r.completed}/${r.total} tasks done)`
  ).join('\n');

  const stalledContext = stalled.length > 0
    ? stalled.map(s => `${s.title} (${s.reason})`).join('\n')
    : 'No stalled goals.';

  const planObjectivesContext = recentPlan?.weeklyPlan?.weeklyObjectives
    ? recentPlan.weeklyPlan.weeklyObjectives.map(o => `[${o.priority}] ${o.title}: ${o.successCriteria}`).join('\n')
    : 'No prior plan found.';

  const recentConversation = readConversationHistory(convDir, 20);
  const convContext = recentConversation.length > 0
    ? recentConversation.map(e => `[${e.role}] ${(e.content || '').slice(0, 200)}`).join('\n')
    : 'No conversation history.';

  const reviewUserPrompt = `Business: ${instanceConfig.name}
Industry: ${instanceConfig.industryContext?.label || instanceConfig.industry}
Personality: ${instanceConfig.personalityConfig?.label || 'professional'} — ${instanceConfig.personalityConfig?.voiceStyle || 'direct'}
Review period: last ${weeksBack} week(s)

This week's plan objectives:
${planObjectivesContext}

Completed this week:
${completedContext}

Goal completion rates (all-time):
${ratesContext}

Stalled goals:
${stalledContext}

Recent conversation context:
${convContext}

Write the weekly review now. Speak as the AI CEO to the founder.`;

  log(`Generating weekly review via ${OPUS_MODEL}...`);
  let reviewText;
  try {
    reviewText = await callClaude(anthropicKey, OPUS_MODEL, REVIEW_SYSTEM, reviewUserPrompt, 2048);
  } catch (e) {
    log(`Review generation failed: ${e.message}`);
    throw e;
  }

  log(`Review generated (${reviewText.length} chars)`);

  // Write review to disk
  const dateStr = new Date().toISOString().slice(0, 10);
  const reviewPath = join(instance.instanceDir, 'data', 'plans', `${dateStr}-weekly-review.md`);
  writeFileSync(reviewPath, `# Weekly Review — ${instanceConfig.name}\n_Generated: ${new Date().toISOString()}_\n\n${reviewText}`);
  log(`Review written: ${reviewPath}`);

  if (isDryRun) {
    log('DRY RUN — Telegram send skipped');
    console.log('\n=== WEEKLY REVIEW (DRY RUN) ===\n');
    console.log(reviewText);
    console.log('\n=== END REVIEW ===\n');
    return;
  }

  log(`Sending review to Telegram (chat: ${ownerChatId})...`);
  await sendTelegramMessage(botToken, ownerChatId, `*Weekly Review — ${instanceConfig.name}*\n\n${reviewText}`);
  log('Review delivered via Telegram');
  console.log(`\n  Review sent. File: ${reviewPath}\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.instance) {
    console.error('Usage: node scripts/your9-planner.mjs --instance <customer-id> --plan|--review|--backlog');
    console.error('');
    console.error('Modes:');
    console.error('  --plan      Generate weekly plan from goals + conversation context');
    console.error('  --review    Generate weekly summary and send via Telegram');
    console.error('  --backlog   Print current task backlog to stdout');
    console.error('');
    console.error('Flags:');
    console.error('  --dry-run     Skip Telegram send in --review mode');
    console.error('  --weeks-back  Weeks to include in --review (default: 1)');
    process.exit(1);
  }

  const mode = args.plan ? 'plan' : args.review ? 'review' : args.backlog ? 'backlog' : null;
  if (!mode) {
    console.error('ERROR: You must specify a mode: --plan, --review, or --backlog');
    process.exit(1);
  }

  let instance;
  try {
    instance = loadInstance(args.instance);
  } catch (e) {
    console.error(`Failed to load instance: ${e.message}`);
    process.exit(1);
  }

  log(`Mode: ${mode} | Instance: ${args.instance} | Business: ${instance.instanceConfig.name}`);

  try {
    if (mode === 'backlog') {
      runBacklog(instance);
    } else if (mode === 'plan') {
      await runPlan(instance, args);
    } else if (mode === 'review') {
      await runReview(instance, args);
    }
  } catch (e) {
    console.error(`\nPLANNER FAILED (${mode}): ${e.message}`);
    log(`FATAL (${mode}): ${e.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`PLANNER FATAL: ${err.message}`);
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
