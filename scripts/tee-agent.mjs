#!/usr/bin/env node
/**
 * Tee — Engineering Lead (Persistent)
 * Picks up build tasks, code fixes, deployments. Reports to Wendy/9.
 * Executes code-level changes identified by audits and directives.
 */

import { runAgent, shell, ROOT } from './agent-base.mjs';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ─── PHASE 2: BUILD MODE ────────────────────────────────────────────────────
// Phase 1 audit complete. Tee now builds fixes and new features.
const workQueue = [
  {
    id: 'ainflgm-mobile-fix-plan',
    priority: 1,
    title: 'Design mobile responsiveness fixes for ainflgm.com',
    description: 'SCOUT found mobile issues. Draft window is April 23-25. Design specific CSS/HTML fixes for all dist/*.html pages to ensure mobile responsiveness. Output file-by-file fix plan with code.',
    dimension: 'User Experience'
  },
  {
    id: 'error-handler-module',
    priority: 2,
    title: 'Design global error handler module for all services',
    description: 'Phase 1 found most scripts lack uncaughtException/unhandledRejection handlers. Design a drop-in error handler module that logs crashes, notifies hub, and attempts graceful restart. Output reusable code.',
    dimension: 'Reliability'
  },
  {
    id: 'log-rotation-module',
    priority: 3,
    title: 'Design log rotation for all services',
    description: 'No service has log rotation. Some logs are growing unbounded. Design a simple rotation module: max 10MB per file, keep 3 rotations. Output reusable module code.',
    dimension: 'Reliability'
  },
  {
    id: 'health-endpoint-template',
    priority: 4,
    title: 'Design standard health endpoint template',
    description: 'Phase 1 found inconsistent health endpoints. Design a standard health endpoint module that any service can import: returns JSON with status, uptime, version, memory, error count. Output reusable code.',
    dimension: 'Observability'
  }
];

async function gatherEvidence(taskId) {
  const evidence = {};

  if (taskId === 'ainflgm-mobile-fix-plan') {
    const scoutReport = join(ROOT, 'logs', 'scout-task-ainflgm-live-audit.md');
    if (existsSync(scoutReport)) evidence.scoutAudit = readFileSync(scoutReport, 'utf8').substring(0, 2000);
    evidence.viewportMeta = shell(`grep -l "viewport" dist/*.html 2>/dev/null`);
    evidence.noViewport = shell(`for f in dist/*.html; do grep -qL "viewport" "$f" && echo "$f"; done 2>/dev/null`);
    evidence.mediaQueries = shell(`for f in dist/*.html; do count=$(grep -c "@media" "$f" 2>/dev/null); echo "$(basename $f): $count"; done | head -20`);
    evidence.samplePage = shell(`head -50 dist/tools.html 2>/dev/null`);
  }

  if (taskId === 'error-handler-module') {
    const teeReport = join(ROOT, 'logs', 'tee-task-error-handling-audit.md');
    if (existsSync(teeReport)) evidence.errorAudit = readFileSync(teeReport, 'utf8').substring(0, 2000);
    evidence.existingHandlers = shell(`grep -rn "uncaughtException\\|unhandledRejection" scripts/*.mjs 2>/dev/null | head -20`);
    evidence.hubNotify = shell(`grep -n "send.*telegram\\|notify\\|alert" scripts/comms-hub.mjs 2>/dev/null | head -10`);
  }

  if (taskId === 'log-rotation-module') {
    evidence.logSizes = shell(`ls -lhS logs/ 2>/dev/null | head -15`);
    evidence.existingRotation = shell(`grep -rn "rotate\\|truncate\\|maxSize" scripts/*.mjs 2>/dev/null | head -10`);
    evidence.appendPatterns = shell(`grep -rn "appendFileSync.*log" scripts/*.mjs 2>/dev/null | head -15`);
  }

  if (taskId === 'health-endpoint-template') {
    evidence.existingHealth = shell(`grep -A10 "/health" scripts/comms-hub.mjs 2>/dev/null | head -15`);
    evidence.agentBaseHealth = shell(`grep -A15 "/health" scripts/agent-base.mjs 2>/dev/null | head -20`);
    evidence.inconsistencies = shell(`for p in 3457 3456 3471 3472; do echo "Port $p:"; curl -s --max-time 2 http://localhost:$p/health 2>/dev/null | python3 -c "import sys,json; print(list(json.load(sys.stdin).keys()))" 2>/dev/null || echo "no response"; done`);
  }

  if (taskId === 'health-endpoint-gaps') {
    const scripts = ['comms-hub', 'voice-server', 'trader9-bot', 'trinity-agent', 'pilot-server',
                     'kids-mentor', 'jules-telegram', 'underwriter-api', 'wendy-agent',
                     'health-monitor', 'usage-monitor', 'ram-watch-agent', 'portfolio-notify',
                     'family-chat', '9-ops-daemon', 'monitor-canary'];
    for (const s of scripts) {
      evidence[`${s}_health`] = shell(`grep -c "/health\\|health.*endpoint" scripts/${s}.mjs 2>/dev/null || echo "0"`);
    }
    // Probe known ports
    const ports = [3457, 3456, 3471, 3472, 3480, 3481];
    for (const p of ports) {
      evidence[`port_${p}_health`] = shell(`curl -s --max-time 2 http://localhost:${p}/health 2>/dev/null | head -c 200 || echo "NO_RESPONSE"`);
    }
  }

  if (taskId === 'log-rotation-status') {
    evidence.logFiles = shell(`ls -lhS logs/ 2>/dev/null | head -30`);
    evidence.logSizes = shell(`du -sh logs/ 2>/dev/null`);
    evidence.rotationCode = shell(`grep -rl "rotate\\|truncate\\|size.*>\\|rotation" scripts/*.mjs 2>/dev/null`);
    evidence.largeFiles = shell(`find logs/ -size +50M 2>/dev/null`);
    evidence.oldestLogs = shell(`ls -lt logs/ 2>/dev/null | tail -10`);
  }

  if (taskId === 'process-restart-coverage') {
    evidence.launchAgents = shell(`ls -la ~/Library/LaunchAgents/com.9.* 2>/dev/null || echo "NONE"`);
    evidence.watchdogs = shell(`grep -rl "watchdog\\|restart\\|respawn" scripts/*.mjs 2>/dev/null`);
    evidence.runningProcesses = shell(`ps aux | grep -E "node.*scripts/" | grep -v grep | awk '{print $2, $NF}' | sort -k2`);
    evidence.launchAgentDetails = shell(`for f in ~/Library/LaunchAgents/com.9.*; do echo "=== $(basename $f) ==="; grep -A1 "ProgramArguments\\|KeepAlive\\|RunAtLoad" "$f" 2>/dev/null; done`);
  }

  if (taskId === 'dead-code-scripts') {
    evidence.deprecatedFiles = shell(`ls scripts/*.deprecated 2>/dev/null || echo "NONE"`);
    evidence.allScripts = shell(`ls scripts/*.mjs 2>/dev/null`);
    evidence.runningScripts = shell(`ps aux | grep -E "node.*scripts/" | grep -v grep | awk '{print $NF}' | sort`);
    evidence.scriptReferences = shell(`for f in scripts/*.mjs; do name=$(basename "$f"); refs=$(grep -rl "$name" scripts/*.mjs .claude/ docs/ 2>/dev/null | grep -v "$f" | wc -l); echo "$name: $refs refs"; done 2>/dev/null | head -30`);
  }

  if (taskId === 'error-handling-audit') {
    const scripts = ['comms-hub', 'voice-server', 'trader9-bot', 'trinity-agent', 'pilot-server',
                     'kids-mentor', 'jules-telegram', 'underwriter-api', 'wendy-agent',
                     'health-monitor', 'usage-monitor', 'ram-watch-agent', 'portfolio-notify',
                     'family-chat', '9-ops-daemon', 'monitor-canary', 'fort-agent', 'tee-agent'];
    for (const s of scripts) {
      evidence[`${s}_errorHandlers`] = shell(`grep -c "uncaughtException\\|unhandledRejection\\|process.on.*error\\|\\.catch" scripts/${s}.mjs 2>/dev/null || echo "0"`);
    }
    evidence.globalHandlers = shell(`grep -rn "uncaughtException\\|unhandledRejection" scripts/*.mjs 2>/dev/null | head -30`);
    evidence.tryCatchUsage = shell(`grep -c "try.*{\\|catch.*(" scripts/comms-hub.mjs scripts/voice-server.mjs scripts/pilot-server.mjs 2>/dev/null`);
  }

  if (taskId === 'package-dependency-audit') {
    evidence.packageJson = shell(`cat package.json 2>/dev/null | head -50`);
    evidence.lockFile = shell(`ls -la package-lock.json yarn.lock 2>/dev/null || echo "NO_LOCK_FILE"`);
    evidence.nodeModulesAge = shell(`ls -la node_modules/.package-lock.json 2>/dev/null | awk '{print $6, $7, $8}'`);
    evidence.outdated = shell(`npm outdated --json 2>/dev/null | head -c 2000 || echo "npm outdated failed"`);
    evidence.auditSummary = shell(`npm audit --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); m=d.get('metadata',{}); v=m.get('vulnerabilities',{}); print(json.dumps(v))" 2>/dev/null || echo "audit failed"`);
  }

  return evidence;
}

runAgent({
  name: 'tee',
  displayName: 'Tee',
  port: 3483,
  role: 'Engineering Lead. Audits code quality, identifies technical debt, plans fixes. Executes build tasks from the gold standard work queue.',
  workQueue,
  gatherEvidence
}).catch(e => { console.error(`Tee FATAL: ${e.message}`); process.exit(1); });
