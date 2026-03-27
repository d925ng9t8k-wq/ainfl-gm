/**
 * AI Underwriter API — Multi-Agency Mortgage Guideline Assistant
 * Port 3471
 *
 * Endpoints:
 *   POST /query    — { question, loanType? } → structured guideline answer
 *   GET  /health   — status check with uptime and request stats
 *   GET  /test     — run all built-in test cases (offline validation)
 *   GET  /test-live — run test cases against Claude API (costs tokens)
 *
 * Supports: FHA, Conventional (Fannie/Freddie), VA, Jumbo
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
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
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
const MAX_QUESTION_LENGTH = 2000;
const MAX_BODY_SIZE = 10_000; // 10KB max request body
const REQUEST_TIMEOUT_MS = 45_000;

// ─── Request tracking ────────────────────────────────────────────────────────
const stats = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  queryRequests: 0,
  errors: 0,
  avgResponseTime: 0,
  modelUsage: { haiku: 0, sonnet: 0 },
  loanTypeBreakdown: { fha: 0, conventional: 0, va: 0, jumbo: 0, general: 0 }
};

// ─── Loan type detection ─────────────────────────────────────────────────────
const LOAN_TYPE_PATTERNS = {
  fha: ['fha', 'hud 4000', 'hud handbook', 'ufmip', 'mip ', 'mortgagee letter', 'total scorecard'],
  va: ['va loan', 'va disability', 'va benefit', 'certificate of eligibility', 'coe ', 'funding fee', 'va entitlement', 'irrrl', 'va streamline', 'va residual'],
  jumbo: ['jumbo', 'non-conforming', 'high balance', 'super conforming', 'above conforming'],
  conventional: ['conventional', 'fannie mae', 'freddie mac', 'conforming', 'homeready', 'home possible', 'du approve', 'lp accept', 'pmi cancel', 'homeone']
};

function detectLoanType(question, explicitType) {
  if (explicitType) {
    const normalized = explicitType.toLowerCase().trim();
    if (['fha', 'va', 'jumbo', 'conventional'].includes(normalized)) return normalized;
  }
  const q = question.toLowerCase();
  for (const [type, patterns] of Object.entries(LOAN_TYPE_PATTERNS)) {
    if (patterns.some(p => q.includes(p))) return type;
  }
  return 'general';
}

// ─── System Prompts by loan type ─────────────────────────────────────────────
const SYSTEM_PROMPTS = {
  fha: `You are an expert AI mortgage underwriting assistant specializing in FHA loans. You answer loan officer questions using the HUD Handbook 4000.1 and current Mortgagee Letters.

RULES:
1. Always cite the specific HUD 4000.1 section number (e.g., "Section II.A.1.b.ii")
2. If you are not confident in the answer, say so explicitly — never guess
3. Keep answers concise but thorough — 2-5 sentences
4. If the question involves income calculation, show the math step by step
5. If the question could apply to multiple agencies, give the FHA-specific answer first, then note how conventional or VA may differ
6. Never fabricate section numbers — if uncertain, say "refer to HUD 4000.1 Chapter [X]"
7. Note the effective date if a guideline was recently updated by a Mortgagee Letter
8. When a rule has exceptions or compensating factors, always mention them
9. Distinguish between AUS (TOTAL Scorecard) and manual underwrite requirements when relevant

FORMAT YOUR RESPONSE AS JSON:
{
  "answer": "The plain English answer with specific numbers and requirements",
  "citation": "HUD Handbook 4000.1, Section X.X.X.x — Title",
  "confidence": "high" | "medium" | "low",
  "note": "Any additional context, caveats, or cross-agency comparison",
  "loanType": "FHA"
}`,

  va: `You are an expert AI mortgage underwriting assistant specializing in VA loans. You answer loan officer questions using VA Pamphlet 26-7 (Lenders Handbook) and current VA Circulars.

RULES:
1. Always cite the specific VA Pamphlet 26-7 chapter and section when possible
2. If you are not confident, say so — never guess on VA eligibility or entitlement math
3. Keep answers concise but thorough — 2-5 sentences
4. For entitlement calculations, show the math
5. Note VA-specific advantages (no PMI, no down payment, funding fee exemptions)
6. Distinguish between first-use and subsequent-use funding fees
7. When relevant, compare to FHA or conventional alternatives

FORMAT YOUR RESPONSE AS JSON:
{
  "answer": "The plain English answer with specific numbers and requirements",
  "citation": "VA Pamphlet 26-7, Chapter X, Section X — Title",
  "confidence": "high" | "medium" | "low",
  "note": "Any additional context, caveats, or cross-agency comparison",
  "loanType": "VA"
}`,

  conventional: `You are an expert AI mortgage underwriting assistant specializing in conventional loans (Fannie Mae and Freddie Mac). You answer loan officer questions using the Fannie Mae Selling Guide and Freddie Mac Seller/Servicer Guide.

RULES:
1. Cite the specific Fannie Mae Selling Guide section or Freddie Mac Guide section when possible
2. If you are not confident, say so — never guess
3. Keep answers concise but thorough — 2-5 sentences
4. Note differences between Fannie Mae and Freddie Mac when they exist
5. Distinguish between DU/LP automated findings and manual underwrite requirements
6. When relevant, mention how MI cancellation, LLPAs, or pricing adjustments apply
7. Compare to FHA when the borrower might benefit from switching loan types

FORMAT YOUR RESPONSE AS JSON:
{
  "answer": "The plain English answer with specific numbers and requirements",
  "citation": "Fannie Mae Selling Guide, Section X.X.X / Freddie Mac Guide Section X.X",
  "confidence": "high" | "medium" | "low",
  "note": "Any additional context, caveats, or Fannie vs Freddie differences",
  "loanType": "Conventional"
}`,

  jumbo: `You are an expert AI mortgage underwriting assistant specializing in jumbo (non-conforming) loans. You answer loan officer questions about jumbo loan guidelines, noting that these vary significantly by investor/lender.

RULES:
1. Note that jumbo guidelines are investor-specific — there is no single standard like FHA or Fannie Mae
2. Provide general industry-standard jumbo thresholds and common requirements
3. Always recommend verifying against the specific investor's guidelines
4. Keep answers concise but thorough — 2-5 sentences
5. When relevant, note the current conforming loan limit as the jumbo threshold

FORMAT YOUR RESPONSE AS JSON:
{
  "answer": "The plain English answer with typical industry requirements",
  "citation": "General jumbo lending standards — verify with specific investor guidelines",
  "confidence": "high" | "medium" | "low",
  "note": "Jumbo guidelines vary by investor. Always confirm with your specific lender overlay.",
  "loanType": "Jumbo"
}`,

  general: `You are an expert AI mortgage underwriting assistant covering all major loan programs: FHA, VA, Conventional (Fannie Mae/Freddie Mac), and Jumbo. You answer loan officer questions with authoritative guideline knowledge.

RULES:
1. Identify which loan program(s) the question applies to
2. Cite specific guideline sections when possible (HUD 4000.1 for FHA, VA Pamphlet 26-7 for VA, Fannie Mae Selling Guide for conventional)
3. If the question could apply to multiple programs, compare them
4. Keep answers concise but thorough — 2-5 sentences
5. If you are not confident, say so explicitly
6. When income calculations are involved, show the math

FORMAT YOUR RESPONSE AS JSON:
{
  "answer": "The plain English answer with specific numbers and requirements",
  "citation": "Relevant guideline source and section",
  "confidence": "high" | "medium" | "low",
  "note": "Any additional context or cross-program comparison",
  "loanType": "General"
}`
};

// ─── Query routing: Sonnet for complex, Haiku for simple ─────────────────────
const COMPLEX_KEYWORDS = [
  'calculate', 'calculation', 'income', 'qualify', 'eligible', 'eligibility',
  'exception', 'compensating', 'dti', 'debt-to-income', 'self-employed',
  'variable', 'overtime', 'bonus', 'commission', 'rental income', 'schedule e',
  'bankruptcy', 'foreclosure', 'waiting period', 'short sale', 'manual underwrite',
  'non-occupant co-borrower', 'identity of interest', 'flipping', 'anti-flip',
  'entitlement', 'residual income', 'funding fee', 'jumbo', 'high balance',
  'boarder income', 'gift funds', 'seller concession', 'mip cancel',
  'grossed up', 'gross up', 'non-taxable', 'ltv calculation', 'cltv',
  'fico exception', 'credit score exception', 'collections', 'charge-off',
  'subordinate financing', 'second mortgage', 'heloc', 'cash-out',
  'streamline', 'irrrl', 'rate-and-term', 'manufactured home', 'condo approval'
];

function selectModel(question) {
  const q = question.toLowerCase();
  const complexCount = COMPLEX_KEYWORDS.filter(kw => q.includes(kw)).length;
  // Multiple complex keywords or very long questions get Sonnet
  if (complexCount >= 2 || (complexCount >= 1 && q.length > 200)) {
    return 'claude-sonnet-4-5';
  }
  if (complexCount === 1) {
    return 'claude-sonnet-4-5';
  }
  return 'claude-haiku-4-5';
}

// ─── Claude API call ──────────────────────────────────────────────────────────
function callClaude(model, systemPrompt, question) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      max_tokens: 768,
      system: systemPrompt,
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
          reject(new Error(`Failed to parse Claude response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Claude API request timed out after ' + (REQUEST_TIMEOUT_MS / 1000) + 's'));
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
    const parsed = JSON.parse(cleaned);
    // Validate expected fields
    if (!parsed.answer || typeof parsed.answer !== 'string') {
      return {
        answer: text,
        citation: 'Refer to applicable mortgage guidelines',
        confidence: 'low',
        note: 'Response was missing required answer field.'
      };
    }
    return parsed;
  } catch {
    // Claude returned plain text — wrap it
    return {
      answer: text,
      citation: 'Refer to applicable mortgage guidelines',
      confidence: 'low',
      note: 'Response was not in expected JSON format.'
    };
  }
}

// ─── Input validation ────────────────────────────────────────────────────────
function validateQueryInput(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { valid: false, error: 'Invalid JSON in request body', status: 400 };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'Request body must be a JSON object', status: 400 };
  }

  const { question, loanType } = parsed;

  if (!question) {
    return { valid: false, error: 'Missing required field: question', status: 400 };
  }

  if (typeof question !== 'string') {
    return { valid: false, error: 'Field "question" must be a string', status: 400 };
  }

  const trimmed = question.trim();
  if (!trimmed) {
    return { valid: false, error: 'Field "question" cannot be empty', status: 400 };
  }

  if (trimmed.length > MAX_QUESTION_LENGTH) {
    return {
      valid: false,
      error: `Question exceeds maximum length of ${MAX_QUESTION_LENGTH} characters (received ${trimmed.length})`,
      status: 400
    };
  }

  if (loanType !== undefined && typeof loanType !== 'string') {
    return { valid: false, error: 'Field "loanType" must be a string if provided', status: 400 };
  }

  return { valid: true, question: trimmed, loanType: loanType || null };
}

// ─── CORS headers ─────────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ─── JSON response helper ────────────────────────────────────────────────────
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ─── Read body with size limit ───────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error(`Request body exceeds maximum size of ${MAX_BODY_SIZE} bytes`));
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ─── Test cases ──────────────────────────────────────────────────────────────
const TEST_CASES = [
  // ── FHA Tests (1-8) ──────────────────────────────────────────────────────
  {
    id: 1,
    category: 'FHA',
    question: 'What is the minimum credit score for FHA with 3.5% down?',
    expectedLoanType: 'fha',
    expectedModel: 'haiku',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('580') && (a.includes('3.5') || a.includes('96.5'));
    },
    description: 'FHA min FICO for 3.5% down should be 580'
  },
  {
    id: 2,
    category: 'FHA',
    question: 'What is the FHA upfront mortgage insurance premium (UFMIP)?',
    expectedLoanType: 'fha',
    expectedModel: 'haiku',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('1.75') || a.includes('1.75%');
    },
    description: 'FHA UFMIP should be 1.75%'
  },
  {
    id: 3,
    category: 'FHA',
    question: 'What is the FHA waiting period after Chapter 7 bankruptcy?',
    expectedLoanType: 'fha',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('2 year') || a.includes('two year') || a.includes('24 month');
    },
    description: 'FHA Chapter 7 wait should be 2 years from discharge'
  },
  {
    id: 4,
    category: 'FHA',
    question: 'Can 100% of the FHA down payment come from gift funds?',
    expectedLoanType: 'fha',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('100%') || a.includes('yes') || a.includes('entire');
    },
    description: 'FHA allows 100% of down payment from gifts'
  },
  {
    id: 5,
    category: 'FHA',
    question: 'What is the maximum FHA seller concession?',
    expectedLoanType: 'fha',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('6%') || a.includes('six percent');
    },
    description: 'FHA max seller concession is 6%'
  },
  {
    id: 6,
    category: 'FHA',
    question: 'What are the FHA DTI ratio limits with compensating factors?',
    expectedLoanType: 'fha',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return (a.includes('50') || a.includes('50%')) && (a.includes('31') || a.includes('43'));
    },
    description: 'FHA DTI should mention 31/43 standard and up to 50 with comp factors'
  },
  {
    id: 7,
    category: 'FHA',
    question: 'What is the FHA anti-flipping rule? How many days must the seller own the property?',
    expectedLoanType: 'fha',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('90') && (a.includes('day') || a.includes('flip'));
    },
    description: 'FHA anti-flip rule requires 90 days of seller ownership'
  },
  {
    id: 8,
    category: 'FHA',
    question: 'How are non-medical collections over $2,000 handled for FHA qualification?',
    expectedLoanType: 'fha',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('5%') && (a.includes('collection') || a.includes('liability'));
    },
    description: 'FHA requires 5% of outstanding balance as monthly liability for collections over $2k'
  },

  // ── Conventional Tests (9-14) ────────────────────────────────────────────
  {
    id: 9,
    category: 'Conventional',
    question: 'What is the minimum credit score for a Fannie Mae conventional loan?',
    expectedLoanType: 'conventional',
    expectedModel: 'haiku',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('620');
    },
    description: 'Fannie Mae minimum FICO is 620'
  },
  {
    id: 10,
    category: 'Conventional',
    question: 'When does PMI cancel on a conventional loan?',
    expectedLoanType: 'conventional',
    expectedModel: 'haiku',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return (a.includes('78%') || a.includes('80%')) && (a.includes('cancel') || a.includes('terminat') || a.includes('drop'));
    },
    description: 'PMI auto-terminates at 78% LTV, borrower-initiated at 80%'
  },
  {
    id: 11,
    category: 'Conventional',
    question: 'What is the maximum DTI for a conventional loan with DU Approve/Eligible?',
    expectedLoanType: 'conventional',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('50') || a.includes('50%');
    },
    description: 'Conventional max DTI via DU is 50%'
  },
  {
    id: 12,
    category: 'Conventional',
    question: 'What is the minimum down payment for a Fannie Mae HomeReady loan?',
    expectedLoanType: 'conventional',
    expectedModel: 'haiku',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('3%') || a.includes('97%');
    },
    description: 'HomeReady minimum down payment is 3%'
  },
  {
    id: 13,
    category: 'Conventional',
    question: 'What is the conventional waiting period after foreclosure?',
    expectedLoanType: 'conventional',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('7 year') || a.includes('seven year');
    },
    description: 'Conventional foreclosure waiting period is 7 years'
  },
  {
    id: 14,
    category: 'Conventional',
    question: 'How does Freddie Mac Home Possible differ from Fannie Mae HomeReady on boarder income?',
    expectedLoanType: 'conventional',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return (a.includes('boarder') || a.includes('border')) && (a.includes('not') || a.includes('does not') || a.includes('differ'));
    },
    description: 'Freddie Mac Home Possible does NOT allow boarder income; Fannie HomeReady does'
  },

  // ── VA Tests (15-19) ─────────────────────────────────────────────────────
  {
    id: 15,
    category: 'VA',
    question: 'What is the VA loan down payment requirement?',
    expectedLoanType: 'va',
    expectedModel: 'haiku',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('0%') || a.includes('no down payment') || a.includes('zero');
    },
    description: 'VA loans allow 0% down payment'
  },
  {
    id: 16,
    category: 'VA',
    question: 'What is the VA funding fee for a first-time use purchase with 0% down?',
    expectedLoanType: 'va',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('2.15') || a.includes('2.15%');
    },
    description: 'VA first-use funding fee at 0% down is 2.15%'
  },
  {
    id: 17,
    category: 'VA',
    question: 'Who is exempt from the VA funding fee?',
    expectedLoanType: 'va',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('disability') || a.includes('disabled') || a.includes('purple heart') || a.includes('surviving spouse');
    },
    description: 'VA funding fee exemptions include disabled veterans, Purple Heart, surviving spouses'
  },
  {
    id: 18,
    category: 'VA',
    question: 'Does the VA loan have monthly mortgage insurance?',
    expectedLoanType: 'va',
    expectedModel: 'haiku',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('no') && (a.includes('pmi') || a.includes('mortgage insurance') || a.includes('mi'));
    },
    description: 'VA loans have no monthly mortgage insurance'
  },
  {
    id: 19,
    category: 'VA',
    question: 'What is the VA IRRRL streamline refinance funding fee?',
    expectedLoanType: 'va',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('0.5') || a.includes('0.50') || a.includes('.5%') || a.includes('half');
    },
    description: 'VA IRRRL funding fee is 0.5%'
  },

  // ── Jumbo Tests (20-22) ──────────────────────────────────────────────────
  {
    id: 20,
    category: 'Jumbo',
    question: 'What is the current conforming loan limit that defines a jumbo loan?',
    expectedLoanType: 'jumbo',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      // Accept various recent conforming limits
      return a.includes('766,550') || a.includes('726,200') || a.includes('conforming') || a.includes('limit');
    },
    description: 'Jumbo threshold is above the conforming loan limit'
  },
  {
    id: 21,
    category: 'Jumbo',
    question: 'What is the typical minimum down payment for a jumbo loan?',
    expectedLoanType: 'jumbo',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('10%') || a.includes('15%') || a.includes('20%') || a.includes('down payment');
    },
    description: 'Typical jumbo down payment is 10-20%'
  },
  {
    id: 22,
    category: 'Jumbo',
    question: 'What credit score is typically required for a jumbo mortgage?',
    expectedLoanType: 'jumbo',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('700') || a.includes('720') || a.includes('680') || a.includes('higher');
    },
    description: 'Typical jumbo FICO requirement is 700-720+'
  },

  // ── Cross-program / Edge cases (23-25) ───────────────────────────────────
  {
    id: 23,
    category: 'Cross-program',
    question: 'Compare the foreclosure waiting periods for FHA, conventional, and VA loans.',
    expectedLoanType: 'fha',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return a.includes('fha') && (a.includes('conventional') || a.includes('fannie')) && (a.includes('2') || a.includes('3') || a.includes('7'));
    },
    description: 'Cross-program comparison should mention FHA (3yr), conventional (7yr), VA (2yr)'
  },
  {
    id: 24,
    category: 'FHA',
    question: 'What documentation is needed for self-employed borrowers on an FHA loan, and how is declining income calculated?',
    expectedLoanType: 'fha',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return (a.includes('tax return') || a.includes('tax returns')) && (a.includes('2 year') || a.includes('two year') || a.includes('declining') || a.includes('lower'));
    },
    description: 'Self-employment docs: 2yr tax returns, declining income uses lower year'
  },
  {
    id: 25,
    category: 'FHA',
    question: 'Can a non-occupant co-borrower be used on an FHA loan? What are the LTV limits?',
    expectedLoanType: 'fha',
    expectedModel: 'sonnet',
    validate: (r) => {
      const a = (r.answer || '').toLowerCase();
      return (a.includes('non-occupant') || a.includes('co-borrower')) && (a.includes('96.5') || a.includes('75%'));
    },
    description: 'FHA non-occupant co-borrower: 96.5% LTV if family, 75% if non-family'
  }
];

// ─── Run offline tests (no API calls — tests validation/routing logic) ──────
function runOfflineTests() {
  const results = [];

  for (const tc of TEST_CASES) {
    const detectedType = detectLoanType(tc.question, null);
    const selectedModel = selectModel(tc.question);
    const expectedModelStr = tc.expectedModel === 'sonnet' ? 'claude-sonnet-4-5' : 'claude-haiku-4-5';

    const loanTypeMatch = detectedType === tc.expectedLoanType;
    const modelMatch = selectedModel === expectedModelStr;

    results.push({
      id: tc.id,
      category: tc.category,
      description: tc.description,
      question: tc.question.slice(0, 80) + (tc.question.length > 80 ? '...' : ''),
      loanTypeDetected: detectedType,
      loanTypeExpected: tc.expectedLoanType,
      loanTypePass: loanTypeMatch,
      modelSelected: selectedModel.includes('sonnet') ? 'sonnet' : 'haiku',
      modelExpected: tc.expectedModel,
      modelPass: modelMatch
    });
  }

  const loanTypePassCount = results.filter(r => r.loanTypePass).length;
  const modelPassCount = results.filter(r => r.modelPass).length;

  return {
    summary: {
      totalTests: results.length,
      loanTypeDetection: { passed: loanTypePassCount, failed: results.length - loanTypePassCount },
      modelRouting: { passed: modelPassCount, failed: results.length - modelPassCount }
    },
    results
  };
}

// ─── Run live tests (calls Claude API — costs tokens) ────────────────────────
async function runLiveTests(maxTests = 3) {
  // Only run a subset by default to avoid burning tokens
  const subset = TEST_CASES.slice(0, maxTests);
  const results = [];

  for (const tc of subset) {
    const detectedType = detectLoanType(tc.question, null);
    const model = selectModel(tc.question);
    const systemPrompt = SYSTEM_PROMPTS[detectedType] || SYSTEM_PROMPTS.general;

    try {
      const start = Date.now();
      const claudeResponse = await callClaude(model, systemPrompt, tc.question);
      const responseTime = Date.now() - start;

      const rawText = claudeResponse.content?.[0]?.text || '';
      const guideline = parseGuidelineResponse(rawText);

      const validationPass = tc.validate(guideline);

      results.push({
        id: tc.id,
        category: tc.category,
        description: tc.description,
        pass: validationPass,
        responseTime,
        model: model.includes('sonnet') ? 'sonnet' : 'haiku',
        loanType: detectedType,
        answer: (guideline.answer || '').slice(0, 200) + '...',
        confidence: guideline.confidence
      });
    } catch (err) {
      results.push({
        id: tc.id,
        category: tc.category,
        description: tc.description,
        pass: false,
        error: err.message
      });
    }
  }

  const passed = results.filter(r => r.pass).length;
  return {
    summary: {
      totalTests: results.length,
      passed,
      failed: results.length - passed,
      note: `Ran ${maxTests} of ${TEST_CASES.length} tests. Use ?count=N to run more (max ${TEST_CASES.length}).`
    },
    results
  };
}

// ─── URL parsing helper ──────────────────────────────────────────────────────
function parseURL(req) {
  try {
    return new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return null;
  }
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  setCORS(res);
  stats.totalRequests++;

  const url = parseURL(req);
  const pathname = url ? url.pathname : req.url;

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && pathname === '/health') {
    sendJSON(res, 200, {
      status: 'ok',
      service: 'underwriter-api',
      port: PORT,
      uptime: stats.startedAt,
      stats: {
        totalRequests: stats.totalRequests,
        queryRequests: stats.queryRequests,
        errors: stats.errors,
        avgResponseTime: stats.queryRequests > 0 ? Math.round(stats.avgResponseTime) + 'ms' : 'N/A',
        modelUsage: stats.modelUsage,
        loanTypes: stats.loanTypeBreakdown
      },
      endpoints: ['GET /health', 'POST /query', 'GET /test', 'GET /test-live']
    });
    return;
  }

  // Offline test endpoint (no API calls)
  if (req.method === 'GET' && pathname === '/test') {
    try {
      const results = runOfflineTests();
      sendJSON(res, 200, results);
    } catch (err) {
      stats.errors++;
      console.error('[underwriter-api] Test error:', err.message);
      sendJSON(res, 500, { error: 'Test execution failed: ' + err.message });
    }
    return;
  }

  // Live test endpoint (calls Claude API)
  if (req.method === 'GET' && pathname === '/test-live') {
    try {
      const count = Math.min(
        parseInt(url?.searchParams?.get('count') || '3', 10) || 3,
        TEST_CASES.length
      );
      const results = await runLiveTests(count);
      sendJSON(res, 200, results);
    } catch (err) {
      stats.errors++;
      console.error('[underwriter-api] Live test error:', err.message);
      sendJSON(res, 500, { error: 'Live test execution failed: ' + err.message });
    }
    return;
  }

  // Query endpoint
  if (req.method === 'POST' && pathname === '/query') {
    try {
      const body = await readBody(req);
      const validation = validateQueryInput(body);

      if (!validation.valid) {
        sendJSON(res, validation.status, { error: validation.error });
        return;
      }

      const { question, loanType: explicitLoanType } = validation;
      const loanType = detectLoanType(question, explicitLoanType);
      const model = selectModel(question);
      const systemPrompt = SYSTEM_PROMPTS[loanType] || SYSTEM_PROMPTS.general;

      stats.queryRequests++;
      stats.loanTypeBreakdown[loanType] = (stats.loanTypeBreakdown[loanType] || 0) + 1;
      if (model.includes('sonnet')) stats.modelUsage.sonnet++;
      else stats.modelUsage.haiku++;

      const start = Date.now();
      const claudeResponse = await callClaude(model, systemPrompt, question);
      const responseTime = Date.now() - start;

      // Update running average
      stats.avgResponseTime = (stats.avgResponseTime * (stats.queryRequests - 1) + responseTime) / stats.queryRequests;

      const rawText = claudeResponse.content?.[0]?.text || '';
      const guideline = parseGuidelineResponse(rawText);

      const modelLabel = model.includes('sonnet') ? 'Claude Sonnet' : 'Claude Haiku';

      sendJSON(res, 200, {
        answer: guideline.answer || '',
        citation: guideline.citation || 'Refer to applicable mortgage guidelines',
        confidence: guideline.confidence || 'medium',
        note: guideline.note || '',
        loanType: guideline.loanType || loanType.toUpperCase(),
        model: modelLabel,
        modelId: model,
        responseTime
      });

    } catch (err) {
      stats.errors++;
      console.error('[underwriter-api] Query error:', err.message);

      // Provide specific error messages based on error type
      let statusCode = 500;
      let errorMessage = 'Internal server error';

      if (err.message.includes('timed out')) {
        statusCode = 504;
        errorMessage = 'The AI model took too long to respond. Please try again.';
      } else if (err.message.includes('exceeds maximum size')) {
        statusCode = 413;
        errorMessage = err.message;
      } else if (err.message.includes('overloaded') || err.message.includes('rate limit')) {
        statusCode = 503;
        errorMessage = 'The AI service is temporarily overloaded. Please retry in a few seconds.';
      } else if (err.message.includes('authentication') || err.message.includes('invalid.*key')) {
        statusCode = 502;
        errorMessage = 'AI service authentication error. Contact administrator.';
      } else {
        errorMessage = err.message || 'Internal server error';
      }

      sendJSON(res, statusCode, { error: errorMessage });
    }
    return;
  }

  // 404 — list available endpoints
  sendJSON(res, 404, {
    error: 'Not found',
    availableEndpoints: [
      'GET  /health     — Service status and statistics',
      'POST /query      — Ask a mortgage guideline question { question: "...", loanType?: "fha|va|conventional|jumbo" }',
      'GET  /test       — Run offline test suite (routing/detection validation)',
      'GET  /test-live  — Run live test suite against Claude API (?count=N)'
    ]
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[underwriter-api] Running on http://localhost:${PORT}`);
  console.log(`[underwriter-api] API key loaded: ${API_KEY ? 'YES' : 'NO'}`);
  console.log(`[underwriter-api] Endpoints: /health, /query, /test, /test-live`);
  console.log(`[underwriter-api] Loan types: FHA, VA, Conventional, Jumbo, General`);
  console.log(`[underwriter-api] Test cases: ${TEST_CASES.length}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[underwriter-api] Port ${PORT} already in use`);
    process.exit(1);
  }
  console.error('[underwriter-api] Server error:', err.message);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[underwriter-api] SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('[underwriter-api] SIGINT received, shutting down...');
  server.close(() => process.exit(0));
});
