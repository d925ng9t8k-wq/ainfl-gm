#!/usr/bin/env node
/**
 * FORT — Security Agent (Persistent)
 * Monitors and hardens all services. Reports to Wendy/9.
 * Born from Wendy's Task 1 finding: CRITICAL auth gaps across all endpoints.
 */

import { runAgent, shell, ROOT } from './agent-base.mjs';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ─── PHASE 2: REMEDIATION MODE ──────────────────────────────────────────────
// Phase 1 audit complete. FORT now designs concrete fixes for the gaps found.
const workQueue = [
  {
    id: 'hub-auth-implementation',
    priority: 1,
    title: 'Design hub auth middleware implementation',
    description: 'comms-hub has zero auth on /send, /authority, /terminal/claim, /inbox, /action. Design a bearer token middleware: generate token on startup, require it on all write endpoints, exempt /health and /terminal/ping. Output ready-to-paste Node.js code.',
    dimension: 'Security'
  },
  {
    id: 'env-hardcoded-fix',
    priority: 2,
    title: 'Design fixes for hardcoded credentials in source',
    description: 'Phase 1 found hardcoded tokens and emails in source. Design the migration: move all to .env, create .env.example, add .env to .gitignore if missing. Output specific file:line locations and replacement code.',
    dimension: 'Security'
  },
  {
    id: 'rate-limiter-design',
    priority: 3,
    title: 'Design rate limiter for all HTTP services',
    description: 'No service has rate limiting. Design a simple in-memory rate limiter (IP + endpoint, configurable limits) that can be dropped into any service. Output reusable module code.',
    dimension: 'Security'
  },
  {
    id: 'voice-consent-disclosure',
    priority: 4,
    title: 'Design voice call consent disclosure',
    description: 'Voice server has no call consent disclosure. Some states require it. Design a 5-second TTS greeting for call start: "This call may be assisted by AI." Output the implementation for voice-server.mjs.',
    dimension: 'Legal'
  }
];

async function gatherEvidence(taskId) {
  const evidence = {};

  if (taskId === 'hub-auth-implementation') {
    evidence.hubEndpoints = shell(`grep -n "req.url\\|pathname.*===\\|method.*POST" scripts/comms-hub.mjs 2>/dev/null | head -60`);
    evidence.existingAuth = shell(`grep -n "auth\\|token\\|secret\\|HUB_API_SECRET\\|session" scripts/comms-hub.mjs 2>/dev/null | head -30`);
    evidence.serverSetup = shell(`grep -n "createServer\\|listen(" scripts/comms-hub.mjs 2>/dev/null | head -10`);
    const fortReport = join(ROOT, 'logs', 'fort-task-auth-gap-inventory.md');
    if (existsSync(fortReport)) evidence.priorAudit = readFileSync(fortReport, 'utf8').substring(0, 2000);
  }

  if (taskId === 'env-hardcoded-fix') {
    const credReport = join(ROOT, 'logs', 'fort-task-credential-hardcoding-scan.md');
    if (existsSync(credReport)) evidence.credScan = readFileSync(credReport, 'utf8').substring(0, 2000);
    evidence.gitignore = shell(`cat .gitignore 2>/dev/null | grep -i "env"`);
    evidence.envExample = shell(`ls .env.example 2>/dev/null || echo "MISSING"`);
    evidence.hardcodedTokens = shell(`grep -rn "token.*=.*['\"]\\|TOKEN.*=.*['\"]" scripts/*.mjs 2>/dev/null | grep -v "process.env\\|ENV\\." | head -20`);
  }

  if (taskId === 'rate-limiter-design') {
    evidence.httpServers = shell(`grep -l "createServer\\|http.Server" scripts/comms-hub.mjs scripts/voice-server.mjs scripts/pilot-server.mjs scripts/underwriter-api.mjs 2>/dev/null`);
    evidence.existingLimits = shell(`grep -rn "rate\\|limit\\|throttle\\|429" scripts/comms-hub.mjs scripts/voice-server.mjs scripts/pilot-server.mjs 2>/dev/null | head -10`);
  }

  if (taskId === 'voice-consent-disclosure') {
    evidence.callStart = shell(`grep -n "call\\|answer\\|connect\\|greeting\\|welcome" scripts/voice-server.mjs 2>/dev/null | head -20`);
    evidence.ttsSetup = shell(`grep -n "tts\\|eleven\\|speak\\|audio" scripts/voice-server.mjs 2>/dev/null | head -20`);
  }

  if (taskId === 'auth-gap-inventory') {
    // Probe every known port
    const ports = [3457, 3456, 3471, 3472, 3480];
    for (const p of ports) {
      evidence[`port_${p}_listening`] = shell(`lsof -i :${p} -P -n 2>/dev/null | head -3`);
    }
    // Extract all endpoint handlers from source
    evidence.hubEndpoints = shell(`grep -n "req.url\\|req.method.*===\\|pathname.*===\\|url.*===" scripts/comms-hub.mjs 2>/dev/null | head -50`);
    evidence.voiceEndpoints = shell(`grep -n "req.url\\|req.method.*===\\|pathname.*===" scripts/voice-server.mjs 2>/dev/null | head -30`);
    evidence.underwriterEndpoints = shell(`grep -n "req.url\\|req.method.*===\\|pathname.*===" scripts/underwriter-api.mjs 2>/dev/null | head -30`);
    evidence.pilotEndpoints = shell(`grep -n "req.url\\|req.method.*===\\|pathname.*===" scripts/pilot-server.mjs 2>/dev/null | head -30`);
    // Check for auth middleware/checks
    evidence.authChecks = shell(`grep -n "auth\\|token\\|secret\\|bearer\\|session" scripts/comms-hub.mjs scripts/voice-server.mjs scripts/underwriter-api.mjs scripts/pilot-server.mjs 2>/dev/null | head -40`);
  }

  if (taskId === 'env-secrets-audit') {
    evidence.gitignore = shell(`cat .gitignore 2>/dev/null | grep -i "env\\|secret\\|key\\|cred"`);
    evidence.envKeyNames = shell(`grep "=" .env 2>/dev/null | cut -d= -f1 | sort`);
    evidence.envInGitHistory = shell(`git log --oneline --all --diff-filter=A -- .env 2>/dev/null | head -5`);
    evidence.secretsInSource = shell(`grep -rn "sk-ant\\|ANTHROPIC_API_KEY=\\|BOT_TOKEN=\\|AUTH_TOKEN=" scripts/*.mjs 2>/dev/null | head -20`);
    evidence.secretsInLogs = shell(`grep -l "sk-ant\\|api_key\\|auth_token" logs/*.log 2>/dev/null`);
    // Check for .env.example
    evidence.envExample = shell(`ls -la .env.example 2>/dev/null || echo "MISSING"`);
  }

  if (taskId === 'network-exposure-scan') {
    evidence.listeningAll = shell(`lsof -i -P -n | grep LISTEN | grep node | awk '{print $1, $9}' | sort -u`);
    evidence.bindPatterns = shell(`grep -n "listen(\\|createServer\\|0\\.0\\.0\\.0\\|127\\.0\\.0\\.1\\|localhost" scripts/comms-hub.mjs scripts/voice-server.mjs scripts/underwriter-api.mjs scripts/pilot-server.mjs 2>/dev/null | head -30`);
    evidence.firewallStatus = shell(`/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null`);
  }

  if (taskId === 'credential-hardcoding-scan') {
    evidence.hardcodedTokens = shell(`grep -rn "token.*=.*['\"]\\|TOKEN.*=.*['\"]" scripts/*.mjs 2>/dev/null | grep -v "process.env\\|ENV\\." | head -30`);
    evidence.hardcodedKeys = shell(`grep -rn "key.*=.*['\"]sk-\\|key.*=.*['\"]pk_" scripts/*.mjs 2>/dev/null | head -20`);
    evidence.hardcodedPhones = shell(`grep -rn "['\"]\\+1[0-9]\\{10\\}['\"]\\|['\"][0-9]\\{10\\}['\"]" scripts/*.mjs 2>/dev/null | head -20`);
    evidence.hardcodedEmails = shell(`grep -rn "['\"][a-zA-Z0-9._-]*@[a-zA-Z0-9._-]*['\"]" scripts/*.mjs 2>/dev/null | grep -v "noreply\\|example\\|test" | head -20`);
  }

  if (taskId === 'rate-limit-audit') {
    evidence.rateLimitCode = shell(`grep -rn "rate.*limit\\|throttle\\|req.*per.*sec\\|429\\|Too Many" scripts/comms-hub.mjs scripts/voice-server.mjs scripts/pilot-server.mjs scripts/underwriter-api.mjs 2>/dev/null | head -20`);
    evidence.requestTracking = shell(`grep -rn "requestCount\\|req.*count\\|counter\\|increment" scripts/comms-hub.mjs scripts/voice-server.mjs scripts/pilot-server.mjs 2>/dev/null | head -20`);
    evidence.ipTracking = shell(`grep -rn "remoteAddress\\|ip.*track\\|client.*ip" scripts/comms-hub.mjs scripts/voice-server.mjs scripts/pilot-server.mjs 2>/dev/null | head -15`);
  }

  if (taskId === 'input-validation-audit') {
    evidence.postHandlers = shell(`grep -n "method.*POST\\|req.method.*POST" scripts/comms-hub.mjs scripts/voice-server.mjs scripts/pilot-server.mjs scripts/underwriter-api.mjs 2>/dev/null | head -30`);
    evidence.bodyParsing = shell(`grep -n "JSON.parse\\|body.*=\\|MAX_BODY\\|content-length\\|body.*size" scripts/comms-hub.mjs scripts/voice-server.mjs scripts/pilot-server.mjs scripts/underwriter-api.mjs 2>/dev/null | head -30`);
    evidence.sizeChecks = shell(`grep -n "size\\|limit\\|max\\|length.*>\\|length.*<" scripts/comms-hub.mjs scripts/voice-server.mjs scripts/pilot-server.mjs 2>/dev/null | head -20`);
  }

  return evidence;
}

runAgent({
  name: 'fort',
  displayName: 'FORT',
  port: 3481,
  role: 'Security specialist. Monitors and hardens all services. Finds vulnerabilities, recommends fixes, tracks remediation.',
  workQueue,
  gatherEvidence
}).catch(e => { console.error(`FORT FATAL: ${e.message}`); process.exit(1); });
