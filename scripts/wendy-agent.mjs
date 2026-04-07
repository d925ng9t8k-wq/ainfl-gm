#!/usr/bin/env node
/**
 * Wendy — Super Consultant (Persistent Background Agent)
 * 9 Enterprises' always-on architecture, team build, and deployment manager.
 * Reports to 9 via comms hub context + log files.
 *
 * Runs independently of 9's terminal session. Survives crashes.
 * Picks highest-priority tasks from the work queue, executes them,
 * logs results, moves to next. Never idle.
 *
 * Apr 5 rule: Sonnet minimum for all quality-sensitive roles.
 * Wendy uses Opus for architecture/strategy decisions, Sonnet for execution.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { CLAUDE_QUALITY_MODEL, CLAUDE_FLAGSHIP_MODEL } from './model-constants.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENV = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);

const API_KEY = ENV.ANTHROPIC_API_KEY;
const HUB_URL = 'http://localhost:3457';
const LOG_FILE = join(ROOT, 'logs', 'wendy.log');
const STATE_FILE = join(ROOT, 'logs', 'wendy-state.json');
const WORK_CYCLE = 10 * 60 * 1000; // 10 minutes between work cycles
const MODEL_STRATEGY = CLAUDE_FLAGSHIP_MODEL; // Opus for architecture/strategy
const MODEL_EXECUTE = CLAUDE_QUALITY_MODEL;   // Sonnet for execution work

// Ensure logs dir exists
if (!existsSync(join(ROOT, 'logs'))) mkdirSync(join(ROOT, 'logs'), { recursive: true });

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] Wendy: ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

function loadState() {
  if (existsSync(STATE_FILE)) {
    try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { /* fresh */ }
  }
  return {
    cycles: 0,
    lastCycle: null,
    currentTask: null,
    completedTasks: [],
    errors: [],
    startedAt: new Date().toISOString()
  };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function reportToHub(key, value) {
  try {
    await fetch(`${HUB_URL}/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: typeof value === 'string' ? value : JSON.stringify(value) })
    });
  } catch (e) {
    log(`Hub report failed: ${e.message}`);
  }
}

async function callClaude(prompt, model = MODEL_EXECUTE, maxTokens = 4096) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.substring(0, 200)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// ─── Work Queue ─────────────────────────────────────────────────────────────
// Priority-ordered work items derived from the gold standard audit.
// Wendy works top-down. Each item is a concrete, executable task.
// ─── PHASE 2: BUILD MODE ────────────────────────────────────────────────────
// Phase 1 (audit) complete: 27 reports generated. Phase 2 = fix and build.
// Wendy now drives architectural improvements and product builds.
const WORK_QUEUE = [
  {
    id: 'auth-middleware-design',
    priority: 1,
    title: 'Design auth middleware for comms-hub',
    description: 'FORT found CRITICAL: comms-hub has zero auth on /send, /authority, /terminal/claim, /inbox. Design a token-based auth middleware that protects all write endpoints. Output a concrete implementation plan with code snippets.',
    dimension: 'Security'
  },
  {
    id: 'launchagent-all-agents',
    priority: 2,
    title: 'Design LaunchAgent plist files for all persistent agents',
    description: 'Wendy, FORT, Tee, SCOUT need LaunchAgents so they auto-restart on Mac reboot and crash. Design the plist files. Currently only comms-hub and open-terminal have LaunchAgents.',
    dimension: 'Reliability'
  },
  {
    id: 'pepper-voice-integration-plan',
    priority: 3,
    title: 'Plan Pepper voice integration',
    description: 'Pepper (jules-telegram) needs voice capability. Voice server exists on port 3456 with ElevenLabs + Twilio. Design how to connect Pepper personality to voice server so she can take phone calls. Output architecture + implementation steps.',
    dimension: 'Product Build'
  },
  {
    id: 'pepper-task-execution-plan',
    priority: 4,
    title: 'Plan Pepper task execution (food ordering, calendar)',
    description: 'Pepper needs to execute real tasks: food ordering (DoorDash/UberEats via Playwright browser automation), calendar management, reminders that actually fire. Design the tool integration layer. Output specific APIs/approaches for each.',
    dimension: 'Product Build'
  },
  {
    id: 'ainflgm-draft-prep',
    priority: 5,
    title: 'Plan ainflgm.com Draft window preparation',
    description: 'NFL Draft April 23-25 (18 days). SCOUT found mobile issues and brand inconsistencies. Design a sprint plan to fix mobile responsiveness, broken links, and ensure all draft tools work. This is the closest revenue opportunity.',
    dimension: 'Revenue'
  },
  {
    id: 'command-hub-deployment-plan',
    priority: 6,
    title: 'Plan Command Hub deployment',
    description: 'Command Hub (Next.js dashboard) is built but not deployed. Kyle said "turn it on." Design the deployment: Vercel + Supabase auth. What works, what is missing, what to ship first.',
    dimension: 'Product Build'
  },
  {
    id: 'pepper-custom-build-architecture',
    priority: 7,
    title: 'Architecture for Pepper custom builds per user',
    description: 'Owner directive: users pick a base personality type + skill set, then custom training per consumer. Design the multi-tenant Pepper architecture: how do user configs persist, how do personality templates work, how does per-user memory isolate.',
    dimension: 'Architecture'
  },
  {
    id: 'universe-health-improvement-plan',
    priority: 8,
    title: 'Prioritized improvement plan from 42.8 to 70/100',
    description: 'Using all 27 Phase 1 audit reports, create a prioritized 30-day plan to move universe health from 42.8/100 to 70/100. Sequence fixes by impact and dependencies. This is the master roadmap.',
    dimension: 'Strategy'
  }
];

// ─── Real evidence gathering ────────────────────────────────────────────────
// Wendy must NEVER hallucinate findings. Every claim is backed by live evidence.

function shell(cmd, timeout = 10000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, cwd: ROOT }).trim();
  } catch (e) {
    return `[ERROR: ${e.message.substring(0, 200)}]`;
  }
}

function probeEndpoint(port, path) {
  return shell(`curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:${port}${path}`);
}

function probeEndpointBody(port, path) {
  return shell(`curl -s --max-time 3 http://localhost:${port}${path} 2>/dev/null | head -c 1000`);
}

async function gatherEvidence(taskId) {
  log(`Gathering live evidence for task: ${taskId}`);
  const evidence = {};

  if (taskId === 'auth-middleware-design') {
    evidence.hubEndpoints = shell(`grep -n "req.url\\|pathname.*===\\|method.*POST" scripts/comms-hub.mjs 2>/dev/null | head -60`);
    evidence.existingAuth = shell(`grep -n "auth\\|token\\|secret\\|HUB_API_SECRET\\|session" scripts/comms-hub.mjs 2>/dev/null | head -30`);
    evidence.hubSize = shell(`wc -l scripts/comms-hub.mjs 2>/dev/null`);
    // Read FORT's auth gap report for reference
    const fortReport = join(ROOT, 'logs', 'fort-task-auth-gap-inventory.md');
    if (existsSync(fortReport)) evidence.fortFindings = readFileSync(fortReport, 'utf8').substring(0, 3000);
  }

  if (taskId === 'launchagent-all-agents') {
    evidence.existingAgents = shell(`ls -la ~/Library/LaunchAgents/com.9.* 2>/dev/null || echo "NONE"`);
    evidence.existingPlist = shell(`cat ~/Library/LaunchAgents/com.9.comms-hub.plist 2>/dev/null | head -30`);
    evidence.agentScripts = shell(`ls scripts/wendy-agent.mjs scripts/fort-agent.mjs scripts/tee-agent.mjs scripts/scout-agent.mjs 2>/dev/null`);
    evidence.nodePath = shell(`which node`);
    evidence.scriptPaths = shell(`realpath scripts/wendy-agent.mjs scripts/fort-agent.mjs scripts/tee-agent.mjs scripts/scout-agent.mjs 2>/dev/null`);
  }

  if (taskId === 'pepper-voice-integration-plan') {
    evidence.voiceServer = shell(`head -80 scripts/voice-server.mjs 2>/dev/null`);
    evidence.julesBot = shell(`head -40 scripts/jules-telegram.mjs 2>/dev/null`);
    evidence.voiceHealth = shell(`curl -s http://localhost:3456/health 2>/dev/null | head -c 500`);
    evidence.elevenLabsConfig = shell(`grep -n "eleven\\|tts\\|voice\\|ELEVENLABS" scripts/voice-server.mjs 2>/dev/null | head -20`);
    evidence.twilioConfig = shell(`grep "TWILIO" .env 2>/dev/null | cut -d= -f1`);
  }

  if (taskId === 'pepper-task-execution-plan') {
    evidence.playwrightAvail = shell(`npx playwright --version 2>/dev/null || echo "NOT INSTALLED"`);
    evidence.mcpConfig = shell(`cat .claude/mcp.json 2>/dev/null | head -30 || echo "NO MCP CONFIG"`);
    evidence.browserScripts = shell(`find scripts/ -name "*browser*" -o -name "*playwright*" -o -name "*automation*" 2>/dev/null`);
    evidence.pepperCapabilities = shell(`grep -A5 "WHAT PEPPER DOES" scripts/jules-telegram.mjs 2>/dev/null | head -15`);
  }

  if (taskId === 'ainflgm-draft-prep') {
    // Read SCOUT's site audit
    const scoutReport = join(ROOT, 'logs', 'scout-task-ainflgm-live-audit.md');
    if (existsSync(scoutReport)) evidence.scoutAudit = readFileSync(scoutReport, 'utf8').substring(0, 3000);
    const brandReport = join(ROOT, 'logs', 'scout-task-brand-consistency-scan.md');
    if (existsSync(brandReport)) evidence.brandAudit = readFileSync(brandReport, 'utf8').substring(0, 3000);
    evidence.distPages = shell(`ls dist/*.html 2>/dev/null`);
    evidence.sitemapUrls = shell(`grep "<loc>" dist/sitemap.xml 2>/dev/null | head -20`);
  }

  if (taskId === 'command-hub-deployment-plan') {
    evidence.commandHubFiles = shell(`ls command-hub/ 2>/dev/null`);
    evidence.packageJson = shell(`cat command-hub/package.json 2>/dev/null | head -30`);
    evidence.appDir = shell(`ls command-hub/app/ 2>/dev/null || echo "NO APP DIR"`);
    evidence.supabaseConfig = shell(`ls command-hub/supabase/ 2>/dev/null || echo "NO SUPABASE DIR"`);
    evidence.envExample = shell(`cat command-hub/.env.example 2>/dev/null || cat command-hub/.env.local.example 2>/dev/null || echo "NO ENV EXAMPLE"`);
  }

  if (taskId === 'pepper-custom-build-architecture') {
    evidence.currentProfile = shell(`head -30 data/jules-profile-jasson.json 2>/dev/null`);
    evidence.currentPrompt = shell(`grep -A5 "buildSystemPrompt" scripts/jules-telegram.mjs 2>/dev/null | head -20`);
    evidence.memoryLayer = shell(`ls data/9-memory.db* 2>/dev/null`);
    evidence.supabaseSync = shell(`grep -n "supabase" scripts/comms-hub.mjs 2>/dev/null | head -10`);
    const pepperSpec = join(ROOT, '..', '.claude', 'projects', '-Users-jassonfishback-Projects-BengalOracle', 'memory', 'project_pepper_product_spec.md');
    if (existsSync(pepperSpec)) evidence.pepperSpec = readFileSync(pepperSpec, 'utf8').substring(0, 2000);
  }

  if (taskId === 'universe-health-improvement-plan') {
    // Read all Phase 1 report summaries
    const reportDir = join(ROOT, 'logs');
    const reports = shell(`ls ${reportDir}/wendy-task-*.md ${reportDir}/fort-task-*.md ${reportDir}/tee-task-*.md ${reportDir}/scout-task-*.md 2>/dev/null`).split('\n').filter(Boolean);
    for (const f of reports.slice(0, 20)) {
      const name = f.split('/').pop().replace('.md', '');
      const content = readFileSync(f, 'utf8');
      const recIdx = content.indexOf('RECOMMENDED ACTIONS');
      if (recIdx > -1) evidence[name] = content.substring(recIdx, recIdx + 800);
      else evidence[name] = content.substring(content.length - 800);
    }
    evidence.baseline = '42.8/100 (April 5 SCOUT audit)';
    evidence.target = '70/100 (Owner directive: minimum acceptable)';
  }

  // Legacy audit tasks (keep for reference)
  if (taskId === 'security-audit-endpoints') {
    // Actually probe every known port and common paths
    const ports = [3457, 3456, 3471, 3472, 3480];
    const paths = ['/', '/health', '/inbox', '/send', '/state', '/context', '/api', '/admin'];
    for (const port of ports) {
      evidence[`port_${port}`] = {};
      for (const path of paths) {
        const code = probeEndpoint(port, path);
        if (code !== '000') {
          evidence[`port_${port}`][path] = { status: code, body: probeEndpointBody(port, path).substring(0, 300) };
        }
      }
      // Check if port is even listening
      evidence[`port_${port}`]._listening = shell(`lsof -i :${port} -P -n 2>/dev/null | head -5`);
    }
    // Check for auth headers in source code
    evidence.authPatterns = shell(`grep -r "authorization\\|x-api-key\\|bearer\\|session.*token\\|auth.*check" scripts/*.mjs --include="*.mjs" -l 2>/dev/null`);
    evidence.noAuthEndpoints = shell(`grep -r "req.url\\|req.method\\|createServer" scripts/comms-hub.mjs scripts/voice-server.mjs scripts/underwriter-api.mjs scripts/pilot-server.mjs 2>/dev/null | head -40`);
  }

  if (taskId === 'health-endpoints-standardize') {
    const services = [
      { name: 'comms-hub', port: 3457 },
      { name: 'voice-server', port: 3456 },
      { name: 'underwriter-api', port: 3471 },
      { name: 'pilot-server', port: 3472 },
      { name: 'wendy-agent', port: 3480 }
    ];
    for (const svc of services) {
      const body = probeEndpointBody(svc.port, '/health');
      evidence[svc.name] = { port: svc.port, healthResponse: body };
    }
    // Also check which scripts have /health handlers
    evidence.healthInCode = shell(`grep -l "health" scripts/*.mjs 2>/dev/null`);
  }

  if (taskId === 'structured-logging-audit') {
    evidence.logFiles = shell(`ls -la logs/ 2>/dev/null`);
    evidence.logSizes = shell(`du -sh logs/* 2>/dev/null | sort -rh | head -20`);
    evidence.logPatterns = shell(`for f in scripts/comms-hub.mjs scripts/voice-server.mjs scripts/trinity-agent.mjs scripts/trader9-bot.mjs scripts/kids-mentor.mjs scripts/pilot-server.mjs; do echo "=== $f ==="; grep -c "appendFileSync\\|console.log\\|console.error\\|writeFileSync.*log" "$f" 2>/dev/null; done`);
    evidence.logRotation = shell(`grep -rl "rotation\\|rotate\\|truncate.*log\\|log.*size" scripts/*.mjs 2>/dev/null`);
  }

  if (taskId === 'crash-recovery-audit') {
    evidence.launchAgents = shell(`ls -la ~/Library/LaunchAgents/com.9.* 2>/dev/null`);
    evidence.launchAgentContents = shell(`for f in ~/Library/LaunchAgents/com.9.*; do echo "=== $f ==="; cat "$f" 2>/dev/null | head -30; done`);
    evidence.processTree = shell(`ps aux | grep -E "node.*scripts/" | grep -v grep | awk '{print $2, $11, $12}'`);
    evidence.watchdogs = shell(`grep -rl "watchdog\\|restart\\|respawn\\|auto.*start\\|crash.*recover" scripts/*.mjs 2>/dev/null`);
  }

  if (taskId === 'dependency-map-verify') {
    const depFile = join(ROOT, 'docs', 'dependency-map.json');
    if (existsSync(depFile)) {
      evidence.depMap = readFileSync(depFile, 'utf8').substring(0, 5000);
    }
    evidence.runningProcesses = shell(`ps aux | grep -E "node.*scripts/" | grep -v grep | awk '{print $NF}'`);
    evidence.envVars = shell(`grep -c "=" .env 2>/dev/null && echo "vars in .env" && head -c 0 .env`);
    evidence.listeningPorts = shell(`lsof -i -P -n | grep LISTEN | grep node | awk '{print $1, $9}' | sort -u`);
  }

  if (taskId === 'credential-rotation-plan') {
    const credFile = join(ROOT, 'docs', 'credential-inventory.md');
    if (existsSync(credFile)) {
      evidence.credInventory = readFileSync(credFile, 'utf8').substring(0, 6000);
    }
    // Check .env for key names (not values!)
    evidence.envKeyNames = shell(`grep "=" .env 2>/dev/null | cut -d= -f1 | sort`);
    // Check git log for .env changes (should be zero)
    evidence.envInGit = shell(`git log --oneline --all -- .env 2>/dev/null | head -5`);
  }

  if (taskId === 'ainflgm-mobile-audit') {
    evidence.siteCheck = shell(`curl -s -o /dev/null -w "%{http_code} %{size_download} %{time_total}s" --max-time 10 https://ainflgm.com`);
    evidence.pages = shell(`curl -s https://ainflgm.com/sitemap.xml 2>/dev/null | grep "<loc>" | head -20`);
    // Check for viewport meta tag
    evidence.viewportMeta = shell(`curl -s https://ainflgm.com | grep -i "viewport" | head -3`);
    // Check CSS for responsive patterns
    evidence.responsiveCSS = shell(`grep -r "media.*max-width\\|media.*min-width\\|@media" dist/*.html 2>/dev/null | wc -l`);
  }

  if (taskId === 'voice-tunnel-stability') {
    evidence.tunnelStatus = shell(`curl -s http://localhost:3457/health 2>/dev/null | python3 -c "import sys,json; t=json.load(sys.stdin).get('tunnel',{}); print(json.dumps(t, indent=2))" 2>/dev/null`);
    evidence.cloudflaredProcess = shell(`ps aux | grep cloudflared | grep -v grep`);
    evidence.tunnelInHub = shell(`grep -A5 "tunnel" scripts/comms-hub.mjs 2>/dev/null | head -30`);
    evidence.twilioConfig = shell(`grep "TWILIO" .env 2>/dev/null | cut -d= -f1`);
  }

  if (taskId === 'legal-compliance-checklist') {
    evidence.tosPages = shell(`grep -rl "terms.*service\\|privacy.*policy\\|ToS\\|GDPR" dist/*.html 2>/dev/null`);
    evidence.distPages = shell(`ls dist/*.html 2>/dev/null`);
    evidence.voiceConsent = shell(`grep -i "consent\\|recording\\|disclosure\\|this call" scripts/voice-server.mjs 2>/dev/null | head -10`);
  }

  if (taskId === 'team-structure-proposal') {
    evidence.currentProcesses = shell(`ps aux | grep -E "node.*scripts/" | grep -v grep | awk '{print $NF}' | sort`);
    evidence.scriptCount = shell(`ls scripts/*.mjs 2>/dev/null | wc -l`);
    evidence.scriptList = shell(`ls scripts/*.mjs 2>/dev/null`);
    evidence.universeSize = '19 items per gold standard audit';
    const teamFile = join(ROOT, '..', '.claude', 'projects', '-Users-jassonfishback-Projects-BengalOracle', 'memory', 'project_team_structure.md');
    if (existsSync(teamFile)) {
      evidence.currentTeamDoc = readFileSync(teamFile, 'utf8').substring(0, 2000);
    }
  }

  return evidence;
}

async function getNextTask(state) {
  const completed = new Set(state.completedTasks.map(t => t.id));
  const next = WORK_QUEUE.find(t => !completed.has(t.id));
  if (next) return next;

  // ─── SELF-DIRECTING: Check Supabase queue first, then generate from plan ──
  // External task queue (Supabase) is the authoritative source.
  // If no Supabase tasks, generate from the execution plan.
  log('Hardcoded queue empty. Self-generating new tasks from execution plan...');
  try {
    const planPath = join(ROOT, 'docs', 'unified-execution-plan-v1.md');
    const ordersPath = join(ROOT, 'docs', 'wendy-squad-deployment-orders.md');
    let planContext = '';
    if (existsSync(planPath)) planContext += readFileSync(planPath, 'utf8').substring(0, 4000);
    if (existsSync(ordersPath)) planContext += '\n\n' + readFileSync(ordersPath, 'utf8').substring(0, 3000);

    const completedList = state.completedTasks.map(t => `- ${t.title}`).join('\n');
    const prompt = `You are Wendy, Super Consultant for 9 Enterprises. You have completed all your current tasks. Based on the execution plan below, generate the SINGLE most important next task that has NOT been completed yet.

COMPLETED TASKS:
${completedList}

EXECUTION PLAN:
${planContext}

Respond with ONLY a JSON object (no markdown, no explanation):
{"id": "task-id-slug", "title": "Task title", "description": "Detailed description of what to do", "dimension": "Category"}`;

    const result = await callClaude(prompt, MODEL_EXECUTE, 500);
    try {
      const task = JSON.parse(result.trim());
      if (task.id && task.title && task.description) {
        log(`Self-generated task: ${task.title}`);
        WORK_QUEUE.push(task); // Add to queue so it persists
        return task;
      }
    } catch (parseErr) {
      log(`Failed to parse self-generated task: ${parseErr.message}`);
    }
  } catch (e) {
    log(`Self-direction failed: ${e.message}`);
  }

  // Fallback: truly nothing to do
  return null;
}

async function executeTask(task) {
  log(`Starting task: ${task.title} (${task.id})`);

  // Step 1: Gather REAL evidence
  const evidence = await gatherEvidence(task.id);
  log(`Evidence gathered: ${Object.keys(evidence).length} data points`);

  const systemContext = `You are Wendy, Super Consultant for 9 Enterprises.

CRITICAL RULE: You may ONLY reference data that appears in the EVIDENCE section below.
Do NOT invent endpoints, files, or findings that are not in the evidence.
If the evidence is insufficient, say so and list what additional data you would need.

Standards:
- Enterprise gold bar = 85/100 minimum
- Kyle Shea (CIO, Rapid Mortgage) is the yardstick
- No hand-waving. Every claim backed by the evidence provided.
- Radical honesty.

Keep response under 2000 words. End with FINDINGS and RECOMMENDED ACTIONS sections.
Sign as: — Wendy, Super Consultant, 9 Enterprises`;

  // Read additional context files
  let additionalContext = '';
  try {
    if (task.id.includes('credential')) {
      const credFile = join(ROOT, 'docs', 'credential-inventory.md');
      if (existsSync(credFile)) {
        additionalContext += '\n\nCredential Inventory:\n' + readFileSync(credFile, 'utf8').substring(0, 4000);
      }
    }
    if (task.id.includes('dependency')) {
      const depFile = join(ROOT, 'docs', 'dependency-map.md');
      if (existsSync(depFile)) {
        additionalContext += '\n\nDependency Map:\n' + readFileSync(depFile, 'utf8').substring(0, 4000);
      }
    }
  } catch (e) {
    log(`Context load warning: ${e.message}`);
  }

  const model = task.id.includes('team-structure') || task.id.includes('proposal')
    ? MODEL_STRATEGY : MODEL_EXECUTE;

  const prompt = `${systemContext}

TASK: ${task.title}
DESCRIPTION: ${task.description}
DIMENSION: ${task.dimension}
${additionalContext}

EVIDENCE (gathered from live system — this is your ONLY source of truth):
${JSON.stringify(evidence, null, 2)}

Analyze this evidence and produce your report.`;

  const result = await callClaude(prompt, model, 4096);
  return result;
}

async function workCycle(state) {
  state.cycles++;
  state.lastCycle = new Date().toISOString();
  log(`=== Work cycle #${state.cycles} starting ===`);

  const task = await getNextTask(state);
  if (!task) {
    log('No tasks available even after self-generation. Short maintenance pause before retrying.');
    await reportToHub('wendyStatus', {
      status: 'self-directing',
      completedTasks: state.completedTasks.length,
      lastCycle: state.lastCycle,
      message: 'Self-directed: will retry task generation next cycle. No one sits idle.'
    });
    return;
  }

  state.currentTask = task.id;
  saveState(state);
  await reportToHub('wendyStatus', {
    status: 'working',
    currentTask: task.title,
    cycle: state.cycles
  });

  try {
    const result = await executeTask(task);

    // Save task output to dedicated file
    const outputFile = join(ROOT, 'logs', `wendy-task-${task.id}.md`);
    const header = `# Wendy Task Report: ${task.title}\n**Date:** ${new Date().toISOString()}\n**Dimension:** ${task.dimension}\n**Task ID:** ${task.id}\n\n---\n\n`;
    writeFileSync(outputFile, header + result);

    state.completedTasks.push({
      id: task.id,
      title: task.title,
      completedAt: new Date().toISOString(),
      outputFile: `logs/wendy-task-${task.id}.md`
    });
    state.currentTask = null;

    log(`Task complete: ${task.title} → ${outputFile}`);
    await reportToHub('wendyLatest', `Completed: ${task.title}. ${state.completedTasks.length}/${WORK_QUEUE.length} tasks done.`);

  } catch (e) {
    log(`Task FAILED: ${task.id} — ${e.message}`);
    state.errors.push({
      taskId: task.id,
      error: e.message,
      timestamp: new Date().toISOString()
    });
    // Skip this task on next cycle if it failed 3 times
    const failCount = state.errors.filter(err => err.taskId === task.id).length;
    if (failCount >= 3) {
      log(`Task ${task.id} failed 3 times. Marking as failed, moving on.`);
      state.completedTasks.push({
        id: task.id,
        title: task.title,
        completedAt: new Date().toISOString(),
        status: 'failed',
        reason: e.message
      });
    }
  }

  saveState(state);
}

// ─── Health endpoint ────────────────────────────────────────────────────────
import http from 'http';
const HEALTH_PORT = 3480;

const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    const state = loadState();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      agent: 'wendy',
      status: 'running',
      uptime: Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000),
      cycles: state.cycles,
      currentTask: state.currentTask,
      completedTasks: state.completedTasks.length,
      totalTasks: WORK_QUEUE.length,
      errors: state.errors.length,
      lastCycle: state.lastCycle
    }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

healthServer.listen(HEALTH_PORT, () => {
  log(`Health endpoint live on port ${HEALTH_PORT}`);
});

// ─── Main loop ──────────────────────────────────────────────────────────────
async function main() {
  log('=== Wendy Super Consultant starting ===');
  log(`Strategy model: ${MODEL_STRATEGY}`);
  log(`Execution model: ${MODEL_EXECUTE}`);
  log(`Work cycle interval: ${WORK_CYCLE / 1000}s`);
  log(`Work queue: ${WORK_QUEUE.length} tasks`);

  const state = loadState();
  log(`Resuming: ${state.completedTasks.length} tasks already complete, ${state.cycles} prior cycles`);

  await reportToHub('wendyStatus', {
    status: 'starting',
    completedTasks: state.completedTasks.length,
    totalTasks: WORK_QUEUE.length,
    startedAt: new Date().toISOString()
  });

  // Run first cycle immediately
  try {
    await workCycle(state);
  } catch (e) {
    log(`Cycle error: ${e.message}`);
  }

  // Then loop — short gap between tasks when work remains, longer when idle
  const runLoop = async () => {
    while (true) {
      const currentState = loadState();
      const pendingCount = WORK_QUEUE.length - currentState.completedTasks.length;
      const delay = pendingCount > 0 ? 30 * 1000 : WORK_CYCLE; // 30s between tasks, 10min when idle
      await new Promise(r => setTimeout(r, delay));
      try {
        await workCycle(loadState());
      } catch (e) {
        log(`Cycle error: ${e.message}`);
        await new Promise(r => setTimeout(r, 60 * 1000)); // wait 1min on error
      }
    }
  };
  runLoop();
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
