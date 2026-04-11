/**
 * doc-daemon.mjs
 * DOC — Reliability Engineer for 9 Enterprises Universe.
 *
 * Mission: Proactive health monitoring + triage response. Runs 24/7 independent
 * of any Claude Code session.
 *
 * Monitors every 5 minutes:
 *   - comms-hub health (localhost:3457/health)
 *   - voice-server health (localhost:3456/health)
 *   - ainflgm.com HTTP status
 *   - Background agent PIDs (comms-hub, voice-server, 9-ops-daemon, ram-watch-agent)
 *   - RAM + disk pressure
 *   - Gmail inbox for new emails from key contacts
 *
 * Alerts: Telegram via hub /send endpoint (falls back to direct Telegram API if hub down)
 * Self-healing: Attempts restart of known scripts when service is down
 * Health endpoint: GET http://localhost:3462/health
 * Log: logs/doc-daemon.log
 *
 * Start: nohup /opt/homebrew/bin/node scripts/doc-daemon.mjs > /dev/null 2>&1 & disown
 *
 * — DOC, Reliability Engineer, 9 Enterprises
 */

import { execSync, spawn }        from 'child_process';
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { createServer }           from 'http';
import https                      from 'https';
import tls                        from 'tls';
import path                       from 'path';
import { fileURLToPath }          from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT   = path.resolve(__dirname, '..');

// ─── Load .env ────────────────────────────────────────────────────────────────
const envPath = path.join(PROJECT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const k = line.slice(0, eqIdx).trim();
      const v = line.slice(eqIdx + 1).trim();
      if (k && !k.startsWith('#') && !(k in process.env)) process.env[k] = v;
    }
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────
const HEALTH_PORT      = 3462;
const CHECK_INTERVAL   = 5 * 60 * 1000;   // 5 minutes
const LOG_FILE         = path.join(PROJECT, 'logs/doc-daemon.log');
const HUB_URL          = 'http://localhost:3457';
const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID   || '8784022142';
const GMAIL_USER       = process.env.GMAIL_USER         || 'emailfishback@gmail.com';
const GMAIL_APP_PASS   = process.env.GMAIL_APP_PASSWORD || '';
const GMAIL_IMAP_HOST  = 'imap.gmail.com';
const GMAIL_IMAP_PORT  = 993;

// Key contacts — alert 9 immediately when any of these show up in inbox
const KEY_EMAIL_DOMAINS  = ['emailrmc.com', 'rapidmortgage.com'];
const KEY_EMAIL_ADDRESSES = ['mjaynes@emailrmc.com', 'kshea@rapidmortgage.com'];

// Services to monitor + optional restart commands
const SERVICES = [
  {
    name:    'comms-hub',
    url:     'http://localhost:3457/health',
    script:  path.join(PROJECT, 'scripts/comms-hub.mjs'),
    pattern: 'comms-hub.mjs',
  },
  {
    name:    'voice-server',
    url:     'http://localhost:3456/health',
    script:  path.join(PROJECT, 'scripts/voice-server.mjs'),
    pattern: 'voice-server.mjs',
  },
  {
    name:    '9-ops-daemon',
    url:     'http://localhost:3461/health',
    script:  path.join(PROJECT, 'scripts/9-ops-daemon.mjs'),
    pattern: '9-ops-daemon.mjs',
  },
  {
    name:    'ram-watch-agent',
    url:     'http://localhost:3459/health',
    script:  path.join(PROJECT, 'scripts/ram-watch-agent.mjs'),
    pattern: 'ram-watch-agent.mjs',
  },
];

const EXTERNAL_URLS = [
  { name: 'ainflgm.com', url: 'https://ainflgm.com' },
];

mkdirSync(path.join(PROJECT, 'logs'), { recursive: true });

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] [DOC] ${msg}\n`;
  try { process.stdout.write(line); } catch {}
  try { appendFileSync(LOG_FILE, line); } catch {}
}

// ─── Alert dedup: don't re-alert same issue every 5 min indefinitely ─────────
const alertCooldowns = new Map();   // key → last-alert timestamp
const ALERT_COOLDOWN = 15 * 60 * 1000;  // re-alert after 15 min silence max

function shouldAlert(key) {
  const last = alertCooldowns.get(key) || 0;
  if (Date.now() - last > ALERT_COOLDOWN) {
    alertCooldowns.set(key, Date.now());
    return true;
  }
  return false;
}

function clearAlert(key) {
  alertCooldowns.delete(key);
}

// ─── Send Telegram ─────────────────────────────────────────────────────────────
// Primary: POST to hub /send endpoint. Fallback: direct Telegram API.
async function sendTelegram(message) {
  // Try hub first (preferred — goes through all hub filters + logging)
  try {
    await httpPost(`${HUB_URL}/send`, {
      channel: 'telegram',
      message: `[DOC] ${message}`,
    });
    return;
  } catch {
    // Hub may be down — fall back to direct API
  }

  if (!TELEGRAM_TOKEN) {
    log(`ALERT (no-send): ${message}`);
    return;
  }

  try {
    const body = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text:    `[DOC] ${message}`,
    });
    await httpsRequest({
      hostname: 'api.telegram.org',
      path:     `/bot${TELEGRAM_TOKEN}/sendMessage`,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);
    log(`Telegram sent (direct): ${message.slice(0, 120)}`);
  } catch (e) {
    log(`Telegram send failed: ${e.message}`);
  }
}


function httpPost(url, obj, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(obj);
    // parse URL
    const u     = new URL(url);
    const proto = u.protocol === 'https:' ? https : null;

    const doReq = (http) => {
      const req = http.request({
        hostname: u.hostname,
        port:     u.port || (u.protocol === 'https:' ? 443 : 80),
        path:     u.pathname + u.search,
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      }, res => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => resolve(buf));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    };

    if (proto) { doReq(https); }
    else { import('http').then(({ default: http }) => doReq(http)).catch(reject); }
  });
}

function httpsRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve(buf));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Unified GET for both http and https
async function checkUrl(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
    const mod  = u.protocol === 'https:' ? https : null;

    const handle = (http) => {
      const req = http.get(url, { timeout: timeoutMs }, res => {
        resolve({ status: res.statusCode });
        res.resume();
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    };

    if (mod) { handle(https); }
    else { import('http').then(({ default: http }) => handle(http)).catch(reject); }
  });
}

// ─── Service health checks ────────────────────────────────────────────────────
async function checkService(svc) {
  try {
    const result = await checkUrl(svc.url, 6000);
    if (result.status === 200) return { ok: true };
    return { ok: false, reason: `HTTP ${result.status}` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ─── External URL checks ──────────────────────────────────────────────────────
async function checkExternalUrl(target) {
  try {
    const result = await checkUrl(target.url, 10000);
    const ok = result.status >= 200 && result.status < 400;
    return { ok, reason: ok ? null : `HTTP ${result.status}` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ─── RAM / Disk pressure ──────────────────────────────────────────────────────
function safeExec(cmd, timeoutMs = 8000) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: timeoutMs }).trim();
  } catch {
    return '';
  }
}

function checkRam() {
  try {
    const totalBytes = parseInt(safeExec('sysctl -n hw.memsize', 3000));
    const pageSize   = parseInt(safeExec('sysctl -n hw.pagesize', 3000));
    const vmOut      = safeExec('vm_stat', 5000);
    const pages = {};
    for (const line of vmOut.split('\n')) {
      const m = line.match(/Pages\s+(.+?):\s+(\d+)/);
      if (m) pages[m[1].toLowerCase().trim()] = parseInt(m[2]);
    }
    const wiredMb  = Math.round((pages['wired down'] || 0) * pageSize / (1024 * 1024));
    const activeMb = Math.round((pages.active || 0) * pageSize / (1024 * 1024));
    const freeMb   = Math.round((pages.free || 0) * pageSize / (1024 * 1024));
    const totalMb  = Math.round(totalBytes / (1024 * 1024));
    const usedMb   = wiredMb + activeMb;
    const usedPct  = Math.round((usedMb / totalMb) * 100);

    const pressureOut = safeExec('memory_pressure 2>/dev/null | head -1', 5000);
    const pressure = pressureOut.toLowerCase().includes('critical') ? 'critical'
                   : pressureOut.toLowerCase().includes('warning')  ? 'warning'
                   : 'normal';

    return { ok: pressure !== 'critical', usedMb, totalMb, freeMb, usedPct, pressure };
  } catch (e) {
    return { ok: true, error: e.message };
  }
}

function checkDisk() {
  try {
    const raw = safeExec('df -k / | tail -1', 5000);
    const parts  = raw.trim().split(/\s+/);
    const usedKb = parseInt(parts[2]);
    const availKb = parseInt(parts[3]);
    const totalKb = usedKb + availKb;
    const usedPct = Math.round((usedKb / totalKb) * 100);
    return { ok: usedPct < 90, usedPct, availGb: Math.round(availKb / (1024 * 1024)) };
  } catch (e) {
    return { ok: true, error: e.message };
  }
}

// ─── Self-healing: attempt service restart ────────────────────────────────────
function attemptRestart(svc) {
  try {
    // Check if already running by pattern
    const running = safeExec(`pgrep -f "${svc.pattern}" 2>/dev/null`);
    if (running) {
      log(`[heal] ${svc.name} has live PID(s) ${running.replace('\n', ',')} — skip restart`);
      return false;
    }

    if (!existsSync(svc.script)) {
      log(`[heal] ${svc.name} script not found at ${svc.script} — cannot restart`);
      return false;
    }

    const nodeBin = '/opt/homebrew/bin/node';
    const child = spawn(nodeBin, [svc.script], {
      detached: true,
      stdio:    'ignore',
      env:      process.env,
      cwd:      PROJECT,
    });
    child.unref();
    log(`[heal] Spawned ${svc.name} PID ${child.pid}`);
    return true;
  } catch (e) {
    log(`[heal] Failed to restart ${svc.name}: ${e.message}`);
    return false;
  }
}

// ─── Gmail IMAP (raw TLS) ─────────────────────────────────────────────────────
// Uses Node native tls module — no external deps. Implements just enough IMAP
// to authenticate, SELECT INBOX, SEARCH UNSEEN, and FETCH headers.
// Only reads new/unseen messages since last check.

let gmailLastSeenUid = 0;  // track highest UID processed

function imapCommand(socket, tag, cmd) {
  return new Promise((resolve) => {
    socket.write(`${tag} ${cmd}\r\n`);
    let buf = '';
    const listener = (data) => {
      buf += data.toString();
      // Wait for tagged response line
      if (buf.includes(`${tag} OK`) || buf.includes(`${tag} NO`) || buf.includes(`${tag} BAD`)) {
        socket.off('data', listener);
        resolve(buf);
      }
    };
    socket.on('data', listener);
  });
}

async function checkGmail() {
  if (!GMAIL_APP_PASS) {
    log('[gmail] GMAIL_APP_PASSWORD not set — skipping email check');
    return [];
  }

  return new Promise((resolve) => {
    const results = [];
    const TIMEOUT = 30000;
    let timedOut  = false;
    let done      = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { socket.destroy(); } catch {}
      log('[gmail] IMAP timeout');
      resolve(results);
    }, TIMEOUT);

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.write('Z LOGOUT\r\n'); socket.destroy(); } catch {}
      resolve(results);
    };

    const socket = tls.connect({ host: GMAIL_IMAP_HOST, port: GMAIL_IMAP_PORT }, async () => {
      try {
        let tag = 0;
        const t = () => `A${++tag}`;

        // Wait for server greeting
        await new Promise(r => {
          const greet = (data) => {
            if (data.toString().startsWith('* OK')) { socket.off('data', greet); r(); }
          };
          socket.on('data', greet);
        });

        // LOGIN
        const loginTag = t();
        const loginResp = await imapCommand(socket, loginTag, `LOGIN "${GMAIL_USER}" "${GMAIL_APP_PASS}"`);
        if (!loginResp.includes(`${loginTag} OK`)) {
          log(`[gmail] LOGIN failed: ${loginResp.slice(0, 200)}`);
          finish();
          return;
        }

        // SELECT INBOX
        const selectTag = t();
        const selectResp = await imapCommand(socket, selectTag, 'SELECT INBOX');
        if (!selectResp.includes(`${selectTag} OK`)) {
          log('[gmail] SELECT INBOX failed');
          finish();
          return;
        }

        // SEARCH UNSEEN — get UIDs of unread messages
        const searchTag = t();
        const searchResp = await imapCommand(socket, searchTag, 'UID SEARCH UNSEEN');
        const searchLine = searchResp.split('\n').find(l => l.startsWith('* SEARCH'));
        const uids = searchLine
          ? searchLine.replace('* SEARCH', '').trim().split(/\s+/).filter(Boolean).map(Number)
          : [];

        if (uids.length === 0) { finish(); return; }

        // Only fetch UIDs we haven't seen yet
        const newUids = uids.filter(u => u > gmailLastSeenUid);
        if (newUids.length === 0) { finish(); return; }

        // Fetch FROM + SUBJECT headers for new UIDs (max 20 at a time)
        const batch = newUids.slice(-20);
        const uidList = batch.join(',');
        const fetchTag = t();
        const fetchResp = await imapCommand(socket, fetchTag, `UID FETCH ${uidList} (ENVELOPE)`);

        // Parse ENVELOPE responses — extract sender + subject
        // ENVELOPE format: (date subject from sender reply-to to cc bcc in-reply-to message-id)
        const envRegex = /\* \d+ FETCH \(UID (\d+) ENVELOPE \(([^)]+(?:\([^)]*\)[^)]*)*)\)/gi;
        let match;
        while ((match = envRegex.exec(fetchResp)) !== null) {
          const uid     = parseInt(match[1]);
          const envStr  = match[2];

          // Extract subject (2nd quoted string) and from (3rd element which is a list)
          // Simple extraction: grab quoted strings in order
          const quoteds = [];
          let   qi = 0, inQ = false, cur = '';
          for (const ch of envStr) {
            if (ch === '"' && !inQ) { inQ = true; cur = ''; }
            else if (ch === '"' && inQ) { inQ = false; quoteds.push(cur); cur = ''; }
            else if (inQ) cur += ch;
          }
          const subject = quoteds[1] || '(no subject)';
          // FROM email is typically in quoteds around index 4-6 (varies by server)
          // Safer: regex for @domain patterns
          const fromMatch = envStr.match(/"([^"@]+@[^"]+)"/);
          const fromEmail = fromMatch ? fromMatch[1].toLowerCase() : '';

          if (uid > gmailLastSeenUid) gmailLastSeenUid = uid;

          results.push({ uid, from: fromEmail, subject });
        }

        // Fallback: if regex didn't parse, update lastSeen to highest UID to avoid re-fetching
        if (results.length === 0 && newUids.length > 0) {
          gmailLastSeenUid = Math.max(...newUids);
        }

        finish();
      } catch (e) {
        log(`[gmail] IMAP error: ${e.message}`);
        finish();
      }
    });

    socket.on('error', (e) => {
      if (!done) { log(`[gmail] TLS error: ${e.message}`); finish(); }
    });
  });
}

function isKeyContact(fromEmail) {
  if (!fromEmail) return false;
  const lower = fromEmail.toLowerCase();
  if (KEY_EMAIL_ADDRESSES.some(a => lower === a.toLowerCase())) return true;
  if (KEY_EMAIL_DOMAINS.some(d => lower.endsWith('@' + d))) return true;
  return false;
}

// ─── Main monitoring cycle ────────────────────────────────────────────────────
let cycleCount    = 0;
let lastStatus    = {};  // svc.name → true/false

async function runChecks() {
  cycleCount++;
  const issues = [];
  const recoveries = [];

  log(`=== Health Check Cycle #${cycleCount} ===`);

  // 1. Service health checks
  for (const svc of SERVICES) {
    const result = await checkService(svc);
    const wasDown = lastStatus[svc.name] === false;

    if (!result.ok) {
      log(`[DOWN] ${svc.name}: ${result.reason}`);
      lastStatus[svc.name] = false;

      // Attempt self-heal
      const healed = attemptRestart(svc);
      const healNote = healed ? ' — restart attempted' : ' — restart not possible';

      if (shouldAlert(`svc:${svc.name}`)) {
        issues.push(`${svc.name} is DOWN (${result.reason})${healNote}`);
      }
    } else {
      if (wasDown) {
        recoveries.push(`${svc.name} is back UP`);
        clearAlert(`svc:${svc.name}`);
        log(`[UP] ${svc.name} recovered`);
      } else {
        log(`[OK] ${svc.name}`);
      }
      lastStatus[svc.name] = true;
    }
  }

  // 2. External URL checks
  for (const target of EXTERNAL_URLS) {
    const result = await checkExternalUrl(target);
    const wasDown = lastStatus[`ext:${target.name}`] === false;

    if (!result.ok) {
      log(`[DOWN] ${target.name}: ${result.reason}`);
      lastStatus[`ext:${target.name}`] = false;
      if (shouldAlert(`ext:${target.name}`)) {
        issues.push(`${target.name} is DOWN (${result.reason})`);
      }
    } else {
      if (wasDown) {
        recoveries.push(`${target.name} is back UP`);
        clearAlert(`ext:${target.name}`);
        log(`[UP] ${target.name} recovered`);
      } else {
        log(`[OK] ${target.name}`);
      }
      lastStatus[`ext:${target.name}`] = true;
    }
  }

  // 3. RAM check
  const ram = checkRam();
  if (!ram.ok || ram.pressure === 'warning') {
    const pressureStr = ram.pressure || 'unknown';
    log(`[RAM] ${pressureStr}: ${ram.usedMb}MB / ${ram.totalMb}MB (${ram.usedPct}%)`);
    if (shouldAlert('ram:pressure')) {
      issues.push(`RAM pressure: ${pressureStr} — ${ram.usedMb}MB used / ${ram.totalMb}MB total (${ram.usedPct}%)`);
    }
  } else {
    clearAlert('ram:pressure');
    log(`[OK] RAM: ${ram.usedMb}MB / ${ram.totalMb}MB (${ram.usedPct}%) pressure=${ram.pressure}`);
  }

  // 4. Disk check
  const disk = checkDisk();
  if (!disk.ok) {
    log(`[DISK] Usage: ${disk.usedPct}% — ${disk.availGb}GB free`);
    if (shouldAlert('disk:full')) {
      issues.push(`Disk usage at ${disk.usedPct}% — only ${disk.availGb}GB free on /`);
    }
  } else {
    clearAlert('disk:full');
    log(`[OK] Disk: ${disk.usedPct}% used, ${disk.availGb}GB free`);
  }

  // 5. Gmail check
  let emailAlerts = [];
  try {
    const emails = await checkGmail();
    for (const email of emails) {
      log(`[gmail] UID=${email.uid} from=${email.from} subject=${email.subject}`);
      if (isKeyContact(email.from)) {
        emailAlerts.push(`Email from key contact <${email.from}>: "${email.subject}"`);
        log(`[gmail] KEY CONTACT: ${email.from}`);
      }
    }
    if (emails.length > 0) {
      log(`[gmail] ${emails.length} new message(s), ${emailAlerts.length} from key contacts`);
    }
  } catch (e) {
    log(`[gmail] Check error: ${e.message}`);
  }

  // 6. Send alerts
  for (const msg of recoveries) {
    await sendTelegram(`RECOVERED: ${msg}`);
  }
  for (const msg of issues) {
    await sendTelegram(`ALERT: ${msg}`);
  }
  for (const msg of emailAlerts) {
    await sendTelegram(`NEW EMAIL: ${msg}`);
  }

  const total = SERVICES.length + EXTERNAL_URLS.length;
  const downCount = issues.length;
  log(`=== Cycle #${cycleCount} done — ${downCount} issue(s), ${recoveries.length} recovery(s), ${emailAlerts.length} email alert(s) ===`);
}

// ─── HTTP health endpoint ─────────────────────────────────────────────────────
const server = createServer((req, res) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (req.url === '/health') {
    res.writeHead(200, headers);
    res.end(JSON.stringify({
      status:      'running',
      displayName: 'DOC',
      pid:         process.pid,
      uptime:      Math.round(process.uptime()),
      cycleCount,
      lastStatus,
      checked_at:  new Date().toISOString(),
    }));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(HEALTH_PORT, '127.0.0.1', () => {
  log(`DOC health endpoint on 127.0.0.1:${HEALTH_PORT}`);
});
server.on('error', e => log(`HTTP server error: ${e.message}`));

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  log('SIGTERM received — shutting down gracefully');
  server.close(() => {
    log('Health server closed');
    process.exit(0);
  });
  // Force exit if server close hangs
  setTimeout(() => process.exit(0), 3000);
});

process.on('SIGINT', () => {
  log('SIGINT received — shutting down');
  server.close();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  log(`Uncaught exception: ${err.message}\n${err.stack}`);
  // Do NOT exit — daemon must stay alive
});

process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${reason}`);
});

// ─── Main loop ────────────────────────────────────────────────────────────────
async function monitorLoop() {
  try {
    await runChecks();
  } catch (e) {
    log(`Monitor loop error: ${e.message}`);
  }
  setTimeout(monitorLoop, CHECK_INTERVAL);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
log('=== DOC daemon starting ===');
log(`Check interval: ${CHECK_INTERVAL / 60000}m | Health port: ${HEALTH_PORT}`);
log(`Monitoring: ${SERVICES.map(s => s.name).join(', ')}`);
log(`External: ${EXTERNAL_URLS.map(u => u.name).join(', ')}`);
log(`Gmail: ${GMAIL_APP_PASS ? `enabled (${GMAIL_USER})` : 'disabled (no app password)'}`);

// Run first check immediately, then loop
(async () => {
  await runChecks();
  setTimeout(monitorLoop, CHECK_INTERVAL);
})();
