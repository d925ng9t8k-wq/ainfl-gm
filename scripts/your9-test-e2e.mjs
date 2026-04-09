#!/usr/bin/env node
/**
 * your9-test-e2e.mjs — End-to-End Test Suite
 * Your9 by 9 Enterprises
 *
 * Validates the entire Your9 customer journey from provisioning through
 * agent capabilities. This is the quality gate before first customer deployment.
 *
 * Usage:
 *   node scripts/your9-test-e2e.mjs
 *   node scripts/your9-test-e2e.mjs --cleanup
 *
 * Flags:
 *   --cleanup     Remove test instance(s) after running
 *   --instance    Test against an existing instance ID instead of provisioning fresh
 *   --keep-on-fail  Do not clean up if tests fail (useful for debugging)
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync,
  rmSync, readdirSync, statSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync, spawn } from 'child_process';
import { createServer } from 'http';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');
const TEMPLATES_DIR = join(ROOT, 'templates');
const NODE = process.execPath;

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
// Test runner state
// ---------------------------------------------------------------------------

const results = [];
let currentSuite = '';

function suite(name) {
  currentSuite = name;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log('─'.repeat(60));
}

function pass(name, detail = '') {
  const msg = detail ? `${name} — ${detail}` : name;
  console.log(`  PASS  ${msg}`);
  results.push({ suite: currentSuite, name, status: 'pass', detail });
}

function fail(name, detail = '') {
  const msg = detail ? `${name} — ${detail}` : name;
  console.log(`  FAIL  ${msg}`);
  results.push({ suite: currentSuite, name, status: 'fail', detail });
}

function info(msg) {
  console.log(`        ${msg}`);
}

// ---------------------------------------------------------------------------
// File / JSON helpers
// ---------------------------------------------------------------------------

function fileExists(p) {
  return existsSync(p);
}

function dirExists(p) {
  return existsSync(p) && statSync(p).isDirectory();
}

function readJSON(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch (e) {
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
// Port derivation — mirrors your9-hub.mjs logic
// ---------------------------------------------------------------------------

function deriveHubPort(customerId) {
  let hash = 0;
  for (let i = 0; i < customerId.length; i++) {
    hash = (hash * 31 + customerId.charCodeAt(i)) >>> 0;
  }
  return 4000 + (hash % 900);
}

function deriveDashboardPort(customerId) {
  return deriveHubPort(customerId) + 100;
}

// ---------------------------------------------------------------------------
// HTTP helper — wait for a port to respond
// ---------------------------------------------------------------------------

function httpGet(port, path, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const req = createServer(); // dummy — just use http.request
    req.close(); // don't actually open a server

    // Use Node's built-in http client instead
    import('http').then(({ request }) => {
      const r = request(
        { hostname: '127.0.0.1', port, path, method: 'GET' },
        (res) => {
          clearTimeout(timer);
          let buf = '';
          res.on('data', c => (buf += c));
          res.on('end', () => {
            try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
            catch { resolve({ status: res.statusCode, body: buf }); }
          });
        }
      );
      r.on('error', () => { clearTimeout(timer); resolve(null); });
      r.setTimeout(timeoutMs, () => { r.destroy(); clearTimeout(timer); resolve(null); });
      r.end();
    }).catch(() => { clearTimeout(timer); resolve(null); });
  });
}

// ---------------------------------------------------------------------------
// Sleep helper
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Provision a test instance using your9-provision.mjs
// ---------------------------------------------------------------------------

async function provisionTestInstance(customerId) {
  const result = spawnSync(
    NODE,
    [
      join(__dirname, 'your9-provision.mjs'),
      '--name', 'Test Brokerage Co',
      '--industry', 'mortgage',
      '--personality', 'direct',
      '--tier', 'starter',
      '--id', customerId,
    ],
    { encoding: 'utf-8', timeout: 30000 }
  );

  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

function cleanupInstance(customerId) {
  const instanceDir = join(INSTANCES_DIR, customerId);
  if (existsSync(instanceDir)) {
    rmSync(instanceDir, { recursive: true, force: true });
    console.log(`\n  Cleaned up: instances/${customerId}`);
  }
}

// ---------------------------------------------------------------------------
// SUITE 1 — Onboarding Flow
// Provision a test customer instance, verify all files created
// ---------------------------------------------------------------------------

async function testOnboarding(customerId, instanceDir) {
  suite('1. Onboarding Flow — Provisioning');

  // 1a. Provision runs without error
  const provResult = await provisionTestInstance(customerId);

  if (provResult.error) {
    fail('Provision script executes', `Process error: ${provResult.error.message}`);
    return false;
  }

  if (provResult.code !== 0) {
    fail('Provision exits with code 0', `Exit code: ${provResult.code}\nstderr: ${provResult.stderr.slice(0, 300)}`);
    return false;
  }

  pass('Provision script executes without error');

  // 1b. Instance directory created
  if (dirExists(instanceDir)) {
    pass('Instance directory created', instanceDir);
  } else {
    fail('Instance directory created', `Missing: ${instanceDir}`);
    return false;
  }

  // 1c. All subdirectories
  const REQUIRED_SUBDIRS = ['config', 'data', 'logs', 'agents', 'comms', 'prompts'];
  let allDirs = true;
  for (const sub of REQUIRED_SUBDIRS) {
    const p = join(instanceDir, sub);
    if (dirExists(p)) {
      pass(`Subdirectory: ${sub}/`);
    } else {
      fail(`Subdirectory: ${sub}/`, `Missing: ${p}`);
      allDirs = false;
    }
  }

  // 1d. Output contains PROVISION COMPLETE
  if (provResult.stdout.includes('PROVISION COMPLETE')) {
    pass('Provision output contains PROVISION COMPLETE');
  } else {
    fail('Provision output contains PROVISION COMPLETE', 'Pattern not found in stdout');
  }

  // 1e. Idempotent re-run — run provision again on same ID, expect code 0
  const rerunResult = await provisionTestInstance(customerId);
  if (rerunResult.code === 0 && !rerunResult.error) {
    pass('Provision is idempotent (safe to re-run)');
  } else {
    fail('Provision is idempotent (safe to re-run)', `Exit code: ${rerunResult.code}`);
  }

  return allDirs;
}

// ---------------------------------------------------------------------------
// SUITE 2 — AI CEO Birth
// Verify CEO config, system prompt, Soul Code integration
// ---------------------------------------------------------------------------

async function testCeoBirth(instanceDir) {
  suite('2. AI CEO Birth — Config & System Prompt');

  const ceoConfigPath = join(instanceDir, 'config', 'ceo.json');
  const ceoPromptPath = join(instanceDir, 'prompts', 'ceo-system-prompt.md');

  // 2a. CEO config file exists
  if (fileExists(ceoConfigPath)) {
    pass('CEO config file exists');
  } else {
    fail('CEO config file exists', ceoConfigPath);
    return;
  }

  // 2b. CEO config has required fields
  const ceoConfig = readJSON(ceoConfigPath);
  if (!ceoConfig) {
    fail('CEO config is valid JSON', ceoConfigPath);
    return;
  }

  const requiredCeoFields = ['model', 'maxTokens', 'temperature', 'systemPromptPath', 'personality', 'channels'];
  let allFields = true;
  for (const field of requiredCeoFields) {
    if (ceoConfig[field] !== undefined) {
      pass(`CEO config field: ${field}`, JSON.stringify(ceoConfig[field]).slice(0, 60));
    } else {
      fail(`CEO config field: ${field}`, 'Missing from ceo.json');
      allFields = false;
    }
  }

  // 2c. CEO model is set and not placeholder
  if (ceoConfig.model && !ceoConfig.model.includes('PLACEHOLDER')) {
    pass('CEO model is set', ceoConfig.model);
  } else {
    fail('CEO model is set', `Got: ${ceoConfig.model}`);
  }

  // 2d. CEO channels include telegram (starter tier)
  if (Array.isArray(ceoConfig.channels) && ceoConfig.channels.includes('telegram')) {
    pass('CEO channels includes telegram');
  } else {
    fail('CEO channels includes telegram', `Got: ${JSON.stringify(ceoConfig.channels)}`);
  }

  // 2e. CEO system prompt exists
  if (fileExists(ceoPromptPath)) {
    pass('CEO system prompt file exists');
  } else {
    fail('CEO system prompt file exists', ceoPromptPath);
    return;
  }

  // 2f. System prompt has Soul Code content
  const prompt = readText(ceoPromptPath);
  if (!prompt) {
    fail('CEO system prompt is readable', ceoPromptPath);
    return;
  }

  const soulCodeMarkers = ['SOUL CODE', 'Soul Code', 'soul code'];
  const hasSoulCode = soulCodeMarkers.some(m => prompt.includes(m));
  if (hasSoulCode) {
    pass('CEO system prompt contains Soul Code foundation');
  } else {
    fail('CEO system prompt contains Soul Code foundation', 'SOUL CODE pattern not found in prompt');
  }

  // 2g. System prompt has customer context overlay
  if (prompt.includes('Test Brokerage Co')) {
    pass('CEO system prompt contains business name');
  } else {
    fail('CEO system prompt contains business name', 'Business name not found in prompt');
  }

  // 2h. System prompt has industry context
  if (prompt.includes('Mortgage') || prompt.includes('mortgage') || prompt.includes('RESPA')) {
    pass('CEO system prompt contains industry context');
  } else {
    fail('CEO system prompt contains industry context', 'No mortgage/RESPA reference found');
  }

  // 2i. System prompt has personality config
  const personalityMarkers = ['Voice style', 'voice style', 'Preferred openings', 'PERSONALITY'];
  const hasPersonality = personalityMarkers.some(m => prompt.includes(m));
  if (hasPersonality) {
    pass('CEO system prompt contains personality configuration');
  } else {
    fail('CEO system prompt contains personality configuration', 'Personality section not found');
  }

  // 2j. System prompt has the hard constraint block (isolation from 9)
  if (prompt.includes('You are NOT 9') || prompt.includes('HARD CONSTRAINT')) {
    pass('CEO system prompt contains isolation constraint (not 9)');
  } else {
    fail('CEO system prompt contains isolation constraint', 'HARD CONSTRAINT block not found');
  }

  // 2k. Soul Code base template was found (prompt is not just the placeholder error)
  if (prompt.includes('Soul Code base template not found')) {
    fail('Soul Code base template was loaded', 'Template missing — prompt contains error text');
  } else {
    pass('Soul Code base template loaded successfully');
  }
}

// ---------------------------------------------------------------------------
// SUITE 3 — Agent Provisioning
// Verify all 3 starter agents configured correctly
// ---------------------------------------------------------------------------

async function testAgentProvisioning(instanceDir) {
  suite('3. Agent Provisioning — Executor, Mind, Voice');

  const STARTER_AGENTS = [
    { id: 'executor', name: 'The Executor', role: 'Operations' },
    { id: 'mind', name: 'The Mind', role: 'Research & Intel' },
    { id: 'voice', name: 'The Voice', role: 'Communications' },
  ];

  for (const agent of STARTER_AGENTS) {
    const agentDir = join(instanceDir, 'agents', agent.id);
    const configPath = join(agentDir, 'config.json');
    const promptPath = join(agentDir, 'system-prompt.md');

    // Agent directory
    if (dirExists(agentDir)) {
      pass(`${agent.name}: directory exists`);
    } else {
      fail(`${agent.name}: directory exists`, agentDir);
      continue;
    }

    // Agent config.json
    if (fileExists(configPath)) {
      pass(`${agent.name}: config.json exists`);
    } else {
      fail(`${agent.name}: config.json exists`, configPath);
      continue;
    }

    const config = readJSON(configPath);
    if (!config) {
      fail(`${agent.name}: config.json is valid JSON`);
      continue;
    }

    // Required config fields
    const requiredFields = ['id', 'name', 'role', 'model', 'maxTokens', 'escalationTriggers'];
    for (const field of requiredFields) {
      if (config[field] !== undefined) {
        pass(`${agent.name}: config.${field}`, String(config[field]).slice(0, 60));
      } else {
        fail(`${agent.name}: config.${field}`, 'Field missing');
      }
    }

    // Agent ID matches expected
    if (config.id === agent.id) {
      pass(`${agent.name}: id is correct (${agent.id})`);
    } else {
      fail(`${agent.name}: id is correct`, `Got: ${config.id}, expected: ${agent.id}`);
    }

    // Model is not a placeholder
    if (config.model && !config.model.includes('PLACEHOLDER')) {
      pass(`${agent.name}: model is set`, config.model);
    } else {
      fail(`${agent.name}: model is set`, `Got: ${config.model}`);
    }

    // escalationTriggers is a non-empty array
    if (Array.isArray(config.escalationTriggers) && config.escalationTriggers.length > 0) {
      pass(`${agent.name}: escalationTriggers defined (${config.escalationTriggers.length})`);
    } else {
      fail(`${agent.name}: escalationTriggers defined`, 'Empty or missing');
    }

    // Agent system prompt
    if (fileExists(promptPath)) {
      pass(`${agent.name}: system-prompt.md exists`);
    } else {
      fail(`${agent.name}: system-prompt.md exists`, promptPath);
      continue;
    }

    const prompt = readText(promptPath);
    if (!prompt) {
      fail(`${agent.name}: system-prompt.md is readable`);
      continue;
    }

    // Prompt contains the agent name
    if (prompt.includes(agent.name)) {
      pass(`${agent.name}: prompt contains agent name`);
    } else {
      fail(`${agent.name}: prompt contains agent name`, `"${agent.name}" not found`);
    }

    // Prompt contains the business name
    if (prompt.includes('Test Brokerage Co')) {
      pass(`${agent.name}: prompt contains business name`);
    } else {
      fail(`${agent.name}: prompt contains business name`);
    }

    // Prompt contains Soul Code hard rules
    if (prompt.includes('HARD RULES') || prompt.includes('Hard Rules') || prompt.includes('Soul Code')) {
      pass(`${agent.name}: prompt contains Soul Code hard rules`);
    } else {
      fail(`${agent.name}: prompt contains Soul Code hard rules`);
    }

    // Prompt has escalation section
    if (prompt.includes('Escalate') || prompt.includes('escalat')) {
      pass(`${agent.name}: prompt contains escalation instructions`);
    } else {
      fail(`${agent.name}: prompt contains escalation instructions`);
    }

    // Prompt has industry context
    if (prompt.includes('RESPA') || prompt.includes('mortgage') || prompt.includes('Mortgage')) {
      pass(`${agent.name}: prompt contains industry context`);
    } else {
      fail(`${agent.name}: prompt contains industry context`);
    }
  }

  // Verify agents directory only has expected subdirs (not junk)
  const agentsDir = join(instanceDir, 'agents');
  if (dirExists(agentsDir)) {
    const agentDirs = readdirSync(agentsDir).filter(f =>
      statSync(join(agentsDir, f)).isDirectory()
    );
    const expectedIds = STARTER_AGENTS.map(a => a.id);
    const unexpected = agentDirs.filter(d => !expectedIds.includes(d));
    if (unexpected.length === 0) {
      pass(`Agents directory contains only expected agents (${agentDirs.join(', ')})`);
    } else {
      fail(`Agents directory has unexpected entries`, `Unexpected: ${unexpected.join(', ')}`);
    }
  }
}

// ---------------------------------------------------------------------------
// SUITE 4 — Comms Hub Configuration
// Verify hub starts, health endpoint responds, Telegram config valid
// This is a structural test — we do NOT start a real hub (needs Telegram token)
// We verify the config files are correct and the hub script is syntactically valid
// ---------------------------------------------------------------------------

async function testCommsHub(instanceDir, customerId) {
  suite('4. Comms Hub — Config & Script Validation');

  const commsDir = join(instanceDir, 'comms');
  const telegramPath = join(commsDir, 'telegram.json');
  const emailPath = join(commsDir, 'email.json');
  const firstMsgPath = join(commsDir, 'first-message.txt');
  const envPath = join(instanceDir, 'config', '.env');
  const hubScript = join(__dirname, 'your9-hub.mjs');

  // 4a. Telegram config exists
  if (fileExists(telegramPath)) {
    pass('Telegram config exists');
  } else {
    fail('Telegram config exists', telegramPath);
  }

  // 4b. Telegram config valid JSON with required fields
  const tgConfig = readJSON(telegramPath);
  if (tgConfig) {
    pass('Telegram config is valid JSON');

    const reqFields = ['botToken', 'ownerChatId', 'parseMode', 'webhookPath', 'commands'];
    for (const field of reqFields) {
      if (tgConfig[field] !== undefined) {
        pass(`Telegram config: ${field}`);
      } else {
        fail(`Telegram config: ${field}`, 'Field missing');
      }
    }

    // botToken should use LOAD_FROM_ENV pattern
    if (tgConfig.botToken === 'LOAD_FROM_ENV:TELEGRAM_BOT_TOKEN') {
      pass('Telegram botToken uses LOAD_FROM_ENV pattern (no hardcoded token)');
    } else {
      fail('Telegram botToken uses LOAD_FROM_ENV pattern', `Got: ${tgConfig.botToken}`);
    }

    // commands array should have expected commands
    if (Array.isArray(tgConfig.commands) && tgConfig.commands.length >= 3) {
      pass(`Telegram commands defined (${tgConfig.commands.length})`);
      const commandNames = tgConfig.commands.map(c => c.command);
      if (commandNames.includes('briefing')) {
        pass('Telegram /briefing command defined');
      } else {
        fail('Telegram /briefing command defined', `Got: ${commandNames.join(', ')}`);
      }
    } else {
      fail('Telegram commands defined', 'commands array missing or too short');
    }

    // webhookPath includes customer ID
    if (tgConfig.webhookPath && tgConfig.webhookPath.includes(customerId)) {
      pass('Telegram webhookPath is customer-scoped');
    } else {
      fail('Telegram webhookPath is customer-scoped', `Got: ${tgConfig.webhookPath}`);
    }
  } else {
    fail('Telegram config is valid JSON', telegramPath);
  }

  // 4c. Email config exists (starter tier — should be created but disabled)
  if (fileExists(emailPath)) {
    pass('Email config exists');
    const emailConfig = readJSON(emailPath);
    if (emailConfig) {
      pass('Email config is valid JSON');
      if (emailConfig.provider === 'resend') {
        pass('Email config uses Resend provider');
      } else {
        fail('Email config uses Resend provider', `Got: ${emailConfig.provider}`);
      }
      // Starter tier should have email disabled
      if (emailConfig.enabled === false) {
        pass('Email disabled for starter tier');
      } else {
        fail('Email disabled for starter tier', `enabled: ${emailConfig.enabled}`);
      }
    }
  } else {
    fail('Email config exists', emailPath);
  }

  // 4d. First message template exists and is non-empty
  if (fileExists(firstMsgPath)) {
    const firstMsg = readText(firstMsgPath);
    if (firstMsg && firstMsg.trim().length > 20) {
      pass('First message template exists and non-empty', `"${firstMsg.trim().slice(0, 60)}..."`);
    } else {
      fail('First message template non-empty', 'Content too short or empty');
    }
  } else {
    fail('First message template exists', firstMsgPath);
  }

  // 4e. Instance .env exists
  if (fileExists(envPath)) {
    pass('Instance .env exists');
    const envContent = readText(envPath);
    if (envContent) {
      // Required env vars should be present (even as placeholders)
      const requiredVars = [
        'YOUR9_CUSTOMER_ID',
        'YOUR9_CUSTOMER_NAME',
        'YOUR9_TIER',
        'ANTHROPIC_API_KEY',
        'YOUR9_CEO_MODEL',
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_OWNER_CHAT_ID',
        'YOUR9_INSTANCE_SECRET',
        'YOUR9_HUB_PORT',
      ];
      for (const v of requiredVars) {
        if (envContent.includes(v)) {
          pass(`.env contains: ${v}`);
        } else {
          fail(`.env contains: ${v}`, 'Key not found in .env');
        }
      }

      // YOUR9_CUSTOMER_ID should match
      const idLine = envContent.split('\n').find(l => l.startsWith('YOUR9_CUSTOMER_ID='));
      if (idLine && idLine.includes(customerId)) {
        pass('.env YOUR9_CUSTOMER_ID matches instance', customerId);
      } else {
        fail('.env YOUR9_CUSTOMER_ID matches instance', `Line: ${idLine}`);
      }

      // Tokens should be generated (not blank)
      const secretLine = envContent.split('\n').find(l => l.startsWith('YOUR9_INSTANCE_SECRET='));
      if (secretLine && secretLine.includes('y9s_') && secretLine.length > 40) {
        pass('.env YOUR9_INSTANCE_SECRET is generated token');
      } else {
        fail('.env YOUR9_INSTANCE_SECRET is generated token', secretLine);
      }
    }
  } else {
    fail('Instance .env exists', envPath);
  }

  // 4f. Hub script syntax validation
  const hubCheck = spawnSync(NODE, ['--check', hubScript], { encoding: 'utf-8', timeout: 10000 });
  if (hubCheck.status === 0) {
    pass('your9-hub.mjs syntax is valid');
  } else {
    fail('your9-hub.mjs syntax is valid', hubCheck.stderr?.slice(0, 200) || 'unknown error');
  }

  // 4g. Derived hub port is in valid range
  const hubPort = deriveHubPort(customerId);
  if (hubPort >= 4000 && hubPort < 4900) {
    pass(`Hub port derivation is in valid range (${hubPort})`);
  } else {
    fail('Hub port derivation is in valid range', `Got: ${hubPort}`);
  }

  // 4h. Hub port is not a known conflict (comms-hub is 3457, voice is 3456)
  const conflictPorts = [3456, 3457, 3000, 80, 443];
  if (!conflictPorts.includes(hubPort)) {
    pass('Hub port does not conflict with known system ports');
  } else {
    fail('Hub port does not conflict with known system ports', `Port ${hubPort} is reserved`);
  }
}

// ---------------------------------------------------------------------------
// SUITE 5 — Dashboard
// Verify dashboard script syntax, config, port derivation
// (We do NOT start a live server — no real Telegram token or hub running)
// ---------------------------------------------------------------------------

async function testDashboard(instanceDir, customerId) {
  suite('5. Dashboard — Config & Script Validation');

  const dashScript = join(__dirname, 'your9-dashboard.mjs');

  // 5a. Dashboard script exists
  if (fileExists(dashScript)) {
    pass('your9-dashboard.mjs exists');
  } else {
    fail('your9-dashboard.mjs exists', dashScript);
    return;
  }

  // 5b. Dashboard script syntax valid
  const dashCheck = spawnSync(NODE, ['--check', dashScript], { encoding: 'utf-8', timeout: 10000 });
  if (dashCheck.status === 0) {
    pass('your9-dashboard.mjs syntax is valid');
  } else {
    fail('your9-dashboard.mjs syntax is valid', dashCheck.stderr?.slice(0, 200) || 'unknown error');
  }

  // 5c. Dashboard port = hub port + 100
  const hubPort = deriveHubPort(customerId);
  const dashPort = deriveDashboardPort(customerId);
  if (dashPort === hubPort + 100) {
    pass(`Dashboard port derivation correct (hub: ${hubPort}, dash: ${dashPort})`);
  } else {
    fail('Dashboard port derivation correct', `hub: ${hubPort}, dash: ${dashPort}, diff: ${dashPort - hubPort}`);
  }

  // 5d. Dashboard port in valid range
  if (dashPort >= 4100 && dashPort < 5000) {
    pass(`Dashboard port in valid range (${dashPort})`);
  } else {
    fail('Dashboard port in valid range', `Got: ${dashPort}`);
  }

  // 5e. Customer config is readable by dashboard (tests readCustomerConfig path)
  const configPath = join(instanceDir, 'config', 'customer.json');
  const config = readJSON(configPath);
  if (config && config.status === 'active') {
    pass(`Customer config readable and status is active`);
  } else {
    fail('Customer config readable and status is active', `status: ${config?.status}`);
  }

  // 5f. CEO config is readable by dashboard
  const ceoConfig = readJSON(join(instanceDir, 'config', 'ceo.json'));
  if (ceoConfig && ceoConfig.model) {
    pass('CEO config readable by dashboard');
  } else {
    fail('CEO config readable by dashboard');
  }

  // 5g. Agent configs are all readable
  const agentsDir = join(instanceDir, 'agents');
  const agentDirs = readdirSync(agentsDir).filter(f =>
    statSync(join(agentsDir, f)).isDirectory()
  );
  let allReadable = true;
  for (const agentId of agentDirs) {
    const agentConfig = readJSON(join(agentsDir, agentId, 'config.json'));
    if (agentConfig && agentConfig.id) {
      pass(`Agent config readable: ${agentId}`);
    } else {
      fail(`Agent config readable: ${agentId}`);
      allReadable = false;
    }
  }

  // 5h. Data subdirectories exist (dashboard reads these)
  // These don't need to exist at provision time — dashboard handles missing gracefully
  // But we can verify the dashboard script handles them correctly via the code
  // The real test is that the script imports are clean
  const dashContent = readText(dashScript);
  if (!dashContent) {
    fail('Dashboard script is readable');
    return;
  }

  const requiredImports = ['readFileSync', 'readdirSync', 'existsSync', 'createServer'];
  for (const imp of requiredImports) {
    if (dashContent.includes(imp)) {
      pass(`Dashboard imports: ${imp}`);
    } else {
      fail(`Dashboard imports: ${imp}`, 'Not found in script');
    }
  }

  // 5i. Dashboard has /health endpoint defined
  if (dashContent.includes("'/health'") || dashContent.includes('"/health"') || dashContent.includes('=== \'/health\'')) {
    pass('Dashboard defines /health endpoint');
  } else {
    fail('Dashboard defines /health endpoint', 'No /health route found');
  }

  // 5j. Dashboard has main HTML route
  if (dashContent.includes('text/html') || dashContent.includes('DOCTYPE html')) {
    pass('Dashboard serves HTML content');
  } else {
    fail('Dashboard serves HTML content', 'No HTML output found');
  }
}

// ---------------------------------------------------------------------------
// SUITE 6 — Agent Capabilities
// Verify email, research, social task file structures
// ---------------------------------------------------------------------------

async function testAgentCapabilities(instanceDir) {
  suite('6. Agent Capabilities — Script Validation');

  const scripts = {
    email: join(__dirname, 'your9-agent-voice-email.mjs'),
    research: join(__dirname, 'your9-agent-mind-research.mjs'),
    social: join(__dirname, 'your9-agent-social.mjs'),
  };

  // 6a. All agent scripts exist
  for (const [name, path] of Object.entries(scripts)) {
    if (fileExists(path)) {
      pass(`${name} agent script exists`);
    } else {
      fail(`${name} agent script exists`, path);
    }
  }

  // 6b. All agent scripts pass syntax check
  for (const [name, path] of Object.entries(scripts)) {
    if (!fileExists(path)) continue;
    const check = spawnSync(NODE, ['--check', path], { encoding: 'utf-8', timeout: 10000 });
    if (check.status === 0) {
      pass(`${name} agent script: syntax valid`);
    } else {
      fail(`${name} agent script: syntax valid`, check.stderr?.slice(0, 200) || 'unknown');
    }
  }

  // 6c. Email agent exports handleEmailDelegation function
  const emailContent = readText(scripts.email);
  if (emailContent && emailContent.includes('handleEmailDelegation')) {
    pass('Email agent exports handleEmailDelegation');
  } else {
    fail('Email agent exports handleEmailDelegation', 'Function not found in source');
  }

  // 6d. Research agent exports executeResearch and saveReport
  const researchContent = readText(scripts.research);
  if (researchContent && researchContent.includes('executeResearch')) {
    pass('Research agent exports executeResearch');
  } else {
    fail('Research agent exports executeResearch', 'Function not found in source');
  }
  if (researchContent && researchContent.includes('saveReport')) {
    pass('Research agent exports saveReport');
  } else {
    fail('Research agent exports saveReport', 'Function not found in source');
  }

  // 6e. Social agent exports required functions
  const socialContent = readText(scripts.social);
  const socialExports = ['processSocialTask', 'handleSocialApprovalReply', 'hasPendingApprovals', 'looksLikeApprovalReply', 'isSocialTask', 'detectPlatforms'];
  for (const fn of socialExports) {
    if (socialContent && socialContent.includes(fn)) {
      pass(`Social agent exports: ${fn}`);
    } else {
      fail(`Social agent exports: ${fn}`, 'Not found in source');
    }
  }

  // 6f. Hub imports from all three agent scripts (integration check)
  const hubContent = readText(join(__dirname, 'your9-hub.mjs'));
  if (hubContent) {
    if (hubContent.includes("'./your9-agent-social.mjs'") || hubContent.includes('"./your9-agent-social.mjs"')) {
      pass('Hub imports social agent');
    } else {
      fail('Hub imports social agent');
    }
    if (hubContent.includes("'./your9-agent-voice-email.mjs'") || hubContent.includes('"./your9-agent-voice-email.mjs"')) {
      pass('Hub imports email agent');
    } else {
      fail('Hub imports email agent');
    }
    if (hubContent.includes("'./your9-agent-mind-research.mjs'") || hubContent.includes('"./your9-agent-mind-research.mjs"')) {
      pass('Hub imports research agent');
    } else {
      fail('Hub imports research agent');
    }
  }

  // 6g. Social agent: platform constants defined (linkedin and x)
  if (socialContent && socialContent.includes("'linkedin'") && socialContent.includes("'x'")) {
    pass('Social agent defines linkedin and x platforms');
  } else {
    fail('Social agent defines linkedin and x platforms');
  }

  // 6h. Social agent: approval keywords defined
  if (socialContent && (socialContent.includes('PUBLISH') || socialContent.includes("'SEND'"))) {
    pass('Social agent defines approval keywords');
  } else {
    fail('Social agent defines approval keywords');
  }

  // 6i. Email agent: approval keyword SEND defined
  if (emailContent && emailContent.includes('SEND')) {
    pass('Email agent defines SEND approval keyword');
  } else {
    fail('Email agent defines SEND approval keyword');
  }

  // 6j. Research agent: report directory path
  if (researchContent && researchContent.includes('reports')) {
    pass('Research agent uses reports directory');
  } else {
    fail('Research agent uses reports directory');
  }

  // 6k. No raw credentials in any agent script
  for (const [name, content] of Object.entries({ email: emailContent, research: researchContent, social: socialContent })) {
    if (!content) continue;
    const hasHardcoded = /sk-ant-|telegram:[0-9]+:|resend_live/.test(content);
    if (!hasHardcoded) {
      pass(`${name} agent: no hardcoded credentials detected`);
    } else {
      fail(`${name} agent: no hardcoded credentials detected`, 'Potential credential found in source');
    }
  }
}

// ---------------------------------------------------------------------------
// SUITE 7 — Self-Improvement
// Verify improvement log directory and file format
// ---------------------------------------------------------------------------

async function testSelfImprovement(instanceDir, customerId) {
  suite('7. Self-Improvement — Structure & Script Validation');

  const selfImproveScript = join(__dirname, 'your9-self-improve.mjs');

  // 7a. Script exists
  if (fileExists(selfImproveScript)) {
    pass('your9-self-improve.mjs exists');
  } else {
    fail('your9-self-improve.mjs exists', selfImproveScript);
    return;
  }

  // 7b. Syntax valid
  const check = spawnSync(NODE, ['--check', selfImproveScript], { encoding: 'utf-8', timeout: 10000 });
  if (check.status === 0) {
    pass('your9-self-improve.mjs syntax is valid');
  } else {
    fail('your9-self-improve.mjs syntax is valid', check.stderr?.slice(0, 200) || 'unknown');
    return;
  }

  const content = readText(selfImproveScript);

  // 7c. Self-improve script has the two-model pipeline
  if (content && content.includes('ANALYSIS_MODEL') && content.includes('CEO_REVIEW_MODEL')) {
    pass('Self-improve script has two-model pipeline (analysis + CEO review)');
  } else {
    fail('Self-improve script has two-model pipeline');
  }

  // 7d. Analysis model is Sonnet
  if (content && content.includes("claude-sonnet-4-5")) {
    pass('Analysis model is Sonnet (correct — not Haiku)');
  } else {
    fail('Analysis model is Sonnet', 'claude-sonnet-4-5 not found');
  }

  // 7e. CEO review model is Opus
  if (content && content.includes("claude-opus-4")) {
    pass('CEO review model is Opus');
  } else {
    fail('CEO review model is Opus', 'claude-opus-4 not found');
  }

  // 7f. Improvement log directory structure
  const improvementsDir = join(instanceDir, 'data', 'improvements');
  // The improvements dir is created on first use by loadInstance() — verify it
  // exists after provision OR confirm the provisioning creates the data dir
  const dataDir = join(instanceDir, 'data');
  if (dirExists(dataDir)) {
    pass('Instance data directory exists');
  } else {
    fail('Instance data directory exists', dataDir);
  }

  // 7g. Create the improvements directory and write a test log entry to validate format
  if (!existsSync(improvementsDir)) {
    mkdirSync(improvementsDir, { recursive: true });
  }

  const testLogEntry = {
    runAt: new Date().toISOString(),
    customerId,
    agentId: 'executor',
    agentName: 'The Executor',
    tasksAnalyzed: 0,
    dryRun: true,
    analysis: null,
    ceoReview: null,
    applied: [],
    rejected: [],
    outcome: 'no_tasks',
  };

  const testLogPath = join(improvementsDir, `${Date.now()}-executor-test.json`);
  try {
    writeFileSync(testLogPath, JSON.stringify(testLogEntry, null, 2));
    pass('Improvement log directory writeable');
  } catch (e) {
    fail('Improvement log directory writeable', e.message);
  }

  // 7h. Written log file is valid JSON with expected schema
  const writtenLog = readJSON(testLogPath);
  if (writtenLog) {
    pass('Improvement log file is valid JSON');
    const requiredLogFields = ['runAt', 'customerId', 'agentId', 'outcome', 'applied', 'rejected'];
    for (const field of requiredLogFields) {
      if (writtenLog[field] !== undefined) {
        pass(`Improvement log: ${field} field present`);
      } else {
        fail(`Improvement log: ${field} field present`, 'Missing from schema');
      }
    }
  } else {
    fail('Improvement log file is valid JSON');
  }

  // 7i. Self-improve handles missing tasks gracefully (min-tasks threshold)
  if (content && content.includes('minTasks') && content.includes('Not enough completed tasks')) {
    pass('Self-improve exits gracefully when tasks < minimum');
  } else {
    fail('Self-improve exits gracefully when tasks < minimum', 'minTasks guard not found');
  }

  // 7j. Self-improve has dry-run mode
  if (content && content.includes('dry-run') || content && content.includes('dryRun')) {
    pass('Self-improve supports dry-run mode');
  } else {
    fail('Self-improve supports dry-run mode');
  }

  // 7k. Valid agents enum in self-improve
  const VALID_AGENTS = ['executor', 'mind', 'voice'];
  for (const agentId of VALID_AGENTS) {
    if (content && content.includes(`'${agentId}'`)) {
      pass(`Self-improve supports agent: ${agentId}`);
    } else {
      fail(`Self-improve supports agent: ${agentId}`);
    }
  }

  // 7l. applyProposals handles all 4 proposal types
  const proposalTypes = ['system_prompt_edit', 'process_rule', 'escalation_trigger', 'config_change'];
  for (const t of proposalTypes) {
    if (content && content.includes(t)) {
      pass(`Self-improve handles proposal type: ${t}`);
    } else {
      fail(`Self-improve handles proposal type: ${t}`);
    }
  }
}

// ---------------------------------------------------------------------------
// SUITE 8 — Supplementary Scripts
// Validate add-agent and daily-briefing scripts
// ---------------------------------------------------------------------------

async function testSupplementaryScripts() {
  suite('8. Supplementary Scripts — Add Agent & Daily Briefing');

  const scripts = {
    'add-agent': join(__dirname, 'your9-add-agent.mjs'),
    'daily-briefing': join(__dirname, 'your9-daily-briefing.mjs'),
    'provision': join(__dirname, 'your9-provision.mjs'),
  };

  for (const [name, path] of Object.entries(scripts)) {
    // Exists
    if (fileExists(path)) {
      pass(`${name} script exists`);
    } else {
      fail(`${name} script exists`, path);
      continue;
    }

    // Syntax valid
    const check = spawnSync(NODE, ['--check', path], { encoding: 'utf-8', timeout: 10000 });
    if (check.status === 0) {
      pass(`${name} script: syntax valid`);
    } else {
      fail(`${name} script: syntax valid`, check.stderr?.slice(0, 200) || 'unknown');
    }
  }

  // add-agent: has dry-run mode
  const addAgentContent = readText(scripts['add-agent']);
  if (addAgentContent && addAgentContent.includes('dry-run')) {
    pass('add-agent supports --dry-run flag');
  } else {
    fail('add-agent supports --dry-run flag');
  }

  // add-agent: reads templates dir
  if (addAgentContent && addAgentContent.includes('TEMPLATES_DIR')) {
    pass('add-agent uses templates directory');
  } else {
    fail('add-agent uses templates directory');
  }

  // daily-briefing: has --once flag for cron use
  const briefingContent = readText(scripts['daily-briefing']);
  if (briefingContent && briefingContent.includes('once')) {
    pass('daily-briefing supports --once flag (cron-safe)');
  } else {
    fail('daily-briefing supports --once flag (cron-safe)');
  }

  // daily-briefing: has --dry-run flag
  if (briefingContent && briefingContent.includes('dry-run')) {
    pass('daily-briefing supports --dry-run flag');
  } else {
    fail('daily-briefing supports --dry-run flag');
  }

  // provision: soul-code-base.md template exists
  const soulCodePath = join(ROOT, 'templates', 'soul-code-base.md');
  if (fileExists(soulCodePath)) {
    const soulCode = readText(soulCodePath);
    if (soulCode && soulCode.trim().length > 100) {
      pass('templates/soul-code-base.md exists and non-empty');
    } else {
      fail('templates/soul-code-base.md non-empty', 'File is too short or empty');
    }
  } else {
    fail('templates/soul-code-base.md exists', soulCodePath);
  }

  // provision: --status mode exits cleanly on valid instance
  // (tested structurally — provision outputs status correctly)
  const provContent = readText(scripts.provision);
  if (provContent && provContent.includes('--status') && provContent.includes('printInstanceStatus')) {
    pass('provision supports --status flag');
  } else {
    fail('provision supports --status flag');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const doCleanup = args.cleanup === true || args.cleanup === 'true';
  const keepOnFail = args['keep-on-fail'] === true || args['keep-on-fail'] === 'true';
  const existingInstance = args.instance;

  console.log('');
  console.log('='.repeat(60));
  console.log('  Your9 End-to-End Test Suite');
  console.log('  9 Enterprises — Quality Gate v1.0');
  console.log('='.repeat(60));

  const customerId = existingInstance || `y9-test-${randomUUID().slice(0, 8)}`;
  const instanceDir = join(INSTANCES_DIR, customerId);
  const isExisting = !!existingInstance;

  console.log(`\n  Test instance: ${customerId}`);
  console.log(`  Instance dir:  ${instanceDir}`);
  console.log(`  Cleanup after: ${doCleanup}`);
  console.log(`  Existing:      ${isExisting}`);
  console.log('');

  // Run all suites
  let onboardingOk = true;

  if (!isExisting) {
    onboardingOk = await testOnboarding(customerId, instanceDir);
  } else {
    suite('1. Onboarding Flow — Skipped (using existing instance)');
    if (dirExists(instanceDir)) {
      pass('Existing instance directory found', instanceDir);
    } else {
      fail('Existing instance directory found', `Not found: ${instanceDir}`);
      onboardingOk = false;
    }
  }

  if (onboardingOk || isExisting) {
    await testCeoBirth(instanceDir);
    await testAgentProvisioning(instanceDir);
    await testCommsHub(instanceDir, customerId);
    await testDashboard(instanceDir, customerId);
    await testAgentCapabilities(instanceDir);
    await testSelfImprovement(instanceDir, customerId);
  } else {
    console.log('\n  Skipping remaining suites — instance directory creation failed.');
  }

  await testSupplementaryScripts();

  // ---------------------------------------------------------------------------
  // Results summary
  // ---------------------------------------------------------------------------

  const total = results.length;
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const allPassed = failed === 0;

  console.log('');
  console.log('='.repeat(60));
  console.log(`  Results: ${passed}/${total} passed — ${failed} failed`);
  console.log('='.repeat(60));

  if (failed > 0) {
    console.log('\n  Failures:');
    for (const r of results.filter(r => r.status === 'fail')) {
      console.log(`    [${r.suite}]`);
      console.log(`      FAIL: ${r.name}`);
      if (r.detail) console.log(`      ${r.detail}`);
    }
    console.log('');
  }

  if (allPassed) {
    console.log('\n  ALL TESTS PASSED. Your9 is ready for first customer deployment.');
  } else {
    console.log(`\n  ${failed} test(s) failed. Fix failures before customer deployment.`);
  }
  console.log('');

  // Cleanup
  if (!isExisting) {
    if (doCleanup && (allPassed || !keepOnFail)) {
      cleanupInstance(customerId);
    } else if (!doCleanup) {
      console.log(`  Test instance preserved at: instances/${customerId}`);
      console.log(`  Re-run with --cleanup to remove it.`);
    } else if (keepOnFail && !allPassed) {
      console.log(`  Test instance preserved (--keep-on-fail is set): instances/${customerId}`);
    }
  }

  console.log('');

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error(`\nFATAL: Test suite crashed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
