#!/usr/bin/env node
/**
 * your9-hub.mjs — Per-Instance Communications Hub
 * Your9 by 9 Enterprises
 *
 * Each Your9 customer instance runs its own isolated hub. This file is the
 * communications backbone: Telegram polling, AI CEO message processing,
 * agent delegation, conversation persistence, and health endpoint.
 *
 * No external SDK dependencies beyond Node.js built-ins. Uses raw HTTPS for
 * both Telegram and Anthropic API calls — same pattern as comms-hub.mjs.
 *
 * Usage:
 *   node scripts/your9-hub.mjs --instance <customer-id>
 *
 * Flags:
 *   --instance    Customer ID (required). Must exist in instances/ directory.
 *   --port        Override the hub port (otherwise reads from instance .env)
 *
 * Port isolation:
 *   Reads YOUR9_HUB_PORT from instances/{id}/config/.env
 *   Falls back to: 4000 + (numeric hash of customer ID mod 900)
 *   Binds to 127.0.0.1 only — never exposed externally without a reverse proxy.
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, readdirSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import https from 'https';

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
// .env loader — reads a key=value file into an object (does not pollute process.env)
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
// Port derivation — fallback if YOUR9_HUB_PORT is not set in instance .env
// ---------------------------------------------------------------------------

function derivePort(customerId) {
  let hash = 0;
  for (let i = 0; i < customerId.length; i++) {
    hash = (hash * 31 + customerId.charCodeAt(i)) >>> 0;
  }
  return 4000 + (hash % 900);
}

// ---------------------------------------------------------------------------
// Logging — writes to stdout and to instance log file
// ---------------------------------------------------------------------------

let hubLogPath = null;

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] HUB: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  if (hubLogPath) {
    try { appendFileSync(hubLogPath, line + '\n'); } catch {}
  }
}

function logSection(title) {
  const bar = '-'.repeat(60);
  const line = `\n${bar}\n  ${title}\n${bar}`;
  try { process.stdout.write(line + '\n'); } catch {}
  if (hubLogPath) {
    try { appendFileSync(hubLogPath, line + '\n'); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Raw HTTPS helper — returns parsed JSON or throws
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
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(new Error(`JSON parse failed: ${e.message} — body: ${buf.slice(0, 200)}`));
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

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET', headers: headers || {} },
      res => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(new Error(`JSON parse failed: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('HTTPS GET timed out')); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Telegram API helpers
// ---------------------------------------------------------------------------

async function telegramReq(botToken, method, params = {}) {
  const result = await httpsPost('api.telegram.org', `/bot${botToken}/${method}`, {}, params);
  if (result.ok === false) {
    throw new Error(`Telegram ${method} error: ${result.description || JSON.stringify(result)}`);
  }
  return result;
}

async function telegramGetUpdates(botToken, offset) {
  // Long-poll: 25 second timeout. Telegram returns immediately if there are updates.
  const path = `/bot${botToken}/getUpdates?offset=${offset}&timeout=25&allowed_updates=["message"]`;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path,
        method: 'GET',
      },
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
    // 35 second timeout — slightly longer than the 25-second Telegram timeout
    req.setTimeout(35000, () => { req.destroy(); resolve({ ok: true, result: [] }); });
    req.end();
  });
}

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
      // Try Markdown first, fall back to plain text if parse fails
      await telegramReq(botToken, 'sendMessage', { chat_id: chatId, text: chunk, parse_mode: 'Markdown' });
    } catch {
      try {
        await telegramReq(botToken, 'sendMessage', { chat_id: chatId, text: chunk });
      } catch (e) {
        log(`sendMessage failed: ${e.message}`);
        throw e;
      }
    }
  }
}

async function sendTypingIndicator(botToken, chatId) {
  try {
    await telegramReq(botToken, 'sendChatAction', { chat_id: chatId, action: 'typing' });
  } catch {
    // Non-fatal — typing indicator is cosmetic
  }
}

// ---------------------------------------------------------------------------
// Anthropic API helper — raw HTTPS, no SDK
// ---------------------------------------------------------------------------

async function callClaude(anthropicKey, model, systemPrompt, messages, maxTokens = 4096) {
  const body = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  };

  const result = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body
  );

  if (result.error) {
    throw new Error(`Anthropic API error: ${result.error.message || JSON.stringify(result.error)}`);
  }

  const text = result.content?.[0]?.text;
  if (!text) {
    throw new Error(`Anthropic returned no content: ${JSON.stringify(result).slice(0, 200)}`);
  }

  return text;
}

// ---------------------------------------------------------------------------
// Conversation history — persisted per-instance as JSONL
// ---------------------------------------------------------------------------

function loadConversationHistory(convDir, maxMessages = 40) {
  const histPath = join(convDir, 'history.jsonl');
  if (!existsSync(histPath)) return [];
  try {
    const lines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
    const parsed = lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    // Return last maxMessages entries as Claude-compatible message format
    return parsed.slice(-maxMessages).map(entry => ({
      role: entry.role,
      content: entry.content,
    }));
  } catch (e) {
    log(`Conversation history load failed (non-fatal): ${e.message}`);
    return [];
  }
}

function appendConversationEntry(convDir, role, content) {
  const histPath = join(convDir, 'history.jsonl');
  const entry = { role, content, timestamp: new Date().toISOString() };
  try {
    appendFileSync(histPath, JSON.stringify(entry) + '\n');
    // Rotate: keep only last 500 lines
    const lines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length > 500) {
      writeFileSync(histPath, lines.slice(-400).join('\n') + '\n');
    }
  } catch (e) {
    log(`Conversation history append failed (non-fatal): ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Task logging — one JSON file per task in instances/{id}/data/tasks/
// ---------------------------------------------------------------------------

function logTask(taskDir, task) {
  const taskPath = join(taskDir, `${Date.now()}-task.json`);
  const entry = { ...task, loggedAt: new Date().toISOString() };
  try {
    writeFileSync(taskPath, JSON.stringify(entry, null, 2));
  } catch (e) {
    log(`Task log failed (non-fatal): ${e.message}`);
  }
  return taskPath;
}

function updateTaskFile(taskPath, updates) {
  try {
    const existing = JSON.parse(readFileSync(taskPath, 'utf-8'));
    writeFileSync(taskPath, JSON.stringify({ ...existing, ...updates }, null, 2));
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------------------------------
// Agent execution — process a CEO-delegated task with Sonnet
// ---------------------------------------------------------------------------

async function executeAgentTask(anthropicKey, agentId, agentConfig, instanceDir, task, taskDir) {
  const promptPath = join(instanceDir, 'agents', agentId, 'system-prompt.md');

  if (!existsSync(promptPath)) {
    log(`Agent ${agentId} system prompt not found at ${promptPath}`);
    return `Agent ${agentId} system prompt not found — cannot execute task.`;
  }

  const agentSystemPrompt = readFileSync(promptPath, 'utf-8');
  const model = agentConfig.model || 'claude-sonnet-4-5';
  const maxTokens = agentConfig.maxTokens || 2048;

  log(`Agent ${agentId} executing: "${task.slice(0, 80)}..."`);

  const taskEntry = {
    agentId,
    task,
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  const taskPath = logTask(taskDir, taskEntry);

  try {
    const result = await callClaude(
      anthropicKey,
      model,
      agentSystemPrompt,
      [{ role: 'user', content: task }],
      maxTokens
    );

    updateTaskFile(taskPath, {
      status: 'completed',
      result: result.slice(0, 2000),
      completedAt: new Date().toISOString(),
    });

    log(`Agent ${agentId} completed. Result: "${result.slice(0, 100)}..."`);
    return result;
  } catch (e) {
    const errMsg = `Agent ${agentId} error: ${e.message}`;
    log(errMsg);
    updateTaskFile(taskPath, {
      status: 'failed',
      error: e.message,
      failedAt: new Date().toISOString(),
    });
    return errMsg;
  }
}

// ---------------------------------------------------------------------------
// CEO delegation parser
//
// When the CEO response contains a delegation directive, extract and execute it.
// Format the CEO uses to delegate:
//   [DELEGATE:executor] Summarize this week's pipeline status.
//   [DELEGATE:mind] Research top 3 competitors in the mortgage space.
//   [DELEGATE:voice] Draft a follow-up email to John.
//
// The hub executes the delegation, feeds agent results back to the CEO for
// a synthesis response, then returns the final message to the owner.
// ---------------------------------------------------------------------------

function parseDelegations(text) {
  const delegations = [];
  // Match [DELEGATE:agentid] followed by the task text until the next directive or end
  const re = /\[DELEGATE:(\w+)\]\s*([\s\S]+?)(?=\[DELEGATE:|$)/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    delegations.push({
      agentId: match[1].toLowerCase(),
      task: match[2].trim(),
    });
  }
  return delegations;
}

function stripDelegationDirectives(text) {
  return text.replace(/\[DELEGATE:\w+\][\s\S]+/gi, '').trim();
}

// ---------------------------------------------------------------------------
// CEO message processing — the core AI loop
// ---------------------------------------------------------------------------

async function processCeoMessage(hub, userMessage) {
  const {
    anthropicKey,
    instanceConfig,
    ceoConfig,
    agentConfigs,
    instanceDir,
    convDir,
    taskDir,
  } = hub;

  const ceoSystemPromptPath = join(instanceDir, 'prompts', 'ceo-system-prompt.md');
  const ceoSystemPrompt = readFileSync(ceoSystemPromptPath, 'utf-8');

  // Build active task context — last 5 task files for CEO awareness
  let taskContext = '';
  try {
    const taskFiles = readdirSync(taskDir)
      .filter(f => f.endsWith('-task.json'))
      .sort()
      .slice(-5);

    if (taskFiles.length > 0) {
      const summaries = taskFiles
        .map(f => {
          try {
            const t = JSON.parse(readFileSync(join(taskDir, f), 'utf-8'));
            return `- [${t.agentId || 'unknown'}] ${t.status}: ${(t.task || '').slice(0, 100)}`;
          } catch { return null; }
        })
        .filter(Boolean);

      if (summaries.length > 0) {
        taskContext = `\n\n## Recent Agent Activity\n${summaries.join('\n')}`;
      }
    }
  } catch {}

  const fullSystemPrompt = ceoSystemPrompt + taskContext;

  // Load conversation history and append current message
  const history = loadConversationHistory(convDir);
  const messages = [...history, { role: 'user', content: userMessage }];

  log(`CEO processing: "${userMessage.slice(0, 80)}..."`);

  let ceoResponse;
  try {
    ceoResponse = await callClaude(
      anthropicKey,
      ceoConfig.model,
      fullSystemPrompt,
      messages,
      ceoConfig.maxTokens || 4096
    );
  } catch (e) {
    log(`CEO API call failed: ${e.message}`);
    throw e;
  }

  // Persist this exchange to history before any delegation
  appendConversationEntry(convDir, 'user', userMessage);
  appendConversationEntry(convDir, 'assistant', ceoResponse);

  // Check for agent delegation directives
  const delegations = parseDelegations(ceoResponse);
  if (delegations.length === 0) {
    return ceoResponse;
  }

  // Execute delegations in sequence (not parallel — conversation order matters)
  log(`CEO delegating to ${delegations.length} agent(s): ${delegations.map(d => d.agentId).join(', ')}`);
  const cleanCeoText = stripDelegationDirectives(ceoResponse);
  const agentResults = [];

  for (const delegation of delegations) {
    const agentConf = agentConfigs[delegation.agentId];
    if (!agentConf) {
      log(`Delegation to unknown agent "${delegation.agentId}" — skipping`);
      agentResults.push(`(Agent "${delegation.agentId}" not found in this instance)`);
      continue;
    }

    const result = await executeAgentTask(
      anthropicKey,
      delegation.agentId,
      agentConf,
      instanceDir,
      delegation.task,
      taskDir
    );
    agentResults.push(`**${agentConf.name || delegation.agentId}:** ${result}`);
  }

  // Feed agent results back to CEO for synthesis
  const agentReport = agentResults.join('\n\n');
  const synthesisMessages = [
    ...messages,
    { role: 'assistant', content: ceoResponse },
    {
      role: 'user',
      content: `Your agents have completed their tasks. Here are their reports:\n\n${agentReport}\n\nBased on these results, provide your final response to the owner. Be concise and action-oriented.`,
    },
  ];

  log('CEO synthesizing agent results');
  let finalResponse;
  try {
    finalResponse = await callClaude(
      anthropicKey,
      ceoConfig.model,
      fullSystemPrompt,
      synthesisMessages,
      ceoConfig.maxTokens || 4096
    );
  } catch (e) {
    log(`CEO synthesis failed: ${e.message}`);
    // Fallback: CEO text + raw agent output
    const parts = [cleanCeoText, '', 'Agent results:', agentReport].filter(Boolean);
    finalResponse = parts.join('\n');
  }

  // Persist synthesis to history
  appendConversationEntry(convDir, 'assistant', finalResponse);

  return finalResponse;
}

// ---------------------------------------------------------------------------
// Telegram polling loop — runs for the lifetime of the hub process
// ---------------------------------------------------------------------------

async function telegramPoll(hub) {
  const { botToken, ownerChatId, instanceConfig, instanceDir } = hub;

  // Load persisted offset so we don't re-process old messages on restart
  let offset = 0;
  const offsetPath = join(instanceDir, 'data', 'telegram-offset.txt');
  try {
    if (existsSync(offsetPath)) {
      offset = parseInt(readFileSync(offsetPath, 'utf-8').trim()) || 0;
    }
  } catch {}

  log(`Telegram polling started from offset ${offset}`);
  hub.telegramStatus = 'active';

  while (!hub.shutdown) {
    try {
      const data = await telegramGetUpdates(botToken, offset);

      if (!data.ok) {
        log(`Telegram getUpdates returned not-ok: ${JSON.stringify(data)}`);
        hub.telegramStatus = 'error';
        await sleep(5000);
        continue;
      }

      hub.telegramStatus = 'active';

      if (!data.result || data.result.length === 0) {
        // Normal long-poll timeout — loop immediately
        continue;
      }

      for (const update of data.result) {
        const msg = update.message;

        if (msg && String(msg.chat?.id) === String(ownerChatId)) {
          if (msg.text) {
            const userText = msg.text.trim();
            log(`Telegram IN: "${userText.slice(0, 100)}"`);
            hub.messagesHandled++;
            hub.lastActivity = new Date().toISOString();

            await handleOwnerMessage(hub, userText);
          } else if (msg.photo) {
            await sendTelegramMessage(botToken, ownerChatId,
              'Received your photo. Photo analysis is not enabled on this instance. Send your request as text and I will act on it.');
          } else if (msg.document) {
            await sendTelegramMessage(botToken, ownerChatId,
              `Received your document (${msg.document.file_name || 'file'}). Document parsing is not currently enabled. Share the key details as text and I will get to work.`);
          } else if (msg.voice) {
            await sendTelegramMessage(botToken, ownerChatId,
              'Voice messages are not currently enabled on this instance. Type your message and I will respond right away.');
          }
        } else if (msg) {
          log(`Ignored message from unknown chat_id: ${msg.chat?.id} (expected ${ownerChatId})`);
        }

        // Advance offset past this update
        offset = update.update_id + 1;
        try { writeFileSync(offsetPath, String(offset)); } catch {}
      }
    } catch (e) {
      if (hub.shutdown) break;
      log(`Telegram poll error: ${e.message}`);
      hub.telegramStatus = 'error';
      // Brief pause before retrying to avoid tight error loops
      await sleep(5000);
    }
  }

  log('Telegram polling stopped');
}

// ---------------------------------------------------------------------------
// Owner message handler — built-in commands + CEO routing
// ---------------------------------------------------------------------------

async function handleOwnerMessage(hub, userText) {
  const { botToken, ownerChatId } = hub;

  if (userText === '/briefing' || userText === '/start') {
    try {
      await sendTypingIndicator(botToken, ownerChatId);
      const reply = await processCeoMessage(
        hub,
        "Give me a full status briefing. What are you working on, what's pending, and what do I need to know right now?"
      );
      await sendTelegramMessage(botToken, ownerChatId, reply);
    } catch (e) {
      log(`Briefing command failed: ${e.message}`);
      await sendTelegramMessage(botToken, ownerChatId, `Error generating briefing: ${e.message}`);
    }
    return;
  }

  if (userText === '/pipeline') {
    try {
      await sendTypingIndicator(botToken, ownerChatId);
      const reply = await processCeoMessage(hub, 'Give me a current pipeline and task status summary.');
      await sendTelegramMessage(botToken, ownerChatId, reply);
    } catch (e) {
      log(`Pipeline command failed: ${e.message}`);
      await sendTelegramMessage(botToken, ownerChatId, `Error: ${e.message}`);
    }
    return;
  }

  if (userText === '/agents') {
    const { agentConfigs } = hub;
    const agentList = Object.values(agentConfigs)
      .map(a => `- *${a.name}* (${a.role}) — Model: ${a.model}`)
      .join('\n');
    await sendTelegramMessage(botToken, ownerChatId, `*Agent Team*\n${agentList || 'No agents provisioned.'}`);
    return;
  }

  if (userText === '/help') {
    const helpText = [
      '*Available Commands*',
      '/briefing — Full status overview',
      '/pipeline — Current task pipeline',
      '/agents — Agent team status',
      '/help — This message',
      '',
      'Or just send any message and your AI CEO will respond.',
    ].join('\n');
    await sendTelegramMessage(botToken, ownerChatId, helpText);
    return;
  }

  // Standard message — route to CEO
  try {
    await sendTypingIndicator(botToken, ownerChatId);
    const reply = await processCeoMessage(hub, userText);
    await sendTelegramMessage(botToken, ownerChatId, reply);
    log(`Telegram OUT: "${reply.slice(0, 100)}..."`);
  } catch (e) {
    log(`CEO processing failed: ${e.message}`);
    await sendTelegramMessage(botToken, ownerChatId,
      `I ran into an issue processing that. Error: ${e.message}. Try again or check the instance logs.`);
  }
}

// ---------------------------------------------------------------------------
// Health HTTP server — binds to 127.0.0.1 only
// ---------------------------------------------------------------------------

function startHealthServer(hub, port) {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const body = JSON.stringify({
        status: 'ok',
        customerId: hub.instanceConfig.customerId,
        businessName: hub.instanceConfig.name,
        industry: hub.instanceConfig.industry,
        tier: hub.instanceConfig.tier,
        telegramStatus: hub.telegramStatus,
        messagesHandled: hub.messagesHandled,
        lastActivity: hub.lastActivity,
        uptimeSeconds: Math.round((Date.now() - hub.startTime) / 1000),
        startedAt: new Date(hub.startTime).toISOString(),
        agents: Object.keys(hub.agentConfigs),
        port,
      }, null, 2);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });

  server.listen(port, '127.0.0.1', () => {
    log(`Health endpoint: http://127.0.0.1:${port}/health`);
  });

  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      log(`FATAL: Port ${port} is already in use. Set a different YOUR9_HUB_PORT in instances/${hub.instanceConfig.customerId}/config/.env or use --port.`);
      process.exit(1);
    }
    log(`Health server error: ${e.message}`);
  });

  return server;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Startup validation — verifies all required files exist before the hub starts
// ---------------------------------------------------------------------------

function validateInstance(customerId) {
  const instanceDir = join(INSTANCES_DIR, customerId);

  if (!existsSync(instanceDir)) {
    console.error(`\nFATAL: Instance directory not found: ${instanceDir}`);
    console.error(`Run the provisioner first: node scripts/your9-provision.mjs --name "..." --industry "..." --id ${customerId}`);
    process.exit(1);
  }

  const requiredFiles = [
    ['config/customer.json', 'Customer config'],
    ['config/.env', 'Instance environment file'],
    ['config/ceo.json', 'CEO config'],
    ['prompts/ceo-system-prompt.md', 'CEO system prompt'],
    ['comms/telegram.json', 'Telegram comms config'],
  ];

  const errors = [];
  for (const [rel, label] of requiredFiles) {
    if (!existsSync(join(instanceDir, rel))) {
      errors.push(`Missing: ${label} (${rel})`);
    }
  }

  if (errors.length > 0) {
    console.error(`\nInstance validation FAILED for: ${customerId}`);
    for (const err of errors) console.error(`  - ${err}`);
    console.error(`\nRun provisioner: node scripts/your9-provision.mjs --id ${customerId} --name "..." --industry "..."`);
    process.exit(1);
  }

  return instanceDir;
}

// ---------------------------------------------------------------------------
// Load agent configs from the instance agents directory
// ---------------------------------------------------------------------------

function loadAgentConfigs(instanceDir) {
  const agentsDir = join(instanceDir, 'agents');
  const configs = {};
  if (!existsSync(agentsDir)) return configs;

  try {
    for (const agentId of readdirSync(agentsDir)) {
      const configPath = join(agentsDir, agentId, 'config.json');
      if (existsSync(configPath)) {
        try {
          configs[agentId] = JSON.parse(readFileSync(configPath, 'utf-8'));
        } catch (e) {
          console.warn(`Agent config load failed for ${agentId}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.warn(`Agents directory read failed: ${e.message}`);
  }

  return configs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.instance) {
    console.error('Usage: node scripts/your9-hub.mjs --instance <customer-id>');
    console.error('       node scripts/your9-hub.mjs --instance <customer-id> --port 4001');
    process.exit(1);
  }

  const customerId = args.instance;

  // Validate instance files exist before doing anything else
  const instanceDir = validateInstance(customerId);

  // Set up log path
  const logDir = join(instanceDir, 'logs');
  mkdirSync(logDir, { recursive: true });
  const logDate = new Date().toISOString().slice(0, 10);
  hubLogPath = join(logDir, `hub-${logDate}.log`);

  logSection(`YOUR9 HUB STARTUP — Instance: ${customerId}`);

  // Load instance environment
  const instanceEnvPath = join(instanceDir, 'config', '.env');
  const instanceEnv = loadEnvFile(instanceEnvPath);

  // Load platform root .env for ANTHROPIC_API_KEY fallback
  const platformEnvPath = join(ROOT, '.env');
  const platformEnv = loadEnvFile(platformEnvPath);

  // Resolve Anthropic API key — instance key first, platform key as fallback
  const anthropicKey = (
    instanceEnv.ANTHROPIC_API_KEY &&
    !instanceEnv.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER_')
  )
    ? instanceEnv.ANTHROPIC_API_KEY
    : platformEnv.ANTHROPIC_API_KEY;

  if (!anthropicKey || anthropicKey.startsWith('PLACEHOLDER_')) {
    console.error('FATAL: No valid ANTHROPIC_API_KEY found.');
    console.error(`  Instance .env: ${instanceEnvPath}`);
    console.error(`  Platform .env: ${platformEnvPath}`);
    console.error('Set ANTHROPIC_API_KEY in either file before starting the hub.');
    process.exit(1);
  }

  // Resolve Telegram credentials
  const botToken = (
    instanceEnv.TELEGRAM_BOT_TOKEN &&
    !instanceEnv.TELEGRAM_BOT_TOKEN.startsWith('PLACEHOLDER_')
  )
    ? instanceEnv.TELEGRAM_BOT_TOKEN
    : null;

  const ownerChatId = (
    instanceEnv.TELEGRAM_OWNER_CHAT_ID &&
    !instanceEnv.TELEGRAM_OWNER_CHAT_ID.startsWith('PLACEHOLDER_')
  )
    ? instanceEnv.TELEGRAM_OWNER_CHAT_ID
    : null;

  if (!botToken || !ownerChatId) {
    console.error('FATAL: Telegram credentials not configured.');
    console.error(`  TELEGRAM_BOT_TOKEN: ${botToken ? 'OK' : 'MISSING or PLACEHOLDER'}`);
    console.error(`  TELEGRAM_OWNER_CHAT_ID: ${ownerChatId ? 'OK' : 'MISSING or PLACEHOLDER'}`);
    console.error(`\n  Edit and fill in real values: ${instanceEnvPath}`);
    process.exitCode = 1;
    process.exit(1);
  }

  // Resolve port
  let port;
  if (args.port) {
    port = parseInt(args.port);
  } else if (
    instanceEnv.YOUR9_HUB_PORT &&
    !instanceEnv.YOUR9_HUB_PORT.startsWith('PLACEHOLDER_')
  ) {
    port = parseInt(instanceEnv.YOUR9_HUB_PORT);
  } else {
    port = derivePort(customerId);
    log(`YOUR9_HUB_PORT not set in .env — derived port: ${port}`);
  }

  if (isNaN(port) || port < 1024 || port > 65535) {
    console.error(`FATAL: Invalid port ${port}. Must be 1024-65535.`);
    process.exit(1);
  }

  // Load configs
  const instanceConfig = JSON.parse(readFileSync(join(instanceDir, 'config', 'customer.json'), 'utf-8'));
  const ceoConfig = JSON.parse(readFileSync(join(instanceDir, 'config', 'ceo.json'), 'utf-8'));
  const agentConfigs = loadAgentConfigs(instanceDir);

  // Ensure data directories exist
  const convDir = join(instanceDir, 'data', 'conversations');
  const taskDir = join(instanceDir, 'data', 'tasks');
  mkdirSync(convDir, { recursive: true });
  mkdirSync(taskDir, { recursive: true });

  // Hub state object — shared reference passed to all async functions
  const hub = {
    instanceConfig,
    ceoConfig,
    agentConfigs,
    anthropicKey,
    botToken,
    ownerChatId,
    instanceDir,
    convDir,
    taskDir,
    telegramStatus: 'starting',
    messagesHandled: 0,
    lastActivity: null,
    startTime: Date.now(),
    shutdown: false,
  };

  // Log startup summary
  log(`Business:     ${instanceConfig.name}`);
  log(`Industry:     ${instanceConfig.industry}`);
  log(`Personality:  ${instanceConfig.personality}`);
  log(`Tier:         ${instanceConfig.tier}`);
  log(`CEO model:    ${ceoConfig.model}`);
  log(`Agents:       ${Object.keys(agentConfigs).join(', ') || 'none'}`);
  log(`Port:         ${port}`);
  log(`API key:      ${anthropicKey.slice(0, 20)}...`);
  log(`Owner chat:   ${ownerChatId}`);

  // Start health server
  startHealthServer(hub, port);

  // Send startup message to owner
  const firstMsgPath = join(instanceDir, 'comms', 'first-message.txt');
  if (existsSync(firstMsgPath)) {
    const firstMsg = readFileSync(firstMsgPath, 'utf-8').trim();
    try {
      await sendTelegramMessage(botToken, ownerChatId, firstMsg);
      log('Startup message sent to owner');
    } catch (e) {
      log(`Startup message failed (non-fatal): ${e.message}`);
    }
  }

  // Graceful shutdown handlers
  const doShutdown = () => {
    log('Shutdown signal received — stopping hub');
    hub.shutdown = true;
    process.exit(0);
  };
  process.on('SIGINT', doShutdown);
  process.on('SIGTERM', doShutdown);

  // Start Telegram polling — blocks until shutdown
  logSection('TELEGRAM POLLING ACTIVE');
  await telegramPoll(hub);
}

main().catch(err => {
  console.error(`HUB FATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
