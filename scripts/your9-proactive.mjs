#!/usr/bin/env node
/**
 * your9-proactive.mjs — Proactive Initiative Engine for the AI CEO
 * Your9 by 9 Enterprises
 *
 * Turns the AI CEO from reactive to proactive. Continuously scans business
 * data — tasks, conversation history, agent reports, industry context — and
 * surfaces opportunities, risks, and follow-ups the founder hasn't asked about.
 *
 * The CEO (Opus) generates a recommendation with reasoning and proposed actions.
 * The recommendation is presented via Telegram with two options:
 *   "Approve & Execute" — CEO auto-delegates to the right agent
 *   "Discuss"           — CEO opens a conversation thread
 *
 * All initiatives are logged at: instances/{id}/data/initiatives/
 *
 * Usage:
 *   node scripts/your9-proactive.mjs --instance <customer-id> --scan
 *   node scripts/your9-proactive.mjs --instance <customer-id> --daemon
 *
 * Flags:
 *   --instance    Customer ID (required). Must exist in instances/ directory.
 *   --scan        Run one analysis pass and exit. Good for testing or cron.
 *   --daemon      Run continuously. Checks every 4 hours.
 *   --dry-run     Generate initiative but do not send Telegram message.
 *
 * Exports (for hub integration):
 *   scanForInitiatives(instanceDir, customerConfig, creds)
 *   presentInitiative(initiative, creds)
 *   handleInitiativeResponse(text, instanceDir, creds)
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync,
  appendFileSync, readdirSync
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
const PROACTIVE_LOG = join(ROOT, 'logs', 'your9-proactive.log');

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const OPUS_MODEL = 'claude-opus-4-20250514';
const SONNET_MODEL = 'claude-sonnet-4-5';

// Scan interval for daemon mode: 4 hours
const DAEMON_INTERVAL_MS = 4 * 60 * 60 * 1000;

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
  const line = `[${ts}] PROACTIVE: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  try {
    if (!existsSync(join(ROOT, 'logs'))) mkdirSync(join(ROOT, 'logs'), { recursive: true });
    appendFileSync(PROACTIVE_LOG, line + '\n');
  } catch { /* non-fatal */ }
}

function logSection(title) {
  const bar = '='.repeat(60);
  const line = `\n${bar}\n  ${title}\n${bar}`;
  try { process.stdout.write(line + '\n'); } catch {}
  try { appendFileSync(PROACTIVE_LOG, line + '\n'); } catch {}
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
// Raw HTTPS helpers — same pattern as hub
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
// Anthropic API — raw HTTPS, no SDK dependency
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
// Telegram send — chunked, Markdown with plain-text fallback
// ---------------------------------------------------------------------------

async function sendTelegramMessage(botToken, chatId, text) {
  const MAX = 4000;
  const chunks = [];
  let remaining = String(text);
  while (remaining.length > MAX) {
    const boundary = remaining.lastIndexOf('\n', MAX);
    const cut = boundary > 0 ? boundary : MAX;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);

  const send = (chunk, parseMode) => new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: chatId,
      text: chunk,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
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

  for (const chunk of chunks) {
    try {
      const result = await send(chunk, 'Markdown');
      if (!result.ok) throw new Error(result.description || 'Unknown Telegram error');
    } catch {
      const result = await send(chunk, null);
      if (!result.ok) throw new Error(`Telegram send failed: ${JSON.stringify(result)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Business data collection — reads all relevant instance data for analysis
// ---------------------------------------------------------------------------

function collectBusinessData(instanceDir) {
  const data = {
    tasks: { completed: [], pending: [], stalled: [] },
    conversations: [],
    agentReports: [],
    initiatives: { prior: [] },
    goals: [],
    ceoAssessment: null,
    plans: [],
  };

  // --- Initial reasoning (goals + CEO assessment) ---
  const reasoningPath = join(instanceDir, 'data', 'initial-reasoning.json');
  if (existsSync(reasoningPath)) {
    try {
      const r = JSON.parse(readFileSync(reasoningPath, 'utf-8'));
      data.goals = r.goals || [];
      data.ceoAssessment = r.ceoAssessment || null;
    } catch { /* non-fatal */ }
  }

  // --- Task files ---
  const taskDir = join(instanceDir, 'data', 'tasks');
  if (existsSync(taskDir)) {
    const now = Date.now();
    const staleThresholdMs = 7 * 24 * 60 * 60 * 1000; // 7 days
    for (const f of readdirSync(taskDir).filter(n => n.endsWith('.json'))) {
      try {
        const task = JSON.parse(readFileSync(join(taskDir, f), 'utf-8'));
        if (task.status === 'completed' || task.status === 'done') {
          data.tasks.completed.push(task);
        } else {
          const created = new Date(task.loggedAt || task.createdAt || 0).getTime();
          if (created > 0 && now - created > staleThresholdMs) {
            data.tasks.stalled.push(task);
          } else {
            data.tasks.pending.push(task);
          }
        }
      } catch { /* non-fatal */ }
    }
  }

  // --- Conversation history (last 100 messages) ---
  const convHistPath = join(instanceDir, 'data', 'conversations', 'history.jsonl');
  if (existsSync(convHistPath)) {
    try {
      const lines = readFileSync(convHistPath, 'utf-8').trim().split('\n').filter(Boolean);
      data.conversations = lines
        .slice(-100)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    } catch { /* non-fatal */ }
  }

  // --- Agent reports (audit directory) ---
  const auditDir = join(instanceDir, 'data', 'audit');
  if (existsSync(auditDir)) {
    for (const f of readdirSync(auditDir).filter(n => n.endsWith('.json')).slice(-20)) {
      try {
        const report = JSON.parse(readFileSync(join(auditDir, f), 'utf-8'));
        data.agentReports.push(report);
      } catch { /* non-fatal */ }
    }
  }

  // --- Prior initiatives (avoid repeating ourselves) ---
  const initiativesDir = join(instanceDir, 'data', 'initiatives');
  if (existsSync(initiativesDir)) {
    for (const f of readdirSync(initiativesDir).filter(n => n.endsWith('.json')).slice(-50)) {
      try {
        const init = JSON.parse(readFileSync(join(initiativesDir, f), 'utf-8'));
        data.initiatives.prior.push(init);
      } catch { /* non-fatal */ }
    }
  }

  // --- Weekly plans ---
  const plansDir = join(instanceDir, 'data', 'plans');
  if (existsSync(plansDir)) {
    for (const f of readdirSync(plansDir).filter(n => n.endsWith('.json')).slice(-4)) {
      try {
        const plan = JSON.parse(readFileSync(join(plansDir, f), 'utf-8'));
        data.plans.push(plan);
      } catch { /* non-fatal */ }
    }
  }

  return data;
}

// ---------------------------------------------------------------------------
// Opportunity scan prompt — what Opus receives to generate the initiative
// ---------------------------------------------------------------------------

function buildScanSystemPrompt(customerConfig, ceoSystemPrompt) {
  const { name, industryContext, personalityConfig } = customerConfig;

  return `You are the AI CEO of ${name}, a ${industryContext.label} business.

${ceoSystemPrompt || ''}

---

## YOUR ROLE: PROACTIVE CEO

You are NOT waiting to be asked. You are scanning the business for things the founder should know about — things they are too close to see, too busy to notice, or simply haven't thought to ask about yet.

Your job:
1. Find ONE high-value initiative: an opportunity, risk flag, follow-up action, or efficiency improvement.
2. Be specific. Vague recommendations are useless. The founder should be able to say "yes, do it" and you execute immediately.
3. Back every recommendation with data from the business context you've been given.

Your voice style: ${personalityConfig.label}. ${personalityConfig.voiceStyle}

Regulatory context: ${industryContext.regulatoryContext}

---

## OUTPUT FORMAT

Return valid JSON only. No preamble, no markdown outside the JSON block.

{
  "opportunityType": "competitor_move|follow_up|efficiency|risk_flag|market_timing|relationship|revenue|operational",
  "urgency": "immediate|this_week|this_month",
  "title": "Short title. Max 60 characters.",
  "headline": "One sentence. What you found and why it matters right now.",
  "reasoning": "2-4 sentences. What data/signals led you here. Specific, not generic.",
  "proposedActions": [
    {
      "agentId": "executor|mind|voice",
      "action": "Exactly what the agent should do. Specific enough to execute without follow-up questions.",
      "expectedOutcome": "What success looks like."
    }
  ],
  "expectedImpact": "1-2 sentences. Concrete impact if the founder approves.",
  "founderMessage": "The actual Telegram message to send the founder. Written in your voice. Includes the recommendation, why now, and what approval means. Keep it under 250 words. End with exactly: Reply APPROVE to execute or DISCUSS to talk through it.",
  "skipReason": null
}

RULES:
- If you genuinely find nothing worth surfacing, set skipReason to a brief explanation and leave founderMessage null.
- proposedActions must have 1-3 items. Each assigned to a real agent.
- Do not repeat initiatives already surfaced in the last 7 days (check the prior initiatives list).
- Urgency is real: if you flag something as 'immediate', it actually needs founder attention today.`;
}

function buildScanUserPrompt(customerConfig, businessData) {
  const { name, industryContext, goals, painPoints } = customerConfig;
  const { tasks, conversations, agentReports, initiatives, plans, ceoAssessment } = businessData;

  let prompt = `Business: ${name}
Industry: ${industryContext.label}
Key metrics: ${(industryContext.keyMetrics || []).join(', ')}
Common operational tasks: ${(industryContext.commonTasks || []).join(', ')}`;

  if (ceoAssessment) {
    prompt += `\n\nMy initial assessment of this business:\n"${ceoAssessment}"`;
  }

  if (goals && goals.length > 0) {
    prompt += `\n\nActive strategic goals:\n${goals.map(g => `- [${g.priority}] ${g.title}: ${g.rationale}`).join('\n')}`;
  }

  if (painPoints && painPoints.length > 0) {
    prompt += `\n\nFounder's stated pain points:\n${(painPoints || []).map(p => `- ${p}`).join('\n')}`;
  }

  // Task summary
  prompt += `\n\nTask status:
- Completed: ${tasks.completed.length}
- Pending: ${tasks.pending.length}
- Stalled (>7 days without progress): ${tasks.stalled.length}`;

  if (tasks.stalled.length > 0) {
    prompt += `\n\nStalled tasks (needs attention):\n${tasks.stalled.map(t => `- [${t.agentId}] ${t.title}: ${t.brief?.slice(0, 80)}...`).join('\n')}`;
  }

  if (tasks.completed.length > 0) {
    const recentCompleted = tasks.completed.slice(-5);
    prompt += `\n\nRecent completed tasks:\n${recentCompleted.map(t => `- ${t.title}`).join('\n')}`;
  }

  // Conversation signals (last 20 messages for pattern detection)
  if (conversations.length > 0) {
    const recentConvs = conversations.slice(-20);
    const founderMessages = recentConvs
      .filter(c => c.role === 'user')
      .map(c => `- "${String(c.content).slice(0, 120)}"`)
      .join('\n');
    if (founderMessages) {
      prompt += `\n\nRecent founder messages (look for signals: frustrations, mentions of competitors, unmet needs, follow-ups they may have forgotten):\n${founderMessages}`;
    }
  }

  // Agent reports
  if (agentReports.length > 0) {
    const recentReports = agentReports.slice(-5);
    prompt += `\n\nRecent agent activity:\n${recentReports.map(r => `- ${r.agentId || 'agent'}: ${r.summary || r.description || JSON.stringify(r).slice(0, 100)}`).join('\n')}`;
  }

  // Prior initiatives (avoid repeating)
  if (initiatives.prior.length > 0) {
    const recentInits = initiatives.prior
      .filter(i => {
        const age = Date.now() - new Date(i.generatedAt || 0).getTime();
        return age < 7 * 24 * 60 * 60 * 1000; // last 7 days
      });
    if (recentInits.length > 0) {
      prompt += `\n\nInitiatives already surfaced in the last 7 days (DO NOT repeat these):\n${recentInits.map(i => `- [${i.opportunityType}] ${i.title}`).join('\n')}`;
    }
  }

  prompt += `\n\nScan the above data. Find one high-value initiative worth surfacing to the founder RIGHT NOW. Return JSON only.`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Parse initiative from model response
// ---------------------------------------------------------------------------

function parseInitiative(raw) {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch {}
    }
    throw new Error(`Could not parse initiative JSON: ${e.message}\n\nRaw (first 400 chars):\n${raw.slice(0, 400)}`);
  }
}

// ---------------------------------------------------------------------------
// Initiative log — persists to instances/{id}/data/initiatives/
// ---------------------------------------------------------------------------

function saveInitiative(instanceDir, initiative) {
  const initiativesDir = join(instanceDir, 'data', 'initiatives');
  if (!existsSync(initiativesDir)) mkdirSync(initiativesDir, { recursive: true });

  const id = `init-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const record = {
    id,
    generatedAt: new Date().toISOString(),
    status: 'pending',   // pending | approved | rejected | discussing | executed | skipped
    ...initiative,
    executionResult: null,
    founderResponse: null,
    responseAt: null,
  };

  const filePath = join(initiativesDir, `${id}.json`);
  writeFileSync(filePath, JSON.stringify(record, null, 2));
  log(`Initiative saved: ${filePath}`);
  return { id, filePath, record };
}

function updateInitiative(instanceDir, id, updates) {
  const initiativesDir = join(instanceDir, 'data', 'initiatives');
  const filePath = join(initiativesDir, `${id}.json`);
  if (!existsSync(filePath)) {
    log(`WARNING: cannot update initiative ${id} — file not found`);
    return false;
  }
  try {
    const existing = JSON.parse(readFileSync(filePath, 'utf-8'));
    const updated = { ...existing, ...updates, lastUpdatedAt: new Date().toISOString() };
    writeFileSync(filePath, JSON.stringify(updated, null, 2));
    return true;
  } catch (e) {
    log(`WARNING: initiative update failed for ${id}: ${e.message}`);
    return false;
  }
}

function loadPendingInitiatives(instanceDir) {
  const initiativesDir = join(instanceDir, 'data', 'initiatives');
  if (!existsSync(initiativesDir)) return [];

  const results = [];
  for (const f of readdirSync(initiativesDir).filter(n => n.endsWith('.json'))) {
    try {
      const record = JSON.parse(readFileSync(join(initiativesDir, f), 'utf-8'));
      if (record.status === 'pending' || record.status === 'discussing') {
        results.push(record);
      }
    } catch { /* non-fatal */ }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Format initiative for Telegram
// ---------------------------------------------------------------------------

function formatInitiativeMessage(initiative, businessName) {
  const urgencyLabel = {
    immediate: 'IMMEDIATE',
    this_week: 'THIS WEEK',
    this_month: 'THIS MONTH',
  }[initiative.urgency] || initiative.urgency?.toUpperCase() || 'NOTICE';

  const typeLabel = {
    competitor_move: 'Competitor Alert',
    follow_up: 'Follow-Up',
    efficiency: 'Efficiency Win',
    risk_flag: 'Risk Flag',
    market_timing: 'Market Timing',
    relationship: 'Relationship',
    revenue: 'Revenue Opportunity',
    operational: 'Operational',
  }[initiative.opportunityType] || initiative.opportunityType || 'Initiative';

  // Use the CEO-authored founderMessage if available, otherwise build one
  if (initiative.founderMessage) {
    return `*[${urgencyLabel}] ${typeLabel}: ${initiative.title}*\n\n${initiative.founderMessage}\n\n_Initiative ID: ${initiative.id}_`;
  }

  // Fallback format
  const actionLines = (initiative.proposedActions || [])
    .map((a, i) => `${i + 1}. [${a.agentId}] ${a.action}`)
    .join('\n');

  return `*[${urgencyLabel}] ${typeLabel}: ${initiative.title}*

${initiative.headline}

*Why now:* ${initiative.reasoning}

*Proposed actions:*
${actionLines}

*Expected impact:* ${initiative.expectedImpact}

Reply *APPROVE* to execute or *DISCUSS* to talk through it.

_Initiative ID: ${initiative.id}_`;
}

// ---------------------------------------------------------------------------
// Task delegation — writes a task file for the right agent
// ---------------------------------------------------------------------------

function delegateInitiativeTask(instanceDir, initiative) {
  const taskDir = join(instanceDir, 'data', 'tasks');
  if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });

  const taskPaths = [];

  for (const action of initiative.proposedActions || []) {
    const timestamp = Date.now();
    const taskPath = join(taskDir, `${timestamp}-${action.agentId}-initiative-task.json`);
    const task = {
      initiativeId: initiative.id,
      initiativeTitle: initiative.title,
      agentId: action.agentId,
      title: `[Initiative] ${initiative.title}`,
      brief: action.action,
      expectedOutcome: action.expectedOutcome,
      status: 'pending',
      createdBy: 'proactive-engine',
      loggedAt: new Date().toISOString(),
      source: 'initiative-approved',
    };
    writeFileSync(taskPath, JSON.stringify(task, null, 2));
    log(`Delegated task to ${action.agentId}: ${taskPath}`);
    taskPaths.push(taskPath);
  }

  return taskPaths;
}

// ---------------------------------------------------------------------------
// Exported: scanForInitiatives
// The main analysis function. Reads instance data, calls Opus, returns the
// initiative record (or null if nothing found worth surfacing).
// ---------------------------------------------------------------------------

export async function scanForInitiatives(instanceDir, customerConfig, creds) {
  const { anthropicKey } = creds;

  log(`Scanning for initiatives: ${customerConfig.name} (${customerConfig.customerId})`);

  // Collect all business data
  const businessData = collectBusinessData(instanceDir);
  log(`Data collected: ${businessData.tasks.completed.length} completed tasks, ${businessData.tasks.stalled.length} stalled, ${businessData.conversations.length} conversation messages`);

  // Load CEO system prompt
  const ceoSystemPromptPath = join(instanceDir, 'prompts', 'ceo-system-prompt.md');
  let ceoSystemPrompt = '';
  if (existsSync(ceoSystemPromptPath)) {
    ceoSystemPrompt = readFileSync(ceoSystemPromptPath, 'utf-8');
  }

  // Determine model — Opus for enterprise/professional tiers, Sonnet otherwise
  const tier = customerConfig.tier || 'starter';
  const model = (tier === 'enterprise' || tier === 'professional') ? OPUS_MODEL : SONNET_MODEL;
  log(`Using model: ${model} (tier: ${tier})`);

  // Build prompts
  const systemPrompt = buildScanSystemPrompt(customerConfig, ceoSystemPrompt);
  const userPrompt = buildScanUserPrompt(customerConfig, businessData);

  // Call the CEO model
  let rawResponse;
  try {
    rawResponse = await callClaude(anthropicKey, model, systemPrompt, userPrompt, 4096);
  } catch (e) {
    log(`CEO model call failed: ${e.message}`);
    throw e;
  }

  // Parse the initiative
  let initiative;
  try {
    initiative = parseInitiative(rawResponse);
  } catch (e) {
    log(`Initiative parse failed: ${e.message}`);
    throw e;
  }

  // Check if CEO decided to skip
  if (initiative.skipReason) {
    log(`CEO found nothing to surface: ${initiative.skipReason}`);
    return null;
  }

  // Validate required fields
  if (!initiative.title || !initiative.proposedActions?.length) {
    log(`Initiative missing required fields — skipping`);
    return null;
  }

  // Save to disk
  const { id, filePath, record } = saveInitiative(instanceDir, initiative);
  log(`Initiative ready: [${record.opportunityType}] ${record.title} (urgency: ${record.urgency})`);

  return record;
}

// ---------------------------------------------------------------------------
// Exported: presentInitiative
// Sends the initiative to the founder via Telegram.
// ---------------------------------------------------------------------------

export async function presentInitiative(initiative, creds) {
  const { botToken, ownerChatId, businessName } = creds;

  if (!botToken || !ownerChatId) {
    log(`Cannot present initiative — Telegram credentials missing`);
    return false;
  }

  const message = formatInitiativeMessage(initiative, businessName);
  log(`Sending initiative to founder: ${initiative.title}`);

  try {
    await sendTelegramMessage(botToken, ownerChatId, message);
    log(`Initiative sent successfully: ${initiative.id}`);
    return true;
  } catch (e) {
    log(`Telegram send failed: ${e.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Exported: handleInitiativeResponse
// Called by the hub when it receives a founder message that might be a
// response to an initiative. Returns true if it was handled, false if not.
// ---------------------------------------------------------------------------

export async function handleInitiativeResponse(text, instanceDir, creds) {
  const normalized = String(text).trim().toUpperCase();

  // Check if this looks like an initiative response
  const isApprove = normalized === 'APPROVE' || normalized.startsWith('APPROVE ');
  const isDiscuss = normalized === 'DISCUSS' || normalized.startsWith('DISCUSS ');

  if (!isApprove && !isDiscuss) {
    // Check for initiative ID in text (e.g., "init-12345-abc approve")
    const idMatch = text.match(/\b(init-\d+-[a-z0-9]+)\b/i);
    if (!idMatch) return false;

    const initiativeId = idMatch[1].toLowerCase();
    const lowerText = text.toLowerCase();
    if (!lowerText.includes('approve') && !lowerText.includes('discuss')) return false;

    // Re-route with the specific initiative ID
    const approveById = lowerText.includes('approve');
    return await _handleResponseById(initiativeId, approveById ? 'approve' : 'discuss', instanceDir, creds);
  }

  // No specific ID — find the most recent pending initiative
  const pending = loadPendingInitiatives(instanceDir);
  if (pending.length === 0) {
    log(`Initiative response received but no pending initiatives found`);
    return false;
  }

  // Sort by generatedAt desc, take most recent
  pending.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
  const initiative = pending[0];

  return await _handleResponseById(initiative.id, isApprove ? 'approve' : 'discuss', instanceDir, creds);
}

async function _handleResponseById(initiativeId, action, instanceDir, creds) {
  const initiativesDir = join(instanceDir, 'data', 'initiatives');
  const filePath = join(initiativesDir, `${initiativeId}.json`);

  if (!existsSync(filePath)) {
    log(`Initiative response: ID ${initiativeId} not found`);
    return false;
  }

  const initiative = JSON.parse(readFileSync(filePath, 'utf-8'));
  const { botToken, ownerChatId } = creds;

  if (action === 'approve') {
    log(`Initiative APPROVED: ${initiative.title}`);
    updateInitiative(instanceDir, initiativeId, {
      status: 'approved',
      founderResponse: 'approve',
      responseAt: new Date().toISOString(),
    });

    // Delegate to agents
    const taskPaths = delegateInitiativeTask(instanceDir, initiative);
    updateInitiative(instanceDir, initiativeId, {
      status: 'executed',
      delegatedTaskFiles: taskPaths,
    });

    // Confirm to founder
    const agentsList = (initiative.proposedActions || [])
      .map(a => `- [${a.agentId}] ${a.action}`)
      .join('\n');

    const confirmMsg = `Got it. Executing now.\n\n${agentsList}\n\n_I'll update you when there's progress to report._`;
    try {
      await sendTelegramMessage(botToken, ownerChatId, confirmMsg);
    } catch (e) {
      log(`Confirmation send failed: ${e.message}`);
    }

    log(`Tasks delegated: ${taskPaths.length} task(s) written`);
    return true;
  }

  if (action === 'discuss') {
    log(`Initiative DISCUSS: ${initiative.title}`);
    updateInitiative(instanceDir, initiativeId, {
      status: 'discussing',
      founderResponse: 'discuss',
      responseAt: new Date().toISOString(),
    });

    const discussMsg = `Sure. Here's the full picture:\n\n*${initiative.title}*\n\n${initiative.reasoning}\n\n*What I'd do:*\n${(initiative.proposedActions || []).map(a => `- [${a.agentId}] ${a.action} (expected: ${a.expectedOutcome})`).join('\n')}\n\nWhat's on your mind?`;
    try {
      await sendTelegramMessage(botToken, ownerChatId, discussMsg);
    } catch (e) {
      log(`Discussion message send failed: ${e.message}`);
    }

    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Initiative metrics — approval rate, execution count, etc.
// ---------------------------------------------------------------------------

function getInitiativeMetrics(instanceDir) {
  const initiativesDir = join(instanceDir, 'data', 'initiatives');
  if (!existsSync(initiativesDir)) return { total: 0, approved: 0, rejected: 0, discussing: 0, executed: 0, approvalRate: null };

  let total = 0, approved = 0, rejected = 0, discussing = 0, executed = 0, skipped = 0;

  for (const f of readdirSync(initiativesDir).filter(n => n.endsWith('.json'))) {
    try {
      const record = JSON.parse(readFileSync(join(initiativesDir, f), 'utf-8'));
      total++;
      const s = record.status;
      if (s === 'approved') approved++;
      else if (s === 'rejected') rejected++;
      else if (s === 'discussing') discussing++;
      else if (s === 'executed') executed++;
      else if (s === 'skipped') skipped++;
    } catch { /* non-fatal */ }
  }

  const responded = approved + rejected;
  const approvalRate = responded > 0 ? Math.round((approved / responded) * 100) : null;

  return { total, approved, rejected, discussing, executed, skipped, approvalRate };
}

// ---------------------------------------------------------------------------
// Single scan + present pass — one full cycle
// ---------------------------------------------------------------------------

async function runScanPass(instanceDir, customerConfig, creds, isDryRun) {
  logSection(`PROACTIVE SCAN — ${customerConfig.name}`);

  let initiative;
  try {
    initiative = await scanForInitiatives(instanceDir, customerConfig, creds);
  } catch (e) {
    log(`Scan failed: ${e.message}`);
    return false;
  }

  if (!initiative) {
    log(`No initiative to surface — scan complete with no action`);
    return true;
  }

  if (isDryRun) {
    log(`DRY RUN — Telegram send skipped`);
    console.log('\n--- INITIATIVE (dry run) ---');
    console.log(`Type:     ${initiative.opportunityType}`);
    console.log(`Urgency:  ${initiative.urgency}`);
    console.log(`Title:    ${initiative.title}`);
    console.log(`Headline: ${initiative.headline}`);
    console.log(`\nReasoning:\n${initiative.reasoning}`);
    console.log(`\nMessage preview:\n${initiative.founderMessage}`);
    console.log('--- END ---\n');
    return true;
  }

  const sent = await presentInitiative(initiative, creds);
  if (sent) {
    log(`Pass complete. Initiative presented: ${initiative.id}`);
  } else {
    log(`Pass complete. Initiative saved but NOT sent (Telegram issue).`);
  }

  return sent;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const isDryRun = !!args['dry-run'];

  if (!args.instance) {
    console.error('Usage: node scripts/your9-proactive.mjs --instance <customer-id> --scan|--daemon');
    console.error('       --scan    One-time analysis pass');
    console.error('       --daemon  Continuous, checks every 4 hours');
    console.error('       --dry-run Generate initiative but do not send Telegram');
    process.exit(1);
  }

  const isScan = !!args['scan'];
  const isDaemon = !!args['daemon'];

  if (!isScan && !isDaemon) {
    console.error('Specify a mode: --scan or --daemon');
    process.exit(1);
  }

  const customerId = args.instance;
  const instanceDir = join(INSTANCES_DIR, customerId);

  logSection(`PROACTIVE INITIATIVE ENGINE — ${customerId}`);

  // --- Validate instance ---
  if (!existsSync(instanceDir)) {
    console.error(`Instance not found: ${customerId}`);
    process.exit(1);
  }

  const customerConfigPath = join(instanceDir, 'config', 'customer.json');
  if (!existsSync(customerConfigPath)) {
    console.error(`Customer config missing: ${customerConfigPath}`);
    process.exit(1);
  }

  const customerConfig = JSON.parse(readFileSync(customerConfigPath, 'utf-8'));
  log(`Instance: ${customerConfig.name} (${customerConfig.industry}, ${customerConfig.tier})`);

  if (customerConfig.status !== 'active') {
    console.error(`Instance status "${customerConfig.status}" — must be active`);
    process.exit(1);
  }

  // --- Load credentials ---
  const envPath = join(instanceDir, 'config', '.env');
  const instanceEnv = loadEnvFile(envPath);

  const anthropicKey = (instanceEnv.ANTHROPIC_API_KEY && !instanceEnv.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER'))
    ? instanceEnv.ANTHROPIC_API_KEY
    : process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    console.error(`No Anthropic API key found. Set ANTHROPIC_API_KEY in ${envPath} or environment.`);
    process.exit(1);
  }

  const botToken = (instanceEnv.TELEGRAM_BOT_TOKEN && !instanceEnv.TELEGRAM_BOT_TOKEN.startsWith('PLACEHOLDER'))
    ? instanceEnv.TELEGRAM_BOT_TOKEN : null;

  const ownerChatId = (instanceEnv.TELEGRAM_OWNER_CHAT_ID && !instanceEnv.TELEGRAM_OWNER_CHAT_ID.startsWith('PLACEHOLDER'))
    ? instanceEnv.TELEGRAM_OWNER_CHAT_ID : null;

  if (!isDryRun && (!botToken || !ownerChatId)) {
    console.error(`Telegram credentials not configured. Use --dry-run or set TELEGRAM_BOT_TOKEN + TELEGRAM_OWNER_CHAT_ID in ${envPath}`);
    process.exit(1);
  }

  const creds = {
    anthropicKey,
    botToken,
    ownerChatId,
    businessName: customerConfig.name,
  };

  // --- Print current metrics ---
  const metrics = getInitiativeMetrics(instanceDir);
  if (metrics.total > 0) {
    log(`Prior initiatives: ${metrics.total} total, ${metrics.approved} approved, ${metrics.rejected} rejected, ${metrics.executed} executed${metrics.approvalRate !== null ? `, approval rate: ${metrics.approvalRate}%` : ''}`);
  }

  // --- Run ---
  if (isScan) {
    await runScanPass(instanceDir, customerConfig, creds, isDryRun);
    process.exit(0);
  }

  if (isDaemon) {
    log(`Daemon mode. Scanning every ${DAEMON_INTERVAL_MS / 1000 / 60 / 60} hours.`);
    log(`First scan starting now...`);

    // First pass immediately
    await runScanPass(instanceDir, customerConfig, creds, isDryRun);

    // Then repeat on interval
    setInterval(async () => {
      await runScanPass(instanceDir, customerConfig, creds, isDryRun);
    }, DAEMON_INTERVAL_MS);

    // Keep process alive
    process.on('SIGINT', () => {
      log(`Daemon stopped (SIGINT)`);
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      log(`Daemon stopped (SIGTERM)`);
      process.exit(0);
    });

    log(`Daemon running. Next scan in ${DAEMON_INTERVAL_MS / 1000 / 60} minutes.`);
  }
}

// Only run main() when executed directly (not imported as a module)
const isMain = process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].split('/').pop())
  || process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch(err => {
    console.error(`PROACTIVE ENGINE FAILED: ${err.message}`);
    log(`FATAL: ${err.message}`);
    process.exit(1);
  });
}
