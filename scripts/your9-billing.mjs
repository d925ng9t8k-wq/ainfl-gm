#!/usr/bin/env node
/**
 * your9-billing.mjs — Billing & Subscription System
 * Your9 by 9 Enterprises
 *
 * Complete Stripe-integrated billing engine for Your9 customers.
 * Raw HTTPS only — no Stripe SDK. Matches codebase pattern from comms-hub.mjs.
 *
 * Capabilities:
 *   - Stripe customer + subscription creation
 *   - Three-tier management: Starter ($499/mo), Growth ($999/mo), Enterprise ($2,499/mo)
 *   - Usage tracking: API calls, tasks, agents per billing period
 *   - Automatic subscription activation on provisioning
 *   - Tier enforcement: agent count caps, call limits
 *   - Webhook endpoint for Stripe events (success, failure, cancellation)
 *   - Grace period handling for failed payments (7 days)
 *
 * Usage:
 *   node scripts/your9-billing.mjs --instance {customer-id}         # Status check
 *   node scripts/your9-billing.mjs --instance {customer-id} --activate  # Create Stripe subscription
 *   node scripts/your9-billing.mjs --instance {customer-id} --usage     # Print usage report
 *   node scripts/your9-billing.mjs --webhook                        # Start webhook listener
 *   node scripts/your9-billing.mjs --webhook --port 4242
 */

import https from 'https';
import http from 'http';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync,
  appendFileSync, readdirSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHmac } from 'crypto';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');
const BILLING_LOG = join(ROOT, 'logs', 'your9-billing.log');
const BILLING_DIR = join(ROOT, 'data', 'billing');

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
const STRIPE_SECRET_KEY = ENV.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
const STRIPE_PUBLISHABLE_KEY = ENV.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY;
const STRIPE_WEBHOOK_SECRET = ENV.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] BILLING: ${msg}`;
  console.log(line);
  try {
    if (!existsSync(join(ROOT, 'logs'))) mkdirSync(join(ROOT, 'logs'), { recursive: true });
    appendFileSync(BILLING_LOG, line + '\n');
  } catch { /* non-fatal */ }
}

function logSection(title) {
  const bar = '='.repeat(60);
  const line = `\n${bar}\n  ${title}\n${bar}`;
  console.log(line);
  try { appendFileSync(BILLING_LOG, line + '\n'); } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

const TIERS = {
  starter: {
    label: 'Starter',
    priceMonthly: 499,          // USD
    priceCents: 49900,
    maxAgents: 3,
    monthlyCallLimit: 100,
    storageGB: 5,
    features: ['3 AI agents', '100 API calls/mo', '5GB storage', 'Telegram channel'],
    stripePriceId: ENV.STRIPE_PRICE_STARTER || 'PLACEHOLDER_PRICE_STARTER'
  },
  growth: {
    label: 'Growth',
    priceMonthly: 999,
    priceCents: 99900,
    maxAgents: 6,
    monthlyCallLimit: 500,
    storageGB: 25,
    features: ['6 AI agents', '500 API calls/mo', '25GB storage', 'Telegram + Email + Voice'],
    stripePriceId: ENV.STRIPE_PRICE_GROWTH || 'PLACEHOLDER_PRICE_GROWTH'
  },
  enterprise: {
    label: 'Enterprise',
    priceMonthly: 2499,
    priceCents: 249900,
    maxAgents: 12,
    monthlyCallLimit: -1,       // unlimited
    storageGB: 100,
    features: ['12 AI agents', 'Unlimited API calls', '100GB storage', 'All channels + SMS'],
    stripePriceId: ENV.STRIPE_PRICE_ENTERPRISE || 'PLACEHOLDER_PRICE_ENTERPRISE'
  }
};

// Grace period before suspension on failed payment (days)
const GRACE_PERIOD_DAYS = 7;

// ---------------------------------------------------------------------------
// Stripe raw HTTPS client
// Stripe API uses HTTP Basic auth: secret key as username, empty password.
// Pattern matches comms-hub.mjs / 9-ops-daemon.mjs raw https.request style.
// ---------------------------------------------------------------------------

function stripeRequest({ method, path, body = null, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    if (!STRIPE_SECRET_KEY) {
      reject(new Error('STRIPE_SECRET_KEY not set in .env'));
      return;
    }

    // Stripe uses application/x-www-form-urlencoded for most endpoints
    const bodyStr = body ? encodeFormBody(body) : null;
    const authHeader = `Basic ${Buffer.from(`${STRIPE_SECRET_KEY}:`).toString('base64')}`;

    const headers = {
      'Authorization': authHeader,
      'Stripe-Version': '2023-10-16',
    };

    if (bodyStr) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const opts = {
      hostname: 'api.stripe.com',
      path,
      method,
      headers
    };

    const timer = setTimeout(() => {
      reject(new Error(`Stripe API timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      const req = https.request(opts, (res) => {
        clearTimeout(timer);
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`Stripe error [${parsed.error.code}]: ${parsed.error.message}`));
              return;
            }
            resolve({ status: res.statusCode, data: parsed });
          } catch (e) {
            reject(new Error(`Stripe parse error: ${e.message} — raw: ${data.slice(0, 300)}`));
          }
        });
      });

      req.on('error', (e) => { clearTimeout(timer); reject(e); });
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        clearTimeout(timer);
        reject(new Error('Stripe request timeout'));
      });

      if (bodyStr) req.write(bodyStr);
      req.end();
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

// Stripe expects form-encoded bodies, including nested objects with bracket notation
function encodeFormBody(obj, prefix = '') {
  const parts = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      parts.push(encodeFormBody(value, fullKey));
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] === 'object') {
          parts.push(encodeFormBody(value[i], `${fullKey}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${fullKey}[]`)}=${encodeURIComponent(value[i])}`);
        }
      }
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join('&');
}

// ---------------------------------------------------------------------------
// Billing state — stored per instance in instances/{id}/data/billing.json
// ---------------------------------------------------------------------------

function billingPath(instanceId) {
  return join(INSTANCES_DIR, instanceId, 'data', 'billing.json');
}

function loadBilling(instanceId) {
  const p = billingPath(instanceId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function saveBilling(instanceId, billing) {
  const p = billingPath(instanceId);
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(billing, null, 2));
}

function initBilling(instanceId, tier) {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

  return {
    instanceId,
    tier,
    status: 'provisioned',           // provisioned | active | past_due | grace | suspended | cancelled
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: TIERS[tier]?.stripePriceId || null,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    gracePeriodEnd: null,
    failedPaymentAt: null,
    cancelledAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    usage: {
      apiCalls: 0,
      tasksCompleted: 0,
      activeAgents: 0,
      periodStart,
      periodEnd
    },
    history: []
  };
}

// ---------------------------------------------------------------------------
// Stripe API operations
// ---------------------------------------------------------------------------

async function createStripeCustomer(instanceId, customerConfig) {
  log(`Creating Stripe customer for ${customerConfig.name} (${instanceId})`);

  const { data } = await stripeRequest({
    method: 'POST',
    path: '/v1/customers',
    body: {
      name: customerConfig.name,
      description: `Your9 instance — ${customerConfig.industry}`,
      metadata: {
        your9_instance_id: instanceId,
        your9_tier: customerConfig.tier,
        your9_industry: customerConfig.industry,
        provisioned_at: customerConfig.provisionedAt
      }
    }
  });

  log(`Stripe customer created: ${data.id}`);
  return data;
}

async function createStripeSubscription(stripeCustomerId, tier, instanceId) {
  const tierConfig = TIERS[tier];
  if (!tierConfig) throw new Error(`Unknown tier: ${tier}`);

  // If Stripe price IDs are placeholders, create an inline price on the fly
  // so the billing system works without pre-configured Stripe products.
  // In production: set STRIPE_PRICE_STARTER/GROWTH/ENTERPRISE in .env.
  const usePlaceholder = tierConfig.stripePriceId.startsWith('PLACEHOLDER');

  let priceId = tierConfig.stripePriceId;

  if (usePlaceholder) {
    log(`No Stripe price ID configured for ${tier} — creating inline price`);
    priceId = await createStripePrice(tier, tierConfig);
  }

  log(`Creating subscription: customer=${stripeCustomerId} price=${priceId}`);

  const { data } = await stripeRequest({
    method: 'POST',
    path: '/v1/subscriptions',
    body: {
      customer: stripeCustomerId,
      'items[0][price]': priceId,
      payment_behavior: 'default_incomplete',
      'payment_settings[save_default_payment_method]': 'on_subscription',
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        your9_instance_id: instanceId,
        your9_tier: tier
      }
    }
  });

  log(`Stripe subscription created: ${data.id} (status: ${data.status})`);
  return data;
}

async function createStripePrice(tier, tierConfig) {
  // Ensure product exists first
  const product = await ensureStripeProduct(tier, tierConfig);

  const { data } = await stripeRequest({
    method: 'POST',
    path: '/v1/prices',
    body: {
      product: product.id,
      unit_amount: tierConfig.priceCents,
      currency: 'usd',
      recurring: {
        interval: 'month'
      },
      nickname: `Your9 ${tierConfig.label}`,
      metadata: {
        your9_tier: tier
      }
    }
  });

  log(`Stripe price created: ${data.id} (${tierConfig.priceMonthly}/mo)`);
  return data.id;
}

async function ensureStripeProduct(tier, tierConfig) {
  // Search for existing product by metadata
  const { data: listData } = await stripeRequest({
    method: 'GET',
    path: `/v1/products?active=true&limit=10`
  });

  for (const product of (listData.data || [])) {
    if (product.metadata?.your9_tier === tier) {
      log(`Reusing existing Stripe product: ${product.id}`);
      return product;
    }
  }

  // Create new product
  const { data } = await stripeRequest({
    method: 'POST',
    path: '/v1/products',
    body: {
      name: `Your9 ${tierConfig.label}`,
      description: tierConfig.features.join(', '),
      metadata: {
        your9_tier: tier,
        max_agents: String(tierConfig.maxAgents),
        monthly_call_limit: String(tierConfig.monthlyCallLimit)
      }
    }
  });

  log(`Stripe product created: ${data.id}`);
  return data;
}

async function cancelStripeSubscription(subscriptionId, reason = 'cancellation_requested') {
  log(`Cancelling Stripe subscription: ${subscriptionId}`);

  const { data } = await stripeRequest({
    method: 'DELETE',
    path: `/v1/subscriptions/${subscriptionId}`,
    body: {
      cancellation_details: {
        comment: reason
      }
    }
  });

  log(`Subscription cancelled: ${data.id}`);
  return data;
}

async function getStripeSubscription(subscriptionId) {
  const { data } = await stripeRequest({
    method: 'GET',
    path: `/v1/subscriptions/${subscriptionId}`
  });
  return data;
}

// ---------------------------------------------------------------------------
// Instance config loader
// ---------------------------------------------------------------------------

function loadInstanceConfig(instanceId) {
  const instanceDir = join(INSTANCES_DIR, instanceId);
  if (!existsSync(instanceDir)) {
    throw new Error(`Instance not found: ${instanceId}`);
  }

  const configPath = join(instanceDir, 'config', 'customer.json');
  if (!existsSync(configPath)) {
    throw new Error(`Customer config missing for instance: ${instanceId}`);
  }

  return JSON.parse(readFileSync(configPath, 'utf8'));
}

function updateInstanceStatus(instanceId, status) {
  const instanceDir = join(INSTANCES_DIR, instanceId);
  const configPath = join(instanceDir, 'config', 'customer.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.status = status;
  config.updatedAt = new Date().toISOString();
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  log(`Instance ${instanceId} status updated: ${status}`);
}

// ---------------------------------------------------------------------------
// Tier enforcement
// ---------------------------------------------------------------------------

function checkTierLimits(instanceId, billing) {
  const tierConfig = TIERS[billing.tier];
  if (!tierConfig) return { ok: true };

  const issues = [];

  // Agent count cap
  if (billing.usage.activeAgents > tierConfig.maxAgents) {
    issues.push(`Active agents (${billing.usage.activeAgents}) exceeds tier limit (${tierConfig.maxAgents})`);
  }

  // Call limit (skip if -1 = unlimited)
  if (tierConfig.monthlyCallLimit !== -1 && billing.usage.apiCalls >= tierConfig.monthlyCallLimit) {
    issues.push(`API calls (${billing.usage.apiCalls}) at or over monthly limit (${tierConfig.monthlyCallLimit})`);
  }

  // Suspension check
  if (billing.status === 'suspended') {
    issues.push('Instance is suspended — payment required to restore access');
  }

  if (billing.status === 'grace') {
    const daysLeft = Math.ceil(
      (new Date(billing.gracePeriodEnd) - new Date()) / (1000 * 60 * 60 * 24)
    );
    issues.push(`Payment failed — ${daysLeft} day(s) remaining in grace period`);
  }

  return { ok: issues.length === 0, issues, tierConfig };
}

function enforceAgentCap(instanceId, billing, requestedAgentCount) {
  const tierConfig = TIERS[billing.tier];
  if (!tierConfig) return { allowed: requestedAgentCount };

  const allowed = Math.min(requestedAgentCount, tierConfig.maxAgents);
  if (allowed < requestedAgentCount) {
    log(`Agent cap enforced for ${instanceId}: requested=${requestedAgentCount} allowed=${allowed} (tier: ${billing.tier})`);
  }

  return {
    allowed,
    capped: allowed < requestedAgentCount,
    tierLimit: tierConfig.maxAgents
  };
}

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------

function recordUsage(instanceId, event) {
  let billing = loadBilling(instanceId);
  if (!billing) {
    const config = loadInstanceConfig(instanceId);
    billing = initBilling(instanceId, config.tier);
  }

  const now = new Date();
  const periodEnd = new Date(billing.usage.periodEnd);

  // Roll period if needed
  if (now > periodEnd) {
    billing.history.push({
      period: billing.usage.periodStart,
      apiCalls: billing.usage.apiCalls,
      tasksCompleted: billing.usage.tasksCompleted,
      rolledAt: now.toISOString()
    });
    const newStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const newEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
    billing.usage = {
      apiCalls: 0,
      tasksCompleted: 0,
      activeAgents: billing.usage.activeAgents,
      periodStart: newStart,
      periodEnd: newEnd
    };
  }

  // Apply event
  if (event.type === 'api_call') billing.usage.apiCalls += 1;
  if (event.type === 'task_completed') billing.usage.tasksCompleted += 1;
  if (event.type === 'agent_count') billing.usage.activeAgents = event.count;

  billing.updatedAt = now.toISOString();
  saveBilling(instanceId, billing);

  return billing.usage;
}

// ---------------------------------------------------------------------------
// Stripe webhook handler
// ---------------------------------------------------------------------------

function verifyWebhookSignature(payload, sigHeader, secret) {
  if (!secret || !sigHeader) return false;

  const parts = sigHeader.split(',');
  const tsPart = parts.find(p => p.startsWith('t='));
  const v1Part = parts.find(p => p.startsWith('v1='));

  if (!tsPart || !v1Part) return false;

  const timestamp = tsPart.slice(2);
  const expectedSig = v1Part.slice(3);

  const signedPayload = `${timestamp}.${payload}`;
  const hmac = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

  // Constant-time comparison (avoid timing attacks)
  if (hmac.length !== expectedSig.length) return false;
  let diff = 0;
  for (let i = 0; i < hmac.length; i++) {
    diff |= hmac.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return diff === 0;
}

function handleWebhookEvent(event) {
  const type = event.type;
  const obj = event.data?.object;

  log(`Webhook event: ${type} (id: ${event.id})`);

  switch (type) {
    case 'invoice.payment_succeeded':
      handlePaymentSucceeded(obj);
      break;

    case 'invoice.payment_failed':
      handlePaymentFailed(obj);
      break;

    case 'customer.subscription.deleted':
      handleSubscriptionCancelled(obj);
      break;

    case 'customer.subscription.updated':
      handleSubscriptionUpdated(obj);
      break;

    default:
      log(`Unhandled webhook event type: ${type}`);
  }
}

function findInstanceByStripeCustomer(stripeCustomerId) {
  if (!existsSync(INSTANCES_DIR)) return null;

  for (const dir of readdirSync(INSTANCES_DIR)) {
    const billing = loadBilling(dir);
    if (billing?.stripeCustomerId === stripeCustomerId) return dir;
  }
  return null;
}

function findInstanceBySubscription(subscriptionId) {
  if (!existsSync(INSTANCES_DIR)) return null;

  for (const dir of readdirSync(INSTANCES_DIR)) {
    const billing = loadBilling(dir);
    if (billing?.stripeSubscriptionId === subscriptionId) return dir;
  }
  return null;
}

function handlePaymentSucceeded(invoice) {
  const customerId = invoice.customer;
  const instanceId = findInstanceByStripeCustomer(customerId);
  if (!instanceId) {
    log(`Payment succeeded — no instance found for Stripe customer: ${customerId}`);
    return;
  }

  const billing = loadBilling(instanceId);
  if (!billing) return;

  const wasGrace = billing.status === 'grace' || billing.status === 'past_due';

  billing.status = 'active';
  billing.failedPaymentAt = null;
  billing.gracePeriodEnd = null;
  billing.updatedAt = new Date().toISOString();

  // Refresh billing period from invoice
  if (invoice.period_start && invoice.period_end) {
    billing.currentPeriodStart = new Date(invoice.period_start * 1000).toISOString();
    billing.currentPeriodEnd = new Date(invoice.period_end * 1000).toISOString();
  }

  saveBilling(instanceId, billing);
  updateInstanceStatus(instanceId, 'active');

  log(`Payment succeeded for instance ${instanceId} — status: active${wasGrace ? ' (restored from grace)' : ''}`);
}

function handlePaymentFailed(invoice) {
  const customerId = invoice.customer;
  const instanceId = findInstanceByStripeCustomer(customerId);
  if (!instanceId) {
    log(`Payment failed — no instance found for Stripe customer: ${customerId}`);
    return;
  }

  const billing = loadBilling(instanceId);
  if (!billing) return;

  const now = new Date();
  const gracePeriodEnd = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();

  billing.status = 'grace';
  billing.failedPaymentAt = now.toISOString();
  billing.gracePeriodEnd = gracePeriodEnd;
  billing.updatedAt = now.toISOString();

  saveBilling(instanceId, billing);
  updateInstanceStatus(instanceId, 'grace');

  log(`Payment FAILED for instance ${instanceId} — grace period ends: ${gracePeriodEnd}`);
}

function handleSubscriptionCancelled(subscription) {
  const instanceId = findInstanceBySubscription(subscription.id);
  if (!instanceId) {
    log(`Subscription cancelled — no instance found: ${subscription.id}`);
    return;
  }

  const billing = loadBilling(instanceId);
  if (!billing) return;

  billing.status = 'cancelled';
  billing.cancelledAt = new Date().toISOString();
  billing.updatedAt = new Date().toISOString();

  saveBilling(instanceId, billing);
  updateInstanceStatus(instanceId, 'cancelled');

  log(`Subscription cancelled for instance ${instanceId}`);
}

function handleSubscriptionUpdated(subscription) {
  const instanceId = findInstanceBySubscription(subscription.id);
  if (!instanceId) return;

  const billing = loadBilling(instanceId);
  if (!billing) return;

  // Sync period dates from Stripe
  if (subscription.current_period_start && subscription.current_period_end) {
    billing.currentPeriodStart = new Date(subscription.current_period_start * 1000).toISOString();
    billing.currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
  }

  // Sync status
  const stripeStatus = subscription.status;
  if (stripeStatus === 'active') billing.status = 'active';
  else if (stripeStatus === 'past_due') billing.status = 'past_due';
  else if (stripeStatus === 'canceled') billing.status = 'cancelled';

  billing.updatedAt = new Date().toISOString();
  saveBilling(instanceId, billing);
  log(`Subscription updated for instance ${instanceId} — status: ${billing.status}`);
}

// ---------------------------------------------------------------------------
// Check grace period expiry (run periodically or on each request)
// ---------------------------------------------------------------------------

function checkGracePeriodExpiry(instanceId) {
  const billing = loadBilling(instanceId);
  if (!billing) return;
  if (billing.status !== 'grace') return;
  if (!billing.gracePeriodEnd) return;

  const now = new Date();
  const end = new Date(billing.gracePeriodEnd);

  if (now > end) {
    billing.status = 'suspended';
    billing.updatedAt = now.toISOString();
    saveBilling(instanceId, billing);
    updateInstanceStatus(instanceId, 'suspended');
    log(`Grace period expired for instance ${instanceId} — SUSPENDED`);
  }
}

// ---------------------------------------------------------------------------
// Webhook HTTP server
// ---------------------------------------------------------------------------

function startWebhookServer(port = 4242) {
  logSection(`STRIPE WEBHOOK SERVER — port ${port}`);

  if (!STRIPE_WEBHOOK_SECRET) {
    log('WARNING: STRIPE_WEBHOOK_SECRET not set — signature verification disabled');
    log('Set STRIPE_WEBHOOK_SECRET in .env to enable signature verification');
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/stripe/webhook') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      // Verify signature if secret is configured
      if (STRIPE_WEBHOOK_SECRET) {
        const sig = req.headers['stripe-signature'];
        if (!verifyWebhookSignature(body, sig, STRIPE_WEBHOOK_SECRET)) {
          log(`Webhook signature verification FAILED`);
          res.writeHead(400);
          res.end('Signature verification failed');
          return;
        }
      }

      let event;
      try {
        event = JSON.parse(body);
      } catch (e) {
        log(`Webhook JSON parse error: ${e.message}`);
        res.writeHead(400);
        res.end('Invalid JSON');
        return;
      }

      // Acknowledge immediately, process async
      res.writeHead(200);
      res.end('ok');

      try {
        handleWebhookEvent(event);
      } catch (err) {
        log(`Webhook handler error: ${err.message}`);
      }
    });
  });

  server.listen(port, () => {
    log(`Webhook server listening on http://localhost:${port}/stripe/webhook`);
    log(`Register this URL in Stripe Dashboard > Webhooks`);
    log(`Events to subscribe: invoice.payment_succeeded, invoice.payment_failed, customer.subscription.deleted, customer.subscription.updated`);
  });

  server.on('error', (err) => {
    log(`Webhook server error: ${err.message}`);
    process.exit(1);
  });

  return server;
}

// ---------------------------------------------------------------------------
// CLI — Activate subscription
// ---------------------------------------------------------------------------

async function activateSubscription(instanceId) {
  logSection(`ACTIVATING SUBSCRIPTION — ${instanceId}`);

  const config = loadInstanceConfig(instanceId);
  const tier = config.tier?.toLowerCase() || 'starter';
  const tierConfig = TIERS[tier];

  if (!tierConfig) {
    throw new Error(`Unknown tier "${tier}" on instance ${instanceId}`);
  }

  log(`Instance: ${config.name}`);
  log(`Tier: ${tierConfig.label} ($${tierConfig.priceMonthly}/mo)`);

  if (!STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY not set in .env — cannot activate subscription');
  }

  let billing = loadBilling(instanceId);
  if (!billing) {
    billing = initBilling(instanceId, tier);
  }

  // Create Stripe customer if needed
  if (!billing.stripeCustomerId) {
    const customer = await createStripeCustomer(instanceId, config);
    billing.stripeCustomerId = customer.id;
    billing.updatedAt = new Date().toISOString();
    saveBilling(instanceId, billing);
  } else {
    log(`Using existing Stripe customer: ${billing.stripeCustomerId}`);
  }

  // Create subscription if needed
  if (!billing.stripeSubscriptionId) {
    const sub = await createStripeSubscription(billing.stripeCustomerId, tier, instanceId);
    billing.stripeSubscriptionId = sub.id;
    billing.status = sub.status === 'active' ? 'active' : 'provisioned';
    billing.updatedAt = new Date().toISOString();

    if (sub.current_period_start && sub.current_period_end) {
      billing.currentPeriodStart = new Date(sub.current_period_start * 1000).toISOString();
      billing.currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
    }

    saveBilling(instanceId, billing);

    // Mark instance active in customer config
    updateInstanceStatus(instanceId, billing.status);

    // Payment intent — if subscription requires payment method to be added
    const pi = sub.latest_invoice?.payment_intent;
    if (pi && pi.status === 'requires_payment_method') {
      log(`Subscription requires payment method.`);
      log(`Client secret for payment collection: ${pi.client_secret}`);
      log(`Publishable key: ${STRIPE_PUBLISHABLE_KEY || 'STRIPE_PUBLISHABLE_KEY not set'}`);
    }
  } else {
    log(`Subscription already exists: ${billing.stripeSubscriptionId}`);
  }

  printBillingStatus(instanceId, billing, tierConfig);
  return billing;
}

// ---------------------------------------------------------------------------
// CLI — Status check
// ---------------------------------------------------------------------------

function printBillingStatus(instanceId, billing, tierConfig) {
  if (!billing) {
    billing = loadBilling(instanceId);
  }
  if (!billing) {
    console.log(`\nNo billing record found for instance: ${instanceId}`);
    console.log(`Run with --activate to create a Stripe subscription.\n`);
    return;
  }

  if (!tierConfig) {
    tierConfig = TIERS[billing.tier] || {};
  }

  const enforcement = checkTierLimits(instanceId, billing);

  console.log('\n=== Your9 Billing Status ===');
  console.log(`Instance:         ${billing.instanceId}`);
  console.log(`Tier:             ${tierConfig.label || billing.tier} ($${tierConfig.priceMonthly || '?'}/mo)`);
  console.log(`Status:           ${billing.status.toUpperCase()}`);
  console.log(`Stripe Customer:  ${billing.stripeCustomerId || 'Not created'}`);
  console.log(`Stripe Sub:       ${billing.stripeSubscriptionId || 'Not created'}`);
  console.log(`Period Start:     ${billing.currentPeriodStart}`);
  console.log(`Period End:       ${billing.currentPeriodEnd}`);
  if (billing.gracePeriodEnd) {
    console.log(`Grace Period End: ${billing.gracePeriodEnd}`);
  }
  if (billing.cancelledAt) {
    console.log(`Cancelled At:     ${billing.cancelledAt}`);
  }
  console.log('');
  console.log('--- Usage (Current Period) ---');
  console.log(`API Calls:        ${billing.usage.apiCalls} / ${tierConfig.monthlyCallLimit === -1 ? 'unlimited' : tierConfig.monthlyCallLimit}`);
  console.log(`Tasks Completed:  ${billing.usage.tasksCompleted}`);
  console.log(`Active Agents:    ${billing.usage.activeAgents} / ${tierConfig.maxAgents || '?'}`);
  console.log('');
  console.log('--- Tier Limits ---');
  console.log(`Max Agents:       ${tierConfig.maxAgents || 'N/A'}`);
  console.log(`Call Limit/mo:    ${tierConfig.monthlyCallLimit === -1 ? 'Unlimited' : tierConfig.monthlyCallLimit}`);
  console.log(`Storage:          ${tierConfig.storageGB || 'N/A'} GB`);
  console.log('');

  if (!enforcement.ok) {
    console.log('--- Enforcement Issues ---');
    for (const issue of enforcement.issues) {
      console.log(`  ! ${issue}`);
    }
    console.log('');
  }

  if (billing.history?.length > 0) {
    console.log('--- Period History ---');
    for (const h of billing.history.slice(-3)) {
      console.log(`  ${h.period.slice(0, 7)}: ${h.apiCalls} calls, ${h.tasksCompleted} tasks`);
    }
    console.log('');
  }
}

// ---------------------------------------------------------------------------
// CLI — Usage report
// ---------------------------------------------------------------------------

function printUsageReport(instanceId) {
  logSection(`USAGE REPORT — ${instanceId}`);

  const config = loadInstanceConfig(instanceId);
  const billing = loadBilling(instanceId);

  if (!billing) {
    console.log(`No billing data found. Run --activate first.\n`);
    return;
  }

  const tierConfig = TIERS[billing.tier] || {};
  const callLimit = tierConfig.monthlyCallLimit;
  const callPct = callLimit === -1
    ? 'unlimited'
    : `${((billing.usage.apiCalls / callLimit) * 100).toFixed(1)}%`;

  console.log(`\n=== Your9 Usage Report ===`);
  console.log(`Instance:   ${config.name} (${instanceId})`);
  console.log(`Tier:       ${tierConfig.label} ($${tierConfig.priceMonthly}/mo)`);
  console.log(`Period:     ${billing.usage.periodStart?.slice(0, 10)} to ${billing.usage.periodEnd?.slice(0, 10)}`);
  console.log('');
  console.log(`API Calls:    ${billing.usage.apiCalls.toLocaleString()} (${callPct} of limit)`);
  console.log(`Tasks Done:   ${billing.usage.tasksCompleted.toLocaleString()}`);
  console.log(`Agents Live:  ${billing.usage.activeAgents} / ${tierConfig.maxAgents}`);
  console.log('');

  if (billing.history?.length > 0) {
    console.log('History (last 6 periods):');
    for (const h of billing.history.slice(-6)) {
      console.log(`  ${h.period.slice(0, 7)}: ${h.apiCalls} API calls, ${h.tasksCompleted} tasks`);
    }
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// CLI — List all instances with billing summary
// ---------------------------------------------------------------------------

function listAllBilling() {
  logSection('ALL INSTANCES — BILLING SUMMARY');

  if (!existsSync(INSTANCES_DIR)) {
    console.log('No instances directory found.\n');
    return;
  }

  const dirs = readdirSync(INSTANCES_DIR);
  if (dirs.length === 0) {
    console.log('No instances provisioned.\n');
    return;
  }

  console.log('');
  const rows = [];
  for (const dir of dirs) {
    const billing = loadBilling(dir);
    if (!billing) continue;

    // Check grace period expiry before reporting
    checkGracePeriodExpiry(dir);
    const refreshed = loadBilling(dir);

    const tierConfig = TIERS[refreshed.tier] || {};
    rows.push({
      id: dir.slice(0, 16) + '...',
      tier: tierConfig.label || refreshed.tier,
      status: refreshed.status,
      calls: refreshed.usage.apiCalls,
      limit: tierConfig.monthlyCallLimit === -1 ? 'unlim' : tierConfig.monthlyCallLimit,
      agents: `${refreshed.usage.activeAgents}/${tierConfig.maxAgents}`
    });
  }

  if (rows.length === 0) {
    console.log('No billing records found.\n');
    return;
  }

  const header = ['Instance', 'Tier', 'Status', 'Calls', 'Limit', 'Agents'].map(h => h.padEnd(14)).join('');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of rows) {
    console.log(
      r.id.padEnd(20) +
      r.tier.padEnd(14) +
      r.status.padEnd(14) +
      String(r.calls).padEnd(10) +
      String(r.limit).padEnd(10) +
      r.agents
    );
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      args[key] = (next && !next.startsWith('--')) ? argv[++i] : true;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  // --webhook: start webhook server
  if (args.webhook) {
    const port = parseInt(args.port || '4242', 10);
    startWebhookServer(port);
    return;
  }

  // --list: show all instances
  if (args.list) {
    listAllBilling();
    return;
  }

  // All other modes require --instance
  const instanceId = args.instance;
  if (!instanceId) {
    console.error('Usage:');
    console.error('  node scripts/your9-billing.mjs --instance <customer-id>            # Status');
    console.error('  node scripts/your9-billing.mjs --instance <customer-id> --activate # Create Stripe subscription');
    console.error('  node scripts/your9-billing.mjs --instance <customer-id> --usage    # Usage report');
    console.error('  node scripts/your9-billing.mjs --list                              # All instances');
    console.error('  node scripts/your9-billing.mjs --webhook [--port 4242]             # Webhook server');
    process.exit(1);
  }

  // Check grace period on every access
  checkGracePeriodExpiry(instanceId);

  // --activate: create Stripe subscription
  if (args.activate) {
    await activateSubscription(instanceId);
    return;
  }

  // --usage: usage report
  if (args.usage) {
    printUsageReport(instanceId);
    return;
  }

  // Default: status check
  logSection(`BILLING STATUS — ${instanceId}`);
  let billing = loadBilling(instanceId);
  if (!billing) {
    const config = loadInstanceConfig(instanceId);
    billing = initBilling(instanceId, config.tier?.toLowerCase() || 'starter');
    saveBilling(instanceId, billing);
    log(`Initialized billing record for ${instanceId}`);
  }
  const tierConfig = TIERS[billing.tier] || {};
  printBillingStatus(instanceId, billing, tierConfig);
}

// ---------------------------------------------------------------------------
// Exports — for use by other scripts (your9-provision.mjs, your9-go-live.mjs)
// ---------------------------------------------------------------------------

export {
  initBilling,
  loadBilling,
  saveBilling,
  recordUsage,
  enforceAgentCap,
  checkTierLimits,
  checkGracePeriodExpiry,
  TIERS,
  GRACE_PERIOD_DAYS
};

// Run CLI if invoked directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(`BILLING ERROR: ${err.message}`);
    log(`FATAL: ${err.message}`);
    process.exit(1);
  });
}
