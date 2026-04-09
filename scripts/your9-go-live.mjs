#!/usr/bin/env node
/**
 * your9-go-live.mjs — Go-Live Validation & Launch Script
 * Your9 by 9 Enterprises
 *
 * Runs the full E2E production readiness check for a specific customer instance.
 * This is the gate between "provisioned" and "live." Every check must pass
 * before a real customer gets their first message.
 *
 * Unlike your9-test-e2e.mjs (which tests a scratch-provisioned instance),
 * this script runs against a REAL instance with REAL credentials.
 * It verifies credentials are not placeholders, Telegram bot is responsive,
 * and the CEO system prompt is correctly tuned for the customer's industry.
 *
 * Usage:
 *   node scripts/your9-go-live.mjs --instance <customer-id>
 *   node scripts/your9-go-live.mjs --instance <customer-id> --dry-run
 *   node scripts/your9-go-live.mjs --instance <customer-id> --verbose
 *
 * Flags:
 *   --instance    Customer ID (required). Must exist in instances/ directory.
 *   --dry-run     Run all checks but do NOT send the Telegram ping test message.
 *   --verbose     Print detailed output for every check (default: summary only on pass).
 *   --json        Output final verdict as JSON to stdout (for CI pipelines).
 *
 * Exit codes:
 *   0 — GO: all checks passed. Instance is ready for first customer message.
 *   1 — NO-GO: one or more blocking checks failed. Do not launch.
 *   2 — WARN: all blocking checks passed, non-blocking issues found. Launch with caution.
 *
 * Checks are classified as:
 *   BLOCKING  — must pass for GO verdict. Failures prevent launch.
 *   WARNING   — should pass but won't block launch. Logged for review.
 *   INFO      — informational. Not pass/fail.
 */

import {
  existsSync, readFileSync, statSync, mkdirSync, appendFileSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { spawnSync } from 'child_process';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');
const GO_LIVE_LOG = join(ROOT, 'logs', 'your9-go-live.log');

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

const args = parseArgs(process.argv);

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function ensureLogDir() {
  const logDir = join(ROOT, 'logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
}

function logToFile(msg) {
  try {
    ensureLogDir();
    appendFileSync(GO_LIVE_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

const BLOCKING = 'BLOCKING';
const WARNING = 'WARNING';
const INFO = 'INFO';

const results = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  ${name}`);
  console.log('═'.repeat(64));
  logToFile(`\n=== ${name} ===`);
}

function pass(severity, name, detail = '') {
  const prefix = severity === BLOCKING ? '[BLOCK]' : severity === WARNING ? '[WARN ]' : '[INFO ]';
  const msg = detail ? `${name} — ${detail}` : name;
  if (args.verbose || severity !== INFO) {
    console.log(`  PASS  ${prefix} ${msg}`);
  }
  logToFile(`PASS ${prefix} ${name}${detail ? ' — ' + detail : ''}`);
  results.push({ section: currentSection, severity, name, status: 'pass', detail });
}

function fail(severity, name, detail = '') {
  const prefix = severity === BLOCKING ? '[BLOCK]' : severity === WARNING ? '[WARN ]' : '[INFO ]';
  const msg = detail ? `${name} — ${detail}` : name;
  console.log(`  FAIL  ${prefix} ${msg}`);
  logToFile(`FAIL ${prefix} ${name}${detail ? ' — ' + detail : ''}`);
  results.push({ section: currentSection, severity, name, status: 'fail', detail });
}

function info(msg) {
  console.log(`        ${msg}`);
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function fileExists(p) {
  return existsSync(p) && statSync(p).isFile();
}

function dirExists(p) {
  return existsSync(p) && statSync(p).isDirectory();
}

function readJSON(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function readText(p) {
  try {
    return readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// .env loader — same pattern as your9-hub.mjs
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
// HTTP helpers
// ---------------------------------------------------------------------------

function httpsGet(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ error: 'timeout' }), timeoutMs);
    try {
      const req = https.request(url, { method: 'GET' }, (res) => {
        clearTimeout(timer);
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(buf), raw: buf }); }
          catch { resolve({ status: res.statusCode, body: null, raw: buf }); }
        });
      });
      req.on('error', (e) => { clearTimeout(timer); resolve({ error: e.message }); });
      req.setTimeout(timeoutMs, () => { req.destroy(); clearTimeout(timer); resolve({ error: 'timeout' }); });
      req.end();
    } catch (e) {
      clearTimeout(timer);
      resolve({ error: e.message });
    }
  });
}

function httpsPost(url, payload, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const timer = setTimeout(() => resolve({ error: 'timeout' }), timeoutMs);
    try {
      const req = https.request(opts, (res) => {
        clearTimeout(timer);
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(buf), raw: buf }); }
          catch { resolve({ status: res.statusCode, body: null, raw: buf }); }
        });
      });
      req.on('error', (e) => { clearTimeout(timer); resolve({ error: e.message }); });
      req.setTimeout(timeoutMs, () => { req.destroy(); clearTimeout(timer); resolve({ error: 'timeout' }); });
      req.write(body);
      req.end();
    } catch (e) {
      clearTimeout(timer);
      resolve({ error: e.message });
    }
  });
}

// ---------------------------------------------------------------------------
// CHECK 1 — Instance exists and has required structure
// ---------------------------------------------------------------------------

async function checkInstanceStructure(instanceDir) {
  section('1. Instance Structure');

  if (!dirExists(instanceDir)) {
    fail(BLOCKING, 'Instance directory exists', instanceDir);
    return false;
  }
  pass(BLOCKING, 'Instance directory exists', instanceDir);

  const REQUIRED_SUBDIRS = ['config', 'data', 'logs', 'agents', 'comms', 'prompts'];
  let structureOk = true;
  for (const sub of REQUIRED_SUBDIRS) {
    const p = join(instanceDir, sub);
    if (dirExists(p)) {
      pass(BLOCKING, `Subdirectory: ${sub}/`);
    } else {
      fail(BLOCKING, `Subdirectory: ${sub}/`, `Missing: ${p}`);
      structureOk = false;
    }
  }

  const REQUIRED_FILES = [
    ['config/customer.json', BLOCKING],
    ['config/.env', BLOCKING],
    ['config/ceo.json', BLOCKING],
    ['prompts/ceo-system-prompt.md', BLOCKING],
    ['data/conversations.json', BLOCKING],
    ['data/tasks.json', BLOCKING],
    ['comms/telegram.json', BLOCKING],
    ['agents/executor/config.json', BLOCKING],
    ['agents/mind/config.json', BLOCKING],
    ['agents/voice/config.json', BLOCKING],
    ['agents/executor/system-prompt.md', WARNING],
    ['agents/mind/system-prompt.md', WARNING],
    ['agents/voice/system-prompt.md', WARNING],
  ];

  for (const [relPath, severity] of REQUIRED_FILES) {
    const p = join(instanceDir, relPath);
    if (fileExists(p)) {
      pass(severity, `File: ${relPath}`);
    } else {
      fail(severity, `File: ${relPath}`, `Missing: ${p}`);
      if (severity === BLOCKING) structureOk = false;
    }
  }

  return structureOk;
}

// ---------------------------------------------------------------------------
// CHECK 2 — Credentials: no PLACEHOLDERs, real values only
// ---------------------------------------------------------------------------

async function checkCredentials(instanceDir) {
  section('2. Credential Verification — No PLACEHOLDER Values');

  const envPath = join(instanceDir, 'config', '.env');
  const env = loadEnvFile(envPath);

  if (Object.keys(env).length === 0) {
    fail(BLOCKING, 'Instance .env is readable and has entries', envPath);
    return false;
  }
  pass(BLOCKING, 'Instance .env is readable', `${Object.keys(env).length} keys loaded`);

  // Define each required key and its expected format
  const REQUIRED_KEYS = [
    {
      key: 'ANTHROPIC_API_KEY',
      severity: BLOCKING,
      validate: (v) => v && !v.includes('PLACEHOLDER') && v.startsWith('sk-ant-'),
      hint: 'Must start with sk-ant-',
    },
    {
      key: 'TELEGRAM_BOT_TOKEN',
      severity: BLOCKING,
      validate: (v) => v && !v.includes('PLACEHOLDER') && /^\d+:[A-Za-z0-9_-]{35,}$/.test(v),
      hint: 'Must match Telegram bot token format: <numeric_id>:<token>',
    },
    {
      key: 'TELEGRAM_OWNER_CHAT_ID',
      severity: BLOCKING,
      validate: (v) => v && !v.includes('PLACEHOLDER') && /^-?\d+$/.test(v),
      hint: 'Must be a numeric Telegram chat ID',
    },
    {
      key: 'YOUR9_HUB_PORT',
      severity: BLOCKING,
      validate: (v) => v && !v.includes('PLACEHOLDER') && /^\d{4,5}$/.test(v),
      hint: 'Must be a 4-5 digit port number',
    },
    {
      key: 'YOUR9_INSTANCE_SECRET',
      severity: BLOCKING,
      validate: (v) => v && !v.includes('PLACEHOLDER') && v.length >= 20,
      hint: 'Must be a generated secret, not PLACEHOLDER',
    },
    {
      key: 'YOUR9_AGENT_SECRET',
      severity: BLOCKING,
      validate: (v) => v && !v.includes('PLACEHOLDER') && v.length >= 20,
      hint: 'Must be a generated secret, not PLACEHOLDER',
    },
    {
      key: 'YOUR9_CUSTOMER_ID',
      severity: BLOCKING,
      validate: (v) => v && !v.includes('PLACEHOLDER') && v.length > 0,
      hint: 'Must be the provisioned customer ID',
    },
    {
      key: 'YOUR9_TIER',
      severity: BLOCKING,
      validate: (v) => v && ['starter', 'growth', 'enterprise'].includes(v.toLowerCase()),
      hint: 'Must be starter, growth, or enterprise',
    },
    {
      key: 'YOUR9_CEO_MODEL',
      severity: BLOCKING,
      validate: (v) => v && !v.includes('PLACEHOLDER'),
      hint: 'Must be a valid Claude model ID',
    },
    {
      key: 'YOUR9_AGENT_MODEL',
      severity: BLOCKING,
      validate: (v) => v && !v.includes('PLACEHOLDER'),
      hint: 'Must be a valid Claude model ID',
    },
    {
      key: 'SUPABASE_URL',
      severity: WARNING,
      validate: (v) => v && !v.includes('PLACEHOLDER') && v.startsWith('https://'),
      hint: 'Should be a real Supabase project URL',
    },
    {
      key: 'SUPABASE_ANON_KEY',
      severity: WARNING,
      validate: (v) => v && !v.includes('PLACEHOLDER') && v.length > 30,
      hint: 'Should be a real Supabase anon key',
    },
  ];

  let credentialsOk = true;
  for (const { key, severity, validate, hint } of REQUIRED_KEYS) {
    const val = env[key];
    if (!val) {
      fail(severity, `Credential: ${key}`, `Key missing from .env — ${hint}`);
      if (severity === BLOCKING) credentialsOk = false;
    } else if (!validate(val)) {
      // Show masked value so we can debug without leaking the full secret
      const masked = val.length > 10
        ? val.slice(0, 4) + '...' + val.slice(-4)
        : '[short value]';
      fail(severity, `Credential: ${key}`, `Invalid format (got: ${masked}) — ${hint}`);
      if (severity === BLOCKING) credentialsOk = false;
    } else {
      const masked = val.length > 10
        ? val.slice(0, 4) + '...' + val.slice(-4)
        : '[ok]';
      pass(severity, `Credential: ${key}`, masked);
    }
  }

  // Scan entire .env for any remaining PLACEHOLDER_ strings
  const envRaw = readText(envPath) || '';
  const placeholderLines = envRaw.split('\n').filter(l =>
    !l.trim().startsWith('#') && l.includes('PLACEHOLDER')
  );
  if (placeholderLines.length === 0) {
    pass(BLOCKING, 'No PLACEHOLDER values remain in .env');
  } else {
    fail(BLOCKING, 'PLACEHOLDER values found in .env', `${placeholderLines.length} line(s) still contain PLACEHOLDER`);
    for (const line of placeholderLines.slice(0, 5)) {
      info(`  ${line.split('=')[0]}=PLACEHOLDER_...`);
    }
    credentialsOk = false;
  }

  return credentialsOk;
}

// ---------------------------------------------------------------------------
// CHECK 3 — Customer config: industry, personality, tier validated
// ---------------------------------------------------------------------------

async function checkCustomerConfig(instanceDir) {
  section('3. Customer Configuration');

  const configPath = join(instanceDir, 'config', 'customer.json');
  const config = readJSON(configPath);

  if (!config) {
    fail(BLOCKING, 'customer.json is valid JSON', configPath);
    return false;
  }
  pass(BLOCKING, 'customer.json is valid JSON');

  // Required fields
  const requiredFields = [
    'customerId', 'name', 'industry', 'personality', 'tier',
    'industryContext', 'personalityConfig', 'tierConfig', 'provisionedAt', 'status'
  ];
  let configOk = true;
  for (const field of requiredFields) {
    if (config[field] !== undefined && config[field] !== null) {
      pass(BLOCKING, `customer.json: ${field}`, String(config[field]).slice(0, 80));
    } else {
      fail(BLOCKING, `customer.json: ${field}`, 'Missing or null');
      configOk = false;
    }
  }

  // Status must be "active" — not "provisioning"
  if (config.status === 'active') {
    pass(BLOCKING, 'Customer status is "active"');
  } else {
    fail(BLOCKING, 'Customer status is "active"', `Got: "${config.status}" — run provisioner to complete setup`);
    configOk = false;
  }

  // Industry context must not be generic if customer is mortgage
  const industry = (config.industry || '').toLowerCase();
  const industryCtx = config.industryContext || {};
  if (industry === 'mortgage' || industry.includes('mortgage')) {
    const mortgageTerms = ['RESPA', 'TRID', 'HMDA', 'pull-through', 'cycle time', 'NMLS'];
    const hasTerms = mortgageTerms.some(t =>
      JSON.stringify(industryCtx).includes(t)
    );
    if (hasTerms) {
      pass(BLOCKING, 'Industry context contains mortgage-specific terms');
    } else {
      fail(BLOCKING, 'Industry context contains mortgage-specific terms',
        'industryContext does not reference RESPA/TRID/HMDA/pull-through/NMLS');
      configOk = false;
    }
  }

  // Personality must be one of the valid modes
  const validPersonalities = ['direct', 'warm', 'analytical', 'aggressive'];
  if (validPersonalities.includes(config.personality)) {
    pass(BLOCKING, 'Personality is valid', config.personality);
  } else {
    fail(BLOCKING, 'Personality is valid', `Got: "${config.personality}" — must be one of: ${validPersonalities.join(', ')}`);
    configOk = false;
  }

  // Tier must be valid
  const validTiers = ['starter', 'growth', 'enterprise'];
  if (validTiers.includes((config.tier || '').toLowerCase())) {
    pass(BLOCKING, 'Tier is valid', config.tier);
  } else {
    fail(BLOCKING, 'Tier is valid', `Got: "${config.tier}"`);
    configOk = false;
  }

  return configOk;
}

// ---------------------------------------------------------------------------
// CHECK 4 — CEO system prompt: mortgage-tuned, not generic, not broken
// ---------------------------------------------------------------------------

async function checkCeoSystemPrompt(instanceDir) {
  section('4. CEO System Prompt — Mortgage Industry Tuning');

  const promptPath = join(instanceDir, 'prompts', 'ceo-system-prompt.md');
  const prompt = readText(promptPath);

  if (!prompt) {
    fail(BLOCKING, 'CEO system prompt is readable', promptPath);
    return false;
  }
  pass(BLOCKING, 'CEO system prompt is readable', `${prompt.length} characters`);

  let promptOk = true;

  // Must contain Soul Code foundation
  const soulCodeMarkers = ['SOUL CODE', 'Soul Code', 'soul code'];
  if (soulCodeMarkers.some(m => prompt.includes(m))) {
    pass(BLOCKING, 'CEO prompt contains Soul Code foundation');
  } else {
    fail(BLOCKING, 'CEO prompt contains Soul Code foundation', 'Pattern "Soul Code" not found');
    promptOk = false;
  }

  // Must contain isolation constraint
  if (prompt.includes('You are NOT 9') || prompt.includes('HARD CONSTRAINT')) {
    pass(BLOCKING, 'CEO prompt contains identity isolation constraint');
  } else {
    fail(BLOCKING, 'CEO prompt contains identity isolation constraint',
      '"You are NOT 9" or HARD CONSTRAINT not found — CEO may impersonate parent system');
    promptOk = false;
  }

  // Must contain business name (not a generic template)
  const config = readJSON(join(instanceDir, 'config', 'customer.json'));
  const bizName = config && config.name;
  if (bizName && prompt.includes(bizName)) {
    pass(BLOCKING, 'CEO prompt references customer business name', bizName);
  } else {
    fail(BLOCKING, 'CEO prompt references customer business name',
      `"${bizName}" not found in prompt — prompt may be a generic template`);
    promptOk = false;
  }

  // Mortgage-specific terms — must be present
  const mortgageRequiredTerms = ['RESPA', 'NMLS', 'pull-through', 'cycle time'];
  for (const term of mortgageRequiredTerms) {
    if (prompt.includes(term)) {
      pass(BLOCKING, `CEO prompt contains mortgage term: "${term}"`);
    } else {
      fail(BLOCKING, `CEO prompt contains mortgage term: "${term}"`,
        'Missing from CEO prompt — industry context not injected');
      promptOk = false;
    }
  }

  // Rate quote constraint — must be present (compliance requirement)
  if (prompt.includes('rate') && (prompt.includes('approval') || prompt.includes('sign-off') || prompt.includes('never provide'))) {
    pass(BLOCKING, 'CEO prompt contains rate quote constraint');
  } else {
    fail(BLOCKING, 'CEO prompt contains rate quote constraint',
      'Rate quote approval constraint not found — compliance risk');
    promptOk = false;
  }

  // Personality must be embedded
  const personalityMarkers = ['Voice style', 'voice style', 'Preferred openings', 'PERSONALITY', 'personality'];
  if (personalityMarkers.some(m => prompt.includes(m))) {
    pass(BLOCKING, 'CEO prompt contains personality configuration');
  } else {
    fail(BLOCKING, 'CEO prompt contains personality configuration', 'Personality section not found');
    promptOk = false;
  }

  // Must NOT contain error placeholder text
  const errorPlaceholders = [
    'Soul Code base template not found',
    '{INDUSTRY}',
    '{BUSINESS_NAME}',
    '{PERSONALITY}',
    'PLACEHOLDER',
  ];
  for (const marker of errorPlaceholders) {
    if (prompt.includes(marker)) {
      fail(BLOCKING, `CEO prompt does not contain error placeholder: "${marker}"`,
        'Prompt template was not fully rendered');
      promptOk = false;
    }
  }
  if (!errorPlaceholders.some(m => prompt.includes(m))) {
    pass(BLOCKING, 'CEO prompt contains no unrendered placeholders or error text');
  }

  // Minimum length — a real system prompt should be substantial
  if (prompt.length >= 2000) {
    pass(BLOCKING, 'CEO prompt is substantial', `${prompt.length} chars (min: 2000)`);
  } else {
    fail(BLOCKING, 'CEO prompt is substantial',
      `Only ${prompt.length} chars — expected at least 2000 for a real industry-tuned prompt`);
    promptOk = false;
  }

  return promptOk;
}

// ---------------------------------------------------------------------------
// CHECK 5 — Agent configs: all three agents provisioned correctly
// ---------------------------------------------------------------------------

async function checkAgentConfigs(instanceDir) {
  section('5. Agent Configuration — Executor, Mind, Voice');

  const AGENTS = [
    { id: 'executor', name: 'The Executor', role: 'Operations' },
    { id: 'mind', name: 'The Mind', role: 'Research & Intel' },
    { id: 'voice', name: 'The Voice', role: 'Communications' },
  ];

  let agentsOk = true;

  for (const agent of AGENTS) {
    const agentDir = join(instanceDir, 'agents', agent.id);
    const configPath = join(agentDir, 'config.json');
    const promptPath = join(agentDir, 'system-prompt.md');

    if (!dirExists(agentDir)) {
      fail(BLOCKING, `${agent.name}: directory exists`, agentDir);
      agentsOk = false;
      continue;
    }

    const config = readJSON(configPath);
    if (!config) {
      fail(BLOCKING, `${agent.name}: config.json is valid JSON`, configPath);
      agentsOk = false;
      continue;
    }

    // Model must not be placeholder
    if (config.model && !config.model.includes('PLACEHOLDER')) {
      pass(BLOCKING, `${agent.name}: model is set`, config.model);
    } else {
      fail(BLOCKING, `${agent.name}: model is set`, `Got: "${config.model}"`);
      agentsOk = false;
    }

    // escalationTriggers must be a non-empty array
    if (Array.isArray(config.escalationTriggers) && config.escalationTriggers.length > 0) {
      pass(BLOCKING, `${agent.name}: escalation triggers defined`, `${config.escalationTriggers.length} triggers`);
    } else {
      fail(BLOCKING, `${agent.name}: escalation triggers defined`, 'Empty or missing escalationTriggers');
      agentsOk = false;
    }

    // System prompt check
    const prompt = readText(promptPath);
    if (!prompt) {
      fail(WARNING, `${agent.name}: system-prompt.md is readable`, promptPath);
      continue;
    }

    // Must contain agent name
    if (prompt.includes(agent.name)) {
      pass(WARNING, `${agent.name}: prompt contains agent name`);
    } else {
      fail(WARNING, `${agent.name}: prompt contains agent name`, `"${agent.name}" not found`);
    }

    // Must contain mortgage context
    if (prompt.includes('mortgage') || prompt.includes('Mortgage') || prompt.includes('RESPA')) {
      pass(WARNING, `${agent.name}: prompt contains industry context`);
    } else {
      fail(WARNING, `${agent.name}: prompt contains industry context`,
        'No mortgage-specific terms found in agent prompt');
    }

    // Must contain Soul Code rules
    if (prompt.includes('HARD RULES') || prompt.includes('Soul Code') || prompt.includes('soul code')) {
      pass(WARNING, `${agent.name}: prompt contains Soul Code hard rules`);
    } else {
      fail(WARNING, `${agent.name}: prompt contains Soul Code hard rules`);
    }
  }

  return agentsOk;
}

// ---------------------------------------------------------------------------
// CHECK 6 — Telegram bot is responsive (live API check)
// ---------------------------------------------------------------------------

async function checkTelegramBot(instanceDir) {
  section('6. Telegram Bot — Live API Verification');

  const envPath = join(instanceDir, 'config', '.env');
  const env = loadEnvFile(envPath);

  const botToken = env['TELEGRAM_BOT_TOKEN'];
  const chatId = env['TELEGRAM_OWNER_CHAT_ID'];

  if (!botToken || botToken.includes('PLACEHOLDER')) {
    fail(BLOCKING, 'Telegram bot token is available', 'PLACEHOLDER or missing — skipping live check');
    return false;
  }

  // Call getMe — confirms token is valid and bot exists
  const getMeUrl = `https://api.telegram.org/bot${botToken}/getMe`;
  info('Calling Telegram getMe...');
  const getMeRes = await httpsGet(getMeUrl, 10000);

  if (getMeRes.error) {
    fail(BLOCKING, 'Telegram getMe responds', `Network error: ${getMeRes.error}`);
    return false;
  }

  if (getMeRes.status !== 200 || !getMeRes.body || !getMeRes.body.ok) {
    fail(BLOCKING, 'Telegram getMe responds with ok:true',
      `HTTP ${getMeRes.status} — ${JSON.stringify(getMeRes.body).slice(0, 200)}`);
    return false;
  }

  const botInfo = getMeRes.body.result;
  pass(BLOCKING, 'Telegram getMe responds successfully',
    `Bot: @${botInfo.username} (id: ${botInfo.id})`);

  // Verify bot is not a generic test bot (username should be unique to this instance)
  if (botInfo.username && botInfo.username.toLowerCase().includes('test')) {
    fail(WARNING, 'Telegram bot is not a generic test bot',
      `Username @${botInfo.username} contains "test" — verify this is the correct production bot`);
  } else {
    pass(WARNING, 'Telegram bot username does not indicate test/placeholder');
  }

  // Send a test message to the owner chat (unless --dry-run)
  if (chatId && !chatId.includes('PLACEHOLDER')) {
    if (args['dry-run']) {
      info('--dry-run: Skipping live Telegram send test');
      pass(INFO, 'Telegram send test (skipped — dry-run mode)');
    } else {
      const sendUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const payload = {
        chat_id: parseInt(chatId, 10),
        text: 'Your9 Go-Live Check: Telegram connectivity verified. Your instance is online.',
        parse_mode: 'Markdown',
      };

      info('Sending Telegram connectivity test message...');
      const sendRes = await httpsPost(sendUrl, payload, 10000);

      if (sendRes.error) {
        fail(BLOCKING, 'Telegram test message sends successfully', `Network error: ${sendRes.error}`);
        return false;
      }

      if (sendRes.status === 200 && sendRes.body && sendRes.body.ok) {
        pass(BLOCKING, 'Telegram test message sends successfully',
          `Message ID: ${sendRes.body.result && sendRes.body.result.message_id}`);
      } else if (sendRes.status === 400) {
        fail(BLOCKING, 'Telegram test message sends successfully',
          `HTTP 400 — chat ID may be wrong (${chatId}). Body: ${JSON.stringify(sendRes.body).slice(0, 200)}`);
        return false;
      } else if (sendRes.status === 403) {
        fail(BLOCKING, 'Telegram test message sends successfully',
          'HTTP 403 — bot does not have access to this chat. Customer must start the bot first (/start).');
        return false;
      } else {
        fail(BLOCKING, 'Telegram test message sends successfully',
          `HTTP ${sendRes.status} — ${JSON.stringify(sendRes.body).slice(0, 200)}`);
        return false;
      }
    }
  } else {
    fail(WARNING, 'Telegram owner chat ID is set', 'PLACEHOLDER or missing — cannot send test message');
  }

  return true;
}

// ---------------------------------------------------------------------------
// CHECK 7 — Hub script syntax validation
// ---------------------------------------------------------------------------

async function checkHubScript() {
  section('7. Hub Script — Syntax Validation');

  const hubPath = join(__dirname, 'your9-hub.mjs');

  if (!fileExists(hubPath)) {
    fail(BLOCKING, 'your9-hub.mjs exists', hubPath);
    return false;
  }
  pass(BLOCKING, 'your9-hub.mjs exists');

  const result = spawnSync(process.execPath, ['--check', hubPath], {
    encoding: 'utf-8',
    timeout: 15000,
  });

  if (result.status === 0 && !result.error) {
    pass(BLOCKING, 'your9-hub.mjs passes syntax check');
  } else {
    const errMsg = result.stderr || result.error?.message || 'Unknown error';
    fail(BLOCKING, 'your9-hub.mjs passes syntax check', errMsg.slice(0, 300));
    return false;
  }

  // Also validate other YOUR9 scripts that the hub imports
  const IMPORTED_SCRIPTS = [
    'your9-agent-social.mjs',
    'your9-agent-voice-email.mjs',
    'your9-agent-mind-research.mjs',
  ];

  for (const script of IMPORTED_SCRIPTS) {
    const scriptPath = join(__dirname, script);
    if (!fileExists(scriptPath)) {
      fail(WARNING, `Imported script exists: ${script}`, scriptPath);
      continue;
    }
    const checkResult = spawnSync(process.execPath, ['--check', scriptPath], {
      encoding: 'utf-8',
      timeout: 10000,
    });
    if (checkResult.status === 0 && !checkResult.error) {
      pass(WARNING, `Imported script syntax ok: ${script}`);
    } else {
      fail(WARNING, `Imported script syntax ok: ${script}`,
        (checkResult.stderr || '').slice(0, 200));
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// CHECK 8 — Comms config: Telegram webhook config is correctly formed
// ---------------------------------------------------------------------------

async function checkCommsConfig(instanceDir) {
  section('8. Comms Configuration — Telegram');

  const telegramPath = join(instanceDir, 'comms', 'telegram.json');
  const tgConfig = readJSON(telegramPath);

  if (!tgConfig) {
    fail(BLOCKING, 'comms/telegram.json is valid JSON', telegramPath);
    return false;
  }
  pass(BLOCKING, 'comms/telegram.json is valid JSON');

  const REQUIRED_FIELDS = ['botToken', 'ownerChatId', 'parseMode', 'webhookPath', 'commands'];
  let commsOk = true;

  for (const field of REQUIRED_FIELDS) {
    if (tgConfig[field] !== undefined) {
      pass(BLOCKING, `telegram.json: ${field}`);
    } else {
      fail(BLOCKING, `telegram.json: ${field}`, 'Field missing');
      commsOk = false;
    }
  }

  // botToken in comms config must not be PLACEHOLDER
  if (tgConfig.botToken && !String(tgConfig.botToken).includes('PLACEHOLDER')) {
    pass(BLOCKING, 'telegram.json: botToken is not a placeholder');
  } else {
    fail(BLOCKING, 'telegram.json: botToken is not a placeholder',
      'PLACEHOLDER still present — comms config was not updated after provisioning');
    commsOk = false;
  }

  // ownerChatId must be numeric
  if (tgConfig.ownerChatId && /^-?\d+$/.test(String(tgConfig.ownerChatId))) {
    pass(BLOCKING, 'telegram.json: ownerChatId is numeric');
  } else {
    fail(BLOCKING, 'telegram.json: ownerChatId is numeric',
      `Got: "${tgConfig.ownerChatId}" — must be a numeric Telegram chat ID`);
    commsOk = false;
  }

  // commands array should be non-empty
  if (Array.isArray(tgConfig.commands) && tgConfig.commands.length > 0) {
    pass(BLOCKING, 'telegram.json: commands array is populated', `${tgConfig.commands.length} commands`);
  } else {
    fail(WARNING, 'telegram.json: commands array is populated', 'Empty or missing');
  }

  return commsOk;
}

// ---------------------------------------------------------------------------
// CHECK 9 — First-message file: day-one briefing is personalized
// ---------------------------------------------------------------------------

async function checkFirstMessage(instanceDir) {
  section('9. First-Day Briefing — Content Validation');

  const firstMsgPath = join(instanceDir, 'comms', 'first-message.txt');
  const msg = readText(firstMsgPath);

  if (!msg) {
    fail(WARNING, 'comms/first-message.txt exists and is readable', firstMsgPath);
    return;
  }
  pass(WARNING, 'comms/first-message.txt exists');

  const config = readJSON(join(instanceDir, 'config', 'customer.json'));
  const bizName = config && config.name;

  // Business name should be in the first message
  if (bizName && msg.includes(bizName)) {
    pass(WARNING, 'First-day message references customer business name', bizName);
  } else {
    fail(WARNING, 'First-day message references customer business name',
      `"${bizName}" not found — message may be a generic template`);
  }

  // Must not contain PLACEHOLDER
  if (msg.includes('PLACEHOLDER')) {
    fail(WARNING, 'First-day message contains no PLACEHOLDER text',
      'Unrendered placeholder found — template was not personalized');
  } else {
    pass(WARNING, 'First-day message contains no PLACEHOLDER text');
  }

  // Should contain mortgage context (for mortgage customers)
  if (config && config.industry === 'mortgage') {
    const mortgageWords = ['mortgage', 'loan', 'pipeline', 'referral', 'branch'];
    if (mortgageWords.some(w => msg.toLowerCase().includes(w))) {
      pass(WARNING, 'First-day message contains mortgage industry context');
    } else {
      fail(WARNING, 'First-day message contains mortgage industry context',
        'No mortgage/loan/pipeline terminology found — message feels generic');
    }
  }

  // Should not open with banned phrases
  const bannedOpenings = ["Certainly!", "Of course!", "I'd be happy to", "As an AI"];
  for (const phrase of bannedOpenings) {
    if (msg.includes(phrase)) {
      fail(WARNING, `First-day message does not use banned phrase: "${phrase}"`);
    }
  }
  if (!bannedOpenings.some(p => msg.includes(p))) {
    pass(WARNING, 'First-day message avoids banned AI phrases');
  }

  // Minimum length — too short means it wasn't generated properly
  if (msg.length >= 200) {
    pass(WARNING, 'First-day message has substance', `${msg.length} chars`);
  } else {
    fail(WARNING, 'First-day message has substance',
      `Only ${msg.length} chars — expected at least 200 for a personalized opening briefing`);
  }
}

// ---------------------------------------------------------------------------
// CHECK 10 — Anthropic API key is valid (live probe with minimal token spend)
// ---------------------------------------------------------------------------

async function checkAnthropicApiKey(instanceDir) {
  section('10. Anthropic API — Live Key Validation');

  const envPath = join(instanceDir, 'config', '.env');
  const env = loadEnvFile(envPath);
  const apiKey = env['ANTHROPIC_API_KEY'];

  if (!apiKey || apiKey.includes('PLACEHOLDER')) {
    fail(BLOCKING, 'Anthropic API key is available', 'PLACEHOLDER or missing — skipping live check');
    return false;
  }

  // Probe with minimal completion (1 token output max) to validate the key
  info('Probing Anthropic API with minimal test call...');
  const probeUrl = 'https://api.anthropic.com/v1/messages';
  const payload = {
    model: 'claude-haiku-4-5',
    max_tokens: 5,
    messages: [{ role: 'user', content: 'ok' }],
  };

  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const opts = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    };

    const timer = setTimeout(() => {
      fail(BLOCKING, 'Anthropic API responds within 10 seconds', 'Timeout');
      resolve(false);
    }, 10000);

    const req = https.request(opts, (res) => {
      clearTimeout(timer);
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => {
        const status = res.statusCode;
        if (status === 200) {
          pass(BLOCKING, 'Anthropic API key is valid and active', `HTTP ${status}`);
          resolve(true);
        } else if (status === 401) {
          fail(BLOCKING, 'Anthropic API key is valid and active',
            'HTTP 401 — key is invalid, expired, or unauthorized');
          resolve(false);
        } else if (status === 429) {
          fail(WARNING, 'Anthropic API key is valid and active',
            'HTTP 429 — rate limited. Key is valid but instance may need its own key for production load.');
          resolve(true); // Rate limit means key is valid
        } else if (status === 529) {
          fail(WARNING, 'Anthropic API responds normally',
            'HTTP 529 — Anthropic API is overloaded. Key appears valid but service is degraded.');
          resolve(true);
        } else {
          fail(BLOCKING, 'Anthropic API key is valid and active',
            `HTTP ${status} — unexpected response. Body: ${buf.slice(0, 200)}`);
          resolve(false);
        }
      });
    });

    req.on('error', (e) => {
      clearTimeout(timer);
      fail(BLOCKING, 'Anthropic API is reachable', `Network error: ${e.message}`);
      resolve(false);
    });

    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// VERDICT — Evaluate all results and output GO / NO-GO
// ---------------------------------------------------------------------------

function outputVerdict() {
  section('GO / NO-GO VERDICT');

  const blockingFails = results.filter(r => r.status === 'fail' && r.severity === BLOCKING);
  const warningFails = results.filter(r => r.status === 'fail' && r.severity === WARNING);
  const blockingPasses = results.filter(r => r.status === 'pass' && r.severity === BLOCKING);
  const totalChecks = results.length;

  console.log();
  console.log(`  Total checks run:   ${totalChecks}`);
  console.log(`  Blocking passes:    ${blockingPasses.length}`);
  console.log(`  Blocking failures:  ${blockingFails.length}`);
  console.log(`  Warnings:           ${warningFails.length}`);
  console.log();

  if (blockingFails.length > 0) {
    console.log('  ┌─────────────────────────────────────────────────────────┐');
    console.log('  │  NO-GO                                                    │');
    console.log('  │  Instance is NOT ready for first customer message.        │');
    console.log('  └─────────────────────────────────────────────────────────┘');
    console.log();
    console.log('  Blocking failures:');
    for (const r of blockingFails) {
      console.log(`    - [${r.section}] ${r.name}`);
      if (r.detail) console.log(`        ${r.detail}`);
    }
    if (warningFails.length > 0) {
      console.log();
      console.log('  Warnings (non-blocking):');
      for (const r of warningFails) {
        console.log(`    - [${r.section}] ${r.name}`);
      }
    }
    logToFile('VERDICT: NO-GO');
    if (args.json) {
      console.log('\n' + JSON.stringify({
        verdict: 'NO-GO',
        blockingFailures: blockingFails.length,
        warnings: warningFails.length,
        failures: blockingFails.map(r => ({ section: r.section, check: r.name, detail: r.detail })),
      }, null, 2));
    }
    return 1;
  }

  if (warningFails.length > 0) {
    console.log('  ┌─────────────────────────────────────────────────────────┐');
    console.log('  │  GO WITH CAUTION                                          │');
    console.log('  │  All blocking checks passed. Non-blocking issues found.   │');
    console.log('  │  Instance can launch but review warnings before Day 7.   │');
    console.log('  └─────────────────────────────────────────────────────────┘');
    console.log();
    console.log('  Warnings to review:');
    for (const r of warningFails) {
      console.log(`    - [${r.section}] ${r.name}`);
      if (r.detail) console.log(`        ${r.detail}`);
    }
    logToFile('VERDICT: GO WITH CAUTION');
    if (args.json) {
      console.log('\n' + JSON.stringify({
        verdict: 'GO_WITH_CAUTION',
        blockingFailures: 0,
        warnings: warningFails.length,
        warningDetails: warningFails.map(r => ({ section: r.section, check: r.name, detail: r.detail })),
      }, null, 2));
    }
    return 2;
  }

  console.log('  ┌─────────────────────────────────────────────────────────┐');
  console.log('  │  GO                                                       │');
  console.log('  │  All checks passed. Instance is ready to launch.         │');
  console.log('  │  Send Kyle his welcome message. The team is running.     │');
  console.log('  └─────────────────────────────────────────────────────────┘');
  logToFile('VERDICT: GO');
  if (args.json) {
    console.log('\n' + JSON.stringify({
      verdict: 'GO',
      blockingFailures: 0,
      warnings: 0,
      message: 'Instance is ready for first customer message.',
    }, null, 2));
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const instanceId = args.instance;

  if (!instanceId) {
    console.error('Error: --instance <customer-id> is required');
    console.error('Usage: node scripts/your9-go-live.mjs --instance <customer-id>');
    process.exit(1);
  }

  const instanceDir = join(INSTANCES_DIR, instanceId);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  YOUR9 GO-LIVE VALIDATION                                    ║');
  console.log('║  9 Enterprises — Production Launch Gate                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Instance ID:  ${instanceId}`);
  console.log(`  Instance dir: ${instanceDir}`);
  console.log(`  Dry run:      ${args['dry-run'] ? 'YES (no Telegram messages sent)' : 'NO (live checks)'}`);
  console.log(`  Timestamp:    ${new Date().toISOString()}`);
  console.log('');

  logToFile(`=== GO-LIVE CHECK START: instance=${instanceId} dry-run=${!!args['dry-run']} ===`);

  // Run all checks
  const structureOk = await checkInstanceStructure(instanceDir);

  // If structure is broken, many other checks will fail trivially — still run them all
  await checkCredentials(instanceDir);
  await checkCustomerConfig(instanceDir);
  await checkCeoSystemPrompt(instanceDir);
  await checkAgentConfigs(instanceDir);
  await checkCommsConfig(instanceDir);
  await checkFirstMessage(instanceDir);
  await checkHubScript();

  // Live checks — these make real network calls
  await checkTelegramBot(instanceDir);
  await checkAnthropicApiKey(instanceDir);

  // Verdict
  const exitCode = outputVerdict();

  logToFile(`=== GO-LIVE CHECK COMPLETE: exit=${exitCode} ===\n`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Fatal error in go-live script:', err);
  process.exit(1);
});
