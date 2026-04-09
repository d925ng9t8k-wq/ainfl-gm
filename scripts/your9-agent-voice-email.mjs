#!/usr/bin/env node
/**
 * your9-agent-voice-email.mjs — Voice Agent Email Capability
 * Your9 by 9 Enterprises
 *
 * Handles the full email approval workflow for the Voice agent:
 *
 *   1. Read an email delegation task from instances/{id}/data/tasks/
 *   2. Use Sonnet to draft the email based on CEO instructions
 *   3. Present the draft to the founder via Telegram for approval
 *   4. Loop: accept "SEND" to send, or revision instructions to redraft
 *   5. On approval, send via Resend API (key read from instance .env)
 *   6. Log the completed task back to instances/{id}/data/tasks/
 *   7. Return a completion report string to the caller (CEO synthesis step)
 *
 * Design principles:
 *   - No external SDK dependencies. Raw HTTPS only (same as your9-hub.mjs).
 *   - Never sends without explicit founder approval ("SEND").
 *   - Revisions loop until approval or explicit cancel ("CANCEL").
 *   - All state is written to disk — the process can be killed mid-flow and
 *     resumed without double-sending.
 *   - Credentials are read from the instance .env — never hardcoded.
 *
 * Usage (standalone, for testing):
 *   node scripts/your9-agent-voice-email.mjs \
 *     --instance <customer-id> \
 *     --task '{"to":"john@example.com","subject":"Follow-up","instructions":"Write a polite follow-up on the open proposal."}'
 *
 * Usage (programmatic, from your9-hub.mjs):
 *   import { handleEmailDelegation } from './your9-agent-voice-email.mjs';
 *   const report = await handleEmailDelegation(hub, delegationTask);
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, readdirSync
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
// .env loader — reads key=value into an object (does not pollute process.env)
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
// Raw HTTPS helpers — same pattern as your9-hub.mjs (no fetch, no SDK)
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
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(buf) });
          } catch {
            resolve({ statusCode: res.statusCode, body: buf });
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('HTTPS request timed out')); });
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

let _logPath = null;

function log(customerId, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] EMAIL-AGENT [${customerId}]: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  if (_logPath) {
    try { appendFileSync(_logPath, line + '\n'); } catch {}
  }
}

function initLog(instanceDir) {
  const logDir = join(instanceDir, 'logs');
  mkdirSync(logDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  _logPath = join(logDir, `voice-email-${today}.log`);
}

// ---------------------------------------------------------------------------
// Anthropic API — draft email via Sonnet
// ---------------------------------------------------------------------------

async function draftEmail(anthropicKey, voiceAgentPrompt, emailSpec, revisionNote = null) {
  const model = 'claude-sonnet-4-5';

  const systemPrompt = voiceAgentPrompt + `

---

## YOUR CURRENT TASK: DRAFT AN EMAIL

You are drafting a real business email that will be sent on behalf of the founder.
Produce ONLY the email body (no subject line, no "From:", no "To:"). The subject and
recipients are handled separately. Write in the founder's voice — professional, direct,
and human. No sycophancy. No filler phrases like "I hope this email finds you well."

When done, output ONLY the email body text. No commentary. No metadata. Just the email.
`;

  const userContent = revisionNote
    ? `Original instructions:\n${emailSpec.instructions}\n\nRevision requested:\n${revisionNote}\n\nPrevious draft for reference:\n${emailSpec.lastDraft}\n\nPlease produce the revised email body.`
    : `Draft an email with these instructions:\n\n${emailSpec.instructions}\n\nRecipient: ${emailSpec.to}\nSubject: ${emailSpec.subject}`;

  const result = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    {
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }
  );

  if (result.body.error) {
    throw new Error(`Anthropic API error: ${result.body.error.message || JSON.stringify(result.body.error)}`);
  }

  const text = result.body.content?.[0]?.text;
  if (!text) {
    throw new Error(`Anthropic returned no content: ${JSON.stringify(result.body).slice(0, 200)}`);
  }

  return text.trim();
}

// ---------------------------------------------------------------------------
// Telegram helpers
// ---------------------------------------------------------------------------

async function sendTelegramMessage(botToken, chatId, text) {
  const MAX = 4000;
  const chunks = [];
  let remaining = String(text);
  while (remaining.length > MAX) {
    chunks.push(remaining.slice(0, MAX));
    remaining = remaining.slice(MAX);
  }
  chunks.push(remaining);

  for (const chunk of chunks) {
    try {
      await httpsPost('api.telegram.org', `/bot${botToken}/sendMessage`, {}, {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
      });
    } catch {
      // Fallback to plain text if Markdown parse fails
      try {
        await httpsPost('api.telegram.org', `/bot${botToken}/sendMessage`, {}, {
          chat_id: chatId,
          text: chunk,
        });
      } catch (e) {
        throw new Error(`Telegram send failed: ${e.message}`);
      }
    }
  }
}

/**
 * Poll Telegram for the next message from ownerChatId.
 * Returns { text, updateId } or throws on timeout.
 * Timeout: 5 minutes (founder has 5 min to respond before the agent reports a timeout).
 */
async function waitForFounderReply(botToken, ownerChatId, fromOffset, timeoutMs = 5 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  let offset = fromOffset;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const pollTimeout = Math.min(25, Math.floor(remaining / 1000));
    if (pollTimeout <= 0) break;

    try {
      const result = await new Promise((resolve, reject) => {
        const path = `/bot${botToken}/getUpdates?offset=${offset}&timeout=${pollTimeout}&allowed_updates=["message"]`;
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
        req.setTimeout((pollTimeout + 10) * 1000, () => { req.destroy(); resolve({ ok: true, result: [] }); });
        req.end();
      });

      if (!result.ok || !result.result?.length) continue;

      for (const update of result.result) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (msg && String(msg.chat?.id) === String(ownerChatId) && msg.text) {
          return { text: msg.text.trim(), nextOffset: offset };
        }
      }
    } catch {
      // Poll errors are non-fatal — retry
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  throw new Error('Approval timeout — no response from founder within 5 minutes');
}

// ---------------------------------------------------------------------------
// Resend API — send the email
// ---------------------------------------------------------------------------

async function sendViaResend(resendKey, { from, to, subject, body }) {
  const result = await httpsPost(
    'api.resend.com',
    '/emails',
    { 'Authorization': `Bearer ${resendKey}` },
    { from, to, subject, html: bodyToHtml(body), text: body }
  );

  if (result.statusCode >= 400) {
    const errMsg = typeof result.body === 'object'
      ? (result.body.message || result.body.error || JSON.stringify(result.body))
      : String(result.body);
    throw new Error(`Resend API error (HTTP ${result.statusCode}): ${errMsg}`);
  }

  const emailId = result.body?.id || 'unknown';
  return emailId;
}

/**
 * Convert plain text email body to minimal HTML for Resend.
 * Preserves line breaks, avoids HTML injection.
 */
function bodyToHtml(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const paragraphs = escaped
    .split(/\n\n+/)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;line-height:1.6;max-width:600px;margin:0 auto;padding:20px">${paragraphs}</body></html>`;
}

// ---------------------------------------------------------------------------
// Task file management
// ---------------------------------------------------------------------------

function writeTaskFile(taskDir, taskId, data) {
  mkdirSync(taskDir, { recursive: true });
  const taskPath = join(taskDir, `${taskId}-email-task.json`);
  writeFileSync(taskPath, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2));
  return taskPath;
}

function updateTaskFile(taskPath, updates) {
  try {
    const existing = JSON.parse(readFileSync(taskPath, 'utf-8'));
    writeFileSync(taskPath, JSON.stringify(
      { ...existing, ...updates, updatedAt: new Date().toISOString() },
      null, 2
    ));
  } catch {
    // Non-fatal
  }
}

/**
 * Find the latest pending email delegation task in the task directory.
 * Returns the parsed task object or null if none found.
 */
function findPendingEmailTask(taskDir) {
  if (!existsSync(taskDir)) return null;
  try {
    const files = readdirSync(taskDir)
      .filter(f => f.endsWith('-email-task.json'))
      .sort()
      .reverse(); // Most recent first

    for (const f of files) {
      try {
        const task = JSON.parse(readFileSync(join(taskDir, f), 'utf-8'));
        if (task.status === 'pending_approval' || task.status === 'draft') {
          return { ...task, _filePath: join(taskDir, f) };
        }
      } catch { /* skip malformed files */ }
    }
  } catch { /* non-fatal */ }
  return null;
}

// ---------------------------------------------------------------------------
// Core approval workflow
// ---------------------------------------------------------------------------

/**
 * Run the full email approval workflow.
 *
 * @param {object} params
 * @param {string} params.customerId
 * @param {string} params.instanceDir
 * @param {string} params.anthropicKey
 * @param {string} params.resendKey        - From instance .env RESEND_API_KEY
 * @param {string} params.emailFrom        - From instance .env EMAIL_FROM
 * @param {string} params.botToken         - Telegram bot token
 * @param {string} params.ownerChatId      - Telegram chat ID for the founder
 * @param {string} params.voiceAgentPrompt - The Voice agent's system prompt text
 * @param {object} params.emailSpec        - { to, subject, instructions }
 * @param {string} params.taskDir          - Path to instances/{id}/data/tasks/
 * @param {number} [params.telegramOffset] - Starting offset for Telegram polling
 *
 * @returns {Promise<string>} Completion report for the CEO
 */
async function runEmailApprovalWorkflow(params) {
  const {
    customerId,
    instanceDir,
    anthropicKey,
    resendKey,
    emailFrom,
    botToken,
    ownerChatId,
    voiceAgentPrompt,
    emailSpec,
    taskDir,
  } = params;

  const taskId = `${Date.now()}`;
  let taskPath = writeTaskFile(taskDir, taskId, {
    type: 'email',
    agentId: 'voice',
    status: 'drafting',
    to: emailSpec.to,
    subject: emailSpec.subject,
    instructions: emailSpec.instructions,
    createdAt: new Date().toISOString(),
  });

  log(customerId, `Email task ${taskId} started — drafting for: ${emailSpec.to}`);

  // --- STEP 1: Draft the email ---
  let draft;
  try {
    draft = await draftEmail(anthropicKey, voiceAgentPrompt, emailSpec);
  } catch (e) {
    const errMsg = `Failed to draft email: ${e.message}`;
    log(customerId, errMsg);
    updateTaskFile(taskPath, { status: 'failed', error: errMsg });
    return `Email task failed at draft stage: ${e.message}`;
  }

  updateTaskFile(taskPath, { status: 'pending_approval', currentDraft: draft });
  log(customerId, `Draft complete (${draft.length} chars) — presenting to founder`);

  // --- STEP 2: Present to founder via Telegram ---
  const approvalMessage = buildApprovalMessage(emailSpec, draft);
  try {
    await sendTelegramMessage(botToken, ownerChatId, approvalMessage);
  } catch (e) {
    const errMsg = `Failed to send draft to founder via Telegram: ${e.message}`;
    log(customerId, errMsg);
    updateTaskFile(taskPath, { status: 'failed', error: errMsg });
    return `Email task failed — could not deliver draft to founder: ${e.message}`;
  }

  // --- STEP 3: Approval loop ---
  let currentDraft = draft;
  let revisionCount = 0;
  const MAX_REVISIONS = 5;
  let telegramOffset = params.telegramOffset || 0;

  while (revisionCount <= MAX_REVISIONS) {
    let founderReply;
    try {
      const result = await waitForFounderReply(botToken, ownerChatId, telegramOffset);
      founderReply = result.text;
      telegramOffset = result.nextOffset;
    } catch (e) {
      // Timeout — report back to CEO, leave task in pending state
      log(customerId, `Approval timeout for task ${taskId}: ${e.message}`);
      updateTaskFile(taskPath, { status: 'awaiting_response', timeoutAt: new Date().toISOString() });
      return `Email draft sent to founder for approval but no response received within 5 minutes. Task is on hold — founder can reply "SEND" or provide revisions when ready. Email was addressed to ${emailSpec.to} with subject "${emailSpec.subject}".`;
    }

    const command = founderReply.toUpperCase().trim();
    log(customerId, `Founder reply: "${founderReply.slice(0, 80)}"`);

    // SEND — approve and send
    if (command === 'SEND') {
      log(customerId, `Founder approved — sending via Resend`);
      updateTaskFile(taskPath, { status: 'sending', approvedAt: new Date().toISOString() });

      let emailId;
      try {
        emailId = await sendViaResend(resendKey, {
          from: emailFrom,
          to: emailSpec.to,
          subject: emailSpec.subject,
          body: currentDraft,
        });
      } catch (e) {
        const errMsg = `Resend API failed: ${e.message}`;
        log(customerId, errMsg);
        updateTaskFile(taskPath, { status: 'send_failed', error: errMsg });
        await sendTelegramMessage(botToken, ownerChatId,
          `Email send failed. Resend API error: ${e.message}\n\nThe draft is saved — reply "SEND" to retry, or "CANCEL" to discard.`
        );
        continue; // Let founder retry
      }

      updateTaskFile(taskPath, {
        status: 'completed',
        sentAt: new Date().toISOString(),
        emailId,
        finalDraft: currentDraft,
      });

      const confirmMsg = `Sent. Email delivered to ${emailSpec.to} via Resend (ID: ${emailId}).`;
      log(customerId, confirmMsg);

      try {
        await sendTelegramMessage(botToken, ownerChatId, confirmMsg);
      } catch { /* confirmation send failure is non-fatal */ }

      return `Email sent successfully. To: ${emailSpec.to} | Subject: "${emailSpec.subject}" | Resend ID: ${emailId} | Revisions: ${revisionCount}`;
    }

    // CANCEL — discard
    if (command === 'CANCEL') {
      log(customerId, `Founder cancelled email task ${taskId}`);
      updateTaskFile(taskPath, { status: 'cancelled', cancelledAt: new Date().toISOString() });
      await sendTelegramMessage(botToken, ownerChatId, 'Email cancelled. Nothing was sent.').catch(() => {});
      return `Email task cancelled by founder. Nothing was sent to ${emailSpec.to}.`;
    }

    // Treat anything else as a revision instruction
    revisionCount++;
    if (revisionCount > MAX_REVISIONS) {
      const maxMsg = `Maximum revisions (${MAX_REVISIONS}) reached. Discarding task. Reply "SEND" to send the current draft or start a new request.`;
      log(customerId, `Max revisions reached for task ${taskId}`);
      updateTaskFile(taskPath, { status: 'max_revisions_reached' });
      await sendTelegramMessage(botToken, ownerChatId, maxMsg).catch(() => {});
      return `Email task exhausted ${MAX_REVISIONS} revision rounds without approval. Task discarded.`;
    }

    log(customerId, `Revision ${revisionCount} requested: "${founderReply.slice(0, 80)}"`);
    updateTaskFile(taskPath, { status: 'revising', revisionCount, revisionNote: founderReply });

    await sendTelegramMessage(botToken, ownerChatId, 'On it — revising now...').catch(() => {});

    const revisionSpec = { ...emailSpec, lastDraft: currentDraft };
    try {
      currentDraft = await draftEmail(anthropicKey, voiceAgentPrompt, revisionSpec, founderReply);
    } catch (e) {
      const errMsg = `Revision ${revisionCount} failed: ${e.message}`;
      log(customerId, errMsg);
      await sendTelegramMessage(botToken, ownerChatId,
        `Revision failed: ${e.message}. The previous draft still stands. Reply "SEND" to send it or provide different revision instructions.`
      ).catch(() => {});
      continue;
    }

    updateTaskFile(taskPath, { status: 'pending_approval', currentDraft, revisionCount });
    const revisedMsg = buildApprovalMessage(emailSpec, currentDraft, revisionCount);
    await sendTelegramMessage(botToken, ownerChatId, revisedMsg).catch(() => {});
  }

  return `Email task ended without resolution after ${revisionCount} revisions.`;
}

// ---------------------------------------------------------------------------
// Approval message builder
// ---------------------------------------------------------------------------

function buildApprovalMessage(emailSpec, draft, revisionNumber = 0) {
  const header = revisionNumber === 0
    ? 'Here is the email draft:'
    : `Here is the revised draft (revision ${revisionNumber}):`;

  return [
    header,
    '',
    `*To:* ${emailSpec.to}`,
    `*Subject:* ${emailSpec.subject}`,
    '',
    '```',
    draft,
    '```',
    '',
    'Reply *SEND* to send it, or tell me what to change. Reply *CANCEL* to discard.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Public API — called from your9-hub.mjs during agent delegation
// ---------------------------------------------------------------------------

/**
 * handleEmailDelegation — entry point for hub integration.
 *
 * The CEO delegation task text is parsed for email fields. The hub passes its
 * own state object so this function can read credentials and send Telegram
 * messages through the same bot the hub uses.
 *
 * @param {object} hub         - The hub state object from your9-hub.mjs
 * @param {string} taskText    - Raw delegation task text from the CEO
 * @returns {Promise<string>}  - Completion report for CEO synthesis
 */
export async function handleEmailDelegation(hub, taskText) {
  const {
    anthropicKey,
    botToken,
    ownerChatId,
    instanceDir,
    taskDir,
    instanceConfig,
  } = hub;

  const customerId = instanceConfig.customerId;
  initLog(instanceDir);

  // Load instance .env for Resend credentials
  const instanceEnvPath = join(instanceDir, 'config', '.env');
  const instanceEnv = loadEnvFile(instanceEnvPath);

  const resendKey = instanceEnv.RESEND_API_KEY;
  const emailFrom = instanceEnv.EMAIL_FROM;

  if (!resendKey || resendKey.startsWith('PLACEHOLDER_')) {
    return 'Email capability not configured for this instance. RESEND_API_KEY is missing in instance .env. Ask the owner to configure it.';
  }

  if (!emailFrom || emailFrom.startsWith('PLACEHOLDER_')) {
    return 'Email capability not configured for this instance. EMAIL_FROM is missing in instance .env. Ask the owner to configure it.';
  }

  // Parse email spec from task text
  // The CEO is expected to delegate with structured fields. We extract them
  // with a best-effort parser and fall back to treating the whole text as
  // instructions if structured fields are missing.
  const emailSpec = parseEmailSpec(taskText);

  if (!emailSpec.to) {
    return 'Email task is missing a recipient address (to:). Ask the owner for the recipient and re-delegate.';
  }

  if (!emailSpec.subject) {
    return 'Email task is missing a subject line (subject:). Ask the owner for the subject and re-delegate.';
  }

  // Load Voice agent system prompt for drafting context
  const voicePromptPath = join(instanceDir, 'agents', 'voice', 'system-prompt.md');
  let voiceAgentPrompt = '';
  if (existsSync(voicePromptPath)) {
    voiceAgentPrompt = readFileSync(voicePromptPath, 'utf-8');
  }

  log(customerId, `handleEmailDelegation: to=${emailSpec.to} subject="${emailSpec.subject}"`);

  return runEmailApprovalWorkflow({
    customerId,
    instanceDir,
    anthropicKey,
    resendKey,
    emailFrom,
    botToken,
    ownerChatId,
    voiceAgentPrompt,
    emailSpec,
    taskDir,
    telegramOffset: hub._emailTelegramOffset || 0,
  });
}

// ---------------------------------------------------------------------------
// Email spec parser
//
// Attempts to extract structured email fields from the CEO delegation text.
// The CEO is trained (via agent system prompt) to delegate with this format:
//
//   Send an email.
//   to: john@example.com
//   subject: Follow-up on proposal
//   instructions: Write a warm follow-up referencing our call last Tuesday...
//
// Fields are case-insensitive. Unrecognized lines are appended to instructions.
// ---------------------------------------------------------------------------

function parseEmailSpec(text) {
  const spec = { to: '', subject: '', instructions: '' };
  const lines = text.split('\n');
  const extraLines = [];

  for (const line of lines) {
    const lower = line.toLowerCase().trimStart();
    if (lower.startsWith('to:')) {
      spec.to = line.slice(line.indexOf(':') + 1).trim();
    } else if (lower.startsWith('subject:')) {
      spec.subject = line.slice(line.indexOf(':') + 1).trim();
    } else if (lower.startsWith('instructions:')) {
      spec.instructions = line.slice(line.indexOf(':') + 1).trim();
    } else if (lower.startsWith('body:') || lower.startsWith('message:')) {
      spec.instructions = line.slice(line.indexOf(':') + 1).trim();
    } else {
      extraLines.push(line);
    }
  }

  // If no explicit instructions field, use remaining lines
  if (!spec.instructions && extraLines.length > 0) {
    spec.instructions = extraLines.join('\n').trim();
  }

  // Last-resort: scan for email address if to: field was not found
  if (!spec.to) {
    const emailMatch = text.match(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/);
    if (emailMatch) spec.to = emailMatch[0];
  }

  return spec;
}

// ---------------------------------------------------------------------------
// Standalone CLI mode — for testing without the full hub running
// ---------------------------------------------------------------------------

async function runStandalone() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--')) {
      const key = process.argv[i].slice(2);
      args[key] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
        ? process.argv[++i]
        : true;
    }
  }

  if (!args.instance) {
    console.error('Usage: node scripts/your9-agent-voice-email.mjs --instance <customer-id> [--task <json>]');
    console.error('       --task \'{"to":"x@y.com","subject":"Hi","instructions":"Write a brief hello."}\' ');
    process.exit(1);
  }

  const customerId = args.instance;
  const instanceDir = join(INSTANCES_DIR, customerId);

  if (!existsSync(instanceDir)) {
    console.error(`Instance not found: ${instanceDir}`);
    process.exit(1);
  }

  initLog(instanceDir);

  // Load credentials
  const instanceEnvPath = join(instanceDir, 'config', '.env');
  const instanceEnv = loadEnvFile(instanceEnvPath);
  const platformEnvPath = join(ROOT, '.env');
  const platformEnv = loadEnvFile(platformEnvPath);

  const anthropicKey = (instanceEnv.ANTHROPIC_API_KEY && !instanceEnv.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER_'))
    ? instanceEnv.ANTHROPIC_API_KEY
    : platformEnv.ANTHROPIC_API_KEY;

  const botToken = instanceEnv.TELEGRAM_BOT_TOKEN;
  const ownerChatId = instanceEnv.TELEGRAM_OWNER_CHAT_ID;
  const resendKey = instanceEnv.RESEND_API_KEY;
  const emailFrom = instanceEnv.EMAIL_FROM;

  if (!anthropicKey || anthropicKey.startsWith('PLACEHOLDER_')) {
    console.error('FATAL: No valid ANTHROPIC_API_KEY found.');
    process.exit(1);
  }
  if (!botToken || botToken.startsWith('PLACEHOLDER_')) {
    console.error('FATAL: TELEGRAM_BOT_TOKEN not configured in instance .env');
    process.exit(1);
  }
  if (!ownerChatId || ownerChatId.startsWith('PLACEHOLDER_')) {
    console.error('FATAL: TELEGRAM_OWNER_CHAT_ID not configured in instance .env');
    process.exit(1);
  }
  if (!resendKey || resendKey.startsWith('PLACEHOLDER_')) {
    console.error('FATAL: RESEND_API_KEY not configured in instance .env');
    process.exit(1);
  }
  if (!emailFrom || emailFrom.startsWith('PLACEHOLDER_')) {
    console.error('FATAL: EMAIL_FROM not configured in instance .env');
    process.exit(1);
  }

  const taskDir = join(instanceDir, 'data', 'tasks');
  mkdirSync(taskDir, { recursive: true });

  // Parse task from CLI arg or check for a pending task on disk
  let emailSpec;
  if (args.task) {
    try {
      const parsed = JSON.parse(args.task);
      emailSpec = {
        to: parsed.to || '',
        subject: parsed.subject || '',
        instructions: parsed.instructions || '',
      };
    } catch (e) {
      console.error(`Failed to parse --task JSON: ${e.message}`);
      process.exit(1);
    }
  } else {
    // Check for a pending task file
    const pending = findPendingEmailTask(taskDir);
    if (pending) {
      emailSpec = {
        to: pending.to,
        subject: pending.subject,
        instructions: pending.instructions,
        lastDraft: pending.currentDraft,
      };
      console.log(`Resuming pending email task: ${pending._filePath}`);
    } else {
      console.error('No --task provided and no pending email task found in task directory.');
      process.exit(1);
    }
  }

  if (!emailSpec.to || !emailSpec.subject) {
    console.error('Email spec must include to, subject, and instructions.');
    process.exit(1);
  }

  // Load Voice agent system prompt
  const voicePromptPath = join(instanceDir, 'agents', 'voice', 'system-prompt.md');
  const voiceAgentPrompt = existsSync(voicePromptPath)
    ? readFileSync(voicePromptPath, 'utf-8')
    : '';

  console.log('\n--- Voice Email Agent (standalone) ---');
  console.log(`Instance:    ${customerId}`);
  console.log(`To:          ${emailSpec.to}`);
  console.log(`Subject:     ${emailSpec.subject}`);
  console.log(`Instructions: ${emailSpec.instructions.slice(0, 100)}...`);
  console.log('--------------------------------------\n');

  const report = await runEmailApprovalWorkflow({
    customerId,
    instanceDir,
    anthropicKey,
    resendKey,
    emailFrom,
    botToken,
    ownerChatId,
    voiceAgentPrompt,
    emailSpec,
    taskDir,
    telegramOffset: 0,
  });

  console.log('\n--- COMPLETION REPORT ---');
  console.log(report);
  console.log('-------------------------');
}

// Only run standalone if this file is executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runStandalone().catch(err => {
    console.error(`FATAL: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}
