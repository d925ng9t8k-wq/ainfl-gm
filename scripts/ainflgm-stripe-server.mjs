#!/usr/bin/env node
/**
 * ainflgm-stripe-server.mjs
 * Stripe Checkout backend for ainflgm.com premium tier.
 *
 * Endpoints:
 *   POST /create-checkout-session  — creates Stripe Checkout session, returns {url}
 *   GET  /premium-status           — checks if session is active (by session_id query param)
 *   POST /webhook                  — Stripe webhook handler
 *   GET  /health                   — health check
 *
 * Deploy: Railway or any Node.js host. Set env vars:
 *   STRIPE_SECRET_KEY      — sk_test_ or sk_live_ from Stripe dashboard
 *   STRIPE_PUBLISHABLE_KEY — pk_test_ or pk_live_
 *   STRIPE_WEBHOOK_SECRET  — whsec_ from Stripe webhook config
 *   AINFLGM_ORIGIN         — e.g. https://ainflgm.com (for CORS)
 *   PORT                   — defaults to 3480
 *
 * QC NOTE: Test with sk_test_ keys first. Switch to sk_live_ only after
 * full checkout flow is verified end-to-end.
 */

import https from 'https';
import http from 'http';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHmac, timingSafeEqual } from 'crypto';

// ─── Paths ───────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LOG_FILE = join(ROOT, 'logs', 'ainflgm-stripe.log');

// ─── Env ─────────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return {};
  const vars = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    vars[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return vars;
}

const ENV = loadEnv();
const STRIPE_SECRET      = ENV.STRIPE_SECRET_KEY      || process.env.STRIPE_SECRET_KEY      || '';
const STRIPE_PUB         = ENV.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_WEBHOOK_SEC = ENV.STRIPE_WEBHOOK_SECRET  || process.env.STRIPE_WEBHOOK_SECRET  || '';
const ORIGIN             = ENV.AINFLGM_ORIGIN         || process.env.AINFLGM_ORIGIN         || 'https://ainflgm.com';
const PORT               = parseInt(ENV.AINFLGM_STRIPE_PORT || process.env.PORT || '3480', 10);

// ─── Product config ──────────────────────────────────────────────────────────
const PREMIUM_PRICE_USD = 999; // cents = $9.99
const PREMIUM_PRODUCT_NAME = 'PlayAiGM Premium';
const SUCCESS_URL = `${ORIGIN}/premium-success.html?session_id={CHECKOUT_SESSION_ID}`;
const CANCEL_URL  = `${ORIGIN}/premium-cancel.html`;

// ─── Logging ─────────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] STRIPE: ${msg}`;
  console.log(line);
  try {
    if (!existsSync(join(ROOT, 'logs'))) mkdirSync(join(ROOT, 'logs'), { recursive: true });
    appendFileSync(LOG_FILE, line + '\n');
  } catch { /* non-fatal */ }
}

// ─── Raw Stripe HTTPS call ───────────────────────────────────────────────────
function stripeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    if (!STRIPE_SECRET || STRIPE_SECRET.startsWith('mk_')) {
      reject(new Error('Stripe secret key not configured. Set STRIPE_SECRET_KEY to a real sk_test_ or sk_live_ key.'));
      return;
    }

    const postData = body ? new URLSearchParams(body).toString() : null;
    const options = {
      hostname: 'api.stripe.com',
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`Stripe ${res.statusCode}: ${parsed.error?.message || data}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Stripe parse error: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// ─── Stripe webhook signature verification ───────────────────────────────────
function verifyStripeSignature(rawBody, sigHeader) {
  if (!STRIPE_WEBHOOK_SEC) return true; // skip if not configured (dev mode)
  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts.t;
  const signatures = Object.entries(parts)
    .filter(([k]) => k === 'v1')
    .map(([, v]) => v);

  if (!timestamp || signatures.length === 0) return false;

  const tolerance = 300; // 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > tolerance) return false;

  const signed = `${timestamp}.${rawBody}`;
  const expected = createHmac('sha256', STRIPE_WEBHOOK_SEC).update(signed).digest('hex');
  return signatures.some(sig => {
    try {
      return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    } catch { return false; }
  });
}

// ─── Request body reader ─────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 65536) reject(new Error('Body too large')); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ─── JSON response helper ─────────────────────────────────────────────────────
function jsonResponse(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

async function handleCreateCheckout(req, res) {
  try {
    const body = await readBody(req);
    let payload = {};
    try { payload = Object.fromEntries(new URLSearchParams(body)); } catch { /* default empty */ }

    // Build Stripe Checkout session params (flat URL-encoded, nested with brackets)
    const params = {
      'mode': 'subscription',
      'payment_method_types[0]': 'card',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': PREMIUM_PRODUCT_NAME,
      'line_items[0][price_data][product_data][description]': 'Monthly access to PlayAiGM Premium — exclusive dynasty rankings, cap analysis, and AI GM tools.',
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][unit_amount]': String(PREMIUM_PRICE_USD),
      'line_items[0][quantity]': '1',
      'success_url': SUCCESS_URL,
      'cancel_url': CANCEL_URL,
      'allow_promotion_codes': 'true',
      'billing_address_collection': 'auto',
    };

    // Optional: pre-fill email if passed
    if (payload.email) params['customer_email'] = payload.email;

    // Optional: metadata for tracking source article
    if (payload.source_article) {
      params['metadata[source_article]'] = payload.source_article.slice(0, 200);
    }

    log(`Creating checkout session (source: ${payload.source_article || 'unknown'})`);
    const session = await stripeRequest('POST', '/v1/checkout/sessions', params);
    log(`Checkout session created: ${session.id}`);

    jsonResponse(res, 200, { url: session.url, session_id: session.id });
  } catch (err) {
    log(`Checkout error: ${err.message}`);
    jsonResponse(res, 500, { error: err.message });
  }
}

async function handlePremiumStatus(req, res) {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const sessionId = url.searchParams.get('session_id');

    if (!sessionId) {
      return jsonResponse(res, 400, { error: 'session_id required' });
    }

    const session = await stripeRequest('GET', `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
    const active = session.payment_status === 'paid' || session.status === 'complete';

    jsonResponse(res, 200, {
      active,
      status: session.status,
      payment_status: session.payment_status,
      customer_email: session.customer_details?.email || null,
    });
  } catch (err) {
    log(`Status check error: ${err.message}`);
    jsonResponse(res, 500, { error: err.message });
  }
}

async function handleWebhook(req, res) {
  try {
    const rawBody = await readBody(req);
    const sigHeader = req.headers['stripe-signature'] || '';

    if (!verifyStripeSignature(rawBody, sigHeader)) {
      log('Webhook signature verification failed');
      res.writeHead(400);
      res.end('Signature mismatch');
      return;
    }

    const event = JSON.parse(rawBody);
    log(`Webhook event: ${event.type} — ${event.id}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        log(`Premium subscription activated: ${session.customer_email || session.id}`);
        break;
      }
      case 'customer.subscription.deleted': {
        log(`Subscription cancelled: ${event.data.object.customer}`);
        break;
      }
      case 'invoice.payment_failed': {
        log(`Payment failed: ${event.data.object.customer_email}`);
        break;
      }
      default:
        log(`Unhandled event type: ${event.type}`);
    }

    jsonResponse(res, 200, { received: true });
  } catch (err) {
    log(`Webhook error: ${err.message}`);
    res.writeHead(400);
    res.end(`Webhook error: ${err.message}`);
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  // Routes
  if (method === 'POST' && path === '/create-checkout-session') {
    return await handleCreateCheckout(req, res);
  }
  if (method === 'GET' && path === '/premium-status') {
    return await handlePremiumStatus(req, res);
  }
  if (method === 'POST' && path === '/webhook') {
    return await handleWebhook(req, res);
  }
  if (method === 'GET' && path === '/health') {
    const keyConfigured = STRIPE_SECRET && !STRIPE_SECRET.startsWith('mk_');
    return jsonResponse(res, 200, {
      status: 'ok',
      service: 'ainflgm-stripe',
      stripe_key_configured: keyConfigured,
      stripe_mode: STRIPE_SECRET.startsWith('sk_live_') ? 'live' : 'test',
      origin: ORIGIN,
      ts: new Date().toISOString(),
    });
  }

  // 404
  jsonResponse(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  log(`ainflgm-stripe server running on port ${PORT}`);
  log(`CORS origin: ${ORIGIN}`);
  if (!STRIPE_SECRET || STRIPE_SECRET.startsWith('mk_')) {
    log('WARNING: Stripe secret key not configured or is a placeholder. Set STRIPE_SECRET_KEY to a real sk_test_ key.');
  } else {
    log(`Stripe mode: ${STRIPE_SECRET.startsWith('sk_live_') ? 'LIVE' : 'TEST'}`);
  }
});

server.on('error', (err) => {
  log(`Server error: ${err.message}`);
  process.exit(1);
});
