#!/usr/bin/env node
/**
 * your9-ceo-learning.mjs — AI CEO Learning & Adaptation Engine
 * Your9 by 9 Enterprises
 *
 * The CEO that remembers everything is the CEO that never wastes the founder's time.
 *
 * Flow:
 *   1. Interaction Learning  — After every conversation, Sonnet extracts key
 *      learnings: founder preferences, business updates, new priorities, corrected
 *      assumptions, decision patterns. Every learning is timestamped and categorized.
 *
 *   2. Business Model Update — Maintains a living JSON document of everything the
 *      CEO knows about the founder's business. Gets richer after every session.
 *      Persisted at instances/{id}/data/learning/business-model.json
 *
 *   3. Memory Persistence    — All learnings organized by topic across sessions:
 *      clients, products, competitors, goals, preferences, corrections, context.
 *      Stored as topic-keyed memory entries with timestamps and confidence scores.
 *
 *   4. Strategy Suggestions  — When the CEO detects patterns across accumulated
 *      business data (repeated friction, untapped opportunity, pivot signals),
 *      it generates proactive strategic suggestions for the founder.
 *
 *   5. Learning Log          — Every new piece of knowledge is timestamped and
 *      written to instances/{id}/data/learning/{timestamp}-learnings.json
 *
 * Usage:
 *   node scripts/your9-ceo-learning.mjs --instance <customer-id> --learn
 *   node scripts/your9-ceo-learning.mjs --instance <customer-id> --suggest
 *   node scripts/your9-ceo-learning.mjs --instance <customer-id> --query --topic clients
 *   node scripts/your9-ceo-learning.mjs --instance <customer-id> --learn --suggest
 *
 * Flags:
 *   --instance        Customer ID (required). Must exist in instances/ directory.
 *   --learn           Extract learnings from recent conversation history and persist.
 *   --suggest         Generate strategic suggestions from accumulated memory.
 *   --query           Print memory for a specific topic (use --topic <name>).
 *   --topic           Topic to query: clients | products | competitors | goals |
 *                     preferences | corrections | context (default: all)
 *   --min-messages    Minimum conversation entries required (default: 5).
 *   --max-messages    Max conversation entries to analyze (default: 200).
 *   --dry-run         Run analysis, print output, do NOT write any files.
 *
 * Exports (for programmatic use):
 *   extractLearnings(instanceDir, anthropicKey, options?)
 *   updateBusinessModel(instanceDir, learnings)
 *   queryMemory(instanceDir, topic?)
 *   suggestStrategy(instanceDir, anthropicKey, options?)
 */

import {
  existsSync, readFileSync, writeFileSync, appendFileSync,
  mkdirSync, readdirSync
} from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const INSTANCES = join(ROOT, 'instances');

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const EXTRACTION_MODEL = 'claude-sonnet-4-5';         // Conversation extraction + categorization
const STRATEGY_MODEL   = 'claude-sonnet-4-5';         // Pattern detection + strategy suggestions

// ---------------------------------------------------------------------------
// Memory topic schema
// ---------------------------------------------------------------------------

const MEMORY_TOPICS = [
  'clients',       // People, companies, relationships, contact details the founder mentions
  'products',      // Services, offerings, pricing, features the business provides
  'competitors',   // Competing businesses, market context, differentiation points
  'goals',         // Founder objectives, targets, timelines, success definitions
  'preferences',   // How the founder likes to work, communicate, make decisions
  'corrections',   // Things the CEO got wrong — explicit corrections from the founder
  'context',       // Industry norms, regulatory context, local market conditions
  'team',          // Staff, partners, contractors, org structure, hiring plans
  'financials',    // Revenue targets, cost awareness, budget signals (not hard numbers)
  'operations',    // Day-to-day workflows, recurring tasks, pain points, bottlenecks
];

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

let globalLogPath = null;

function log(msg) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] CEO-LEARNING: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  if (globalLogPath) {
    try { appendFileSync(globalLogPath, line + '\n'); } catch {}
  }
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
// Raw HTTPS helpers — no SDK dependency
// ---------------------------------------------------------------------------

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      res => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); }
          catch (e) {
            reject(new Error(`JSON parse failed: ${e.message} — body: ${buf.slice(0, 300)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('HTTPS request timed out after 120s'));
    });
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Anthropic API — raw HTTPS
// ---------------------------------------------------------------------------

async function callClaude(anthropicKey, model, systemPrompt, userMessage, maxTokens = 4000) {
  const result = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key':         anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    {
      model,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    }
  );

  if (result.error) {
    throw new Error(`Anthropic API error: ${result.error.message || JSON.stringify(result.error)}`);
  }

  const text = result.content?.[0]?.text;
  if (!text) {
    throw new Error(`Anthropic returned no content: ${JSON.stringify(result).slice(0, 300)}`);
  }

  return text;
}

// ---------------------------------------------------------------------------
// JSON extraction from model output (handles markdown fenced blocks)
// ---------------------------------------------------------------------------

function extractJSON(text) {
  // Try fenced block first
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  // Try raw JSON
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  const start = firstBrace === -1 ? firstBracket
              : firstBracket === -1 ? firstBrace
              : Math.min(firstBrace, firstBracket);
  if (start !== -1) {
    try { return JSON.parse(text.slice(start)); } catch {}
  }
  throw new Error(`Could not extract JSON from model output: ${text.slice(0, 200)}`);
}

// ---------------------------------------------------------------------------
// Instance loader
// ---------------------------------------------------------------------------

function loadInstance(customerId) {
  const instanceDir = join(INSTANCES, customerId);

  if (!existsSync(instanceDir)) {
    throw new Error(`Instance not found: ${customerId} (looked in ${INSTANCES})`);
  }

  const configPath = join(instanceDir, 'config', 'customer.json');
  if (!existsSync(configPath)) {
    throw new Error(`Customer config missing: ${configPath}`);
  }
  const instanceConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

  const envPath      = join(instanceDir, 'config', '.env');
  const env          = loadEnvFile(envPath);
  const anthropicKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey || anthropicKey.startsWith('PLACEHOLDER')) {
    throw new Error(`ANTHROPIC_API_KEY not set or is placeholder in ${envPath}`);
  }

  // Ensure required directories exist
  const learningDir = join(instanceDir, 'data', 'learning');
  const logsDir     = join(instanceDir, 'logs');
  [learningDir, logsDir].forEach(d => { if (!existsSync(d)) mkdirSync(d, { recursive: true }); });

  // Set global log path for this run
  globalLogPath = join(logsDir, 'ceo-learning.log');

  return { customerId, instanceDir, instanceConfig, anthropicKey, learningDir, logsDir };
}

// ---------------------------------------------------------------------------
// Conversation history reader
// ---------------------------------------------------------------------------

function loadConversationHistory(instanceDir, maxMessages = 200) {
  // Check both path conventions used across Your9 scripts
  const candidates = [
    join(instanceDir, 'data', 'conversations', 'history.jsonl'),
    join(instanceDir, 'data', 'conversation',  'history.jsonl'),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return parseHistoryFile(p, maxMessages);
  }

  log('No conversation history found — returning empty array');
  return [];
}

function parseHistoryFile(filePath, maxMessages) {
  try {
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    const parsed = lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    return parsed.slice(-maxMessages);
  } catch (e) {
    log(`History parse failed (non-fatal): ${e.message}`);
    return [];
  }
}

function buildConversationContext(history) {
  if (history.length === 0) return 'No conversation history available.';

  return history
    .map(entry => {
      const ts   = entry.timestamp ? `[${entry.timestamp}] ` : '';
      const role = (entry.role || 'unknown').toUpperCase();
      const text = typeof entry.content === 'string'
        ? entry.content
        : JSON.stringify(entry.content);
      return `${ts}${role}: ${text.slice(0, 800)}`;
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Business model — load + save
// ---------------------------------------------------------------------------

function loadBusinessModel(learningDir) {
  const modelPath = join(learningDir, 'business-model.json');
  if (!existsSync(modelPath)) {
    return {
      lastUpdated:   null,
      sessionCount:  0,
      overview:      null,
      industry:      null,
      founderProfile: {},
      revenue:       { signals: [], targets: [], streams: [] },
      clients:       { segments: [], keyRelationships: [], acquisitionChannels: [] },
      products:      { offerings: [], pricing: [], differentiators: [] },
      competitors:   { named: [], landscape: '', edgeAgainst: [] },
      goals:         { shortTerm: [], longTerm: [], successMetrics: [] },
      operations:    { workflows: [], painPoints: [], bottlenecks: [] },
      team:          { members: [], gaps: [], hiringPlans: [] },
      market:        { geography: null, regulatoryContext: null, tailwinds: [], headwinds: [] },
      openQuestions: [],
      lastLearnings:  [],
    };
  }
  try {
    return JSON.parse(readFileSync(modelPath, 'utf-8'));
  } catch (e) {
    log(`Business model load failed — starting fresh: ${e.message}`);
    return loadBusinessModel('/dev/null'); // recurse with guaranteed-missing path trick
  }
}

function saveBusinessModel(learningDir, model, dryRun = false) {
  const modelPath = join(learningDir, 'business-model.json');
  model.lastUpdated = new Date().toISOString();
  if (!dryRun) {
    writeFileSync(modelPath, JSON.stringify(model, null, 2), 'utf-8');
    log(`Business model saved: ${modelPath}`);
  } else {
    log('[dry-run] Would write business model — skipped');
  }
  return model;
}

// ---------------------------------------------------------------------------
// Memory store — load + save
// ---------------------------------------------------------------------------

function loadMemoryStore(learningDir) {
  const memPath = join(learningDir, 'memory.json');
  if (!existsSync(memPath)) {
    const store = {};
    for (const topic of MEMORY_TOPICS) store[topic] = [];
    return store;
  }
  try {
    const stored = JSON.parse(readFileSync(memPath, 'utf-8'));
    // Ensure all topics exist (forward-compat)
    for (const topic of MEMORY_TOPICS) {
      if (!stored[topic]) stored[topic] = [];
    }
    return stored;
  } catch (e) {
    log(`Memory store load failed — starting fresh: ${e.message}`);
    const store = {};
    for (const topic of MEMORY_TOPICS) store[topic] = [];
    return store;
  }
}

function saveMemoryStore(learningDir, store, dryRun = false) {
  const memPath = join(learningDir, 'memory.json');
  if (!dryRun) {
    writeFileSync(memPath, JSON.stringify(store, null, 2), 'utf-8');
    log(`Memory store saved: ${memPath}`);
  } else {
    log('[dry-run] Would write memory store — skipped');
  }
}

// ---------------------------------------------------------------------------
// Merge new memory entries into store (deduplication by content hash)
// ---------------------------------------------------------------------------

function mergeMemoryEntries(store, newEntries) {
  let added = 0;
  for (const entry of newEntries) {
    const topic = entry.topic;
    if (!MEMORY_TOPICS.includes(topic)) {
      log(`Unknown topic "${topic}" — storing under "context"`);
      entry.topic = 'context';
    }
    const bucket = store[entry.topic];

    // Dedup: skip if same fact already exists (fuzzy match on content)
    const isDuplicate = bucket.some(existing =>
      levenshteinSimilarity(existing.content, entry.content) > 0.85
    );
    if (isDuplicate) continue;

    bucket.push({
      id:         generateId(),
      content:    entry.content,
      source:     entry.source || 'conversation',
      confidence: entry.confidence || 'medium',
      addedAt:    new Date().toISOString(),
      sessionRef: entry.sessionRef || null,
    });
    added++;
  }
  log(`Memory merge: ${added} new entries added (${newEntries.length - added} duplicates skipped)`);
  return added;
}

// Simple similarity check to avoid storing near-identical facts
function levenshteinSimilarity(a, b) {
  if (!a || !b) return 0;
  const s1 = a.toLowerCase().slice(0, 200);
  const s2 = b.toLowerCase().slice(0, 200);
  if (s1 === s2) return 1;
  const longer  = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  if (longer.length === 0) return 1;
  return (longer.length - editDistance(longer, shorter)) / longer.length;
}

function editDistance(s1, s2) {
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1[i - 1] !== s2[j - 1]) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------------------------------------------------------------------------
// EXPORTED: extractLearnings
// ---------------------------------------------------------------------------

/**
 * Extract key learnings from recent conversation history.
 *
 * @param {string}  instanceDir   - Absolute path to the instance directory
 * @param {string}  anthropicKey  - Anthropic API key
 * @param {object}  options       - { maxMessages, minMessages, dryRun, instanceConfig }
 * @returns {Promise<{ learnings: object[], businessUpdates: object, sessionId: string }>}
 */
export async function extractLearnings(instanceDir, anthropicKey, options = {}) {
  const {
    maxMessages  = 200,
    minMessages  = 5,
    dryRun       = false,
    instanceConfig = {},
  } = options;

  const learningDir = join(instanceDir, 'data', 'learning');
  if (!existsSync(learningDir)) mkdirSync(learningDir, { recursive: true });

  const history = loadConversationHistory(instanceDir, maxMessages);

  if (history.length < minMessages) {
    log(`Skipping extraction — only ${history.length} messages (min: ${minMessages})`);
    return { learnings: [], businessUpdates: {}, sessionId: null, skipped: true };
  }

  log(`Extracting learnings from ${history.length} conversation entries`);

  const existingModel = loadBusinessModel(learningDir);
  const existingMemory = loadMemoryStore(learningDir);

  // Build a summary of what the CEO already knows (prevents re-stating known facts)
  const knownFacts = Object.entries(existingMemory)
    .filter(([, entries]) => entries.length > 0)
    .map(([topic, entries]) => {
      const sample = entries.slice(-5).map(e => `- ${e.content}`).join('\n');
      return `${topic.toUpperCase()}:\n${sample}`;
    })
    .join('\n\n');

  const systemPrompt = `You are an AI business analyst extracting structured learnings from a CEO-founder conversation.

Your job is to identify NEW information the CEO has learned about the founder's business.
Focus ONLY on facts, preferences, decisions, and corrections that are genuinely new or that update prior understanding.

Business context:
- Company: ${instanceConfig.name || 'Unknown'}
- Industry: ${instanceConfig.industry || 'Unknown'}

What the CEO already knows (do not re-extract these unless they have been corrected):
${knownFacts || 'Nothing yet — this is the first extraction.'}

Output ONLY valid JSON. No commentary outside the JSON block.

Schema:
{
  "sessionSummary": "1-2 sentence summary of what this conversation was about",
  "learnings": [
    {
      "topic": "<one of: clients|products|competitors|goals|preferences|corrections|context|team|financials|operations>",
      "content": "Specific, concrete fact learned (no vague summaries)",
      "confidence": "<high|medium|low>",
      "source": "<founder-stated|inferred|corrected>"
    }
  ],
  "businessUpdates": {
    "overview": "<updated 1-sentence business description, or null if no change>",
    "goalsUpdated": ["<new or updated goal text>"],
    "openQuestionsAdded": ["<unresolved question the CEO should clarify with the founder>"],
    "openQuestionsResolved": ["<questions that were answered in this conversation>"],
    "operationalSignals": ["<friction, bottleneck, or workflow pattern observed>"]
  },
  "founderSignals": {
    "mood": "<positive|neutral|frustrated|uncertain>",
    "urgencyLevel": "<low|normal|high|critical>",
    "decisionStyle": "<decisive|deliberate|delegating|uncertain>",
    "topicsToAvoid": ["<topics that seemed to frustrate or bore the founder>"]
  }
}`;

  const userMessage = `Conversation history to analyze:\n\n${buildConversationContext(history)}`;

  let parsed;
  try {
    const raw = await callClaude(anthropicKey, EXTRACTION_MODEL, systemPrompt, userMessage, 3000);
    parsed = extractJSON(raw);
  } catch (e) {
    throw new Error(`Learning extraction failed: ${e.message}`);
  }

  const sessionId   = new Date().toISOString().replace(/[:.]/g, '-');
  const learnings   = parsed.learnings || [];
  const bizUpdates  = parsed.businessUpdates || {};

  log(`Extracted ${learnings.length} learnings, session: ${sessionId}`);
  log(`Session summary: ${parsed.sessionSummary || 'none'}`);

  if (!dryRun) {
    // Write learning log entry
    const logEntry = {
      sessionId,
      timestamp:    new Date().toISOString(),
      messageCount: history.length,
      sessionSummary: parsed.sessionSummary,
      learningCount:  learnings.length,
      learnings,
      businessUpdates: bizUpdates,
      founderSignals:  parsed.founderSignals || {},
    };
    const logPath = join(learningDir, `${sessionId}-learnings.json`);
    writeFileSync(logPath, JSON.stringify(logEntry, null, 2), 'utf-8');
    log(`Learning log written: ${logPath}`);

    // Persist to memory store
    const store = loadMemoryStore(learningDir);
    mergeMemoryEntries(store, learnings);
    saveMemoryStore(learningDir, store);

    // Apply business updates to the business model
    const updatedModel = await updateBusinessModel(instanceDir, learnings, bizUpdates, { instanceConfig });
    log(`Business model updated (session ${sessionId})`);

    return { learnings, businessUpdates: bizUpdates, sessionId, sessionSummary: parsed.sessionSummary, updatedModel };
  } else {
    log('[dry-run] Would persist learnings — skipped');
    return { learnings, businessUpdates: bizUpdates, sessionId, sessionSummary: parsed.sessionSummary, dryRun: true };
  }
}

// ---------------------------------------------------------------------------
// EXPORTED: updateBusinessModel
// ---------------------------------------------------------------------------

/**
 * Merge new learnings and business updates into the living business model document.
 *
 * @param {string}  instanceDir    - Absolute path to the instance directory
 * @param {Array}   learnings      - Array of learning entries (from extractLearnings)
 * @param {object}  businessUpdates - businessUpdates section from extraction
 * @param {object}  options        - { dryRun, instanceConfig }
 * @returns {object} Updated business model
 */
export async function updateBusinessModel(instanceDir, learnings = [], businessUpdates = {}, options = {}) {
  const { dryRun = false, instanceConfig = {} } = options;

  const learningDir = join(instanceDir, 'data', 'learning');
  if (!existsSync(learningDir)) mkdirSync(learningDir, { recursive: true });

  const model = loadBusinessModel(learningDir);

  // Increment session count
  model.sessionCount = (model.sessionCount || 0) + 1;

  // Apply overview update
  if (businessUpdates.overview) {
    model.overview = businessUpdates.overview;
  }

  // Apply industry from instanceConfig if not yet set
  if (!model.industry && instanceConfig.industry) {
    model.industry = instanceConfig.industry;
  }
  if (!model.market?.regulatoryContext && instanceConfig.industryContext?.regulatoryContext) {
    model.market = model.market || {};
    model.market.regulatoryContext = instanceConfig.industryContext.regulatoryContext;
  }

  // Merge goals — check both short and long term to avoid cross-list duplicates
  if (businessUpdates.goalsUpdated?.length > 0) {
    for (const goal of businessUpdates.goalsUpdated) {
      const allGoals = [...model.goals.shortTerm, ...model.goals.longTerm];
      const isDup = allGoals.some(g => levenshteinSimilarity(g, goal) > 0.8);
      if (!isDup) model.goals.shortTerm.push(goal);
    }
  }

  // Merge open questions
  if (businessUpdates.openQuestionsAdded?.length > 0) {
    for (const q of businessUpdates.openQuestionsAdded) {
      const isDup = model.openQuestions.some(existing => levenshteinSimilarity(existing, q) > 0.8);
      if (!isDup) model.openQuestions.push(q);
    }
  }

  // Resolve open questions
  if (businessUpdates.openQuestionsResolved?.length > 0) {
    model.openQuestions = model.openQuestions.filter(q =>
      !businessUpdates.openQuestionsResolved.some(resolved =>
        levenshteinSimilarity(q, resolved) > 0.7
      )
    );
  }

  // Merge operational signals into operations.painPoints
  if (businessUpdates.operationalSignals?.length > 0) {
    model.operations = model.operations || { workflows: [], painPoints: [], bottlenecks: [] };
    for (const signal of businessUpdates.operationalSignals) {
      const isDup = model.operations.painPoints.some(p => levenshteinSimilarity(p, signal) > 0.8);
      if (!isDup) model.operations.painPoints.push(signal);
    }
  }

  // Merge topic-specific learnings into model sections
  for (const learning of learnings) {
    const { topic, content, confidence } = learning;
    if (!content) continue;

    switch (topic) {
      case 'clients':
        if (!model.clients.segments.some(s => levenshteinSimilarity(s, content) > 0.8)) {
          model.clients.segments.push(content);
        }
        break;
      case 'products':
        if (!model.products.offerings.some(o => levenshteinSimilarity(o, content) > 0.8)) {
          model.products.offerings.push(content);
        }
        break;
      case 'competitors':
        if (!model.competitors.named.some(c => levenshteinSimilarity(c, content) > 0.8)) {
          model.competitors.named.push(content);
        }
        break;
      case 'goals':
        if (confidence === 'high' && !model.goals.longTerm.some(g => levenshteinSimilarity(g, content) > 0.8)) {
          model.goals.longTerm.push(content);
        }
        break;
      case 'team':
        if (!model.team.members.some(m => levenshteinSimilarity(m, content) > 0.8)) {
          model.team.members.push(content);
        }
        break;
      case 'financials':
        if (!model.revenue.signals.some(s => levenshteinSimilarity(s, content) > 0.8)) {
          model.revenue.signals.push(content);
        }
        break;
      case 'operations':
        if (!model.operations.workflows.some(w => levenshteinSimilarity(w, content) > 0.8)) {
          model.operations.workflows.push(content);
        }
        break;
      case 'context':
      case 'corrections':
        // Stored in memory only — not duplicated into model sections
        break;
    }
  }

  // Track last learnings summary (rolling last 10)
  model.lastLearnings = [
    ...(model.lastLearnings || []).slice(-9),
    {
      at:    new Date().toISOString(),
      count: learnings.length,
      topics: [...new Set(learnings.map(l => l.topic))],
    },
  ];

  return saveBusinessModel(learningDir, model, dryRun);
}

// ---------------------------------------------------------------------------
// EXPORTED: queryMemory
// ---------------------------------------------------------------------------

/**
 * Retrieve memory entries by topic.
 *
 * @param {string}  instanceDir - Absolute path to the instance directory
 * @param {string}  topic       - Topic name, or 'all' for the full store
 * @returns {object} Memory entries keyed by topic (or single topic array)
 */
export function queryMemory(instanceDir, topic = 'all') {
  const learningDir = join(instanceDir, 'data', 'learning');
  const store = loadMemoryStore(learningDir);

  if (topic === 'all') {
    return store;
  }

  if (!MEMORY_TOPICS.includes(topic)) {
    throw new Error(`Unknown topic "${topic}". Valid topics: ${MEMORY_TOPICS.join(', ')}`);
  }

  return { [topic]: store[topic] || [] };
}

// ---------------------------------------------------------------------------
// EXPORTED: suggestStrategy
// ---------------------------------------------------------------------------

/**
 * Analyze accumulated memory and business model to generate strategic suggestions.
 *
 * @param {string}  instanceDir   - Absolute path to the instance directory
 * @param {string}  anthropicKey  - Anthropic API key
 * @param {object}  options       - { dryRun, instanceConfig, minLearningEntries }
 * @returns {Promise<{ suggestions: object[], suggestionId: string }>}
 */
export async function suggestStrategy(instanceDir, anthropicKey, options = {}) {
  const {
    dryRun              = false,
    instanceConfig      = {},
    minLearningEntries  = 3,
  } = options;

  const learningDir = join(instanceDir, 'data', 'learning');
  const store       = loadBusinessModel(learningDir);
  const memory      = loadMemoryStore(learningDir);

  // Count total memory entries
  const totalEntries = Object.values(memory).reduce((sum, arr) => sum + arr.length, 0);
  if (totalEntries < minLearningEntries) {
    log(`Skipping strategy — only ${totalEntries} memory entries (min: ${minLearningEntries})`);
    return { suggestions: [], suggestionId: null, skipped: true };
  }

  log(`Generating strategy suggestions from ${totalEntries} memory entries`);

  // Build rich context from memory
  const memoryContext = MEMORY_TOPICS
    .filter(t => memory[t]?.length > 0)
    .map(t => {
      const entries = memory[t].slice(-10); // Most recent 10 per topic
      return `## ${t.toUpperCase()} (${entries.length} entries)\n` +
        entries.map(e => `- [${e.confidence}] ${e.content}`).join('\n');
    })
    .join('\n\n');

  const modelContext = `
## Business Overview
${store.overview || 'Not yet defined'}

## Industry
${store.industry || instanceConfig.industry || 'Unknown'}

## Current Goals
Short-term: ${(store.goals?.shortTerm || []).slice(-5).join(', ') || 'None recorded'}
Long-term: ${(store.goals?.longTerm || []).slice(-5).join(', ') || 'None recorded'}

## Open Questions
${(store.openQuestions || []).slice(-5).join('\n') || 'None'}

## Pain Points
${(store.operations?.painPoints || []).slice(-5).join('\n') || 'None recorded'}

## Sessions analyzed: ${store.sessionCount || 0}
`.trim();

  const systemPrompt = `You are an AI CEO strategic advisor. You have been studying this business through ongoing conversation with its founder. You have accumulated structured memory about the business.

Your job: detect patterns in the accumulated knowledge and generate 2-4 specific, actionable strategic suggestions.

RULES:
- Only suggest things that are grounded in the actual memory data provided
- Each suggestion must cite the pattern or signal that triggered it
- Suggestions should be actionable within 30 days
- Do NOT suggest generic best practices that apply to any business
- Priority order: revenue opportunities first, then operational fixes, then growth plays

Output ONLY valid JSON. No commentary outside the JSON block.

Schema:
{
  "patternsSeen": [
    "Brief description of a recurring pattern detected across memory entries"
  ],
  "suggestions": [
    {
      "title": "Short action-oriented title",
      "category": "<revenue|operations|clients|growth|risk>",
      "priority": "<critical|high|medium>",
      "signal": "Specific memory entries or patterns that triggered this suggestion",
      "action": "Concrete, specific action the founder should take",
      "expectedOutcome": "What improvement or result this should produce",
      "timeframe": "<immediate|this-week|this-month>"
    }
  ],
  "watchItems": [
    "Things to monitor — not ready for action yet but worth tracking"
  ]
}`;

  const userMessage = `Business model snapshot:\n${modelContext}\n\nAccumulated memory:\n${memoryContext}`;

  let parsed;
  try {
    const raw = await callClaude(anthropicKey, STRATEGY_MODEL, systemPrompt, userMessage, 3000);
    parsed = extractJSON(raw);
  } catch (e) {
    throw new Error(`Strategy suggestion failed: ${e.message}`);
  }

  const suggestions = parsed.suggestions || [];
  const suggestionId = new Date().toISOString().replace(/[:.]/g, '-');

  log(`Generated ${suggestions.length} strategy suggestions (id: ${suggestionId})`);

  if (!dryRun) {
    const suggestionLog = {
      suggestionId,
      timestamp:     new Date().toISOString(),
      memoryEntries: totalEntries,
      patternsSeen:  parsed.patternsSeen || [],
      suggestions,
      watchItems:    parsed.watchItems || [],
    };
    const logPath = join(learningDir, `${suggestionId}-strategy.json`);
    writeFileSync(logPath, JSON.stringify(suggestionLog, null, 2), 'utf-8');
    log(`Strategy log written: ${logPath}`);
  } else {
    log('[dry-run] Would write strategy log — skipped');
  }

  return {
    suggestions,
    suggestionId,
    patternsSeen:  parsed.patternsSeen || [],
    watchItems:    parsed.watchItems || [],
  };
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.instance) {
    console.error('Error: --instance <customer-id> is required');
    process.exit(1);
  }

  const modeFlags = ['learn', 'suggest', 'query'];
  const activeModes = modeFlags.filter(m => args[m]);

  if (activeModes.length === 0) {
    console.error('Error: specify at least one mode: --learn | --suggest | --query');
    console.error('  --learn              Extract learnings from conversation history');
    console.error('  --suggest            Generate strategy suggestions from memory');
    console.error('  --query [--topic X]  Print memory for a topic (or all)');
    process.exit(1);
  }

  let instance;
  try {
    instance = loadInstance(args.instance);
  } catch (e) {
    console.error(`Failed to load instance: ${e.message}`);
    process.exit(1);
  }

  const { instanceDir, instanceConfig, anthropicKey, learningDir } = instance;
  const dryRun = !!args['dry-run'];

  log(`=== CEO Learning Engine start ===`);
  log(`Instance: ${args.instance} (${instanceConfig.name || 'unnamed'})`);
  log(`Modes: ${activeModes.join(', ')}${dryRun ? ' [DRY RUN]' : ''}`);

  // --learn
  if (args.learn) {
    log('--- Mode: LEARN ---');
    try {
      const result = await extractLearnings(instanceDir, anthropicKey, {
        maxMessages:    parseInt(args['max-messages'] || '200', 10),
        minMessages:    parseInt(args['min-messages'] || '5', 10),
        dryRun,
        instanceConfig,
      });

      if (result.skipped) {
        log('Learning skipped — not enough conversation history');
      } else {
        log(`Session: ${result.sessionId}`);
        log(`Summary: ${result.sessionSummary}`);
        log(`Learnings extracted: ${result.learnings.length}`);

        // Group by topic for display
        const byTopic = {};
        for (const l of result.learnings) {
          (byTopic[l.topic] = byTopic[l.topic] || []).push(l);
        }
        for (const [topic, entries] of Object.entries(byTopic)) {
          log(`  ${topic}: ${entries.length} entries`);
          for (const e of entries) {
            log(`    [${e.confidence}] ${e.content}`);
          }
        }
      }
    } catch (e) {
      log(`LEARN failed: ${e.message}`);
      if (!args.suggest && !args.query) process.exit(1);
    }
  }

  // --suggest
  if (args.suggest) {
    log('--- Mode: SUGGEST ---');
    try {
      const result = await suggestStrategy(instanceDir, anthropicKey, {
        dryRun,
        instanceConfig,
        minLearningEntries: 3,
      });

      if (result.skipped) {
        log('Strategy skipped — not enough memory data yet');
      } else {
        log(`Patterns detected: ${result.patternsSeen.length}`);
        for (const p of result.patternsSeen) log(`  PATTERN: ${p}`);

        log(`Suggestions (${result.suggestions.length}):`);
        for (const s of result.suggestions) {
          log(`  [${s.priority.toUpperCase()}] [${s.category}] ${s.title}`);
          log(`    Action: ${s.action}`);
          log(`    Timeframe: ${s.timeframe}`);
          log(`    Signal: ${s.signal}`);
        }

        if (result.watchItems.length > 0) {
          log('Watch items:');
          for (const w of result.watchItems) log(`  WATCH: ${w}`);
        }
      }
    } catch (e) {
      log(`SUGGEST failed: ${e.message}`);
      if (!args.query) process.exit(1);
    }
  }

  // --query
  if (args.query) {
    log('--- Mode: QUERY ---');
    const topic = typeof args.topic === 'string' ? args.topic : 'all';
    try {
      const result = queryMemory(instanceDir, topic);
      const topics = Object.entries(result);
      for (const [t, entries] of topics) {
        log(`\nTOPIC: ${t.toUpperCase()} (${entries.length} entries)`);
        if (entries.length === 0) {
          log('  (empty)');
        } else {
          for (const e of entries) {
            log(`  [${e.confidence}] [${e.addedAt?.slice(0, 10)}] ${e.content}`);
          }
        }
      }

      // Also print business model summary
      const model = loadBusinessModel(learningDir);
      log('\n=== BUSINESS MODEL SNAPSHOT ===');
      log(`Overview: ${model.overview || 'not set'}`);
      log(`Industry: ${model.industry || 'not set'}`);
      log(`Sessions analyzed: ${model.sessionCount || 0}`);
      log(`Last updated: ${model.lastUpdated || 'never'}`);
      log(`Open questions: ${model.openQuestions.length}`);
      for (const q of model.openQuestions) log(`  ? ${q}`);
    } catch (e) {
      log(`QUERY failed: ${e.message}`);
      process.exit(1);
    }
  }

  log('=== CEO Learning Engine complete ===');
}

// ---------------------------------------------------------------------------
// Entry point — only run main() when executed directly
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch(e => {
    console.error(`Fatal: ${e.message}`);
    process.exit(1);
  });
}
