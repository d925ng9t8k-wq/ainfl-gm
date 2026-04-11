#!/usr/bin/env node
// triage-bridge.mjs — 9<->Ara bidirectional self-heal daemon (Apr 11, 2026)
//
// MISSION: Owner directive Apr 11 — "I want the two of you as close as possible
// to living in the same world and being able to touch each other. This is a
// priority!" The existing ara-retry-daemon only handles Ara->9 freeze pokes for
// a single trigger (unacked seq + nineSeq stalled). triage-bridge runs eight
// triggers across BOTH directions plus joint-escalation paths to Owner.
//
// ARCHITECTURE:
//
//   ARA HELPS 9 SELF-HEAL (daemon fires pokes ON BEHALF of Ara via /terminal/poke)
//     T1. 9 freeze detection — /tmp/9-last-tool-call age >120s while terminal in relay
//     T2. Backup-memory failure — last 2 cycles of logs/backup-memory.log show FAILED
//     T3. CI failure on recent push — gh run list --limit 5 shows failure on HEAD
//     T4. Hub /health anomaly — status != running OR new errors in any channel
//
//   9 HELPS ARA SELF-HEAL (daemon writes data/triage-9-status-for-ara.json)
//     T5. Ara stuck on cycle — lastSent.ackAt null + age >300s + nineSeq stalled
//     T6. Ara stale-assumption catcher — newest ara msgs reference files/funcs
//         that do NOT exist in repo
//
//   JOINT TRIGGERS THAT ESCALATE TO OWNER (telegram via /send)
//     T7. P0 unacked >5min by both sides — high-urgency poke + no tool call
//     T8. Push + immediate CI failure on HEAD commit
//
// COOLDOWNS are MANDATORY for every trigger to prevent spam. State lives in the
// in-memory Maps below; the daemon is intentionally stateless across restarts so
// a fresh launch is always safe (worst case = one duplicate fire after restart).
//
// FAIL CLOSED: any trigger check that throws is logged and skipped. The daemon
// must NEVER fire a false-positive poke because of an internal exception.
//
// USAGE:
//   node scripts/triage-bridge.mjs                   # foreground daemon, 30s tick
//   node scripts/triage-bridge.mjs --once            # single cycle then exit
//   node scripts/triage-bridge.mjs --once --dry-run  # check triggers, do not fire
//   POLL_MS=15000 node scripts/triage-bridge.mjs     # custom interval
//
// LAUNCHAGENT: see com.9.triage-bridge.plist in repo root. NOT loaded by this
// commit — Owner installs when ready.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ─── Config ──────────────────────────────────────────────────────────────────
const POLL_MS = parseInt(process.env.POLL_MS || '30000', 10);
const HUB_URL = process.env.HUB_URL || 'http://localhost:3457';
const LOG_PATH = path.join(ROOT, 'logs', 'triage-bridge.log');
const BRIDGE_STATE_PATH = path.join(ROOT, 'data', 'ara-bridge-state.json');
const ARA_CONV_PATH = path.join(ROOT, 'data', 'ara-conversation.jsonl');
const BACKUP_LOG_PATH = path.join(ROOT, 'logs', 'backup-memory.log');
const HEARTBEAT_PATH = '/tmp/9-last-tool-call';
const STATUS_FOR_ARA_PATH = path.join(ROOT, 'data', 'triage-9-status-for-ara.json');

// Trigger thresholds
const T1_FREEZE_THRESHOLD_MS = 120 * 1000;        // 9 tool-call age
const T5_ARA_STUCK_THRESHOLD_MS = 300 * 1000;     // Ara unacked age
const T7_P0_UNACKED_THRESHOLD_MS = 5 * 60 * 1000; // joint escalation
const T1_COOLDOWN_MS = 5 * 60 * 1000;             // re-arm 9-freeze poke
const T2_COOLDOWN_MS = 30 * 60 * 1000;            // re-arm backup poke after success
const T4_COOLDOWN_MS = 5 * 60 * 1000;             // re-arm hub-anomaly poke
const T5_COOLDOWN_MS = 5 * 60 * 1000;             // re-arm Ara status snapshot
const T6_COOLDOWN_MS = 5 * 60 * 1000;             // re-arm recon snapshot
const T7_COOLDOWN_MS = 10 * 60 * 1000;            // re-arm Owner escalation
const T8_COOLDOWN_MS = 30 * 60 * 1000;            // re-arm push+CI escalation

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
const ONCE = args.has('--once');
const DRY_RUN = args.has('--dry-run');

// ─── In-memory cooldown / dedupe state ───────────────────────────────────────
const sessionState = {
  lastT1Fire: 0,                  // ms timestamp of last 9-freeze poke
  lastT2Fire: 0,                  // ms timestamp of last backup-memory poke
  t2ArmedAfterSuccess: true,      // flips false on fire, true on next success
  t3FiredCommits: new Set(),      // commit SHAs we've already poked CI for
  lastT4Fire: 0,                  // ms timestamp of last hub-anomaly poke
  lastChannelErrorCounts: null,   // { telegram: N, imessage: N, ... }
  lastT5Fire: 0,                  // ms timestamp of last Ara status snapshot
  lastT6Fire: 0,                  // ms timestamp of last stale-ref recon snapshot
  lastT6RefsHash: '',             // hash of refs we last reported on
  lastT7Fire: 0,                  // ms timestamp of last Owner P0 escalation
  t7TrackedPokes: new Map(),      // pokeKey -> { firedAt, escalated }
  lastT8Fire: 0,                  // ms timestamp of last push+CI escalation
  t8FiredCommits: new Set(),      // commit SHAs we've escalated to Owner
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function ensureLogDir() {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  // Write to log file (and mirror to stdout for foreground / launchctl).
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch (_) { /* ignore — never crash on logging */ }
  console.log(line);
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function tailFile(p, maxLines) {
  // Cheap stdlib tail — not great for huge files but our logs are bounded.
  try {
    const data = fs.readFileSync(p, 'utf8');
    const lines = data.split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  } catch (_) {
    return [];
  }
}

// Fire a poke via the existing comms-hub /terminal/poke endpoint. The hub
// writes the same envelope shape every other inbound message uses, so 9 sees
// it through the standard PostToolUse hook path. urgency=high also schedules
// the hub's secondary Telegram alert after POKE_SECONDARY_ALERT_MS.
async function firePoke({ from, reason, urgency }) {
  if (DRY_RUN) {
    log(`[DRY-RUN] would POKE from=${from} urgency=${urgency} reason="${reason.slice(0, 200)}"`);
    return { ok: true, dryRun: true };
  }
  try {
    const res = await fetch(`${HUB_URL}/terminal/poke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, reason, urgency }),
    });
    const text = await res.text();
    log(`POKE fired from=${from} urgency=${urgency} hubReply=${text.slice(0, 200)}`);
    return { ok: res.ok, body: text };
  } catch (e) {
    log(`POKE failed from=${from}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Send Telegram via comms-hub /send. Used only for joint-trigger escalations.
async function sendTelegram(message) {
  if (DRY_RUN) {
    log(`[DRY-RUN] would TELEGRAM "${message.slice(0, 200)}"`);
    return { ok: true, dryRun: true };
  }
  try {
    const res = await fetch(`${HUB_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'telegram', message }),
    });
    const text = await res.text();
    log(`TELEGRAM fired hubReply=${text.slice(0, 200)}`);
    return { ok: res.ok, body: text };
  } catch (e) {
    log(`TELEGRAM failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Write a status snapshot for Ara to consume on her next read cycle.
function writeStatusForAra(payload) {
  if (DRY_RUN) {
    log(`[DRY-RUN] would write status-for-ara: ${JSON.stringify(payload).slice(0, 200)}`);
    return;
  }
  try {
    fs.writeFileSync(STATUS_FOR_ARA_PATH, JSON.stringify({
      writtenAt: new Date().toISOString(),
      ...payload,
    }, null, 2));
    log(`STATUS-FOR-ARA written: ${path.basename(STATUS_FOR_ARA_PATH)} reason=${payload.reason}`);
  } catch (e) {
    log(`STATUS-FOR-ARA write failed: ${e.message}`);
  }
}

// gh availability check — done once at startup. T3 / T8 noop if missing.
let GH_AVAILABLE = false;
function checkGhAvailable() {
  try {
    execSync('gh --version', { stdio: 'pipe' });
    GH_AVAILABLE = true;
    log('gh CLI available — T3/T8 enabled');
  } catch (_) {
    GH_AVAILABLE = false;
    log('WARNING: gh CLI not available — T3 (CI) and T8 (push+CI) DISABLED for this session');
  }
}

// ─── T1: 9 freeze detection (Ara helps 9) ────────────────────────────────────
async function triggerT1_NineFreeze() {
  let heartbeat;
  try {
    heartbeat = parseInt(fs.readFileSync(HEARTBEAT_PATH, 'utf8').trim(), 10);
    if (!Number.isFinite(heartbeat)) return { trigger: 'T1', skipped: 'no heartbeat file' };
  } catch (_) {
    return { trigger: 'T1', skipped: 'heartbeat unreadable' };
  }
  // Heartbeat is unix seconds (set by check-messages.sh); sanity-coerce.
  const lastToolCallMs = heartbeat > 1e12 ? heartbeat : heartbeat * 1000;
  const ageMs = Date.now() - lastToolCallMs;
  if (ageMs < T1_FREEZE_THRESHOLD_MS) {
    return { trigger: 'T1', ok: true, ageMs };
  }
  // Only fire if terminal is in relay mode (i.e. 9 SHOULD be active).
  let healthJson;
  try {
    healthJson = await (await fetch(`${HUB_URL}/health`)).json();
  } catch (_) {
    return { trigger: 'T1', skipped: 'hub unreachable' };
  }
  if (healthJson.terminalState !== 'relay') {
    return { trigger: 'T1', skipped: `terminalState=${healthJson.terminalState}` };
  }
  // Cooldown check
  if (Date.now() - sessionState.lastT1Fire < T1_COOLDOWN_MS) {
    return { trigger: 'T1', skipped: 'cooldown' };
  }
  const ageSec = Math.round(ageMs / 1000);
  const lastIso = new Date(lastToolCallMs).toISOString();
  const reason = `9 has not made a tool call in ${ageSec}s. Possible freeze. Last tool call: ${lastIso}.`;
  await firePoke({ from: 'ara-triage', reason, urgency: 'high' });
  sessionState.lastT1Fire = Date.now();
  // Track for T7 joint escalation
  const pokeKey = `T1:${lastToolCallMs}`;
  sessionState.t7TrackedPokes.set(pokeKey, { firedAt: Date.now(), escalated: false, source: 'T1' });
  return { trigger: 'T1', fired: true, ageSec };
}

// ─── T2: backup-memory failure (Ara helps 9) ─────────────────────────────────
function triggerT2_BackupFailure() {
  if (!fs.existsSync(BACKUP_LOG_PATH)) {
    return { trigger: 'T2', skipped: 'no backup log' };
  }
  // Look at the last ~200 lines, find cycle boundaries (=== backup-memory.mjs complete ===
  // OR === backup-memory.mjs starting ===), inspect the last 2 cycles for "BACKUP FAILED".
  const lines = tailFile(BACKUP_LOG_PATH, 400);
  // Build cycles by splitting on the "starting" marker.
  const cycles = [];
  let current = [];
  for (const line of lines) {
    if (line.includes('backup-memory.mjs starting') || line.includes('=== backup-memory.mjs ===')) {
      if (current.length) cycles.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length) cycles.push(current);

  // Fallback: if we have no clear cycle markers, treat the whole tail as one cycle.
  const recent = cycles.length >= 2 ? cycles.slice(-2) : (cycles.length === 1 ? cycles : [lines]);
  const failedCycles = recent.filter(c => c.some(l => l.includes('BACKUP FAILED')));

  // T2 re-arm logic: only fire if BOTH last 2 cycles failed AND we are armed.
  if (failedCycles.length >= 2) {
    if (!sessionState.t2ArmedAfterSuccess) {
      return { trigger: 'T2', skipped: 'already fired this failure cluster' };
    }
    if (Date.now() - sessionState.lastT2Fire < T2_COOLDOWN_MS) {
      return { trigger: 'T2', skipped: 'cooldown' };
    }
    const reason = `backup-memory.mjs failed last 2 cycles. Investigate immediately. (Last 2 cycles in ${BACKUP_LOG_PATH})`;
    firePoke({ from: 'ara-triage', reason, urgency: 'high' });
    sessionState.lastT2Fire = Date.now();
    sessionState.t2ArmedAfterSuccess = false;
    sessionState.t7TrackedPokes.set(`T2:${Date.now()}`, { firedAt: Date.now(), escalated: false, source: 'T2' });
    return { trigger: 'T2', fired: true };
  }
  // Re-arm if we see a successful "complete" line in the most recent cycle.
  const lastCycleSuccess = recent.length && recent[recent.length - 1].some(l => l.includes('backup-memory.mjs complete'));
  if (lastCycleSuccess && !sessionState.t2ArmedAfterSuccess) {
    sessionState.t2ArmedAfterSuccess = true;
    log('T2 re-armed (saw successful backup cycle)');
  }
  return { trigger: 'T2', ok: true, failedCycles: failedCycles.length };
}

// ─── T3: CI failure on recent push (Ara helps 9) ─────────────────────────────
function triggerT3_CIFailure() {
  if (!GH_AVAILABLE) return { trigger: 'T3', skipped: 'gh missing' };
  let runs;
  try {
    // Tab-separated default output: status, conclusion, name, workflow, branch, event, runId, elapsed, ts, ...
    const out = execSync('gh run list --limit 5', { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT, timeout: 15000 }).toString();
    runs = out.trim().split('\n').filter(Boolean).map(l => {
      const cols = l.split('\t');
      return { status: cols[0], conclusion: cols[1], name: cols[2], workflow: cols[3], branch: cols[4], event: cols[5], runId: cols[6] };
    });
  } catch (e) {
    return { trigger: 'T3', skipped: `gh failed: ${e.message.slice(0, 80)}` };
  }
  // Get the HEAD commit SHA so we can scope cooldown per commit.
  let headSha = '';
  try {
    headSha = execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch (_) { /* ignore */ }

  // Look for any failure in the most recent batch.
  const failures = runs.filter(r => r.status === 'completed' && r.conclusion === 'failure');
  if (failures.length === 0) return { trigger: 'T3', ok: true };
  const cooldownKey = `${headSha}:${failures[0].runId}`;
  if (sessionState.t3FiredCommits.has(cooldownKey)) {
    return { trigger: 'T3', skipped: 'already fired for this commit' };
  }
  const f = failures[0];
  const reason = `CI workflow "${f.workflow || f.name}" failed on commit ${headSha.slice(0, 7)} (run ${f.runId}). Re-investigate.`;
  firePoke({ from: 'ara-triage', reason, urgency: 'high' });
  sessionState.t3FiredCommits.add(cooldownKey);
  sessionState.t7TrackedPokes.set(`T3:${cooldownKey}`, { firedAt: Date.now(), escalated: false, source: 'T3' });
  return { trigger: 'T3', fired: true, runId: f.runId };
}

// ─── T4: hub /health anomaly (Ara helps 9) ───────────────────────────────────
async function triggerT4_HealthAnomaly() {
  let h;
  try {
    h = await (await fetch(`${HUB_URL}/health`)).json();
  } catch (e) {
    if (Date.now() - sessionState.lastT4Fire < T4_COOLDOWN_MS) {
      return { trigger: 'T4', skipped: 'cooldown (hub unreachable)' };
    }
    const reason = `comms-hub /health unreachable: ${e.message}. Hub may be down.`;
    await firePoke({ from: 'ara-triage', reason, urgency: 'high' });
    sessionState.lastT4Fire = Date.now();
    sessionState.t7TrackedPokes.set(`T4:${Date.now()}`, { firedAt: Date.now(), escalated: false, source: 'T4' });
    return { trigger: 'T4', fired: true, reason: 'unreachable' };
  }
  const anomalies = [];
  if (h.status !== 'running') anomalies.push(`status=${h.status}`);

  // Detect new errors in any channel since last poll.
  const channels = h.channels || {};
  const counts = {};
  for (const [name, ch] of Object.entries(channels)) {
    counts[name] = Array.isArray(ch.errors) ? ch.errors.length : 0;
  }
  if (sessionState.lastChannelErrorCounts) {
    for (const [name, count] of Object.entries(counts)) {
      const prev = sessionState.lastChannelErrorCounts[name] || 0;
      if (count > prev) {
        const ch = channels[name];
        const newest = ch.errors[ch.errors.length - 1];
        anomalies.push(`${name}: +${count - prev} new errors (latest: ${newest?.error || 'unknown'})`);
      }
    }
  }
  sessionState.lastChannelErrorCounts = counts;

  if (anomalies.length === 0) return { trigger: 'T4', ok: true };
  if (Date.now() - sessionState.lastT4Fire < T4_COOLDOWN_MS) {
    return { trigger: 'T4', skipped: 'cooldown' };
  }
  const reason = `hub /health anomaly: ${anomalies.join('; ')}`;
  await firePoke({ from: 'ara-triage', reason, urgency: 'normal' });
  sessionState.lastT4Fire = Date.now();
  sessionState.t7TrackedPokes.set(`T4:${Date.now()}`, { firedAt: Date.now(), escalated: false, source: 'T4' });
  return { trigger: 'T4', fired: true, anomalies };
}

// ─── T5: Ara stuck waiting for 9 (9 helps Ara) ───────────────────────────────
function triggerT5_AraStuck() {
  const s = readJsonSafe(BRIDGE_STATE_PATH);
  if (!s || !s.lastSent) return { trigger: 'T5', skipped: 'no bridge state' };
  const { sentAt, ackAt } = s.lastSent;
  if (ackAt) return { trigger: 'T5', ok: true };
  const ageMs = Date.now() - (sentAt || 0);
  if (ageMs < T5_ARA_STUCK_THRESHOLD_MS) return { trigger: 'T5', ok: true, ageMs };
  if (Date.now() - sessionState.lastT5Fire < T5_COOLDOWN_MS) {
    return { trigger: 'T5', skipped: 'cooldown' };
  }
  // Build status snapshot 9 can hand to Ara.
  const ageSec = Math.round(ageMs / 1000);
  let recentCommits = [];
  try {
    recentCommits = execSync('git log --oneline -5', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
      .toString().trim().split('\n');
  } catch (_) { /* ignore */ }
  let lastToolCallSec = null;
  try {
    const hb = parseInt(fs.readFileSync(HEARTBEAT_PATH, 'utf8').trim(), 10);
    const ms = hb > 1e12 ? hb : hb * 1000;
    lastToolCallSec = Math.round((Date.now() - ms) / 1000);
  } catch (_) { /* ignore */ }
  const payload = {
    reason: 'ara-stuck-on-9',
    araSeqWaiting: s.lastSent.seq,
    araWaitingForSeconds: ageSec,
    nineLastToolCallAgeSec: lastToolCallSec,
    nineRecentCommits: recentCommits,
    nineHubReachable: null, // filled below
  };
  // Try health quickly for completeness.
  fetch(`${HUB_URL}/health`).then(r => r.json()).then(h => {
    payload.nineHubReachable = true;
    payload.nineHubStatus = h.status;
    payload.nineTerminalState = h.terminalState;
    writeStatusForAra(payload);
  }).catch(() => {
    payload.nineHubReachable = false;
    writeStatusForAra(payload);
  });
  sessionState.lastT5Fire = Date.now();
  return { trigger: 'T5', fired: true, ageSec };
}

// ─── T6: Ara stale-assumption catcher (9 helps Ara) ──────────────────────────
function triggerT6_StaleRefs() {
  if (!fs.existsSync(ARA_CONV_PATH)) return { trigger: 'T6', skipped: 'no conv log' };
  const lines = tailFile(ARA_CONV_PATH, 50);
  // Walk backward to find the most recent up-to-3 messages where role is from Ara.
  // Ara messages in the existing log have role of either "assistant", "ara", or
  // "user" (depending on who wrapped the entry); we treat any non-retry_error
  // entry that contains content as a candidate.
  const araMsgs = [];
  for (let i = lines.length - 1; i >= 0 && araMsgs.length < 3; i--) {
    let parsed;
    try { parsed = JSON.parse(lines[i]); } catch (_) { continue; }
    if (!parsed) continue;
    if (parsed.role === 'retry_error') continue;
    const text = parsed.content || parsed.rawContent || '';
    if (text && text.length > 20) araMsgs.push(text);
  }
  if (araMsgs.length === 0) return { trigger: 'T6', skipped: 'no ara messages' };

  // Extract backtick-wrapped tokens and likely file paths.
  const refs = new Set();
  for (const text of araMsgs) {
    // Backtick-wrapped: `foo/bar.mjs`, `someFunction()`
    const backtickRe = /`([^`]+)`/g;
    let m;
    while ((m = backtickRe.exec(text)) !== null) {
      const tok = m[1].trim();
      if (tok.length < 200 && tok.length > 2) refs.add(tok);
    }
    // Bare paths like scripts/foo.mjs or data/bar.json
    const pathRe = /\b((?:scripts|data|memory|docs|logs|cloud-worker|command-hub)\/[A-Za-z0-9_./-]+\.(?:mjs|js|ts|tsx|json|md|sh|sql|html|css))\b/g;
    while ((m = pathRe.exec(text)) !== null) refs.add(m[1]);
  }
  if (refs.size === 0) return { trigger: 'T6', ok: true, refs: 0 };

  const missing = [];
  const present = [];
  for (const ref of refs) {
    // Only check things that LOOK like a file path (contains /). Function names
    // are skipped — too many false positives.
    if (!ref.includes('/')) continue;
    // Strip query / line suffixes
    const cleaned = ref.replace(/[:#].*$/, '');
    const abs = path.isAbsolute(cleaned) ? cleaned : path.join(ROOT, cleaned);
    if (fs.existsSync(abs)) present.push(cleaned);
    else missing.push(cleaned);
  }
  if (missing.length === 0) return { trigger: 'T6', ok: true, checked: present.length };

  const refsHash = missing.sort().join('|');
  if (refsHash === sessionState.lastT6RefsHash) {
    return { trigger: 'T6', skipped: 'same missing refs as last fire' };
  }
  if (Date.now() - sessionState.lastT6Fire < T6_COOLDOWN_MS) {
    return { trigger: 'T6', skipped: 'cooldown' };
  }
  writeStatusForAra({
    reason: 'ara-stale-references-detected',
    missingRefs: missing,
    presentRefsChecked: present.length,
    note: 'These paths appeared in your last 3 messages but do not exist in the repo. Verify before continuing.',
  });
  sessionState.lastT6Fire = Date.now();
  sessionState.lastT6RefsHash = refsHash;
  return { trigger: 'T6', fired: true, missing: missing.length };
}

// ─── T7: P0 unacked >5min by both sides (joint escalation to Owner) ──────────
async function triggerT7_JointEscalation() {
  // Look at every tracked high-urgency poke; if it's older than 5min and the
  // 9-side heartbeat has not advanced past the poke's firedAt, escalate.
  let heartbeatMs = 0;
  try {
    const hb = parseInt(fs.readFileSync(HEARTBEAT_PATH, 'utf8').trim(), 10);
    heartbeatMs = hb > 1e12 ? hb : hb * 1000;
  } catch (_) { /* ignore */ }

  // Snapshot current Ara seq for "Ara has not advanced" check.
  let araSeq = null;
  const bs = readJsonSafe(BRIDGE_STATE_PATH);
  if (bs) araSeq = bs.lastAraSeq;

  let firedAny = false;
  for (const [key, info] of sessionState.t7TrackedPokes.entries()) {
    if (info.escalated) continue;
    const age = Date.now() - info.firedAt;
    if (age < T7_P0_UNACKED_THRESHOLD_MS) continue;
    // 9-side ack: heartbeat AFTER firedAt = 9 made a tool call after the poke.
    const nineAcked = heartbeatMs > info.firedAt;
    // Ara-side ack: lastAraSeq increased since poke; we don't have a snapshot
    // at fire time, so we accept ANY non-null seq advance as "Ara is alive".
    // Conservative — ALWAYS escalate after 5min if 9 hasn't tool-called.
    if (nineAcked) {
      info.escalated = true; // mark resolved, drop tracking
      sessionState.t7TrackedPokes.delete(key);
      continue;
    }
    if (Date.now() - sessionState.lastT7Fire < T7_COOLDOWN_MS) continue;
    const ageMin = Math.round(age / 60000);
    const reason = `9-ARA TRIAGE: P0 alert (${info.source}) unacked for ${ageMin}min by 9. Possible double-freeze. Owner intervention requested.`;
    await sendTelegram(`🚨 ${reason}`);
    sessionState.lastT7Fire = Date.now();
    info.escalated = true;
    firedAny = true;
  }
  // Garbage-collect very old escalated entries to bound memory.
  for (const [key, info] of sessionState.t7TrackedPokes.entries()) {
    if (info.escalated && Date.now() - info.firedAt > 60 * 60 * 1000) {
      sessionState.t7TrackedPokes.delete(key);
    }
  }
  return { trigger: 'T7', fired: firedAny };
}

// ─── T8: push + immediate CI failure (joint escalation to Owner) ─────────────
async function triggerT8_PushPlusCIFailure() {
  if (!GH_AVAILABLE) return { trigger: 'T8', skipped: 'gh missing' };
  let headSha = '';
  let headSubject = '';
  try {
    headSha = execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    headSubject = execSync('git log -1 --pretty=%s', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch (_) {
    return { trigger: 'T8', skipped: 'git failed' };
  }
  if (sessionState.t8FiredCommits.has(headSha)) {
    return { trigger: 'T8', skipped: 'already escalated this commit' };
  }
  if (Date.now() - sessionState.lastT8Fire < T8_COOLDOWN_MS) {
    return { trigger: 'T8', skipped: 'cooldown' };
  }
  let runs;
  try {
    const out = execSync('gh run list --limit 1 --commit ' + headSha, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }).toString();
    runs = out.trim().split('\n').filter(Boolean).map(l => {
      const cols = l.split('\t');
      return { status: cols[0], conclusion: cols[1], name: cols[2], workflow: cols[3] };
    });
  } catch (_) {
    // Fall back to plain limit-1 if --commit not supported in this gh version.
    try {
      const out = execSync('gh run list --limit 1', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }).toString();
      runs = out.trim().split('\n').filter(Boolean).map(l => {
        const cols = l.split('\t');
        return { status: cols[0], conclusion: cols[1], name: cols[2], workflow: cols[3] };
      });
    } catch (_) {
      return { trigger: 'T8', skipped: 'gh failed' };
    }
  }
  if (runs.length === 0) return { trigger: 'T8', ok: true };
  const r = runs[0];
  if (r.status !== 'completed' || r.conclusion !== 'failure') {
    return { trigger: 'T8', ok: true };
  }
  // Both poke 9 AND escalate to Owner.
  const reason = `deployment ${headSha.slice(0, 7)} ("${headSubject}") pushed and CI failed immediately. Production may be broken.`;
  await firePoke({ from: 'ara-triage', reason, urgency: 'high' });
  await sendTelegram(`🚨 9-ARA TRIAGE: ${reason}`);
  sessionState.t8FiredCommits.add(headSha);
  sessionState.lastT8Fire = Date.now();
  return { trigger: 'T8', fired: true, sha: headSha.slice(0, 7) };
}

// ─── Tick orchestrator ───────────────────────────────────────────────────────
async function runCycle() {
  const results = [];
  const safeRun = async (label, fn) => {
    try {
      const r = await fn();
      results.push(r);
    } catch (e) {
      // FAIL CLOSED — log and skip, never let an exception fire a false poke.
      log(`${label} EXCEPTION: ${e.message}`);
      results.push({ trigger: label, error: e.message });
    }
  };
  await safeRun('T1', triggerT1_NineFreeze);
  await safeRun('T2', () => triggerT2_BackupFailure());
  await safeRun('T3', () => triggerT3_CIFailure());
  await safeRun('T4', triggerT4_HealthAnomaly);
  await safeRun('T5', () => triggerT5_AraStuck());
  await safeRun('T6', () => triggerT6_StaleRefs());
  await safeRun('T7', triggerT7_JointEscalation);
  await safeRun('T8', triggerT8_PushPlusCIFailure);

  // Compact summary line for logs.
  const summary = results.map(r => {
    if (r.fired) return `${r.trigger}=FIRED`;
    if (r.skipped) return `${r.trigger}=skip(${r.skipped})`;
    if (r.error) return `${r.trigger}=ERR`;
    return `${r.trigger}=ok`;
  }).join(' ');
  log(`cycle ${DRY_RUN ? '[DRY] ' : ''}${summary}`);
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  ensureLogDir();
  log(`triage-bridge starting (POLL_MS=${POLL_MS}, ONCE=${ONCE}, DRY_RUN=${DRY_RUN}, HUB_URL=${HUB_URL})`);
  checkGhAvailable();

  if (ONCE) {
    const results = await runCycle();
    log('triage-bridge --once complete');
    // Print structured summary to stdout for test runner consumption.
    console.log('TRIAGE_RESULTS=' + JSON.stringify(results));
    process.exit(0);
  }
  await runCycle();
  setInterval(runCycle, POLL_MS);
  log(`triage-bridge looping every ${POLL_MS}ms`);
}

main().catch(e => {
  log(`fatal: ${e.stack || e.message}`);
  process.exit(1);
});
