#!/usr/bin/env node
/**
 * your9-knowledge-query.mjs — AI CEO Knowledge Base Intelligence Layer
 * Your9 by 9 Enterprises
 *
 * The AI layer on top of the knowledge base storage. This is what makes the
 * CEO smarter over time — it reads everything the founder shares, extracts
 * meaning, and surfaces the right knowledge at the right moment.
 *
 * Four core capabilities:
 *
 *   1. ingestDocument(instanceDir, filePath, anthropicKey)
 *      Called when a new document lands in instances/{id}/data/knowledge/.
 *      Sonnet reads the document, extracts key facts, entities, policies, and
 *      dates, writes a searchable summary alongside the source file.
 *
 *   2. queryKnowledge(instanceDir, question, anthropicKey, opts)
 *      Given any question or context, finds the most relevant knowledge base
 *      entries using Sonnet-powered semantic relevance scoring. Returns ranked
 *      entries with excerpts and confidence scores.
 *
 *   3. getDecisionContext(instanceDir, decisionDescription, anthropicKey)
 *      Before the CEO makes any significant decision, call this to pull all
 *      relevant KB entries and format them as CEO-ready context. Injected
 *      directly into the system prompt at decision time.
 *
 *   4. suggestKnowledgeUpdate(instanceDir, conversation, anthropicKey)
 *      After a conversation, Sonnet scans for new facts the CEO learned and
 *      proposes knowledge base additions. Returns structured proposals —
 *      the CEO then confirms before anything is written.
 *
 * Usage (standalone):
 *   node scripts/your9-knowledge-query.mjs --instance <customer-id> --query "What is our refund policy?"
 *   node scripts/your9-knowledge-query.mjs --instance <customer-id> --ingest /path/to/doc.pdf
 *   node scripts/your9-knowledge-query.mjs --instance <customer-id> --suggest --conversation-file /path/to/convo.json
 *
 * Flags:
 *   --instance     Customer ID (required)
 *   --query        Run queryKnowledge with this question
 *   --ingest       Ingest a specific file into the knowledge base
 *   --suggest      Scan recent conversation for knowledge update suggestions
 *   --conversation-file  Path to conversation JSON for --suggest mode
 *   --top          Max results to return from --query (default: 5)
 *   --dry-run      Show what would be written but do not write
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync,
  appendFileSync, readdirSync, statSync, watchFile
} from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

// ---------------------------------------------------------------------------
// Paths + constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');
const LOG_FILE = join(ROOT, 'logs', 'your9-knowledge-query.log');

// The model doing all the intelligence work — Sonnet per brief spec.
// Opus is NOT used here (ongoing queries would be expensive; Sonnet is capable).
const SONNET_MODEL = 'claude-sonnet-4-5';

// Knowledge base sub-paths within an instance
const KB_DIR = 'data/knowledge';
const KB_SUMMARIES_DIR = 'data/knowledge/.summaries';
const KB_INDEX_FILE = 'data/knowledge/.index.json';

// Max characters of a source document to send to Sonnet for ingestion.
// Covers any realistic business document without blowing token limits.
const MAX_INGEST_CHARS = 40000;

// Max summary entries to load for a single query (keeps prompts tight)
const MAX_ENTRIES_FOR_QUERY = 30;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] KNOWLEDGE-QUERY: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  try {
    if (!existsSync(join(ROOT, 'logs'))) mkdirSync(join(ROOT, 'logs'), { recursive: true });
    appendFileSync(LOG_FILE, line + '\n');
  } catch { /* non-fatal */ }
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
// Raw HTTPS POST — no SDK dependency, same pattern as hub.mjs
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
          catch (e) {
            reject(new Error(`JSON parse failed: ${e.message} — body: ${buf.slice(0, 300)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(90000, () => {
      req.destroy();
      reject(new Error('HTTPS request timed out after 90s'));
    });
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Anthropic API call — single-turn, system + user prompt
// ---------------------------------------------------------------------------

async function callSonnet(anthropicKey, systemPrompt, userPrompt, maxTokens = 4096) {
  const result = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    {
      model: SONNET_MODEL,
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

  return text;
}

// ---------------------------------------------------------------------------
// JSON parse helper — strips markdown fencing if model wraps the JSON
// ---------------------------------------------------------------------------

function parseJSON(raw) {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    // Last resort: find first { or [ and parse from there
    const objMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (objMatch) return JSON.parse(objMatch[1]);
    throw new Error(`Could not parse JSON from model response (first 300 chars): ${raw.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

function ensureKbDirs(instanceDir) {
  const kbDir = join(instanceDir, KB_DIR);
  const summariesDir = join(instanceDir, KB_SUMMARIES_DIR);
  if (!existsSync(kbDir)) mkdirSync(kbDir, { recursive: true });
  if (!existsSync(summariesDir)) mkdirSync(summariesDir, { recursive: true });
  return { kbDir, summariesDir };
}

function getKbPaths(instanceDir) {
  return {
    kbDir: join(instanceDir, KB_DIR),
    summariesDir: join(instanceDir, KB_SUMMARIES_DIR),
    indexPath: join(instanceDir, KB_INDEX_FILE),
  };
}

// ---------------------------------------------------------------------------
// Index management
// ---------------------------------------------------------------------------

function loadIndex(indexPath) {
  if (!existsSync(indexPath)) return { entries: [], lastUpdated: null };
  try {
    return JSON.parse(readFileSync(indexPath, 'utf-8'));
  } catch {
    return { entries: [], lastUpdated: null };
  }
}

function saveIndex(indexPath, index) {
  index.lastUpdated = new Date().toISOString();
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

function upsertIndexEntry(index, entry) {
  const existing = index.entries.findIndex(e => e.fileId === entry.fileId);
  if (existing >= 0) {
    index.entries[existing] = { ...index.entries[existing], ...entry, updatedAt: new Date().toISOString() };
  } else {
    index.entries.push({ ...entry, addedAt: new Date().toISOString() });
  }
}

// ---------------------------------------------------------------------------
// Document reading — handles .txt, .md, .json, .csv; truncates if needed
// ---------------------------------------------------------------------------

function readDocumentContent(filePath) {
  const ext = extname(filePath).toLowerCase();
  let content;

  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (e) {
    throw new Error(`Cannot read file ${filePath}: ${e.message}`);
  }

  // For JSON, pretty-print it so Sonnet can read it more easily
  if (ext === '.json') {
    try {
      content = JSON.stringify(JSON.parse(content), null, 2);
    } catch { /* leave as-is if invalid JSON */ }
  }

  if (content.length > MAX_INGEST_CHARS) {
    log(`Document truncated from ${content.length} to ${MAX_INGEST_CHARS} chars: ${basename(filePath)}`);
    content = content.slice(0, MAX_INGEST_CHARS) + '\n\n[DOCUMENT TRUNCATED — additional content not shown]';
  }

  return content;
}

// ---------------------------------------------------------------------------
// CAPABILITY 1: ingestDocument
//
// Reads a document, calls Sonnet to extract a structured summary, writes the
// summary JSON to .summaries/, and updates the KB index.
//
// Returns: the summary object
// ---------------------------------------------------------------------------

/**
 * Ingest a document into the knowledge base.
 *
 * @param {string} instanceDir  - Absolute path to the instance directory
 * @param {string} filePath     - Absolute path to the document to ingest
 * @param {string} anthropicKey - Anthropic API key
 * @param {object} opts
 * @param {boolean} opts.dryRun - If true, return summary but do not write to disk
 * @returns {Promise<object>}   - The extracted summary object
 */
export async function ingestDocument(instanceDir, filePath, anthropicKey, opts = {}) {
  const { dryRun = false } = opts;

  log(`Ingesting: ${filePath}`);

  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const { summariesDir, indexPath } = getKbPaths(instanceDir);
  if (!dryRun) ensureKbDirs(instanceDir);

  const fileName = basename(filePath);
  const fileId = fileName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  const stat = statSync(filePath);
  const content = readDocumentContent(filePath);

  // Load customer config for business context
  let businessContext = '';
  try {
    const cc = JSON.parse(readFileSync(join(instanceDir, 'config', 'customer.json'), 'utf-8'));
    businessContext = `Business: ${cc.name} (${cc.industryContext?.label || cc.industry})`;
  } catch { /* non-fatal */ }

  const systemPrompt = `You are an expert document analyst for an AI business assistant.
Your job is to extract structured, searchable information from business documents.
${businessContext}

You MUST return valid JSON only — no explanation, no preamble, no markdown outside the JSON.`;

  const userPrompt = `Analyze this document and extract all information needed to answer future questions about it.

Document name: ${fileName}
Document size: ${(content.length / 1024).toFixed(1)}KB

Document content:
---
${content}
---

Return JSON with exactly this structure:
{
  "title": "Document title (from content, or derive from filename if missing)",
  "documentType": "policy|contract|financial|procedure|contact|training|other",
  "summary": "2-4 sentence plain-English summary of what this document is and why it matters",
  "keyFacts": [
    "Specific fact 1 (concrete, searchable)",
    "Specific fact 2",
    ...
  ],
  "policies": [
    "Policy or rule stated in the document (if any)"
  ],
  "entities": {
    "people": ["Name — role/context"],
    "companies": ["Company name — relationship"],
    "products": ["Product or service name"],
    "dates": ["YYYY-MM-DD — what this date represents"]
  },
  "keywords": ["word1", "word2", "..."],
  "searchableQuestions": [
    "What question would this document answer? (write 3-5 real questions)"
  ],
  "confidenceNote": "Any caveats about document completeness or clarity"
}

Rules:
- keyFacts: 5-15 items. Specific, not generic. Include numbers, names, dates, thresholds.
- policies: Only include explicit rules/policies. Empty array if none.
- keywords: 10-20 terms a human might search for to find this document.
- searchableQuestions: Real questions this document could answer. These power the semantic search.
- All fields are required. Use empty arrays/objects where nothing applies.`;

  log(`Calling Sonnet to extract summary from ${fileName}`);
  const rawResponse = await callSonnet(anthropicKey, systemPrompt, userPrompt, 4096);

  let summary;
  try {
    summary = parseJSON(rawResponse);
  } catch (e) {
    throw new Error(`Sonnet returned unparseable summary for ${fileName}: ${e.message}`);
  }

  // Add provenance metadata
  const entry = {
    fileId,
    fileName,
    filePath,
    fileSize: stat.size,
    fileModified: stat.mtime.toISOString(),
    ingestedAt: new Date().toISOString(),
    ...summary,
  };

  if (!dryRun) {
    // Write summary JSON
    const summaryPath = join(instanceDir, KB_SUMMARIES_DIR, `${fileId}.json`);
    writeFileSync(summaryPath, JSON.stringify(entry, null, 2));
    log(`Summary written: ${summaryPath}`);

    // Update index
    const index = loadIndex(join(instanceDir, KB_INDEX_FILE));
    upsertIndexEntry(index, {
      fileId,
      fileName,
      filePath,
      title: entry.title,
      documentType: entry.documentType,
      ingestedAt: entry.ingestedAt,
      keywords: entry.keywords,
    });
    saveIndex(join(instanceDir, KB_INDEX_FILE), index);
    log(`Index updated — ${index.entries.length} total entries`);
  } else {
    log(`DRY RUN — summary generated but not written`);
  }

  return entry;
}

// ---------------------------------------------------------------------------
// CAPABILITY 2: queryKnowledge
//
// Given a question, loads all KB summaries, sends them + the question to
// Sonnet, gets back ranked relevance scores + excerpts.
//
// Returns: array of { entry, relevanceScore, relevanceReason, excerpt }
// ---------------------------------------------------------------------------

/**
 * Query the knowledge base for relevant entries.
 *
 * @param {string} instanceDir  - Absolute path to the instance directory
 * @param {string} question     - The question or context to search against
 * @param {string} anthropicKey - Anthropic API key
 * @param {object} opts
 * @param {number} opts.topK         - Max results to return (default: 5)
 * @param {number} opts.minScore     - Minimum relevance score 0-10 (default: 4)
 * @param {boolean} opts.includeText - Include full summary text in results (default: false)
 * @returns {Promise<Array>}   - Ranked array of relevant entries
 */
export async function queryKnowledge(instanceDir, question, anthropicKey, opts = {}) {
  const { topK = 5, minScore = 4, includeText = false } = opts;

  const { summariesDir, indexPath } = getKbPaths(instanceDir);

  // Load all summaries
  const entries = loadAllSummaries(instanceDir);

  if (entries.length === 0) {
    log(`queryKnowledge: no entries in knowledge base for ${instanceDir}`);
    return [];
  }

  log(`queryKnowledge: scoring ${entries.length} entries against "${question.slice(0, 80)}"`);

  // Build a compact representation of each entry for the scoring prompt
  // We include enough context for Sonnet to judge relevance without the full summary
  const entriesForScoring = entries.slice(0, MAX_ENTRIES_FOR_QUERY).map((e, i) => ({
    index: i,
    fileId: e.fileId,
    title: e.title || e.fileName,
    documentType: e.documentType,
    summary: e.summary || '',
    keywords: (e.keywords || []).join(', '),
    searchableQuestions: (e.searchableQuestions || []).join(' | '),
    keyFactsPreview: (e.keyFacts || []).slice(0, 5).join(' | '),
  }));

  const systemPrompt = `You are a knowledge retrieval specialist for an AI business assistant.
Your job is to find the most relevant knowledge base documents for a given question or context.
You must return valid JSON only — no explanation, no preamble.`;

  const userPrompt = `Question / context to search for:
"${question}"

Knowledge base documents (${entriesForScoring.length} total):
${JSON.stringify(entriesForScoring, null, 2)}

Score each document for relevance to the question. Return JSON:
{
  "results": [
    {
      "fileId": "the fileId from the entry",
      "relevanceScore": 8,
      "relevanceReason": "One sentence: why this document is relevant",
      "excerpt": "The most relevant 1-3 sentences from the keyFacts or summary that directly address the question"
    }
  ]
}

Rules:
- relevanceScore: 0-10. 10 = directly answers the question. 0 = completely unrelated.
- Only include documents with relevanceScore >= ${minScore}.
- Sort by relevanceScore descending.
- Limit to top ${topK} results.
- excerpt: Pull the actual text from the document that best answers the question. Quote key facts, policies, or dates.
- If NO documents are relevant, return { "results": [] }`;

  const rawResponse = await callSonnet(anthropicKey, systemPrompt, userPrompt, 2048);

  let scored;
  try {
    scored = parseJSON(rawResponse);
  } catch (e) {
    log(`queryKnowledge: Sonnet returned unparseable scoring response: ${e.message}`);
    return [];
  }

  const results = (scored.results || []).map(r => {
    const fullEntry = entries.find(e => e.fileId === r.fileId);
    if (!fullEntry) return null;
    return {
      fileId: r.fileId,
      fileName: fullEntry.fileName,
      title: fullEntry.title || fullEntry.fileName,
      documentType: fullEntry.documentType,
      relevanceScore: r.relevanceScore,
      relevanceReason: r.relevanceReason,
      excerpt: r.excerpt,
      ingestedAt: fullEntry.ingestedAt,
      filePath: fullEntry.filePath,
      ...(includeText ? { fullSummary: fullEntry } : {}),
    };
  }).filter(Boolean);

  log(`queryKnowledge: returning ${results.length} results (top score: ${results[0]?.relevanceScore ?? 'n/a'})`);
  return results;
}

// ---------------------------------------------------------------------------
// CAPABILITY 3: getDecisionContext
//
// Given a description of a decision the CEO is about to make, queries the KB
// and formats a ready-to-inject context block for the CEO's system prompt.
//
// Returns: { hasContext: bool, contextBlock: string, sources: array }
// ---------------------------------------------------------------------------

/**
 * Get knowledge base context for a CEO decision.
 *
 * @param {string} instanceDir          - Absolute path to the instance directory
 * @param {string} decisionDescription  - What decision is being made
 * @param {string} anthropicKey         - Anthropic API key
 * @param {object} opts
 * @param {number} opts.topK            - Max KB entries to pull (default: 5)
 * @returns {Promise<object>}           - { hasContext, contextBlock, sources }
 */
export async function getDecisionContext(instanceDir, decisionDescription, anthropicKey, opts = {}) {
  const { topK = 5 } = opts;

  log(`getDecisionContext: "${decisionDescription.slice(0, 100)}"`);

  const results = await queryKnowledge(instanceDir, decisionDescription, anthropicKey, {
    topK,
    minScore: 5,  // Higher threshold for decision context — only pull clearly relevant docs
    includeText: false,
  });

  if (results.length === 0) {
    return {
      hasContext: false,
      contextBlock: '',
      sources: [],
    };
  }

  // Format as an injected context block for the CEO system prompt
  const lines = [
    '## Knowledge Base Context',
    `The following internal documents are relevant to this decision:`,
    '',
  ];

  for (const r of results) {
    lines.push(`### ${r.title} (${r.documentType})`);
    lines.push(`*Relevance: ${r.relevanceReason}*`);
    lines.push('');
    lines.push(r.excerpt);
    lines.push('');
    lines.push(`*Source: ${r.fileName} — ingested ${r.ingestedAt ? r.ingestedAt.slice(0, 10) : 'unknown'}*`);
    lines.push('');
  }

  lines.push('---');
  lines.push('When referencing these documents in your response, cite them by title.');
  lines.push('Example: "Based on your Q1 Sales Policy document..."');

  const contextBlock = lines.join('\n');

  log(`getDecisionContext: built context block from ${results.length} source(s)`);

  return {
    hasContext: true,
    contextBlock,
    sources: results.map(r => ({
      fileId: r.fileId,
      title: r.title,
      fileName: r.fileName,
      relevanceScore: r.relevanceScore,
    })),
  };
}

// ---------------------------------------------------------------------------
// CAPABILITY 4: suggestKnowledgeUpdate
//
// After a conversation, scans for new facts the CEO learned and proposes
// additions to the knowledge base. Returns structured proposals the CEO
// can review before writing anything.
//
// Returns: { hasProposals: bool, proposals: array }
// ---------------------------------------------------------------------------

/**
 * Scan a conversation for new knowledge and propose KB additions.
 *
 * @param {string} instanceDir       - Absolute path to the instance directory
 * @param {Array} conversation       - Array of { role: 'user'|'assistant', content: string }
 * @param {string} anthropicKey      - Anthropic API key
 * @param {object} opts
 * @param {boolean} opts.dryRun      - If true, return proposals but do not write
 * @returns {Promise<object>}        - { hasProposals, proposals, proposalFilePath }
 */
export async function suggestKnowledgeUpdate(instanceDir, conversation, anthropicKey, opts = {}) {
  const { dryRun = false } = opts;

  if (!Array.isArray(conversation) || conversation.length === 0) {
    return { hasProposals: false, proposals: [] };
  }

  log(`suggestKnowledgeUpdate: scanning ${conversation.length} messages`);

  // Load existing KB index to avoid proposing duplicates
  const index = loadIndex(join(instanceDir, KB_INDEX_FILE));
  const existingTitles = index.entries.map(e => e.title || e.fileName).join(', ');

  // Load customer config for context
  let businessContext = '';
  let businessName = 'the business';
  try {
    const cc = JSON.parse(readFileSync(join(instanceDir, 'config', 'customer.json'), 'utf-8'));
    businessContext = `Business: ${cc.name} (${cc.industryContext?.label || cc.industry})`;
    businessName = cc.name;
  } catch { /* non-fatal */ }

  // Format conversation for the prompt
  const convoText = conversation
    .slice(-40)  // Last 40 messages — avoid prompt overflow
    .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join('\n\n');

  const systemPrompt = `You are an AI knowledge management assistant for ${businessName}.
Your job is to identify NEW information shared in conversations that should be saved to the knowledge base.
${businessContext}
You MUST return valid JSON only.`;

  const userPrompt = `Review this conversation and identify any new, reusable knowledge the CEO learned.

Conversation:
---
${convoText}
---

Existing knowledge base already contains: ${existingTitles || 'nothing yet'}

Identify facts, policies, decisions, or context that:
1. The founder explicitly shared (company policies, product details, personnel info, etc.)
2. Would be useful for the CEO to remember in FUTURE conversations
3. Are NOT already in the existing knowledge base

Return JSON:
{
  "hasNewKnowledge": true|false,
  "proposals": [
    {
      "proposedTitle": "Short descriptive title for this knowledge entry",
      "documentType": "policy|contact|financial|procedure|training|other",
      "content": "The full text to save — verbatim or cleaned up from conversation. Minimum 2-3 sentences.",
      "keyFacts": ["fact1", "fact2"],
      "whyUseful": "One sentence: why this would help the CEO in future conversations",
      "sourceMessage": "Brief quote from the conversation that triggered this (max 100 chars)"
    }
  ]
}

Rules:
- Only propose if the founder shared something genuinely NEW and specific
- Skip pleasantries, generic discussion, one-off context that won't matter later
- proposals array: empty if nothing worth saving
- Content must be complete enough to be useful without the conversation context
- Max 5 proposals per run`;

  const rawResponse = await callSonnet(anthropicKey, systemPrompt, userPrompt, 3000);

  let parsed;
  try {
    parsed = parseJSON(rawResponse);
  } catch (e) {
    log(`suggestKnowledgeUpdate: unparseable response — ${e.message}`);
    return { hasProposals: false, proposals: [] };
  }

  const proposals = parsed.proposals || [];

  if (proposals.length === 0) {
    log(`suggestKnowledgeUpdate: no new knowledge identified`);
    return { hasProposals: false, proposals: [] };
  }

  log(`suggestKnowledgeUpdate: ${proposals.length} proposal(s) identified`);

  // Write proposals to disk for CEO review (unless dry run)
  let proposalFilePath = null;
  if (!dryRun) {
    const proposalsDir = join(instanceDir, 'data', 'knowledge', '.proposals');
    if (!existsSync(proposalsDir)) mkdirSync(proposalsDir, { recursive: true });

    const timestamp = Date.now();
    proposalFilePath = join(proposalsDir, `${timestamp}-proposals.json`);
    writeFileSync(proposalFilePath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      status: 'pending_review',
      proposals,
    }, null, 2));
    log(`Proposals written to: ${proposalFilePath}`);
  }

  return {
    hasProposals: true,
    proposals,
    proposalFilePath,
  };
}

// ---------------------------------------------------------------------------
// applyKnowledgeProposal — writes an approved proposal as a KB document
//
// Called after the CEO (or founder) confirms a proposal from suggestKnowledgeUpdate.
// Creates a .md file in the knowledge dir and immediately ingests it.
//
// Returns: the ingested summary entry
// ---------------------------------------------------------------------------

/**
 * Apply an approved knowledge update proposal.
 *
 * @param {string} instanceDir  - Absolute path to the instance directory
 * @param {object} proposal     - A single proposal from suggestKnowledgeUpdate results
 * @param {string} anthropicKey - Anthropic API key
 * @returns {Promise<object>}   - The ingested summary entry
 */
export async function applyKnowledgeProposal(instanceDir, proposal, anthropicKey) {
  const { kbDir } = getKbPaths(instanceDir);
  ensureKbDirs(instanceDir);

  const safeTitle = (proposal.proposedTitle || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60);

  const timestamp = new Date().toISOString().slice(0, 10);
  const fileName = `${timestamp}-${safeTitle}.md`;
  const filePath = join(kbDir, fileName);

  // Write as markdown with frontmatter
  const docContent = [
    `# ${proposal.proposedTitle}`,
    '',
    `**Type:** ${proposal.documentType || 'other'}`,
    `**Added:** ${new Date().toISOString().slice(0, 10)}`,
    `**Source:** Conversation — "${proposal.sourceMessage || ''}"`,
    '',
    '---',
    '',
    proposal.content,
    '',
    ...(proposal.keyFacts && proposal.keyFacts.length > 0 ? [
      '## Key Facts',
      ...proposal.keyFacts.map(f => `- ${f}`),
    ] : []),
  ].join('\n');

  writeFileSync(filePath, docContent);
  log(`Knowledge document written: ${filePath}`);

  // Immediately ingest so it's searchable
  const entry = await ingestDocument(instanceDir, filePath, anthropicKey);
  log(`Proposal applied and indexed: ${entry.title}`);
  return entry;
}

// ---------------------------------------------------------------------------
// Auto-watch: watchKnowledgeDir
//
// Sets up a file watcher on instances/{id}/data/knowledge/ and automatically
// ingests any new files that land there. Returns a cleanup function.
//
// Used by the hub to enable automatic ingestion when founders drop files in.
// ---------------------------------------------------------------------------

/**
 * Watch the knowledge directory and auto-ingest new documents.
 *
 * @param {string} instanceDir  - Absolute path to the instance directory
 * @param {string} anthropicKey - Anthropic API key
 * @param {function} onIngest   - Optional callback(entry) after each successful ingest
 * @returns {function}          - Cleanup function to stop watching
 */
export function watchKnowledgeDir(instanceDir, anthropicKey, onIngest) {
  const { kbDir } = getKbPaths(instanceDir);
  ensureKbDirs(instanceDir);

  // Track files we've already ingested to avoid double-processing
  const index = loadIndex(join(instanceDir, KB_INDEX_FILE));
  const knownFiles = new Set(index.entries.map(e => e.fileName));

  log(`watchKnowledgeDir: watching ${kbDir}`);

  // Poll the directory every 30 seconds — fs.watch is unreliable on macOS
  const POLL_INTERVAL = 30000;
  const intervalId = setInterval(async () => {
    try {
      const files = readdirSync(kbDir).filter(f => {
        // Skip hidden files (summaries, proposals, index live in hidden dirs/files)
        if (f.startsWith('.')) return false;
        // Only ingest supported formats
        const ext = extname(f).toLowerCase();
        return ['.txt', '.md', '.json', '.csv', '.pdf'].includes(ext);
      });

      for (const file of files) {
        if (knownFiles.has(file)) continue;

        const filePath = join(kbDir, file);
        log(`watchKnowledgeDir: new file detected — ${file}`);
        knownFiles.add(file);  // Add immediately to avoid double-ingest on next tick

        try {
          const entry = await ingestDocument(instanceDir, filePath, anthropicKey);
          log(`watchKnowledgeDir: auto-ingested ${file} — "${entry.title}"`);
          if (typeof onIngest === 'function') {
            await onIngest(entry);
          }
        } catch (e) {
          log(`watchKnowledgeDir: ingest failed for ${file} — ${e.message}`);
          knownFiles.delete(file);  // Retry next poll
        }
      }
    } catch (e) {
      log(`watchKnowledgeDir: poll error — ${e.message}`);
    }
  }, POLL_INTERVAL);

  // Return cleanup
  return () => {
    clearInterval(intervalId);
    log(`watchKnowledgeDir: stopped`);
  };
}

// ---------------------------------------------------------------------------
// loadAllSummaries — internal helper
// Reads all summary JSON files from .summaries/ and returns them as an array
// ---------------------------------------------------------------------------

function loadAllSummaries(instanceDir) {
  const summariesDir = join(instanceDir, KB_SUMMARIES_DIR);
  if (!existsSync(summariesDir)) return [];

  try {
    return readdirSync(summariesDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(readFileSync(join(summariesDir, f), 'utf-8'));
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
// getKnowledgeStats — utility for health checks and dashboards
// ---------------------------------------------------------------------------

/**
 * Get statistics about the knowledge base.
 *
 * @param {string} instanceDir - Absolute path to the instance directory
 * @returns {object}           - Stats object
 */
export function getKnowledgeStats(instanceDir) {
  const { indexPath } = getKbPaths(instanceDir);
  const index = loadIndex(indexPath);

  const entries = index.entries || [];
  const byType = {};
  for (const e of entries) {
    byType[e.documentType || 'other'] = (byType[e.documentType || 'other'] || 0) + 1;
  }

  return {
    totalDocuments: entries.length,
    byDocumentType: byType,
    lastUpdated: index.lastUpdated,
    entries: entries.map(e => ({
      fileId: e.fileId,
      title: e.title || e.fileName,
      documentType: e.documentType,
      ingestedAt: e.ingestedAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const isDryRun = !!args['dry-run'];

  if (!args.instance) {
    console.error('Usage: node scripts/your9-knowledge-query.mjs --instance <customer-id> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --query "question"           Query the knowledge base');
    console.error('  --ingest /path/to/file       Ingest a specific document');
    console.error('  --suggest                    Scan recent conversation for KB suggestions');
    console.error('  --conversation-file /path    Conversation JSON file for --suggest');
    console.error('  --top N                      Max results for --query (default: 5)');
    console.error('  --dry-run                    Simulate without writing');
    console.error('  --stats                      Show knowledge base statistics');
    process.exit(1);
  }

  const customerId = args.instance;
  const instanceDir = join(INSTANCES_DIR, customerId);

  if (!existsSync(instanceDir)) {
    console.error(`Instance not found: ${customerId}`);
    console.error(`Run: node scripts/your9-provision.mjs --name "..." --industry "..."`);
    process.exit(1);
  }

  // Load credentials
  const envPath = join(instanceDir, 'config', '.env');
  const instanceEnv = loadEnvFile(envPath);
  const anthropicKey = (instanceEnv.ANTHROPIC_API_KEY &&
    !instanceEnv.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER'))
    ? instanceEnv.ANTHROPIC_API_KEY
    : process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    console.error(`No Anthropic API key found. Set ANTHROPIC_API_KEY in ${envPath} or environment.`);
    process.exit(1);
  }

  // --stats
  if (args.stats) {
    const stats = getKnowledgeStats(instanceDir);
    console.log('\nKnowledge Base Statistics');
    console.log('=========================');
    console.log(`Total documents: ${stats.totalDocuments}`);
    console.log(`Last updated:    ${stats.lastUpdated || 'never'}`);
    console.log('By type:');
    for (const [type, count] of Object.entries(stats.byDocumentType)) {
      console.log(`  ${type}: ${count}`);
    }
    if (stats.entries.length > 0) {
      console.log('\nDocuments:');
      for (const e of stats.entries) {
        console.log(`  [${e.documentType}] ${e.title} (${e.ingestedAt?.slice(0, 10) || 'unknown'})`);
      }
    }
    return;
  }

  // --ingest
  if (args.ingest) {
    const filePath = args.ingest;
    console.log(`\nIngesting: ${filePath}${isDryRun ? ' (dry run)' : ''}`);
    try {
      const entry = await ingestDocument(instanceDir, filePath, anthropicKey, { dryRun: isDryRun });
      console.log(`\nIngestion complete:`);
      console.log(`  Title:    ${entry.title}`);
      console.log(`  Type:     ${entry.documentType}`);
      console.log(`  Summary:  ${entry.summary}`);
      console.log(`  Facts:    ${(entry.keyFacts || []).length} extracted`);
      console.log(`  Keywords: ${(entry.keywords || []).slice(0, 8).join(', ')}`);
      if (isDryRun) console.log('\n(dry run — nothing written to disk)');
    } catch (e) {
      console.error(`Ingestion failed: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // --query
  if (args.query) {
    const topK = parseInt(args.top || '5', 10);
    console.log(`\nQuerying knowledge base: "${args.query}"`);
    console.log(`Top ${topK} results (min score: 4)\n`);
    try {
      const results = await queryKnowledge(instanceDir, args.query, anthropicKey, { topK });
      if (results.length === 0) {
        console.log('No relevant documents found.');
        return;
      }
      for (const r of results) {
        console.log(`[${r.relevanceScore}/10] ${r.title} (${r.documentType})`);
        console.log(`  Why relevant: ${r.relevanceReason}`);
        console.log(`  Excerpt: ${r.excerpt}`);
        console.log(`  File: ${r.fileName}`);
        console.log('');
      }
    } catch (e) {
      console.error(`Query failed: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // --suggest
  if (args.suggest) {
    if (!args['conversation-file']) {
      console.error('--suggest requires --conversation-file /path/to/conversation.json');
      process.exit(1);
    }
    const convoPath = args['conversation-file'];
    if (!existsSync(convoPath)) {
      console.error(`Conversation file not found: ${convoPath}`);
      process.exit(1);
    }
    let conversation;
    try {
      conversation = JSON.parse(readFileSync(convoPath, 'utf-8'));
    } catch (e) {
      console.error(`Could not parse conversation file: ${e.message}`);
      process.exit(1);
    }
    console.log(`\nScanning conversation for knowledge update suggestions...`);
    try {
      const result = await suggestKnowledgeUpdate(instanceDir, conversation, anthropicKey, { dryRun: isDryRun });
      if (!result.hasProposals) {
        console.log('No new knowledge identified in this conversation.');
        return;
      }
      console.log(`\n${result.proposals.length} proposal(s):\n`);
      for (let i = 0; i < result.proposals.length; i++) {
        const p = result.proposals[i];
        console.log(`Proposal ${i + 1}: ${p.proposedTitle}`);
        console.log(`  Type:       ${p.documentType}`);
        console.log(`  Why useful: ${p.whyUseful}`);
        console.log(`  Content:    ${p.content.slice(0, 200)}${p.content.length > 200 ? '...' : ''}`);
        console.log('');
      }
      if (result.proposalFilePath) {
        console.log(`Proposals saved to: ${result.proposalFilePath}`);
        console.log('Review and apply with: applyKnowledgeProposal()');
      } else if (isDryRun) {
        console.log('(dry run — proposals not written to disk)');
      }
    } catch (e) {
      console.error(`Suggest failed: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // No action specified
  console.error('Specify an action: --query, --ingest, --suggest, or --stats');
  console.error('Run with no flags for full usage.');
  process.exit(1);
}

// Only run main() when executed directly, not when imported as a module
const isMain = process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].split('/').pop());
if (process.argv[1] && process.argv[1].includes('your9-knowledge-query')) {
  main().catch(err => {
    console.error(`KNOWLEDGE-QUERY FAILED: ${err.message}`);
    process.exit(1);
  });
}
