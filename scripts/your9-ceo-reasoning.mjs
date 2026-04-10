#!/usr/bin/env node
/**
 * your9-ceo-reasoning.mjs — AI CEO Initial Reasoning & Goal Setting Engine
 * Your9 by 9 Enterprises
 *
 * The moment the AI CEO comes alive. Reads a new customer's config, calls Opus
 * to generate the first real strategic goals for the business, breaks each goal
 * into concrete tasks assigned to agents, writes those task files to disk, and
 * sends the founder a structured first briefing via Telegram.
 *
 * This is NOT a template engine. The goals and tasks are generated from scratch
 * by the CEO model using the customer's specific business context.
 *
 * Usage:
 *   node scripts/your9-ceo-reasoning.mjs --instance <customer-id>
 *
 * Flags:
 *   --instance    Customer ID (required). Instance must be provisioned and active.
 *   --dry-run     Generate goals and tasks but do not send the Telegram briefing.
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync
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
const REASONING_LOG = join(ROOT, 'logs', 'your9-ceo-reasoning.log');

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
  const line = `[${ts}] CEO-REASONING: ${msg}`;
  console.log(line);
  try {
    if (!existsSync(join(ROOT, 'logs'))) mkdirSync(join(ROOT, 'logs'), { recursive: true });
    appendFileSync(REASONING_LOG, line + '\n');
  } catch { /* non-fatal */ }
}

function logSection(title) {
  const bar = '='.repeat(60);
  const line = `\n${bar}\n  ${title}\n${bar}`;
  console.log(line);
  try { appendFileSync(REASONING_LOG, line + '\n'); } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// .env loader — does NOT pollute process.env (same pattern as hub)
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
// Raw HTTPS helpers — same pattern as hub, no SDK dependency
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
// Anthropic API — calls the CEO model (Opus for enterprise, Sonnet otherwise)
// ---------------------------------------------------------------------------

async function callClaude(anthropicKey, model, systemPrompt, userPrompt, maxTokens = 8192) {
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
// Telegram send — with chunking and Markdown fallback (same pattern as hub)
// ---------------------------------------------------------------------------

async function sendTelegramMessage(botToken, chatId, text) {
  const MAX = 4000;
  const chunks = [];
  let remaining = String(text);
  while (remaining.length > MAX) {
    // Split on newline where possible
    const boundary = remaining.lastIndexOf('\n', MAX);
    const cut = boundary > 0 ? boundary : MAX;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);

  for (const chunk of chunks) {
    const body = JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'Markdown' });
    const bodyLen = Buffer.byteLength(body);
    const send = (parseMode) => new Promise((resolve, reject) => {
      const payload = JSON.stringify({ chat_id: chatId, text: chunk, ...(parseMode ? { parse_mode: parseMode } : {}) });
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${botToken}/sendMessage`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        res => {
          let buf = '';
          res.on('data', c => (buf += c));
          res.on('end', () => {
            try { resolve(JSON.parse(buf)); }
            catch (e) { reject(new Error(`Telegram parse failed: ${e.message}`)); }
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Telegram send timed out')); });
      req.write(payload);
      req.end();
    });

    try {
      const result = await send('Markdown');
      if (!result.ok) throw new Error(result.description || 'Unknown Telegram error');
    } catch {
      // Fallback to plain text if Markdown fails
      const result = await send(null);
      if (!result.ok) throw new Error(`Telegram send failed: ${JSON.stringify(result)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Task file writer — matches the format hub's logTask produces so the hub
// can pick up and execute these tasks when it starts.
// ---------------------------------------------------------------------------

function writeTaskFile(taskDir, task) {
  if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });
  const timestamp = Date.now();
  // Ensure uniqueness if multiple tasks land in the same millisecond
  const taskPath = join(taskDir, `${timestamp}-${task.agentId}-task.json`);
  const entry = {
    ...task,
    status: 'pending',
    createdBy: 'ceo-reasoning',
    loggedAt: new Date().toISOString(),
  };
  writeFileSync(taskPath, JSON.stringify(entry, null, 2));
  log(`Task file written: ${taskPath}`);
  return taskPath;
}

// ---------------------------------------------------------------------------
// Goal parsing — parses the structured JSON the CEO model returns
// ---------------------------------------------------------------------------

function parseGoalsFromResponse(raw) {
  // The model is instructed to return JSON. Strip any markdown fencing.
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // If JSON parse fails, try to extract the JSON block
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // fall through
      }
    }
    throw new Error(`CEO model returned unparseable goal structure: ${e.message}\n\nRaw (first 500 chars):\n${raw.slice(0, 500)}`);
  }
}

// ---------------------------------------------------------------------------
// CEO reasoning prompt — what Opus reads to generate the business goals
// ---------------------------------------------------------------------------

function buildReasoningSystemPrompt(customerConfig, ceoSystemPrompt) {
  const { name, industry, industryContext, personalityConfig } = customerConfig;

  return `You are the AI CEO of ${name}, a ${industryContext.label} business.

${ceoSystemPrompt}

---

## CURRENT CONTEXT

This is your first session. The business has just activated you. You have read the briefing below and you are now setting the strategic agenda.

You are NOT generating template advice. You are generating YOUR OWN goals for THIS specific business — based on what you know about their industry, their pain points, and what matters most in the first 30 days.

Think like a real CEO who just took the job: what would you fix first? What would you build? What would you measure? Who would you call?

---

## OUTPUT FORMAT

You MUST return valid JSON only — no preamble, no explanation, no markdown outside the JSON block. The structure is:

{
  "ceoAssessment": "A 2-4 sentence first-person assessment of the business situation. Honest. Direct. What you see.",
  "goals": [
    {
      "id": "goal-1",
      "title": "Short goal title",
      "priority": "critical|high|medium",
      "rationale": "1-2 sentences: why this goal, why now.",
      "successCriteria": "What done looks like. Measurable if possible.",
      "targetDays": 30,
      "tasks": [
        {
          "agentId": "executor|mind|voice",
          "title": "Task title",
          "brief": "Full task brief — enough for the agent to execute without asking clarifying questions.",
          "dueInDays": 7
        }
      ]
    }
  ],
  "founderBriefing": {
    "subject": "One-line subject for the briefing message",
    "body": "The full briefing message to send to the founder. Written in the CEO's voice. No templates. Reads like a real CEO who just walked in, sized up the business, and started moving. Include what you're prioritizing, what you're doing today, and what you need from the founder (if anything)."
  }
}

Rules:
- 3-5 goals maximum. Quality over quantity.
- Critical goals come first. Don't bury the lead.
- Each goal must have 1-3 tasks. No orphan goals.
- Tasks must be assigned to a real agent: executor (operations), mind (research/intel), voice (communications/outreach).
- The founderBriefing.body must be written in the CEO's personality voice (${personalityConfig.label}).
- No placeholder text. No "TBD". No "insert X here". Every field is real.`;
}

function buildReasoningUserPrompt(customerConfig) {
  const { name, industry, industryContext, goals, painPoints, additionalContext } = customerConfig;

  let prompt = `Business: ${name}
Industry: ${industryContext.label}
Regulatory environment: ${industryContext.regulatoryContext}

Key industry metrics I need to own:
${industryContext.keyMetrics.map(m => `- ${m}`).join('\n')}

Common operational tasks for this industry:
${industryContext.commonTasks.map(t => `- ${t}`).join('\n')}`;

  if (goals && goals.length > 0) {
    prompt += `\n\nFounder's stated goals:\n${goals.map(g => `- ${g}`).join('\n')}`;
  }

  if (painPoints && painPoints.length > 0) {
    prompt += `\n\nFounder's stated pain points:\n${painPoints.map(p => `- ${p}`).join('\n')}`;
  }

  if (additionalContext) {
    prompt += `\n\nAdditional context from onboarding:\n${additionalContext}`;
  }

  prompt += `\n\nGenerate my strategic goals and founder briefing now. Return JSON only.`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Briefing formatter — turns the CEO's founderBriefing into a Telegram-ready message
// ---------------------------------------------------------------------------

function formatBriefingForTelegram(businessName, briefing, goals) {
  const priorityEmoji = { critical: 'X', high: '!', medium: '-' };
  const goalLines = goals
    .map(g => `${priorityEmoji[g.priority] || '-'} [${g.priority.toUpperCase()}] ${g.title}`)
    .join('\n');

  return `*${briefing.subject}*

${briefing.body}

---

*My priorities for the next 30 days:*
${goalLines}

---
_${businessName} AI CEO — Your9 by 9 Enterprises_`;
}

// ---------------------------------------------------------------------------
// Write reasoning record — saved to instances/{id}/data/ for audit trail
// ---------------------------------------------------------------------------

function writeReasoningRecord(instanceDir, goalsResult, taskPaths) {
  const dataDir = join(instanceDir, 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const record = {
    generatedAt: new Date().toISOString(),
    model: 'ceo-reasoning',
    goals: goalsResult.goals,
    ceoAssessment: goalsResult.ceoAssessment,
    taskFiles: taskPaths,
    briefingSent: true,
  };

  const recordPath = join(dataDir, 'initial-reasoning.json');
  writeFileSync(recordPath, JSON.stringify(record, null, 2));
  log(`Reasoning record written: ${recordPath}`);
  return recordPath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const isDryRun = !!args['dry-run'];

  if (!args.instance) {
    console.error('Usage: node scripts/your9-ceo-reasoning.mjs --instance <customer-id>');
    console.error('       Add --dry-run to skip Telegram send (generates files only)');
    process.exit(1);
  }

  const customerId = args.instance;
  const instanceDir = join(INSTANCES_DIR, customerId);

  logSection(`CEO REASONING ENGINE — ${customerId}`);
  if (isDryRun) log('DRY RUN — Telegram send disabled');

  // --- Validate instance exists and is active ---

  if (!existsSync(instanceDir)) {
    console.error(`Instance not found: ${customerId}`);
    console.error(`Run provisioning first: node scripts/your9-provision.mjs --name "..." --industry "..."`);
    process.exit(1);
  }

  const customerConfigPath = join(instanceDir, 'config', 'customer.json');
  if (!existsSync(customerConfigPath)) {
    console.error(`Customer config missing: ${customerConfigPath}`);
    process.exit(1);
  }

  const customerConfig = JSON.parse(readFileSync(customerConfigPath, 'utf-8'));
  log(`Instance loaded: ${customerConfig.name} (${customerConfig.industry}, ${customerConfig.tier})`);

  if (customerConfig.status !== 'active') {
    console.error(`Instance status is "${customerConfig.status}" — must be "active" to run reasoning.`);
    console.error(`Complete provisioning and mark the instance active before running this script.`);
    process.exit(1);
  }

  // Check if reasoning has already run (idempotent guard)
  const existingReasoningPath = join(instanceDir, 'data', 'initial-reasoning.json');
  if (existsSync(existingReasoningPath)) {
    log(`WARNING: initial-reasoning.json already exists — this instance has already been reasoned.`);
    log(`Delete ${existingReasoningPath} to force a re-run.`);
    console.error(`Reasoning already completed for this instance. Delete initial-reasoning.json to re-run.`);
    process.exit(1);
  }

  // --- Load instance credentials ---

  const envPath = join(instanceDir, 'config', '.env');
  const instanceEnv = loadEnvFile(envPath);

  // Anthropic key: prefer instance key, fall back to platform key
  const anthropicKey = instanceEnv.ANTHROPIC_API_KEY &&
    !instanceEnv.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')
    ? instanceEnv.ANTHROPIC_API_KEY
    : process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    console.error(`No Anthropic API key found. Set ANTHROPIC_API_KEY in ${envPath} or in environment.`);
    process.exit(1);
  }

  const botToken = instanceEnv.TELEGRAM_BOT_TOKEN &&
    !instanceEnv.TELEGRAM_BOT_TOKEN.startsWith('PLACEHOLDER')
    ? instanceEnv.TELEGRAM_BOT_TOKEN : null;

  const ownerChatId = instanceEnv.TELEGRAM_OWNER_CHAT_ID &&
    !instanceEnv.TELEGRAM_OWNER_CHAT_ID.startsWith('PLACEHOLDER')
    ? instanceEnv.TELEGRAM_OWNER_CHAT_ID : null;

  if (!isDryRun && (!botToken || !ownerChatId)) {
    console.error(`Telegram credentials not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_CHAT_ID`);
    console.error(`in ${envPath}, or use --dry-run to skip the Telegram send.`);
    process.exit(1);
  }

  // --- Determine CEO model ---
  // Always use Opus for initial reasoning — this is a one-time cost, not ongoing.
  // The goal quality here sets the entire direction of the business. Do not cheap out.
  const ceoModel = 'claude-opus-4-20250514';
  log(`CEO model: ${ceoModel} (forced Opus for initial reasoning — quality over cost)`);

  // --- Load CEO system prompt ---

  const ceoSystemPromptPath = join(instanceDir, 'prompts', 'ceo-system-prompt.md');
  let ceoSystemPrompt = '';
  if (existsSync(ceoSystemPromptPath)) {
    ceoSystemPrompt = readFileSync(ceoSystemPromptPath, 'utf-8');
    log(`CEO system prompt loaded (${ceoSystemPrompt.length} chars)`);
  } else {
    log(`WARNING: CEO system prompt not found — proceeding without it`);
  }

  // --- Build reasoning prompts ---

  logSection('STEP 1 — Building reasoning prompts');
  const systemPrompt = buildReasoningSystemPrompt(customerConfig, ceoSystemPrompt);
  const userPrompt = buildReasoningUserPrompt(customerConfig);
  log(`System prompt: ${systemPrompt.length} chars`);
  log(`User prompt: ${userPrompt.length} chars`);

  // --- Call Opus to generate strategic goals ---

  logSection('STEP 2 — CEO reasoning (Opus)');
  log(`Sending to Opus for initial strategic reasoning...`);

  let rawResponse;
  try {
    rawResponse = await callClaude(anthropicKey, ceoModel, systemPrompt, userPrompt, 8192);
  } catch (e) {
    console.error(`CEO model call failed: ${e.message}`);
    log(`FATAL: Opus call failed — ${e.message}`);
    process.exit(1);
  }

  // --- Parse goals ---

  logSection('STEP 3 — Parsing goals');
  let goalsResult;
  try {
    goalsResult = parseGoalsFromResponse(rawResponse);
    log(`Parsed ${goalsResult.goals?.length || 0} goals`);
  } catch (e) {
    console.error(`Goal parsing failed: ${e.message}`);
    // Write the raw response for debugging before dying
    const debugPath = join(instanceDir, 'data', 'reasoning-debug.txt');
    if (!existsSync(join(instanceDir, 'data'))) mkdirSync(join(instanceDir, 'data'), { recursive: true });
    writeFileSync(debugPath, rawResponse);
    log(`Raw Opus response written to ${debugPath} for debugging`);
    process.exit(1);
  }

  // Validate structure
  if (!goalsResult.goals || !Array.isArray(goalsResult.goals) || goalsResult.goals.length === 0) {
    console.error(`CEO model returned no goals. Check the response structure.`);
    process.exit(1);
  }
  if (!goalsResult.founderBriefing?.body) {
    console.error(`CEO model returned no founder briefing.`);
    process.exit(1);
  }

  log(`Assessment: ${goalsResult.ceoAssessment?.slice(0, 100)}...`);
  for (const goal of goalsResult.goals) {
    const taskCount = goal.tasks?.length || 0;
    log(`  Goal [${goal.priority}]: ${goal.title} — ${taskCount} task(s)`);
  }

  // --- Write task files ---

  logSection('STEP 4 — Writing task files');
  const taskDir = join(instanceDir, 'data', 'tasks');
  if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });

  const taskPaths = [];
  for (const goal of goalsResult.goals) {
    if (!goal.tasks || goal.tasks.length === 0) continue;
    for (const task of goal.tasks) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (task.dueInDays || 7));

      const taskEntry = {
        goalId: goal.id,
        goalTitle: goal.title,
        goalPriority: goal.priority,
        agentId: task.agentId,
        title: task.title,
        brief: task.brief,
        dueInDays: task.dueInDays || 7,
        dueDate: dueDate.toISOString(),
        source: 'ceo-initial-reasoning',
      };

      // Stagger timestamps so filenames are unique (1ms apart)
      await new Promise(resolve => setTimeout(resolve, 1));
      const taskPath = writeTaskFile(taskDir, taskEntry);
      taskPaths.push(taskPath);
    }
  }

  log(`${taskPaths.length} task file(s) written to ${taskDir}`);

  // --- Format and send founder briefing ---

  logSection('STEP 5 — Founder briefing');
  const { founderBriefing, goals } = goalsResult;
  const briefingMessage = formatBriefingForTelegram(customerConfig.name, founderBriefing, goals);

  log(`Briefing message (${briefingMessage.length} chars):`);
  log(`---`);
  console.log(briefingMessage);
  log(`---`);

  if (isDryRun) {
    log(`DRY RUN — Telegram send skipped`);
  } else {
    log(`Sending briefing to founder via Telegram (chat: ${ownerChatId})...`);
    try {
      await sendTelegramMessage(botToken, ownerChatId, briefingMessage);
      log(`Briefing sent successfully`);
    } catch (e) {
      log(`Telegram send failed: ${e.message}`);
      console.error(`WARNING: Briefing generated but Telegram send failed: ${e.message}`);
      // Non-fatal — goals and tasks are written. Log the failure and continue.
    }
  }

  // --- Save reasoning record ---

  logSection('STEP 6 — Saving reasoning record');
  const recordPath = writeReasoningRecord(instanceDir, goalsResult, taskPaths);

  // Update customer config to mark reasoning complete
  customerConfig.reasoningCompletedAt = new Date().toISOString();
  customerConfig.initialGoalCount = goalsResult.goals.length;
  customerConfig.initialTaskCount = taskPaths.length;
  writeFileSync(customerConfigPath, JSON.stringify(customerConfig, null, 2));
  log(`Customer config updated with reasoning metadata`);

  // --- Summary ---

  logSection('CEO REASONING COMPLETE');
  console.log('');
  console.log(`  Instance:       ${customerId}`);
  console.log(`  Business:       ${customerConfig.name}`);
  console.log(`  Goals created:  ${goalsResult.goals.length}`);
  console.log(`  Tasks written:  ${taskPaths.length}`);
  console.log(`  Briefing sent:  ${isDryRun ? 'NO (dry run)' : 'YES'}`);
  console.log(`  Record saved:   ${recordPath}`);
  console.log('');
  console.log('  CEO Assessment:');
  console.log(`    "${goalsResult.ceoAssessment}"`);
  console.log('');
  console.log('  Goals:');
  for (const goal of goalsResult.goals) {
    const taskCount = goal.tasks?.length || 0;
    console.log(`    [${goal.priority.toUpperCase()}] ${goal.title} (${taskCount} task${taskCount !== 1 ? 's' : ''})`);
  }
  console.log('');
  console.log('  Next step:');
  console.log(`    Start the hub: node scripts/your9-hub.mjs --instance ${customerId}`);
  console.log(`    The hub will pick up the ${taskPaths.length} pending task(s) and begin executing.`);
  console.log('');
}

main().catch(err => {
  console.error(`CEO REASONING FAILED: ${err.message}`);
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
