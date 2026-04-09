#!/usr/bin/env node
/**
 * your9-agent-collab.mjs — Inter-Agent Collaboration & Task Handoff System
 * Your9 by 9 Enterprises
 *
 * Enables agents to pass tasks to each other, share context, and escalate
 * to the CEO — making the agent team feel like a real team, not three
 * isolated bots.
 *
 * Features:
 *   1. Agent-to-agent handoffs via [HANDOFF:target-agent] directive
 *   2. Shared context store at instances/{id}/data/shared-context.json
 *   3. CEO escalation via [ESCALATE] directive
 *   4. Full handoff audit log at instances/{id}/data/handoffs/
 *
 * Example flows:
 *   Mind researches a competitor → [HANDOFF:voice] draft outreach email
 *   Executor hits a blocker     → [ESCALATE] flag for CEO decision
 *   Voice drafts a post         → [HANDOFF:executor] schedule this post
 *
 * Integration (your9-hub.mjs calls these after agent execution):
 *   import { processAgentDirectives } from './your9-agent-collab.mjs';
 *   const collabResult = await processAgentDirectives(hub, agentId, agentOutput);
 *
 * Design:
 *   - No external SDK deps. Raw HTTPS only (matches your9-hub.mjs).
 *   - All state written to disk — crash-safe.
 *   - Handoff depth capped at 3 to prevent infinite loops.
 *   - Shared context uses atomic write (temp file + rename via writeFileSync).
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, readdirSync, renameSync
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Maximum handoff chain depth — prevents A→B→C→A infinite loops
const MAX_HANDOFF_DEPTH = 3;

// Maximum shared context file size (bytes) before old keys are pruned
const MAX_CONTEXT_SIZE = 64 * 1024; // 64 KB

// ---------------------------------------------------------------------------
// Handoff directive parser
//
// Agents can embed these directives anywhere in their response text:
//
//   [HANDOFF:voice] Draft a follow-up email to {name} based on this research.
//   [HANDOFF:executor] Schedule this post for Tuesday at 9am.
//   [ESCALATE] I cannot proceed without a decision on the pricing tier.
//
// Multiple directives may appear in a single response. Each is captured as a
// standalone block — from the directive tag to the next tag or end of text.
// ---------------------------------------------------------------------------

/**
 * Parse [HANDOFF:target] directives from agent output.
 *
 * Returns an array of { targetAgentId, task } objects.
 * The task text is everything after the directive tag until the next
 * directive tag or end of string.
 */
export function parseHandoffs(text) {
  const handoffs = [];
  // Match [HANDOFF:agentid] followed by task text until next directive or end
  const re = /\[HANDOFF:(\w+)\]\s*([\s\S]+?)(?=\[HANDOFF:|!\[ESCALATE\]|\[ESCALATE\]|$)/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const task = match[2].trim();
    if (task) {
      handoffs.push({
        targetAgentId: match[1].toLowerCase(),
        task,
      });
    }
  }
  return handoffs;
}

/**
 * Parse [ESCALATE] directive from agent output.
 *
 * Returns the escalation message string, or null if no escalation.
 * Captures everything after [ESCALATE] until the next directive or end.
 */
export function parseEscalation(text) {
  const re = /\[ESCALATE\]\s*([\s\S]+?)(?=\[HANDOFF:|!\[ESCALATE\]|$)/i;
  const match = re.exec(text);
  if (!match) return null;
  return match[1].trim() || null;
}

/**
 * Strip all collab directives from agent text before presenting to the owner.
 * Leaves only the human-readable portion of the response.
 */
export function stripCollabDirectives(text) {
  return text
    .replace(/\[HANDOFF:\w+\][\s\S]*?(?=\[HANDOFF:|!\[ESCALATE\]|\[ESCALATE\]|$)/gi, '')
    .replace(/\[ESCALATE\][\s\S]*/gi, '')
    .trim();
}

/**
 * Returns true if the agent output contains any collab directive.
 */
export function hasCollabDirectives(text) {
  return /\[HANDOFF:\w+\]/i.test(text) || /\[ESCALATE\]/i.test(text);
}

// ---------------------------------------------------------------------------
// Handoff log — one JSON file per handoff in instances/{id}/data/handoffs/
// ---------------------------------------------------------------------------

function ensureHandoffDir(instanceDir) {
  const dir = join(instanceDir, 'data', 'handoffs');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write a handoff record to disk and return the log file path.
 * Status transitions: 'queued' → 'executing' → 'completed' | 'failed'
 */
function logHandoff(instanceDir, record) {
  const dir = ensureHandoffDir(instanceDir);
  const filename = `${Date.now()}-${record.fromAgentId}-to-${record.toAgentId}.json`;
  const filePath = join(dir, filename);
  const entry = {
    ...record,
    loggedAt: new Date().toISOString(),
  };
  try {
    writeFileSync(filePath, JSON.stringify(entry, null, 2));
  } catch (e) {
    _log(`Handoff log write failed (non-fatal): ${e.message}`);
  }
  return filePath;
}

function updateHandoffLog(filePath, updates) {
  try {
    const existing = JSON.parse(readFileSync(filePath, 'utf-8'));
    writeFileSync(filePath, JSON.stringify({ ...existing, ...updates }, null, 2));
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------------------------------
// Shared context store — instances/{id}/data/shared-context.json
//
// All agents can read and write. Used to share findings, decisions, and state
// across handoff chains without repeating long context in every task string.
//
// Structure:
// {
//   "lastUpdated": "ISO timestamp",
//   "entries": {
//     "key": { "value": any, "writtenBy": "agentId", "writtenAt": "ISO" }
//   }
// }
// ---------------------------------------------------------------------------

function getSharedContextPath(instanceDir) {
  const dataDir = join(instanceDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  return join(dataDir, 'shared-context.json');
}

/**
 * Read the entire shared context store for an instance.
 * Returns the entries object (key → { value, writtenBy, writtenAt }).
 * Returns {} if the file doesn't exist yet.
 */
export function readSharedContext(instanceDir) {
  const ctxPath = getSharedContextPath(instanceDir);
  if (!existsSync(ctxPath)) return {};
  try {
    const raw = JSON.parse(readFileSync(ctxPath, 'utf-8'));
    return raw.entries || {};
  } catch {
    return {};
  }
}

/**
 * Write one or more keys to the shared context store.
 *
 * @param {string} instanceDir  - Instance directory path
 * @param {string} writtenBy    - Agent ID writing the context
 * @param {Object} keyValues    - { key: value } pairs to write/update
 */
export function writeSharedContext(instanceDir, writtenBy, keyValues) {
  const ctxPath = getSharedContextPath(instanceDir);

  // Read current state
  let current = { lastUpdated: null, entries: {} };
  if (existsSync(ctxPath)) {
    try {
      current = JSON.parse(readFileSync(ctxPath, 'utf-8'));
      if (!current.entries) current.entries = {};
    } catch {
      current = { lastUpdated: null, entries: {} };
    }
  }

  // Merge new values
  const ts = new Date().toISOString();
  for (const [key, value] of Object.entries(keyValues)) {
    current.entries[key] = { value, writtenBy, writtenAt: ts };
  }
  current.lastUpdated = ts;

  // Prune if file would exceed size limit — remove oldest entries first
  let serialized = JSON.stringify(current, null, 2);
  if (Buffer.byteLength(serialized) > MAX_CONTEXT_SIZE) {
    const sorted = Object.entries(current.entries)
      .sort((a, b) => (a[1].writtenAt < b[1].writtenAt ? -1 : 1));
    while (Buffer.byteLength(serialized) > MAX_CONTEXT_SIZE && sorted.length > 5) {
      const [oldKey] = sorted.shift();
      delete current.entries[oldKey];
      serialized = JSON.stringify(current, null, 2);
    }
  }

  // Atomic-ish write: temp file + rename
  const tmpPath = ctxPath + '.tmp';
  try {
    writeFileSync(tmpPath, serialized);
    renameSync(tmpPath, ctxPath);
  } catch (e) {
    _log(`Shared context write failed: ${e.message}`);
  }
}

/**
 * Build a compact shared-context summary string to prepend to agent tasks.
 * Only includes entries relevant to the receiving agent's task (all entries
 * for now — context is small enough to include fully).
 */
export function buildContextSummary(instanceDir) {
  const entries = readSharedContext(instanceDir);
  const keys = Object.keys(entries);
  if (keys.length === 0) return '';

  const lines = keys.map(k => {
    const e = entries[k];
    const val = typeof e.value === 'string' ? e.value : JSON.stringify(e.value);
    return `- ${k} (from ${e.writtenBy}): ${val.slice(0, 300)}`;
  });

  return `## Shared Team Context\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Internal logger — mirrors the hub's log style
// ---------------------------------------------------------------------------

function _log(msg) {
  const ts = new Date().toISOString();
  try { process.stdout.write(`[${ts}] COLLAB: ${msg}\n`); } catch {}
}

// ---------------------------------------------------------------------------
// CEO escalation handler
//
// When an agent uses [ESCALATE], the item is:
//   1. Logged to the handoff directory with status 'escalated'
//   2. Sent to the founder via Telegram immediately (non-batched)
//   3. Noted in the shared context so other agents see the escalation
// ---------------------------------------------------------------------------

async function handleEscalation(hub, fromAgentId, escalationMessage, sendTelegram) {
  const { instanceDir, botToken, ownerChatId, agentConfigs } = hub;
  const agentName = agentConfigs[fromAgentId]?.name || fromAgentId;

  _log(`Escalation from ${fromAgentId}: "${escalationMessage.slice(0, 100)}"`);

  // Log the escalation
  const logPath = logHandoff(instanceDir, {
    type: 'escalation',
    fromAgentId,
    fromAgentName: agentName,
    toAgentId: 'ceo',
    toAgentName: 'CEO',
    task: escalationMessage,
    status: 'escalated',
    escalatedAt: new Date().toISOString(),
  });

  // Write to shared context so all agents know something was escalated
  writeSharedContext(instanceDir, fromAgentId, {
    [`escalation_from_${fromAgentId}`]: `${agentName} escalated: ${escalationMessage.slice(0, 200)}`,
  });

  // Surface to founder via Telegram immediately
  if (botToken && ownerChatId && sendTelegram) {
    try {
      const msg = `*[${agentName.toUpperCase()} ESCALATION]*\n\n${escalationMessage}\n\n_Your ${agentName} needs a decision before proceeding. Reply here and I'll route it back._`;
      await sendTelegram(botToken, ownerChatId, msg);
      updateHandoffLog(logPath, { telegramSent: true, telegramSentAt: new Date().toISOString() });
    } catch (e) {
      _log(`Escalation Telegram send failed (non-fatal): ${e.message}`);
      updateHandoffLog(logPath, { telegramSent: false, telegramError: e.message });
    }
  }

  return {
    type: 'escalation',
    fromAgentId,
    message: escalationMessage,
    logPath,
  };
}

// ---------------------------------------------------------------------------
// Handoff executor
//
// Executes one handoff: runs the target agent with the handoff task (plus
// shared context prepended), logs everything, and returns the agent result.
//
// The executeAgentTask function must be passed in by the hub (to avoid a
// circular import — hub imports this module, this module calls back into
// hub logic via a passed-in function reference).
// ---------------------------------------------------------------------------

async function executeHandoff(hub, fromAgentId, targetAgentId, task, depth, executeAgentTask) {
  const { instanceDir, agentConfigs, taskDir } = hub;
  const fromName = agentConfigs[fromAgentId]?.name || fromAgentId;
  const targetName = agentConfigs[targetAgentId]?.name || targetAgentId;
  const targetConf = agentConfigs[targetAgentId];

  if (!targetConf) {
    const errMsg = `Handoff target "${targetAgentId}" not found in this instance — skipping`;
    _log(errMsg);
    return { success: false, error: errMsg, targetAgentId };
  }

  _log(`Handoff [depth ${depth}]: ${fromAgentId} → ${targetAgentId}: "${task.slice(0, 80)}"`);

  // Log the handoff with 'queued' status
  const logPath = logHandoff(instanceDir, {
    type: 'handoff',
    fromAgentId,
    fromAgentName: fromName,
    toAgentId: targetAgentId,
    toAgentName: targetName,
    task: task.slice(0, 2000),
    status: 'executing',
    depth,
    startedAt: new Date().toISOString(),
  });

  // Prepend shared context to the task so the target agent has full picture
  const contextSummary = buildContextSummary(instanceDir);
  const fullTask = contextSummary
    ? `${contextSummary}\n\n## Your Task (handed off from ${fromName})\n${task}`
    : `## Your Task (handed off from ${fromName})\n${task}`;

  try {
    const result = await executeAgentTask(
      hub.anthropicKey,
      targetAgentId,
      targetConf,
      instanceDir,
      fullTask,
      taskDir,
      hub
    );

    updateHandoffLog(logPath, {
      status: 'completed',
      result: (result || '').slice(0, 2000),
      completedAt: new Date().toISOString(),
    });

    // Write key output to shared context so subsequent agents can reference it
    writeSharedContext(instanceDir, targetAgentId, {
      [`${targetAgentId}_last_output`]: (result || '').slice(0, 500),
    });

    _log(`Handoff completed: ${fromAgentId} → ${targetAgentId}`);
    return { success: true, result, targetAgentId, logPath };

  } catch (e) {
    _log(`Handoff failed: ${fromAgentId} → ${targetAgentId}: ${e.message}`);
    updateHandoffLog(logPath, {
      status: 'failed',
      error: e.message,
      failedAt: new Date().toISOString(),
    });
    return { success: false, error: e.message, targetAgentId, logPath };
  }
}

// ---------------------------------------------------------------------------
// Main entry point — called by the hub after every agent execution
//
// Scans the agent's output for [HANDOFF:] and [ESCALATE] directives,
// executes them in order, and returns a structured result the hub can use
// to build a synthesis response for the CEO.
//
// @param {Object} hub             - The hub state object (from your9-hub.mjs)
// @param {string} fromAgentId     - ID of the agent whose output we're scanning
// @param {string} agentOutput     - The raw text output from that agent
// @param {Function} executeAgentTask - hub's executeAgentTask function (injected)
// @param {Function} sendTelegram  - hub's sendTelegramMessage function (injected)
// @param {number} [depth=0]       - Current handoff chain depth (loop guard)
//
// Returns:
// {
//   hasDirectives: boolean,
//   escalation: null | { fromAgentId, message, logPath },
//   handoffs: [{ success, targetAgentId, result?, error?, logPath }],
//   summary: string   — human-readable summary for CEO synthesis
// }
// ---------------------------------------------------------------------------

export async function processAgentDirectives(
  hub,
  fromAgentId,
  agentOutput,
  executeAgentTask,
  sendTelegram,
  depth = 0
) {
  const result = {
    hasDirectives: false,
    escalation: null,
    handoffs: [],
    summary: '',
  };

  if (!agentOutput || !hasCollabDirectives(agentOutput)) {
    return result;
  }

  result.hasDirectives = true;
  const summaryParts = [];

  // --- Handle escalation first (highest priority) ---
  const escalationMessage = parseEscalation(agentOutput);
  if (escalationMessage) {
    result.escalation = await handleEscalation(hub, fromAgentId, escalationMessage, sendTelegram);
    summaryParts.push(`*Escalation flagged by ${agentConfName(hub, fromAgentId)}* — founder notified via Telegram.`);
  }

  // --- Handle handoffs ---
  const handoffs = parseHandoffs(agentOutput);

  if (handoffs.length > 0 && depth >= MAX_HANDOFF_DEPTH) {
    _log(`Handoff depth limit (${MAX_HANDOFF_DEPTH}) reached — suppressing ${handoffs.length} handoff(s) from ${fromAgentId}`);
    summaryParts.push(`_Handoff chain depth limit reached — ${handoffs.length} handoff(s) suppressed to prevent loops._`);
  } else {
    for (const handoff of handoffs) {
      const handoffResult = await executeHandoff(
        hub,
        fromAgentId,
        handoff.targetAgentId,
        handoff.task,
        depth + 1,
        executeAgentTask
      );
      result.handoffs.push(handoffResult);

      if (handoffResult.success) {
        const targetName = agentConfName(hub, handoff.targetAgentId);
        summaryParts.push(
          `*${agentConfName(hub, fromAgentId)} → ${targetName} handoff complete.*\n${(handoffResult.result || '').slice(0, 600)}`
        );

        // Recursively process directives in the target's output (with depth guard)
        if (handoffResult.result && hasCollabDirectives(handoffResult.result)) {
          _log(`Target agent ${handoff.targetAgentId} has further directives — processing recursively at depth ${depth + 1}`);
          const nested = await processAgentDirectives(
            hub,
            handoff.targetAgentId,
            handoffResult.result,
            executeAgentTask,
            sendTelegram,
            depth + 1
          );
          if (nested.hasDirectives && nested.summary) {
            summaryParts.push(nested.summary);
          }
        }
      } else {
        summaryParts.push(
          `*Handoff to ${handoff.targetAgentId} failed:* ${handoffResult.error}`
        );
      }
    }
  }

  result.summary = summaryParts.join('\n\n');
  return result;
}

// ---------------------------------------------------------------------------
// Utility — get display name for an agent from hub config
// ---------------------------------------------------------------------------

function agentConfName(hub, agentId) {
  return hub.agentConfigs?.[agentId]?.name || agentId;
}

// ---------------------------------------------------------------------------
// Handoff log reader — used by the hub's health endpoint and dashboard
//
// Returns the last N handoff records sorted newest-first.
// ---------------------------------------------------------------------------

export function readRecentHandoffs(instanceDir, limit = 20) {
  const dir = join(instanceDir, 'data', 'handoffs');
  if (!existsSync(dir)) return [];

  try {
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit);

    return files
      .map(f => {
        try {
          return JSON.parse(readFileSync(join(dir, f), 'utf-8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Standalone test — validates parser logic without a live instance
//
// Run: node scripts/your9-agent-collab.mjs --test
// ---------------------------------------------------------------------------

if (process.argv.includes('--test')) {
  console.log('=== your9-agent-collab.mjs self-test ===\n');

  const sample1 = `
I've finished researching BrightPath Mortgage. They have strong rates but weak digital presence.

[HANDOFF:voice] Draft a cold outreach email to BrightPath Mortgage. Key talking points:
- Their SEO is thin — we can help.
- Their rates are competitive, their brand isn't.
- Position our service as growth infrastructure, not a vendor.
Keep it under 150 words, conversational, from the CEO.

[HANDOFF:executor] Log BrightPath Mortgage as a prospect in the pipeline with status "outreach-pending".
`;

  const h1 = parseHandoffs(sample1);
  console.log('parseHandoffs (2 expected):');
  console.log(JSON.stringify(h1, null, 2));
  console.assert(h1.length === 2, 'Expected 2 handoffs');
  console.assert(h1[0].targetAgentId === 'voice', 'First target should be voice');
  console.assert(h1[1].targetAgentId === 'executor', 'Second target should be executor');

  const e1 = parseEscalation(sample1);
  console.log('\nparseEscalation (null expected):', e1);
  console.assert(e1 === null, 'Expected no escalation');

  const sample2 = `
I cannot complete this task without more information.

[ESCALATE] The client asked for a 30-day pilot at no cost, but our standard terms require a 90-day commitment. I need a CEO decision on whether to offer the exception before I respond.
`;

  const h2 = parseHandoffs(sample2);
  const e2 = parseEscalation(sample2);
  console.log('\nparseHandoffs on escalation-only (0 expected):', h2.length);
  console.log('parseEscalation:', e2?.slice(0, 80));
  console.assert(h2.length === 0, 'Expected 0 handoffs in escalation-only sample');
  console.assert(e2 !== null, 'Expected escalation to be present');

  const stripped = stripCollabDirectives(sample1);
  console.log('\nstripCollabDirectives output:');
  console.log(stripped);
  console.assert(!stripped.includes('[HANDOFF'), 'Stripped text should not contain directives');

  console.log('\nhasCollabDirectives:', hasCollabDirectives(sample1), '(true expected)');
  console.log('hasCollabDirectives (empty):', hasCollabDirectives('hello world'), '(false expected)');

  // Shared context round-trip (uses /tmp to avoid touching real instances)
  const tmpDir = '/tmp/y9-collab-test';
  mkdirSync(join(tmpDir, 'data'), { recursive: true });
  writeSharedContext(tmpDir, 'mind', { competitor_research: 'BrightPath has weak SEO.' });
  writeSharedContext(tmpDir, 'executor', { pipeline_count: 14 });
  const ctx = readSharedContext(tmpDir);
  console.log('\nShared context round-trip:');
  console.log(JSON.stringify(ctx, null, 2));
  console.assert(ctx.competitor_research?.value === 'BrightPath has weak SEO.', 'Context value mismatch');
  console.assert(ctx.pipeline_count?.value === 14, 'Context numeric value mismatch');

  const summary = buildContextSummary(tmpDir);
  console.log('\nbuildContextSummary:\n', summary);
  console.assert(summary.includes('## Shared Team Context'), 'Summary header missing');

  console.log('\n=== All assertions passed ===');
}
