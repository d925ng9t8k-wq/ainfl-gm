#!/usr/bin/env node
/**
 * your9-knowledge-base.mjs — Per-Customer Knowledge Base & Data Vault
 * Your9 by 9 Enterprises
 *
 * Provides long-term, searchable, encrypted knowledge storage per Your9 instance.
 * The AI CEO and all agents can query this base for context. Founders can upload
 * documents via Telegram or the dashboard.
 *
 * Storage layout:
 *   instances/{id}/data/knowledge/
 *     index.json          — Document registry (id, name, type, size, summary, tags, uploadedAt)
 *     {docId}.enc         — AES-256-CBC encrypted document content
 *     {docId}.meta.json   — Per-document metadata (unencrypted, non-sensitive)
 *
 * Per-instance encryption:
 *   Key derived from a per-instance secret stored in instances/{id}/config/.env
 *   as YOUR9_KB_KEY (32 random bytes, hex-encoded).
 *   If the key does not exist, one is generated and written on first use.
 *   IV is unique per document (stored in meta, never reused).
 *
 * Exports:
 *   uploadDocument(instanceDir, options)     — Ingest + index a document
 *   searchKnowledge(instanceDir, query)      — Semantic keyword search, returns excerpts
 *   listDocuments(instanceDir)               — Returns index entries (no content)
 *   deleteDocument(instanceDir, docId)       — Hard delete doc + meta + index entry
 *   getKnowledgeContext(instanceDir, query)  — CEO/agent shortcut: formatted context string
 *
 * CLI:
 *   node scripts/your9-knowledge-base.mjs --instance <id> --upload <file>
 *   node scripts/your9-knowledge-base.mjs --instance <id> --search <query>
 *   node scripts/your9-knowledge-base.mjs --instance <id> --list
 *   node scripts/your9-knowledge-base.mjs --instance <id> --delete <docId>
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync,
  unlinkSync, readdirSync, statSync,
} from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DOC_SIZE_BYTES = 5 * 1024 * 1024;   // 5 MB per document
const MAX_SEARCH_RESULTS = 5;                   // excerpts returned per query
const EXCERPT_LENGTH = 600;                     // chars per excerpt
const SUMMARY_LENGTH = 300;                     // chars for index summary
const INDEX_FILE = 'index.json';
const KEY_ENV_VAR = 'YOUR9_KB_KEY';

// Supported MIME/extension types and their text extraction strategies
const TEXT_TYPES = new Set(['.txt', '.md', '.csv', '.json', '.yaml', '.yml', '.html', '.htm', '.xml']);
const PDF_MAGIC = Buffer.from('%PDF');

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
    const k = trimmed.slice(0, eqIdx).trim();
    const v = trimmed.slice(eqIdx + 1).trim().replace(/^"(.*)"$/, '$1');
    env[k] = v;
  }
  return env;
}

function writeEnvKey(envPath, key, value) {
  let content = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
  // Remove existing key if present
  const lines = content.split('\n').filter(l => !l.startsWith(`${key}=`));
  lines.push(`${key}=${value}`);
  writeFileSync(envPath, lines.join('\n').trim() + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Per-instance encryption key management
// ---------------------------------------------------------------------------

/**
 * Load or generate the AES-256 key for this instance.
 * Key is stored as 64 hex chars in instances/{id}/config/.env under YOUR9_KB_KEY.
 * Returns a 32-byte Buffer.
 */
function getInstanceKey(instanceDir) {
  const envPath = join(instanceDir, 'config', '.env');
  const env = loadEnvFile(envPath);

  if (env[KEY_ENV_VAR] && env[KEY_ENV_VAR].length === 64) {
    return Buffer.from(env[KEY_ENV_VAR], 'hex');
  }

  // Generate a new key
  const key = randomBytes(32);
  const hexKey = key.toString('hex');
  mkdirSync(join(instanceDir, 'config'), { recursive: true });
  writeEnvKey(envPath, KEY_ENV_VAR, hexKey);
  return key;
}

// ---------------------------------------------------------------------------
// AES-256-CBC encryption / decryption
// ---------------------------------------------------------------------------

/**
 * Encrypt a Buffer. Returns { ciphertext: Buffer, iv: string (hex) }.
 */
function encryptContent(key, plaintext) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext: encrypted, iv: iv.toString('hex') };
}

/**
 * Decrypt a Buffer. iv is hex string.
 */
function decryptContent(key, ciphertext, ivHex) {
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ---------------------------------------------------------------------------
// Knowledge directory helpers
// ---------------------------------------------------------------------------

function ensureKnowledgeDir(instanceDir) {
  const kbDir = join(instanceDir, 'data', 'knowledge');
  mkdirSync(kbDir, { recursive: true });
  return kbDir;
}

function loadIndex(kbDir) {
  const indexPath = join(kbDir, INDEX_FILE);
  if (!existsSync(indexPath)) return [];
  try {
    return JSON.parse(readFileSync(indexPath, 'utf-8'));
  } catch {
    return [];
  }
}

function saveIndex(kbDir, index) {
  writeFileSync(join(kbDir, INDEX_FILE), JSON.stringify(index, null, 2), 'utf-8');
}

function generateDocId(name) {
  const ts = Date.now();
  const hash = createHash('sha1')
    .update(`${name}-${ts}-${Math.random()}`)
    .digest('hex')
    .slice(0, 8);
  return `doc-${ts}-${hash}`;
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/**
 * Extract text from a Buffer given a file extension.
 * Returns plain UTF-8 string. Binary files that are not recognized get
 * a placeholder so they are still indexed (but content search is limited).
 */
function extractText(buffer, ext, name) {
  // Plain text types
  if (TEXT_TYPES.has(ext.toLowerCase())) {
    try {
      return buffer.toString('utf-8');
    } catch {
      return `[Binary content — ${name}]`;
    }
  }

  // PDF: simple text extraction without external deps.
  // We scan for stream content and pull visible ASCII text runs.
  // This is not a PDF parser — it extracts readable strings from the raw stream.
  if (ext.toLowerCase() === '.pdf' || buffer.slice(0, 4).equals(PDF_MAGIC)) {
    return extractPdfText(buffer, name);
  }

  // Office docs (.docx, .xlsx) are ZIP-based XML. Without unzip we cannot
  // reliably extract text. Log what we can and note the limitation.
  if (['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'].includes(ext.toLowerCase())) {
    // Try to find readable UTF-8 runs (works for some formats)
    const rawText = extractReadableStrings(buffer, 40);
    if (rawText.length > 100) {
      return `[Office document — extracted readable text fragments]\n\n${rawText}`;
    }
    return `[Office document: ${name} — upload as .txt or paste content for full indexing]`;
  }

  // Fallback: pull readable ASCII strings
  const readable = extractReadableStrings(buffer, 30);
  if (readable.length > 80) return readable;
  return `[Binary file: ${name} — no readable text extracted]`;
}

/**
 * Pull readable ASCII/UTF-8 string runs from a binary buffer.
 * minLen: minimum run length to include.
 */
function extractReadableStrings(buffer, minLen = 30) {
  const runs = [];
  let run = '';
  for (let i = 0; i < buffer.length && runs.join(' ').length < 50000; i++) {
    const c = buffer[i];
    if ((c >= 0x20 && c <= 0x7e) || c === 0x09 || c === 0x0a || c === 0x0d) {
      run += String.fromCharCode(c);
    } else {
      if (run.length >= minLen) runs.push(run.trim());
      run = '';
    }
  }
  if (run.length >= minLen) runs.push(run.trim());
  return runs.join('\n').slice(0, 100000);
}

/**
 * Extract text from PDF buffer using raw stream scanning.
 * Handles BT...ET text blocks and stream content — no external deps.
 */
function extractPdfText(buffer, name) {
  try {
    const raw = buffer.toString('latin1');
    const textRuns = [];

    // Scan for BT...ET text blocks (PDF text objects)
    const btEtRegex = /BT([\s\S]*?)ET/g;
    let match;
    while ((match = btEtRegex.exec(raw)) !== null) {
      const block = match[1];
      // Extract strings in parentheses (Tj, TJ operators)
      const strRegex = /\(([^)\\]|\\.)*\)/g;
      let strMatch;
      while ((strMatch = strRegex.exec(block)) !== null) {
        const s = strMatch[0].slice(1, -1)
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\\\/g, '\\')
          .replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')');
        if (s.trim().length > 0) textRuns.push(s);
      }
    }

    const extracted = textRuns.join(' ').replace(/\s+/g, ' ').trim();
    if (extracted.length > 50) {
      return `[PDF: ${name}]\n\n${extracted.slice(0, 100000)}`;
    }

    // Fallback to readable strings
    const fallback = extractReadableStrings(buffer, 20);
    return fallback.length > 50
      ? `[PDF: ${name} — text extracted via fallback]\n\n${fallback}`
      : `[PDF: ${name} — no readable text found. Paste the text content directly for full indexing.]`;
  } catch (e) {
    return `[PDF: ${name} — extraction failed: ${e.message}]`;
  }
}

// ---------------------------------------------------------------------------
// Summary generation — deterministic, no AI call required
// ---------------------------------------------------------------------------

/**
 * Generate a plain-text summary from extracted text.
 * Takes the first meaningful paragraph(s) up to SUMMARY_LENGTH chars.
 */
function generateSummary(text) {
  const cleaned = text
    .replace(/\[.*?\]/g, '') // strip bracket notes
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= SUMMARY_LENGTH) return cleaned;

  // Try to cut at a sentence boundary
  const cutPoint = cleaned.lastIndexOf('.', SUMMARY_LENGTH);
  if (cutPoint > SUMMARY_LENGTH / 2) {
    return cleaned.slice(0, cutPoint + 1);
  }
  return cleaned.slice(0, SUMMARY_LENGTH) + '…';
}

/**
 * Extract candidate tags from text via frequency analysis of meaningful words.
 * Returns up to 10 lowercase single-word tags.
 */
function extractTags(text, name) {
  const stopWords = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with',
    'by','from','as','is','was','are','were','be','been','being','have','has',
    'had','do','does','did','will','would','could','should','may','might',
    'shall','can','need','it','its','this','that','these','those','they','we',
    'you','i','he','she','all','any','both','each','few','more','most','other',
    'some','such','no','not','only','same','so','than','too','very','just',
    'also','into','out','up','about','through','during','before','after',
    'above','below','between','page','pdf','document',
  ]);

  const words = text.toLowerCase().match(/[a-z]{4,}/g) || [];
  const freq = {};
  for (const w of words) {
    if (!stopWords.has(w)) freq[w] = (freq[w] || 0) + 1;
  }

  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);

  // Also include words from the filename (often meaningful)
  const nameTags = basename(name, extname(name))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(w => w.length >= 3 && !stopWords.has(w));

  const combined = [...new Set([...nameTags, ...sorted])].slice(0, 12);
  return combined;
}

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

/**
 * Score how well a text chunk matches a query.
 * Simple TF-style scoring: each query word hit in text scores 1 point.
 * Consecutive multi-word phrases score 3 points.
 */
function scoreText(text, queryWords) {
  const lc = text.toLowerCase();
  let score = 0;
  for (const w of queryWords) {
    if (lc.includes(w)) score += 1;
  }
  // Bonus for exact phrase match
  const phrase = queryWords.join(' ');
  if (lc.includes(phrase)) score += 3;
  return score;
}

/**
 * Split text into overlapping chunks of ~EXCERPT_LENGTH chars.
 * Each chunk overlaps by 100 chars to avoid missing context at boundaries.
 */
function chunkText(text) {
  const chunks = [];
  const step = EXCERPT_LENGTH - 100;
  for (let i = 0; i < text.length; i += step) {
    chunks.push({
      text: text.slice(i, i + EXCERPT_LENGTH),
      offset: i,
    });
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Upload and index a document into the instance knowledge base.
 *
 * options:
 *   content: Buffer | string   — File content (required)
 *   name: string               — Original filename (required)
 *   source: string             — 'telegram' | 'dashboard' | 'api' (default: 'api')
 *   uploadedBy: string         — Who uploaded it (default: 'founder')
 *
 * Returns: { ok: true, docId, name, summary, tags, sizeBytes }
 * Throws on validation failure or encryption error.
 */
async function uploadDocument(instanceDir, options) {
  const { content, name, source = 'api', uploadedBy = 'founder' } = options;

  if (!content) throw new Error('content is required');
  if (!name || typeof name !== 'string') throw new Error('name is required');

  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');

  if (buffer.length === 0) throw new Error('Document is empty');
  if (buffer.length > MAX_DOC_SIZE_BYTES) {
    throw new Error(`Document too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`);
  }

  const kbDir = ensureKnowledgeDir(instanceDir);
  const key = getInstanceKey(instanceDir);
  const ext = extname(name) || '.txt';
  const docId = generateDocId(name);

  // Extract text for indexing
  const extractedText = extractText(buffer, ext, name);
  const summary = generateSummary(extractedText);
  const tags = extractTags(extractedText, name);
  const wordCount = extractedText.split(/\s+/).filter(Boolean).length;

  // Encrypt the raw content (the original bytes, not the extracted text)
  // We also store the extracted text encrypted so search doesn't need to re-extract
  const payload = JSON.stringify({
    rawBase64: buffer.toString('base64'),
    extractedText,
    name,
    ext,
  });
  const { ciphertext, iv } = encryptContent(key, Buffer.from(payload, 'utf-8'));
  writeFileSync(join(kbDir, `${docId}.enc`), ciphertext);

  // Write unencrypted metadata (no sensitive content, just index fields)
  const meta = {
    docId,
    name,
    ext,
    sizeBytes: buffer.length,
    wordCount,
    summary,
    tags,
    source,
    uploadedBy,
    uploadedAt: new Date().toISOString(),
    iv,
  };
  writeFileSync(join(kbDir, `${docId}.meta.json`), JSON.stringify(meta, null, 2), 'utf-8');

  // Update the index
  const index = loadIndex(kbDir);
  index.push({
    docId,
    name,
    ext,
    sizeBytes: buffer.length,
    wordCount,
    summary,
    tags,
    source,
    uploadedBy,
    uploadedAt: meta.uploadedAt,
  });
  saveIndex(kbDir, index);

  return { ok: true, docId, name, summary, tags, sizeBytes: buffer.length, wordCount };
}

/**
 * Search the knowledge base for content matching a query.
 * Returns up to MAX_SEARCH_RESULTS excerpts with source attribution.
 *
 * Returns: Array of { docId, name, excerpt, score, relevance }
 */
async function searchKnowledge(instanceDir, query) {
  if (!query || typeof query !== 'string' || !query.trim()) return [];

  const kbDir = ensureKnowledgeDir(instanceDir);
  const index = loadIndex(kbDir);
  if (index.length === 0) return [];

  const key = getInstanceKey(instanceDir);
  const queryWords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);

  if (queryWords.length === 0) return [];

  const results = [];

  for (const entry of index) {
    const metaPath = join(kbDir, `${entry.docId}.meta.json`);
    const encPath = join(kbDir, `${entry.docId}.enc`);

    if (!existsSync(encPath) || !existsSync(metaPath)) continue;

    let extractedText = '';
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      const ciphertext = readFileSync(encPath);
      const decrypted = decryptContent(key, ciphertext, meta.iv);
      const payload = JSON.parse(decrypted.toString('utf-8'));
      extractedText = payload.extractedText || '';
    } catch {
      // If decryption fails for this doc, skip it — don't crash the whole search
      continue;
    }

    // Score against summary + tags (fast path) and full text (slower)
    const tagScore = scoreText((entry.tags || []).join(' '), queryWords);
    const summaryScore = scoreText(entry.summary || '', queryWords) * 2;

    if (extractedText) {
      const chunks = chunkText(extractedText);
      let bestChunk = null;
      let bestScore = tagScore + summaryScore;

      for (const chunk of chunks) {
        const s = scoreText(chunk.text, queryWords);
        if (s > bestScore - tagScore - summaryScore) {
          bestScore = s + tagScore + summaryScore;
          bestChunk = chunk.text;
        }
      }

      if (bestScore > 0) {
        results.push({
          docId: entry.docId,
          name: entry.name,
          excerpt: (bestChunk || entry.summary || '').trim(),
          score: bestScore,
          uploadedAt: entry.uploadedAt,
          tags: entry.tags || [],
        });
      }
    } else if (tagScore + summaryScore > 0) {
      results.push({
        docId: entry.docId,
        name: entry.name,
        excerpt: entry.summary || '',
        score: tagScore + summaryScore,
        uploadedAt: entry.uploadedAt,
        tags: entry.tags || [],
      });
    }
  }

  // Sort by score, return top results
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, MAX_SEARCH_RESULTS).map(r => ({
    docId: r.docId,
    name: r.name,
    excerpt: r.excerpt.slice(0, EXCERPT_LENGTH),
    relevance: r.score,
    uploadedAt: r.uploadedAt,
    tags: r.tags,
  }));
}

/**
 * List all documents in the knowledge base (metadata only, no decryption).
 * Returns the index array.
 */
function listDocuments(instanceDir) {
  const kbDir = ensureKnowledgeDir(instanceDir);
  return loadIndex(kbDir);
}

/**
 * Delete a document by docId. Removes .enc, .meta.json, and the index entry.
 * Throws if docId not found.
 */
function deleteDocument(instanceDir, docId) {
  if (!docId || typeof docId !== 'string') throw new Error('docId required');

  const kbDir = ensureKnowledgeDir(instanceDir);
  const index = loadIndex(kbDir);
  const entryIdx = index.findIndex(e => e.docId === docId);

  if (entryIdx === -1) throw new Error(`Document not found: ${docId}`);

  const entry = index[entryIdx];

  // Remove files
  const encPath = join(kbDir, `${docId}.enc`);
  const metaPath = join(kbDir, `${docId}.meta.json`);
  if (existsSync(encPath)) unlinkSync(encPath);
  if (existsSync(metaPath)) unlinkSync(metaPath);

  // Update index
  index.splice(entryIdx, 1);
  saveIndex(kbDir, index);

  return { ok: true, docId, name: entry.name };
}

/**
 * Get document content (decrypted extracted text) by docId.
 * Used internally by the CEO when a founder asks to view a specific document.
 */
async function getDocumentContent(instanceDir, docId) {
  const kbDir = ensureKnowledgeDir(instanceDir);
  const metaPath = join(kbDir, `${docId}.meta.json`);
  const encPath = join(kbDir, `${docId}.enc`);

  if (!existsSync(encPath) || !existsSync(metaPath)) {
    throw new Error(`Document not found: ${docId}`);
  }

  const key = getInstanceKey(instanceDir);
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  const ciphertext = readFileSync(encPath);
  const decrypted = decryptContent(key, ciphertext, meta.iv);
  const payload = JSON.parse(decrypted.toString('utf-8'));

  return {
    docId,
    name: meta.name,
    ext: meta.ext,
    text: payload.extractedText || '',
    sizeBytes: meta.sizeBytes,
    uploadedAt: meta.uploadedAt,
    tags: meta.tags || [],
    summary: meta.summary || '',
  };
}

/**
 * CEO/agent shortcut — returns a formatted context string for injection into
 * an AI system prompt or conversation context.
 *
 * Returns a string like:
 *   --- Knowledge Base Context ---
 *   [Doc: "filename.pdf"] Excerpt: ...
 *   [Doc: "report.txt"] Excerpt: ...
 *   (No relevant knowledge found if empty)
 */
async function getKnowledgeContext(instanceDir, query) {
  const results = await searchKnowledge(instanceDir, query);

  if (results.length === 0) {
    return '';
  }

  const lines = ['--- Knowledge Base Context ---'];
  for (const r of results) {
    lines.push(`[Doc: "${r.name}" | uploaded ${r.uploadedAt?.slice(0, 10) || 'unknown'}]`);
    lines.push(r.excerpt);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Telegram file download helper
// Used by the hub to pull a document file from Telegram's servers.
// ---------------------------------------------------------------------------

/**
 * Download a Telegram file by file_id.
 * botToken: string
 * fileId: string  — from msg.document.file_id
 * Returns: { buffer: Buffer, fileName: string, mimeType: string }
 */
async function downloadTelegramFile(botToken, fileId, originalName) {
  const https = await import('https');

  function httpsGet(hostname, path) {
    return new Promise((resolve, reject) => {
      const req = https.default.request(
        { hostname, path, method: 'GET' },
        res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve({ buffer: Buffer.concat(chunks), statusCode: res.statusCode }));
        }
      );
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Download timed out')); });
      req.end();
    });
  }

  // Step 1: Get file path from Telegram
  const infoPath = `/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`;
  const infoResult = await httpsGet('api.telegram.org', infoPath);
  const info = JSON.parse(infoResult.buffer.toString('utf-8'));
  if (!info.ok || !info.result?.file_path) {
    throw new Error(`Telegram getFile failed: ${info.description || JSON.stringify(info)}`);
  }

  const filePath = info.result.file_path;
  const fileName = originalName || filePath.split('/').pop() || 'upload.bin';

  // Step 2: Download the file
  const downloadPath = `/file/bot${botToken}/${filePath}`;
  const downloadResult = await httpsGet('api.telegram.org', downloadPath);

  if (downloadResult.statusCode !== 200) {
    throw new Error(`Telegram file download failed with status ${downloadResult.statusCode}`);
  }

  return { buffer: downloadResult.buffer, fileName };
}

// ---------------------------------------------------------------------------
// Dashboard panel data builder
// ---------------------------------------------------------------------------

/**
 * Build the knowledge base panel data for the dashboard HTML renderer.
 * Returns: { documents: [...], totalDocs, totalSizeBytes, kbDir }
 */
function buildKnowledgePanelData(instanceDir) {
  const kbDir = join(instanceDir, 'data', 'knowledge');
  const index = existsSync(join(kbDir, INDEX_FILE))
    ? loadIndex(kbDir)
    : [];

  const totalSizeBytes = index.reduce((sum, d) => sum + (d.sizeBytes || 0), 0);

  return {
    documents: index,
    totalDocs: index.length,
    totalSizeBytes,
    kbDir,
  };
}

/**
 * Render the knowledge base panel as an HTML string for embedding in the dashboard.
 * This follows the card pattern used throughout your9-dashboard.mjs.
 */
function renderKnowledgePanel(panelData, instanceId) {
  const { documents, totalDocs, totalSizeBytes } = panelData;
  const totalMB = (totalSizeBytes / 1024 / 1024).toFixed(2);

  const docRows = documents.length === 0
    ? `<div style="padding:16px;color:var(--text-dim);font-size:13px;">
        No documents uploaded yet. Send a file via Telegram or use the upload form below.
       </div>`
    : documents.map(doc => {
        const uploadDate = doc.uploadedAt
          ? new Date(doc.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : 'Unknown';
        const sizeKB = doc.sizeBytes ? (doc.sizeBytes / 1024).toFixed(1) : '?';
        const tags = (doc.tags || []).slice(0, 4).map(t =>
          `<span class="badge" style="background:var(--surface2);color:var(--text-muted);margin-right:4px;">${escapeHtml(t)}</span>`
        ).join('');

        return `
<div class="kb-doc-row" data-doc-id="${escapeHtml(doc.docId)}">
  <div class="kb-doc-info">
    <div class="kb-doc-name">${escapeHtml(doc.name)}</div>
    <div class="kb-doc-meta">${uploadDate} &middot; ${sizeKB} KB &middot; ${doc.wordCount || '?'} words</div>
    <div class="kb-doc-summary">${escapeHtml((doc.summary || '').slice(0, 120))}${(doc.summary || '').length > 120 ? '&hellip;' : ''}</div>
    <div class="kb-doc-tags" style="margin-top:6px;">${tags}</div>
  </div>
  <button class="kb-delete-btn" onclick="kbDeleteDoc('${escapeHtml(doc.docId)}','${escapeHtml(doc.name)}')" title="Delete document" style="
    background:none;border:1px solid var(--border);color:var(--text-dim);
    border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;flex-shrink:0;
    transition:border-color 0.15s,color 0.15s;
  " onmouseover="this.style.borderColor='#e74c3c';this.style.color='#e74c3c';" onmouseout="this.style.borderColor='';this.style.color='';">
    Delete
  </button>
</div>`;
      }).join('');

  return `
<div class="card" id="knowledge-base-panel">
  <div class="card-header">
    <span class="card-title">Knowledge Base</span>
    <span class="badge" style="background:var(--surface2);color:var(--text-muted);">${totalDocs} doc${totalDocs !== 1 ? 's' : ''} &middot; ${totalMB} MB</span>
  </div>

  <style>
    .kb-doc-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }
    .kb-doc-row:last-child { border-bottom: none; }
    .kb-doc-info { flex: 1; min-width: 0; }
    .kb-doc-name { font-weight: 600; font-size: 13px; margin-bottom: 2px; word-break: break-word; }
    .kb-doc-meta { font-size: 11px; color: var(--text-dim); margin-bottom: 4px; }
    .kb-doc-summary { font-size: 12px; color: var(--text-muted); line-height: 1.4; word-break: break-word; }
    .kb-upload-zone {
      border: 2px dashed var(--border);
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      color: var(--text-dim);
      font-size: 13px;
      margin: 16px;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
    }
    .kb-upload-zone:hover { border-color: var(--accent); background: var(--surface2); }
    .kb-search-row { display: flex; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
    .kb-search-input {
      flex: 1;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 13px;
      padding: 7px 12px;
      outline: none;
    }
    .kb-search-input:focus { border-color: var(--accent); }
    .kb-search-btn {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 7px 14px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
    }
    #kb-search-results {
      padding: 0 16px 12px;
      font-size: 12px;
      color: var(--text-muted);
      display: none;
    }
    .kb-result-item { margin-bottom: 12px; }
    .kb-result-name { font-weight: 600; font-size: 12px; color: var(--text); margin-bottom: 3px; }
    .kb-result-excerpt { color: var(--text-muted); line-height: 1.4; }
  </style>

  <!-- Search -->
  <div class="kb-search-row">
    <input class="kb-search-input" id="kb-search-input" type="text" placeholder="Search knowledge base..." />
    <button class="kb-search-btn" onclick="kbSearch()">Search</button>
  </div>
  <div id="kb-search-results"></div>

  <!-- Document list -->
  <div class="card-body scroll" style="max-height:360px;">
    ${docRows}
  </div>

  <!-- Upload form -->
  <div style="padding:16px;border-top:1px solid var(--border);">
    <div class="kb-upload-zone" onclick="document.getElementById('kb-file-input').click();">
      Drop a file here or click to upload<br>
      <span style="font-size:11px;color:var(--text-dim);margin-top:4px;display:block;">PDF, TXT, MD, CSV, JSON, DOCX &middot; Max 5 MB</span>
    </div>
    <input type="file" id="kb-file-input" style="display:none;" accept=".pdf,.txt,.md,.csv,.json,.yaml,.yml,.html,.docx,.doc,.xlsx" onchange="kbUploadFile(this)" />
    <div id="kb-upload-status" style="margin-top:8px;font-size:12px;color:var(--text-dim);display:none;"></div>
  </div>
</div>

<script>
(function() {
  function kbShowStatus(msg, isError) {
    const el = document.getElementById('kb-upload-status');
    if (!el) return;
    el.style.display = 'block';
    el.style.color = isError ? '#e74c3c' : 'var(--text-muted)';
    el.textContent = msg;
  }

  window.kbUploadFile = async function(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      kbShowStatus('File too large. Max 5 MB.', true);
      input.value = '';
      return;
    }
    kbShowStatus('Uploading ' + file.name + '...');
    const reader = new FileReader();
    reader.onload = async function(e) {
      const base64 = btoa(
        new Uint8Array(e.target.result).reduce((acc, b) => acc + String.fromCharCode(b), '')
      );
      try {
        const resp = await fetch('/knowledge/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, contentBase64: base64, source: 'dashboard' }),
        });
        const data = await resp.json();
        if (data.ok) {
          kbShowStatus('Uploaded: ' + data.name + ' (' + Math.round((data.sizeBytes || 0) / 1024) + ' KB)');
          setTimeout(() => location.reload(), 1200);
        } else {
          kbShowStatus('Upload failed: ' + (data.error || 'unknown error'), true);
        }
      } catch (err) {
        kbShowStatus('Upload error: ' + err.message, true);
      }
      input.value = '';
    };
    reader.readAsArrayBuffer(file);
  };

  window.kbDeleteDoc = async function(docId, name) {
    if (!confirm('Delete "' + name + '" from the knowledge base? This cannot be undone.')) return;
    try {
      const resp = await fetch('/knowledge/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId }),
      });
      const data = await resp.json();
      if (data.ok) {
        const row = document.querySelector('[data-doc-id="' + docId + '"]');
        if (row) row.remove();
      } else {
        alert('Delete failed: ' + (data.error || 'unknown error'));
      }
    } catch (err) {
      alert('Delete error: ' + err.message);
    }
  };

  window.kbSearch = async function() {
    const query = document.getElementById('kb-search-input')?.value?.trim();
    if (!query) return;
    const resultsEl = document.getElementById('kb-search-results');
    if (!resultsEl) return;
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = 'Searching...';
    try {
      const resp = await fetch('/knowledge/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await resp.json();
      if (!data.ok || !data.results?.length) {
        resultsEl.innerHTML = '<p style="color:var(--text-dim);">No results found for: ' + query + '</p>';
        return;
      }
      resultsEl.innerHTML = data.results.map(r => \`
        <div class="kb-result-item">
          <div class="kb-result-name">\${r.name}</div>
          <div class="kb-result-excerpt">\${r.excerpt.slice(0,300)}\${r.excerpt.length > 300 ? '...' : ''}</div>
        </div>
      \`).join('<hr style="border:none;border-top:1px solid var(--border);margin:8px 0;">');
    } catch (err) {
      resultsEl.innerHTML = '<p style="color:#e74c3c;">Search error: ' + err.message + '</p>';
    }
  };

  document.getElementById('kb-search-input')?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') window.kbSearch();
  });
})();
</script>
`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Dashboard HTTP route handlers
// These are called from your9-dashboard.mjs's createServer handler.
// ---------------------------------------------------------------------------

/**
 * Register knowledge base routes on the dashboard server request handler.
 * Call this function from within the createServer callback, passing req, res,
 * url, instanceDir, and the shared readBody/sendErr helpers.
 *
 * Returns true if the route was handled, false otherwise.
 */
async function handleKnowledgeRoute(req, res, url, instanceDir) {
  function sendErr(msg, code) {
    res.writeHead(code || 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: msg }));
  }

  function readBody() {
    return new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', chunk => (raw += chunk));
      req.on('end', () => { try { resolve(raw); } catch (e) { reject(e); } });
      req.on('error', reject);
    });
  }

  // GET /knowledge — returns list of documents as JSON
  if (req.method === 'GET' && url.pathname === '/knowledge') {
    const docs = listDocuments(instanceDir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, documents: docs }));
    return true;
  }

  // POST /knowledge/upload — upload a base64-encoded document
  if (req.method === 'POST' && url.pathname === '/knowledge/upload') {
    try {
      const raw = await readBody();
      const { name, contentBase64, content, source } = JSON.parse(raw);
      if (!name) return sendErr('name required');

      let buffer;
      if (contentBase64) {
        buffer = Buffer.from(contentBase64, 'base64');
      } else if (content) {
        buffer = Buffer.from(content, 'utf-8');
      } else {
        return sendErr('contentBase64 or content required');
      }

      const result = await uploadDocument(instanceDir, {
        content: buffer,
        name,
        source: source || 'dashboard',
        uploadedBy: 'founder',
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      sendErr(e.message);
    }
    return true;
  }

  // POST /knowledge/search — search documents
  if (req.method === 'POST' && url.pathname === '/knowledge/search') {
    try {
      const raw = await readBody();
      const { query } = JSON.parse(raw);
      if (!query) return sendErr('query required');

      const results = await searchKnowledge(instanceDir, query);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, results }));
    } catch (e) {
      sendErr(e.message);
    }
    return true;
  }

  // POST /knowledge/delete — delete a document
  if (req.method === 'POST' && url.pathname === '/knowledge/delete') {
    try {
      const raw = await readBody();
      const { docId } = JSON.parse(raw);
      if (!docId) return sendErr('docId required');

      const result = deleteDocument(instanceDir, docId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      sendErr(e.message);
    }
    return true;
  }

  // GET /knowledge/content?docId=... — get decrypted text of a document
  if (req.method === 'GET' && url.pathname === '/knowledge/content') {
    const docId = url.searchParams.get('docId');
    if (!docId) return sendErr('docId required') || true;
    try {
      const doc = await getDocumentContent(instanceDir, docId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...doc }));
    } catch (e) {
      sendErr(e.message, 404);
    }
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Hub integration helper
// Called from your9-hub.mjs when a Telegram document message is received.
// ---------------------------------------------------------------------------

/**
 * Handle a Telegram document message in the hub's polling loop.
 * Downloads the file, indexes it, replies to the founder.
 *
 * hub: the hub object (must have botToken, ownerChatId, instanceDir, anthropicKey, env)
 * msg: the Telegram message object with msg.document set
 */
async function handleTelegramDocumentUpload(hub, msg) {
  const { botToken, ownerChatId, instanceDir } = hub;
  const doc = msg.document;

  async function reply(text) {
    // Minimal inline send — hub's sendTelegramMessage pattern
    const https = await import('https');
    const body = JSON.stringify({ chat_id: ownerChatId, text, parse_mode: 'Markdown' });
    return new Promise((resolve) => {
      const req = https.default.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${botToken}/sendMessage`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        },
        res => { res.resume(); res.on('end', resolve); }
      );
      req.on('error', resolve);
      req.write(body);
      req.end();
    });
  }

  const fileName = doc.file_name || `upload-${Date.now()}.bin`;
  const fileSize = doc.file_size || 0;

  if (fileSize > MAX_DOC_SIZE_BYTES) {
    await reply(`Document too large (${(fileSize / 1024 / 1024).toFixed(1)} MB). Max allowed is 5 MB. Compress it or paste the key content as text.`);
    return;
  }

  await reply(`Received *${escapeHtml(fileName)}*. Downloading and indexing it into your knowledge base...`);

  try {
    const { buffer } = await downloadTelegramFile(botToken, doc.file_id, fileName);
    const result = await uploadDocument(instanceDir, {
      content: buffer,
      name: fileName,
      source: 'telegram',
      uploadedBy: 'founder',
    });

    const tagLine = result.tags.length > 0 ? `\nTopics: ${result.tags.slice(0, 5).join(', ')}` : '';
    const summaryLine = result.summary ? `\nSummary: ${result.summary.slice(0, 200)}${result.summary.length > 200 ? '...' : ''}` : '';

    await reply(
      `*Indexed:* ${fileName}\n` +
      `Size: ${(result.sizeBytes / 1024).toFixed(1)} KB &middot; ${result.wordCount} words` +
      tagLine +
      summaryLine +
      `\n\nI can reference this document in any conversation. Just ask.`
    );
  } catch (e) {
    await reply(`Failed to index *${fileName}*: ${e.message}. Try sending the content as a text message instead.`);
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const instanceId = args.instance;

  if (!instanceId) {
    console.error('Usage: node scripts/your9-knowledge-base.mjs --instance <customer-id> [--upload <file>|--search <query>|--list|--delete <docId>]');
    process.exit(1);
  }

  const instanceDir = join(INSTANCES_DIR, instanceId);
  if (!existsSync(instanceDir)) {
    console.error(`Instance not found: ${instanceDir}`);
    process.exit(1);
  }

  // --list
  if (args.list) {
    const docs = listDocuments(instanceDir);
    if (docs.length === 0) {
      console.log('Knowledge base is empty.');
    } else {
      console.log(`Knowledge base: ${docs.length} document(s)\n`);
      for (const d of docs) {
        const sizeKB = (d.sizeBytes / 1024).toFixed(1);
        console.log(`  [${d.docId}] ${d.name} — ${sizeKB} KB — ${d.uploadedAt?.slice(0, 10)}`);
        if (d.summary) console.log(`    ${d.summary.slice(0, 100)}`);
        console.log();
      }
    }
    return;
  }

  // --upload <file>
  if (args.upload) {
    const filePath = args.upload;
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    const buffer = readFileSync(filePath);
    const name = basename(filePath);
    console.log(`Uploading: ${name} (${(buffer.length / 1024).toFixed(1)} KB)`);
    const result = await uploadDocument(instanceDir, { content: buffer, name, source: 'cli', uploadedBy: 'admin' });
    console.log(`Indexed: ${result.docId}`);
    console.log(`Summary: ${result.summary}`);
    console.log(`Tags: ${result.tags.join(', ')}`);
    return;
  }

  // --search <query>
  if (args.search) {
    const query = String(args.search);
    console.log(`Searching: "${query}"\n`);
    const results = await searchKnowledge(instanceDir, query);
    if (results.length === 0) {
      console.log('No results found.');
    } else {
      for (const r of results) {
        console.log(`[${r.name}] (relevance: ${r.relevance})`);
        console.log(r.excerpt.slice(0, 400));
        console.log();
      }
    }
    return;
  }

  // --delete <docId>
  if (args.delete) {
    try {
      const result = deleteDocument(instanceDir, args.delete);
      console.log(`Deleted: ${result.docId} (${result.name})`);
    } catch (e) {
      console.error(`Delete failed: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  console.log('No action specified. Use --list, --upload <file>, --search <query>, or --delete <docId>.');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  uploadDocument,
  searchKnowledge,
  listDocuments,
  deleteDocument,
  getDocumentContent,
  getKnowledgeContext,
  handleTelegramDocumentUpload,
  handleKnowledgeRoute,
  buildKnowledgePanelData,
  renderKnowledgePanel,
  downloadTelegramFile,
};

// Run CLI if invoked directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
