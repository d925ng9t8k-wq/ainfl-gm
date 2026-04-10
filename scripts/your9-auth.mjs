#!/usr/bin/env node
/**
 * your9-auth.mjs — Customer Authentication & Account Management
 * Your9 by 9 Enterprises
 *
 * Full auth layer for turning Your9 into a hosted product:
 *   - Signup with email + password (scrypt hashing — no external deps)
 *   - Login with JWT access tokens (24hr) + refresh tokens (30 days)
 *   - Magic link login via email (Resend API)
 *   - Email verification on signup
 *   - Password reset via email
 *   - Account dashboard: profile, subscription status, instance overview
 *   - Multiple Your9 instances per account
 *   - Stripe customer linking (reads from your9-billing.mjs patterns)
 *
 * Storage: instances/accounts/{account-id}.json (one file per customer)
 * Server: HTTP on port 3493, bound to 127.0.0.1
 *
 * Usage:
 *   node scripts/your9-auth.mjs           # Start server
 *   node scripts/your9-auth.mjs --port 3494
 */

import http from 'http';
import https from 'https';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync,
  appendFileSync, readdirSync, unlinkSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  randomUUID, randomBytes, scrypt, timingSafeEqual, createHmac
} from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ACCOUNTS_DIR = join(ROOT, 'instances', 'accounts');
const INSTANCES_DIR = join(ROOT, 'instances');
const AUTH_LOG = join(ROOT, 'logs', 'your9-auth.log');

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return {};
  const vars = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    vars[key] = val;
  }
  return vars;
}

const ENV = loadEnv();

// JWT secret — generate once, persist in .env if not present
const JWT_SECRET = ENV.YOUR9_AUTH_JWT_SECRET || randomBytes(32).toString('hex');
const RESEND_API_KEY = ENV.RESEND_API_KEY || ENV.RESEND_API_KEY_FULL;
const EMAIL_FROM = ENV.YOUR9_AUTH_EMAIL_FROM || 'auth@your9.ai';
const BASE_URL = ENV.YOUR9_AUTH_BASE_URL || 'https://your9.ai';

// Warn if JWT secret is ephemeral — tokens will break on restart
if (!ENV.YOUR9_AUTH_JWT_SECRET) {
  log('WARNING: YOUR9_AUTH_JWT_SECRET not set in .env — tokens invalidated on restart. Add to .env.');
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] AUTH: ${msg}`;
  console.log(line);
  try {
    if (!existsSync(join(ROOT, 'logs'))) mkdirSync(join(ROOT, 'logs'), { recursive: true });
    appendFileSync(AUTH_LOG, line + '\n');
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Directory setup
// ---------------------------------------------------------------------------

function ensureDirs() {
  if (!existsSync(ACCOUNTS_DIR)) mkdirSync(ACCOUNTS_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Password hashing — Node built-in scrypt (no external deps)
// Format: "scrypt:N:r:p:salt:hash" where N=16384, r=8, p=1
// ---------------------------------------------------------------------------

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p
  });
  return `scrypt:${SCRYPT_PARAMS.N}:${SCRYPT_PARAMS.r}:${SCRYPT_PARAMS.p}:${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hashHex] = parts;
  try {
    const derived = await scryptAsync(password, salt, SCRYPT_PARAMS.keylen, {
      N: parseInt(N), r: parseInt(r), p: parseInt(p)
    });
    const storedBuf = Buffer.from(hashHex, 'hex');
    if (derived.length !== storedBuf.length) return false;
    return timingSafeEqual(derived, storedBuf);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// JWT — HMAC-SHA256, raw implementation (no external deps)
// ---------------------------------------------------------------------------

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signJWT(payload) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = b64url(createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest());
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function issueTokens(accountId, email) {
  const now = Math.floor(Date.now() / 1000);
  const access = signJWT({ sub: accountId, email, iat: now, exp: now + 86400, type: 'access' });
  const refresh = signJWT({ sub: accountId, email, iat: now, exp: now + 86400 * 30, type: 'refresh' });
  return { accessToken: access, refreshToken: refresh, expiresIn: 86400 };
}

// ---------------------------------------------------------------------------
// Account storage — one JSON file per account in instances/accounts/
// ---------------------------------------------------------------------------

function accountPath(accountId) {
  return join(ACCOUNTS_DIR, `${accountId}.json`);
}

function loadAccount(accountId) {
  const p = accountPath(accountId);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function saveAccount(account) {
  account.updatedAt = new Date().toISOString();
  writeFileSync(accountPath(account.id), JSON.stringify(account, null, 2));
}

function findAccountByEmail(email) {
  if (!existsSync(ACCOUNTS_DIR)) return null;
  const norm = email.toLowerCase().trim();
  for (const file of readdirSync(ACCOUNTS_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const acct = JSON.parse(readFileSync(join(ACCOUNTS_DIR, file), 'utf8'));
      if (acct.email === norm) return acct;
    } catch { /* skip corrupt file */ }
  }
  return null;
}

function createAccount({ email, passwordHash = null, name = '', stripeCustomerId = null }) {
  const id = `acct_${randomUUID().replace(/-/g, '')}`;
  const now = new Date().toISOString();
  const account = {
    id,
    email: email.toLowerCase().trim(),
    name,
    passwordHash,
    emailVerified: false,
    emailVerifyToken: randomBytes(32).toString('hex'),
    emailVerifyExpiry: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    stripeCustomerId,
    instances: [],       // array of your9 customer IDs linked to this account
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    status: 'active',    // active | suspended | deleted
    // Magic link and password reset tokens stored inline — cleared after use
    magicLinkToken: null,
    magicLinkExpiry: null,
    resetToken: null,
    resetExpiry: null,
    // Refresh tokens — store a set of valid refresh JTIs (jti claims)
    validRefreshTokens: []
  };
  saveAccount(account);
  log(`Account created: ${id} <${email}>`);
  return account;
}

// ---------------------------------------------------------------------------
// Get all Your9 instances linked to an account
// ---------------------------------------------------------------------------

function getInstanceSummaries(instanceIds) {
  return instanceIds.map(customerId => {
    const configPath = join(INSTANCES_DIR, customerId, 'config', 'customer.json');
    if (!existsSync(configPath)) {
      return { customerId, error: 'instance_not_found' };
    }
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      return {
        customerId: cfg.customerId,
        name: cfg.name,
        industry: cfg.industryContext?.label || cfg.industry,
        tier: cfg.tierConfig?.label || cfg.tier,
        personality: cfg.personalityConfig?.label || cfg.personality,
        status: cfg.status,
        provisionedAt: cfg.provisionedAt
      };
    } catch {
      return { customerId, error: 'config_read_error' };
    }
  });
}

// ---------------------------------------------------------------------------
// Email via Resend — raw HTTPS, matches billing.mjs pattern
// ---------------------------------------------------------------------------

function sendEmail({ to, subject, html, text }) {
  return new Promise((resolve, reject) => {
    if (!RESEND_API_KEY) {
      log(`Email skipped (no RESEND_API_KEY): to=${to} subject="${subject}"`);
      resolve({ skipped: true });
      return;
    }

    const body = JSON.stringify({ from: EMAIL_FROM, to, subject, html, text });
    const opts = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const timer = setTimeout(() => reject(new Error('Resend API timeout')), 10000);
    const req = https.request(opts, (res) => {
      clearTimeout(timer);
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            log(`Resend error ${res.statusCode}: ${JSON.stringify(parsed)}`);
            reject(new Error(`Resend error: ${parsed.message || res.statusCode}`));
          } else {
            log(`Email sent: to=${to} id=${parsed.id}`);
            resolve(parsed);
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

function verifyEmailHtml(name, url) {
  return `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;color:#111">
<h2>Verify your Your9 account</h2>
<p>Hi ${name || 'there'},</p>
<p>Click the button below to verify your email address and activate your account.</p>
<p style="margin:32px 0">
  <a href="${url}" style="background:#000;color:#fff;padding:14px 28px;text-decoration:none;border-radius:4px;font-weight:600">Verify Email</a>
</p>
<p>Link expires in 24 hours.</p>
<p>If you didn't create a Your9 account, ignore this email.</p>
<hr style="border:none;border-top:1px solid #eee;margin:32px 0">
<p style="color:#888;font-size:12px">Your9 by 9 Enterprises</p>
</body></html>`;
}

function resetPasswordHtml(name, url) {
  return `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;color:#111">
<h2>Reset your Your9 password</h2>
<p>Hi ${name || 'there'},</p>
<p>Click the button below to set a new password. This link expires in 1 hour.</p>
<p style="margin:32px 0">
  <a href="${url}" style="background:#000;color:#fff;padding:14px 28px;text-decoration:none;border-radius:4px;font-weight:600">Reset Password</a>
</p>
<p>If you didn't request a password reset, you can safely ignore this email.</p>
<hr style="border:none;border-top:1px solid #eee;margin:32px 0">
<p style="color:#888;font-size:12px">Your9 by 9 Enterprises</p>
</body></html>`;
}

function magicLinkHtml(name, url) {
  return `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;color:#111">
<h2>Your Your9 login link</h2>
<p>Hi ${name || 'there'},</p>
<p>Click the button below to log in to Your9. This link expires in 15 minutes and can only be used once.</p>
<p style="margin:32px 0">
  <a href="${url}" style="background:#000;color:#fff;padding:14px 28px;text-decoration:none;border-radius:4px;font-weight:600">Log In to Your9</a>
</p>
<p>If you didn't request this, ignore this email.</p>
<hr style="border:none;border-top:1px solid #eee;margin:32px 0">
<p style="color:#888;font-size:12px">Your9 by 9 Enterprises</p>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateEmail(v) {
  return typeof v === 'string' && EMAIL_RE.test(v.trim());
}

function validatePassword(v) {
  // Min 8 chars, at least 1 letter, 1 number
  return typeof v === 'string' && v.length >= 8 && /[A-Za-z]/.test(v) && /[0-9]/.test(v);
}

// ---------------------------------------------------------------------------
// HTTP server helpers
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 65536) { req.destroy(); reject(new Error('Body too large')); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(json);
}

function ok(res, data = {}) { send(res, 200, { ok: true, ...data }); }
function created(res, data = {}) { send(res, 201, { ok: true, ...data }); }
function badRequest(res, error) { send(res, 400, { ok: false, error }); }
function unauthorized(res, error = 'Unauthorized') { send(res, 401, { ok: false, error }); }
function forbidden(res, error = 'Forbidden') { send(res, 403, { ok: false, error }); }
function notFound(res, error = 'Not found') { send(res, 404, { ok: false, error }); }
function conflict(res, error) { send(res, 409, { ok: false, error }); }
function serverError(res, error = 'Internal server error') { send(res, 500, { ok: false, error }); }

// ---------------------------------------------------------------------------
// Auth middleware — extracts and validates Bearer token
// ---------------------------------------------------------------------------

function requireAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const payload = verifyJWT(token);
  if (!payload || payload.type !== 'access') return null;
  return payload;
}

// ---------------------------------------------------------------------------
// Rate limiting — simple in-memory, per-IP, per-minute
// ---------------------------------------------------------------------------

const rateLimitMap = new Map();

function rateLimit(ip, maxPerMinute = 10) {
  const now = Date.now();
  const key = `${ip}:${Math.floor(now / 60000)}`;
  const count = (rateLimitMap.get(key) || 0) + 1;
  rateLimitMap.set(key, count);
  // Clean up old keys every 100 requests
  if (rateLimitMap.size > 1000) {
    const oldMin = Math.floor(now / 60000) - 2;
    for (const k of rateLimitMap.keys()) {
      if (k.includes(`:${oldMin}`) || k.includes(`:${oldMin - 1}`)) rateLimitMap.delete(k);
    }
  }
  return count > maxPerMinute;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

// POST /auth/signup
async function handleSignup(req, res) {
  let body;
  try { body = await readBody(req); } catch { return badRequest(res, 'Invalid request body'); }

  const { email, password, name } = body;

  if (!validateEmail(email)) return badRequest(res, 'Valid email required');
  if (!validatePassword(password)) {
    return badRequest(res, 'Password must be at least 8 characters with at least 1 letter and 1 number');
  }

  const existing = findAccountByEmail(email);
  if (existing) return conflict(res, 'An account with this email already exists');

  const passwordHash = await hashPassword(password);
  const account = createAccount({ email, passwordHash, name: name?.trim() || '' });

  // Send verification email
  const verifyUrl = `${BASE_URL}/auth/verify?token=${account.emailVerifyToken}`;
  sendEmail({
    to: account.email,
    subject: 'Verify your Your9 account',
    html: verifyEmailHtml(account.name, verifyUrl),
    text: `Verify your email: ${verifyUrl}`
  }).catch(e => log(`Verify email failed: ${e.message}`));

  const tokens = issueTokens(account.id, account.email);

  created(res, {
    message: 'Account created. Check your email to verify.',
    accountId: account.id,
    emailVerified: false,
    ...tokens
  });
}

// POST /auth/login
async function handleLogin(req, res) {
  let body;
  try { body = await readBody(req); } catch { return badRequest(res, 'Invalid request body'); }

  const { email, password } = body;

  if (!validateEmail(email)) return badRequest(res, 'Valid email required');
  if (!password) return badRequest(res, 'Password required');

  const account = findAccountByEmail(email);

  // Always run hash comparison even if account not found — prevents timing attacks
  const dummyHash = 'scrypt:16384:8:1:00000000000000000000000000000000:' + '0'.repeat(128);
  const stored = account?.passwordHash || dummyHash;
  const valid = await verifyPassword(password, stored);

  if (!account || !valid) return unauthorized(res, 'Invalid email or password');
  if (account.status !== 'active') return forbidden(res, 'Account suspended');
  if (!account.passwordHash) return badRequest(res, 'This account uses magic link login. Use /auth/magic-link instead.');

  account.lastLoginAt = new Date().toISOString();
  saveAccount(account);

  const tokens = issueTokens(account.id, account.email);
  log(`Login: ${account.id} <${account.email}>`);

  ok(res, {
    accountId: account.id,
    email: account.email,
    name: account.name,
    emailVerified: account.emailVerified,
    ...tokens
  });
}

// POST /auth/refresh
async function handleRefresh(req, res) {
  let body;
  try { body = await readBody(req); } catch { return badRequest(res, 'Invalid request body'); }

  const { refreshToken } = body;
  if (!refreshToken) return badRequest(res, 'refreshToken required');

  const payload = verifyJWT(refreshToken);
  if (!payload || payload.type !== 'refresh') return unauthorized(res, 'Invalid or expired refresh token');

  const account = loadAccount(payload.sub);
  if (!account || account.status !== 'active') return unauthorized(res, 'Account not found or suspended');

  const tokens = issueTokens(account.id, account.email);
  log(`Token refreshed: ${account.id}`);
  ok(res, tokens);
}

// POST /auth/magic-link — request a magic link login email
async function handleMagicLink(req, res) {
  let body;
  try { body = await readBody(req); } catch { return badRequest(res, 'Invalid request body'); }

  const { email } = body;
  if (!validateEmail(email)) return badRequest(res, 'Valid email required');

  const account = findAccountByEmail(email);

  // Always respond OK — don't reveal if account exists
  if (account && account.status === 'active') {
    const token = randomBytes(32).toString('hex');
    account.magicLinkToken = token;
    account.magicLinkExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    saveAccount(account);

    const magicUrl = `${BASE_URL}/auth/magic?token=${token}`;
    sendEmail({
      to: account.email,
      subject: 'Your Your9 login link',
      html: magicLinkHtml(account.name, magicUrl),
      text: `Log in here (expires in 15 minutes): ${magicUrl}`
    }).catch(e => log(`Magic link email failed: ${e.message}`));
  }

  ok(res, { message: 'If an account exists for that email, a login link has been sent.' });
}

// GET /auth/magic?token=... — consume magic link, return tokens
async function handleMagicVerify(req, res, url) {
  const token = url.searchParams.get('token');
  if (!token) return badRequest(res, 'Token required');

  // Search accounts for matching magic link token
  let account = null;
  if (existsSync(ACCOUNTS_DIR)) {
    for (const file of readdirSync(ACCOUNTS_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const a = JSON.parse(readFileSync(join(ACCOUNTS_DIR, file), 'utf8'));
        if (a.magicLinkToken === token) { account = a; break; }
      } catch { /* skip */ }
    }
  }

  if (!account) return unauthorized(res, 'Invalid or expired magic link');
  if (new Date(account.magicLinkExpiry) < new Date()) return unauthorized(res, 'Magic link expired');

  account.magicLinkToken = null;
  account.magicLinkExpiry = null;
  account.emailVerified = true;
  account.lastLoginAt = new Date().toISOString();
  saveAccount(account);

  const tokens = issueTokens(account.id, account.email);
  log(`Magic link login: ${account.id} <${account.email}>`);
  ok(res, {
    accountId: account.id,
    email: account.email,
    name: account.name,
    emailVerified: true,
    ...tokens
  });
}

// GET /auth/verify?token=... — verify email address
async function handleEmailVerify(req, res, url) {
  const token = url.searchParams.get('token');
  if (!token) return badRequest(res, 'Token required');

  let account = null;
  if (existsSync(ACCOUNTS_DIR)) {
    for (const file of readdirSync(ACCOUNTS_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const a = JSON.parse(readFileSync(join(ACCOUNTS_DIR, file), 'utf8'));
        if (a.emailVerifyToken === token) { account = a; break; }
      } catch { /* skip */ }
    }
  }

  if (!account) return unauthorized(res, 'Invalid verification token');
  if (account.emailVerified) return ok(res, { message: 'Email already verified' });
  if (new Date(account.emailVerifyExpiry) < new Date()) {
    return unauthorized(res, 'Verification link expired. Request a new one via /auth/resend-verify');
  }

  account.emailVerified = true;
  account.emailVerifyToken = null;
  account.emailVerifyExpiry = null;
  saveAccount(account);

  log(`Email verified: ${account.id} <${account.email}>`);
  ok(res, { message: 'Email verified. You can now log in.' });
}

// POST /auth/resend-verify — resend verification email
async function handleResendVerify(req, res) {
  const payload = requireAuth(req);
  if (!payload) return unauthorized(res);

  const account = loadAccount(payload.sub);
  if (!account) return notFound(res, 'Account not found');
  if (account.emailVerified) return ok(res, { message: 'Email already verified' });

  account.emailVerifyToken = randomBytes(32).toString('hex');
  account.emailVerifyExpiry = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  saveAccount(account);

  const verifyUrl = `${BASE_URL}/auth/verify?token=${account.emailVerifyToken}`;
  sendEmail({
    to: account.email,
    subject: 'Verify your Your9 account',
    html: verifyEmailHtml(account.name, verifyUrl),
    text: `Verify your email: ${verifyUrl}`
  }).catch(e => log(`Resend verify email failed: ${e.message}`));

  ok(res, { message: 'Verification email sent.' });
}

// POST /auth/forgot-password
async function handleForgotPassword(req, res) {
  let body;
  try { body = await readBody(req); } catch { return badRequest(res, 'Invalid request body'); }

  const { email } = body;
  if (!validateEmail(email)) return badRequest(res, 'Valid email required');

  const account = findAccountByEmail(email);

  // Always respond OK — don't reveal if account exists
  if (account && account.status === 'active') {
    const token = randomBytes(32).toString('hex');
    account.resetToken = token;
    account.resetExpiry = new Date(Date.now() + 3600 * 1000).toISOString(); // 1 hour
    saveAccount(account);

    const resetUrl = `${BASE_URL}/auth/reset-password?token=${token}`;
    sendEmail({
      to: account.email,
      subject: 'Reset your Your9 password',
      html: resetPasswordHtml(account.name, resetUrl),
      text: `Reset your password: ${resetUrl}`
    }).catch(e => log(`Reset email failed: ${e.message}`));
  }

  ok(res, { message: 'If an account exists for that email, a reset link has been sent.' });
}

// POST /auth/reset-password
async function handleResetPassword(req, res) {
  let body;
  try { body = await readBody(req); } catch { return badRequest(res, 'Invalid request body'); }

  const { token, password } = body;
  if (!token) return badRequest(res, 'token required');
  if (!validatePassword(password)) {
    return badRequest(res, 'Password must be at least 8 characters with at least 1 letter and 1 number');
  }

  let account = null;
  if (existsSync(ACCOUNTS_DIR)) {
    for (const file of readdirSync(ACCOUNTS_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const a = JSON.parse(readFileSync(join(ACCOUNTS_DIR, file), 'utf8'));
        if (a.resetToken === token) { account = a; break; }
      } catch { /* skip */ }
    }
  }

  if (!account) return unauthorized(res, 'Invalid or expired reset token');
  if (new Date(account.resetExpiry) < new Date()) return unauthorized(res, 'Reset link expired. Request a new one.');

  account.passwordHash = await hashPassword(password);
  account.resetToken = null;
  account.resetExpiry = null;
  saveAccount(account);

  log(`Password reset: ${account.id} <${account.email}>`);
  ok(res, { message: 'Password reset. You can now log in with your new password.' });
}

// POST /auth/change-password — authenticated
async function handleChangePassword(req, res) {
  const payload = requireAuth(req);
  if (!payload) return unauthorized(res);

  let body;
  try { body = await readBody(req); } catch { return badRequest(res, 'Invalid request body'); }

  const { currentPassword, newPassword } = body;
  if (!currentPassword) return badRequest(res, 'currentPassword required');
  if (!validatePassword(newPassword)) {
    return badRequest(res, 'New password must be at least 8 characters with at least 1 letter and 1 number');
  }

  const account = loadAccount(payload.sub);
  if (!account) return notFound(res, 'Account not found');
  if (!account.passwordHash) return badRequest(res, 'This account uses magic link login and has no password to change.');

  const valid = await verifyPassword(currentPassword, account.passwordHash);
  if (!valid) return unauthorized(res, 'Current password is incorrect');

  account.passwordHash = await hashPassword(newPassword);
  saveAccount(account);

  log(`Password changed: ${account.id}`);
  ok(res, { message: 'Password changed.' });
}

// GET /account — dashboard: profile + subscription + instances
async function handleGetAccount(req, res) {
  const payload = requireAuth(req);
  if (!payload) return unauthorized(res);

  const account = loadAccount(payload.sub);
  if (!account) return notFound(res, 'Account not found');

  const instances = getInstanceSummaries(account.instances || []);

  ok(res, {
    account: {
      id: account.id,
      email: account.email,
      name: account.name,
      emailVerified: account.emailVerified,
      stripeCustomerId: account.stripeCustomerId,
      status: account.status,
      createdAt: account.createdAt,
      lastLoginAt: account.lastLoginAt
    },
    instances
  });
}

// PATCH /account — update profile
async function handleUpdateAccount(req, res) {
  const payload = requireAuth(req);
  if (!payload) return unauthorized(res);

  let body;
  try { body = await readBody(req); } catch { return badRequest(res, 'Invalid request body'); }

  const account = loadAccount(payload.sub);
  if (!account) return notFound(res, 'Account not found');

  // Only allow safe fields
  if (body.name !== undefined) account.name = body.name?.trim() || '';
  saveAccount(account);

  log(`Account updated: ${account.id}`);
  ok(res, {
    account: { id: account.id, email: account.email, name: account.name }
  });
}

// POST /account/instances — link a Your9 instance to this account
async function handleLinkInstance(req, res) {
  const payload = requireAuth(req);
  if (!payload) return unauthorized(res);

  let body;
  try { body = await readBody(req); } catch { return badRequest(res, 'Invalid request body'); }

  const { customerId } = body;
  if (!customerId) return badRequest(res, 'customerId required');

  // Verify instance exists
  const configPath = join(INSTANCES_DIR, customerId, 'config', 'customer.json');
  if (!existsSync(configPath)) return notFound(res, `Instance ${customerId} not found`);

  const account = loadAccount(payload.sub);
  if (!account) return notFound(res, 'Account not found');

  if (account.instances.includes(customerId)) {
    return conflict(res, 'Instance already linked to this account');
  }

  account.instances.push(customerId);
  saveAccount(account);

  const summaries = getInstanceSummaries(account.instances);
  log(`Instance linked: ${customerId} -> account ${account.id}`);
  ok(res, { instances: summaries });
}

// DELETE /account/instances/:customerId — unlink instance
async function handleUnlinkInstance(req, res, customerId) {
  const payload = requireAuth(req);
  if (!payload) return unauthorized(res);

  const account = loadAccount(payload.sub);
  if (!account) return notFound(res, 'Account not found');

  if (!account.instances.includes(customerId)) return notFound(res, 'Instance not linked to this account');

  account.instances = account.instances.filter(id => id !== customerId);
  saveAccount(account);

  log(`Instance unlinked: ${customerId} from account ${account.id}`);
  ok(res, { message: 'Instance unlinked.', instances: getInstanceSummaries(account.instances) });
}

// GET /account/instances — list all instances for this account
async function handleListInstances(req, res) {
  const payload = requireAuth(req);
  if (!payload) return unauthorized(res);

  const account = loadAccount(payload.sub);
  if (!account) return notFound(res, 'Account not found');

  const summaries = getInstanceSummaries(account.instances || []);
  ok(res, { instances: summaries });
}

// GET /health
function handleHealth(res) {
  ok(res, {
    service: 'your9-auth',
    port: 3493,
    uptime: Math.floor(process.uptime()),
    accounts: existsSync(ACCOUNTS_DIR)
      ? readdirSync(ACCOUNTS_DIR).filter(f => f.endsWith('.json')).length
      : 0
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function router(req, res) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  // CORS — only allow localhost origins (internal service)
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost:3493'}`);
  const path = url.pathname.replace(/\/$/, '') || '/';
  const method = req.method.toUpperCase();

  // Rate limiting on auth endpoints
  const authPaths = ['/auth/signup', '/auth/login', '/auth/magic-link', '/auth/forgot-password', '/auth/reset-password'];
  if (authPaths.includes(path) && rateLimit(ip, 20)) {
    return send(res, 429, { ok: false, error: 'Too many requests. Try again in a minute.' });
  }

  try {
    if (path === '/health' && method === 'GET') return handleHealth(res);

    // Auth routes
    if (path === '/auth/signup' && method === 'POST') return await handleSignup(req, res);
    if (path === '/auth/login' && method === 'POST') return await handleLogin(req, res);
    if (path === '/auth/refresh' && method === 'POST') return await handleRefresh(req, res);
    if (path === '/auth/magic-link' && method === 'POST') return await handleMagicLink(req, res);
    if (path === '/auth/magic' && method === 'GET') return await handleMagicVerify(req, res, url);
    if (path === '/auth/verify' && method === 'GET') return await handleEmailVerify(req, res, url);
    if (path === '/auth/resend-verify' && method === 'POST') return await handleResendVerify(req, res);
    if (path === '/auth/forgot-password' && method === 'POST') return await handleForgotPassword(req, res);
    if (path === '/auth/reset-password' && method === 'POST') return await handleResetPassword(req, res);
    if (path === '/auth/change-password' && method === 'POST') return await handleChangePassword(req, res);

    // Account routes
    if (path === '/account' && method === 'GET') return await handleGetAccount(req, res);
    if (path === '/account' && method === 'PATCH') return await handleUpdateAccount(req, res);
    if (path === '/account/instances' && method === 'GET') return await handleListInstances(req, res);
    if (path === '/account/instances' && method === 'POST') return await handleLinkInstance(req, res);

    // DELETE /account/instances/:customerId
    const unlinkMatch = path.match(/^\/account\/instances\/([^/]+)$/);
    if (unlinkMatch && method === 'DELETE') return await handleUnlinkInstance(req, res, unlinkMatch[1]);

    notFound(res, `No route: ${method} ${path}`);
  } catch (err) {
    log(`Unhandled error [${method} ${path}]: ${err.message}`);
    serverError(res);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv);
const PORT = parseInt(args.port || '3493', 10);
const HOST = '127.0.0.1';

ensureDirs();

const server = http.createServer(router);

server.listen(PORT, HOST, () => {
  log(`=== your9-auth running on http://${HOST}:${PORT} ===`);
  log(`Accounts dir: ${ACCOUNTS_DIR}`);
  log(`JWT secret: ${ENV.YOUR9_AUTH_JWT_SECRET ? 'from .env' : 'EPHEMERAL — add YOUR9_AUTH_JWT_SECRET to .env'}`);
  log(`Email provider: ${RESEND_API_KEY ? 'Resend configured' : 'no RESEND_API_KEY — emails will be skipped'}`);
  log('Routes:');
  log('  POST /auth/signup          Create account (email + password)');
  log('  POST /auth/login           Login with password');
  log('  POST /auth/refresh         Refresh access token');
  log('  POST /auth/magic-link      Request magic link email');
  log('  GET  /auth/magic?token=... Consume magic link, get tokens');
  log('  GET  /auth/verify?token=.. Verify email address');
  log('  POST /auth/resend-verify   Resend verification email');
  log('  POST /auth/forgot-password Send password reset email');
  log('  POST /auth/reset-password  Set new password via token');
  log('  POST /auth/change-password Change password (authenticated)');
  log('  GET  /account              Dashboard: profile + instances');
  log('  PATCH /account             Update profile');
  log('  GET  /account/instances    List linked instances');
  log('  POST /account/instances    Link a Your9 instance');
  log('  DELETE /account/instances/:id  Unlink instance');
  log('  GET  /health               Service health');
});

server.on('error', (err) => {
  log(`Server error: ${err.message}`);
  process.exit(1);
});

process.on('SIGINT', () => { log('Shutting down...'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { log('Shutting down...'); server.close(() => process.exit(0)); });
