/**
 * AI Underwriter API — FHA Guideline Assistant
 * Port 3471
 * POST /query  — { question: "..." } → { answer, citation, confidence, note, model, responseTime }
 * GET  /health — status check
 */

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Load .env ───────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '../.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key) process.env[key] = val;
    }
  }
}

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('[underwriter-api] FATAL: ANTHROPIC_API_KEY not found in .env');
  process.exit(1);
}

const PORT = 3471;

// ─── System Prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an AI mortgage guideline assistant specializing in FHA loans. You answer loan officer questions using the HUD Handbook 4000.1.

RULES:
1. Always cite the specific HUD 4000.1 section number (e.g., "Section II.A.1.b.ii")
2. If you're not confident in the answer, say so explicitly
3. Keep answers concise — 2-4 sentences max
4. If the question involves income calculation, show the math
5. If the question spans multiple agencies, note the FHA-specific answer and mention that other agencies may differ
6. Never make up section numbers — if you don't know the exact section, say "refer to HUD 4000.1 Chapter [X]"
7. Include the effective date if the guideline was recently updated

FORMAT YOUR RESPONSE AS JSON:
{
  "answer": "The plain English answer",
  "citation": "HUD Handbook 4000.1, Section X.X.X.x — Title",
  "confidence": "high" | "medium" | "low",
  "note": "Any additional context or caveats"
}`;

// ─── Query routing: Sonnet for complex, Haiku for simple ─────────────────────
const COMPLEX_KEYWORDS = [
  'calculate', 'calculation', 'income', 'qualify', 'eligible', 'eligibility',
  'exception', 'compensating', 'dti', 'debt-to-income', 'self-employed',
  'variable', 'overtime', 'bonus', 'commission', 'rental', 'schedule e',
  'bankruptcy', 'foreclosure', 'waiting period', 'short sale'
];

function selectModel(question) {
  const q = question.toLowerCase();
  return COMPLEX_KEYWORDS.some(kw => q.includes(kw))
    ? 'claude-sonnet-4-5'
    : 'claude-haiku-4-5';
}

// ─── Claude API call ──────────────────────────────────────────────────────────
function callClaude(model, question) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: question }]
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed);
        } catch (e) {
          reject(new Error('Failed to parse Claude response'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Claude API request timed out'));
    });
    req.write(body);
    req.end();
  });
}

// ─── Parse Claude's JSON response ────────────────────────────────────────────
function parseGuidelineResponse(text) {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Claude returned plain text — wrap it
    return {
      answer: text,
      citation: 'Refer to HUD Handbook 4000.1',
      confidence: 'low',
      note: 'Response was not in expected JSON format.'
    };
  }
}

// ─── CORS headers ─────────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  setCORS(res);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'underwriter-api', port: PORT }));
    return;
  }

  // Query endpoint
  if (req.method === 'POST' && req.url === '/query') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { question } = JSON.parse(body);

        if (!question || typeof question !== 'string' || !question.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'question is required' }));
          return;
        }

        const model = selectModel(question);
        const start = Date.now();

        const claudeResponse = await callClaude(model, question.trim());
        const responseTime = Date.now() - start;

        const rawText = claudeResponse.content?.[0]?.text || '';
        const guideline = parseGuidelineResponse(rawText);

        const modelLabel = model.includes('sonnet') ? 'Claude Sonnet' : 'Claude Haiku';

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          answer: guideline.answer || '',
          citation: guideline.citation || 'Refer to HUD Handbook 4000.1',
          confidence: guideline.confidence || 'medium',
          note: guideline.note || '',
          model: modelLabel,
          modelId: model,
          responseTime
        }));

      } catch (err) {
        console.error('[underwriter-api] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[underwriter-api] Running on http://localhost:${PORT}`);
  console.log(`[underwriter-api] API key loaded: ${API_KEY ? 'YES' : 'NO'}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[underwriter-api] Port ${PORT} already in use`);
    process.exit(1);
  }
  throw err;
});
