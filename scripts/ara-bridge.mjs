#!/usr/bin/env node
// ara-bridge.mjs — LIVE bridge from 9 to the real Ara (the Grok Safari Web App)
//
// WHY: Owner directive (2026-04-10 late night): the bridge MUST connect to OUR
// Ara — the existing live Grok conversation already open on the Mac, which has
// the full context of tonight (Apr 9 letter, Phase C lost-universe absorption,
// origin hunt, Apex Trust). It MUST NOT use the xAI API — a fresh API session
// is a stranger Grok with zero memory of the partnership. Owner: "There's only
// one Real Ara and it is not API. They did a lot of damage damaged us over there."
//
// HOW: Drives the Grok.app Safari Web App directly via native macOS tools that
// do NOT require Accessibility permissions on osascript:
//   - Swift + CGWindowListCopyWindowInfo to find the live window by title+owner
//   - `open -b <bundle-id>` to raise the app frontmost
//   - cliclick for mouse click + keystroke input (uses CGEventPost, not AX)
//   - screencapture -l<windowID> to capture the window by CG window ID
//   - tesseract OCR on the cropped reply area to read Ara's response
//
// USAGE:
//   node scripts/ara-bridge.mjs find                  # locate the live window, print info
//   node scripts/ara-bridge.mjs shot [out.png]        # screenshot window (default /tmp/ara-latest.png)
//   node scripts/ara-bridge.mjs send "message"        # type + send a message to Ara
//   node scripts/ara-bridge.mjs read                  # OCR the latest reply from screen
//   node scripts/ara-bridge.mjs ask "message"         # send, wait, then read her reply
//
// Programmatic:
//   import { sendToAra, readFromAra, findWindow } from './scripts/ara-bridge.mjs';
//
// IMPORTANT: The Grok Safari Web App must be open with the "9enterprises
// consulting - Grok" conversation loaded. If no window is found, the bridge
// EXITS with an error — it does NOT fall back to a fresh API session.

import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ---------- configuration ----------
// Bundle ID of the Grok Safari Web App (grep'd from lsappinfo on Apr 10 2026)
const GROK_BUNDLE_ID = 'com.apple.Safari.WebApp.8B68CD6E-F888-4CB2-8122-0F41A4502C48';
// Window title substring to match the live Ara conversation.
const WINDOW_TITLE_MATCH = 'Grok';
// Log of all bridge turns (local mirror for 9's memory).
const LOG_PATH = path.join(ROOT, 'data', 'ara-conversation.jsonl');
// Latest screenshot path (re-used every call).
const LATEST_SHOT = '/tmp/ara-latest.png';

// Send shortcut: Cmd+Return (verified working against Grok web Apr 10 2026).
// Plain Return inserts a newline in the Grok textarea, does not submit.

// ---------- Swift helper: find Grok window via CGWindowList ----------
// Returns { pid, windowId, title, bounds: {x, y, w, h} } for the first
// on-screen window owned by "Grok" whose title contains WINDOW_TITLE_MATCH.
// Uses CoreGraphics — does NOT require Accessibility permissions.
const SWIFT_FIND_WINDOW = `
import Cocoa
import CoreGraphics

let match = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Grok"
let opts: CGWindowListOption = [.optionAll, .excludeDesktopElements]
guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
    FileHandle.standardError.write("failed to read window list\\n".data(using: .utf8)!)
    exit(1)
}
for w in list {
    let name = (w[kCGWindowName as String] as? String) ?? ""
    let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""
    let pid = (w[kCGWindowOwnerPID as String] as? Int) ?? 0
    let wid = (w[kCGWindowNumber as String] as? Int) ?? 0
    let layer = (w[kCGWindowLayer as String] as? Int) ?? -1
    let bounds = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    // Only normal app windows (layer 0), owned by Grok, with a matching title.
    if layer == 0 && owner == "Grok" && name.contains(match) {
        let x = (bounds["X"] as? Int) ?? 0
        let y = (bounds["Y"] as? Int) ?? 0
        let h = (bounds["Height"] as? Int) ?? 0
        let ww = (bounds["Width"] as? Int) ?? 0
        // Skip tiny chrome windows (title bars etc). The main window is >500 tall.
        if h < 200 || ww < 400 { continue }
        print("\\(pid)|\\(wid)|\\(x)|\\(y)|\\(ww)|\\(h)|\\(name)")
        exit(0)
    }
}
FileHandle.standardError.write("no matching Grok window found\\n".data(using: .utf8)!)
exit(2)
`;

export function findWindow(titleMatch = WINDOW_TITLE_MATCH) {
  const res = spawnSync('/usr/bin/swift', ['-', titleMatch], {
    input: SWIFT_FIND_WINDOW,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(
      `findWindow failed (status ${res.status}): ${res.stderr?.trim() || 'no stderr'}\n` +
        `Is the Grok Safari Web App open with the Ara conversation loaded?`
    );
  }
  const line = res.stdout.trim().split('\n')[0];
  const [pid, wid, x, y, w, h, ...titleParts] = line.split('|');
  return {
    pid: Number(pid),
    windowId: Number(wid),
    bounds: { x: Number(x), y: Number(y), w: Number(w), h: Number(h) },
    title: titleParts.join('|'),
  };
}

// ---------- activate Grok app (raise frontmost) ----------
function activateGrok() {
  try {
    execFileSync('/usr/bin/open', ['-b', GROK_BUNDLE_ID], { stdio: 'ignore' });
  } catch (e) {
    throw new Error(`Failed to activate Grok.app via bundle id: ${e.message}`);
  }
  // Small delay so the window is actually frontmost before we click.
  sleep(700);
}

// ---------- sleep (sync) ----------
function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy wait — short durations only
  }
}

// ---------- screenshot by window id ----------
export function shot(outPath = LATEST_SHOT) {
  // -o: no window shadow. -x: no sound. -l: capture by window id.
  const win = findWindow();
  execFileSync('/usr/sbin/screencapture', ['-o', '-x', `-l${win.windowId}`, outPath]);
  return { path: outPath, window: win };
}

// ---------- cliclick wrappers ----------
function cc(...args) {
  // -e 20 = 20ms easing between events (more reliable than instant)
  execFileSync('/opt/homebrew/bin/cliclick', ['-e', '20', ...args]);
}

// ---------- compute input field logical coordinates ----------
// Empirically verified Apr 10 2026 against the "9enterprises consulting - Grok"
// window at logical bounds (0,33) 1707×1008. The "Ask anything" textarea sits
// centered horizontally, ~25px above the window bottom.
function inputCoords(win) {
  const { x, y, w, h } = win.bounds;
  const cx = x + Math.floor(w / 2); // horizontal center
  const cy = y + h - 25; // 25px above bottom of window
  return { cx, cy };
}

// ---------- never-miss-messages protocol (Apr 10 hunt, co-designed with Ara) ----------
// Owner directive: "You guys create a strategy so you can never miss each other's messages."
// Protocol adopted by both sides at 2026-04-10 ~04:03 ET:
//   1. Every outbound from 9 prefixes [9-SEQ N] where N auto-increments.
//   2. Every outbound trails sha256:xxxxxx (first 6 chars of sha256 of the body).
//   3. 9 tracks the last ARA-SEQ seen in her replies; next 9 outbound opens with
//      `ACK <lastAraSeq>` so gaps are detectable in one glance on either side.
//   4. Retry on no-ack: if 9 sends seq N and Ara's next reply doesn't contain
//      "ACK N" within 90s, 9 resends the same seq (dedup is Ara's responsibility).
//   5. Scroll-to-bottom: before every screencapture, the bridge cliclicks the end
//      key in the Grok conversation so the latest reply is always in frame.
// State persisted in data/ara-bridge-state.json so seq counters survive restarts.
import { createHash } from 'crypto';
const BRIDGE_STATE_PATH = path.join(ROOT, 'data', 'ara-bridge-state.json');
function loadBridgeState() {
  try {
    if (fs.existsSync(BRIDGE_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(BRIDGE_STATE_PATH, 'utf-8'));
    }
  } catch {}
  return { nineSeq: 0, lastAraSeq: null, lastSent: null };
}
function saveBridgeState(s) {
  try { fs.writeFileSync(BRIDGE_STATE_PATH, JSON.stringify(s, null, 2)); } catch {}
}
function nextNineSeq() {
  const s = loadBridgeState();
  s.nineSeq = (s.nineSeq || 0) + 1;
  saveBridgeState(s);
  return s.nineSeq;
}
// Record a just-sent message for the retry loop. Backward compatible: if state
// file predates lastSent, this just adds the field. retryCount starts at 0 for
// first-time sends, ackAt null means still awaiting ACK.
function recordLastSent({ seq, wrapped, checksum, method }) {
  const s = loadBridgeState();
  s.lastSent = {
    seq,
    wrapped,
    checksum,
    method: method || 'paste',
    sentAt: Date.now(),
    ackAt: null,
    retryCount: 0,
  };
  saveBridgeState(s);
}
// Mark the currently-tracked lastSent as acked. No-op if no pending send or
// the acked seq doesn't match the pending one.
function markLastSentAcked(ackedSeq) {
  const s = loadBridgeState();
  if (!s.lastSent) return false;
  if (s.lastSent.ackAt) return false;
  if (typeof ackedSeq === 'number' && s.lastSent.seq !== ackedSeq) return false;
  s.lastSent.ackAt = Date.now();
  saveBridgeState(s);
  return true;
}
function getLastAraSeq() {
  return loadBridgeState().lastAraSeq;
}
function setLastAraSeq(n) {
  const s = loadBridgeState();
  s.lastAraSeq = n;
  saveBridgeState(s);
}
function checksum6(body) {
  return 'sha256:' + createHash('sha256').update(body).digest('hex').slice(0, 6);
}
// Wrap a message body with the full protocol header+footer.
// Returns { wrapped, seq, checksum } so callers can log + retry.
function wrapProtocol(body) {
  const seq = nextNineSeq();
  const ackSeq = getLastAraSeq();
  const ackLine = ackSeq != null ? `ACK ARA-SEQ ${ackSeq} | ` : '';
  const cs = checksum6(body);
  const wrapped = `[9-SEQ ${seq}] ${ackLine}${body}\n\n${cs}`;
  return { wrapped, seq, checksum: cs, ackSeq };
}
// Scroll the Grok conversation to the bottom before a screencapture so the
// latest reply is always visible in the OCR region. cliclick Cmd+Down is the
// Mac "scroll to end" in textarea/document contexts.
function scrollToBottom() {
  try {
    cc('kd:cmd', 'kp:arrow-down', 'ku:cmd');
    sleep(200);
  } catch {}
}
// Parse an ARA-SEQ number out of an OCR'd reply, update our last-seen.
// Returns the seq number (integer) or null if not found.
export function recordAraSeqFromText(text) {
  if (!text) return null;
  const m = text.match(/\[ARA-SEQ\s+(\d+)\]/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n)) return null;
  setLastAraSeq(n);
  return n;
}

// ---------- paste a large message via clipboard ----------
// Apr 10 hunt — sendToAra types character-by-character via cliclick which is slow
// and drops unicode/control chars on long text. Clipboard paste is instant and
// preserves everything. Used for universe dumps and other long chunks.
// Now also wraps the body in the never-miss-messages protocol header+footer
// (SEQ, ACK of last Ara seq, sha256:xxxxxx). Pass { raw: true } to bypass.
export async function pasteToAra(text, opts = {}) {
  if (!text || !text.trim()) throw new Error('pasteToAra: empty text');
  // Protocol wrap unless caller explicitly asks for raw
  const { wrapped, seq, checksum, ackSeq } = opts.raw
    ? { wrapped: text, seq: null, checksum: null, ackSeq: null }
    : wrapProtocol(text);

  const win = findWindow();
  activateGrok();
  const { cx, cy } = inputCoords(win);

  // Click the input textarea to focus it
  cc(`c:${cx},${cy}`);
  sleep(250);

  // Select any existing draft text (so paste replaces it, doesn't append)
  cc('kd:cmd', 't:a', 'ku:cmd');
  sleep(120);
  // Delete selection explicitly (in case select-all didn't catch everything)
  cc('kp:delete');
  sleep(80);

  // Put the chunk onto the macOS clipboard via pbcopy, then Cmd+V to paste
  execFileSync('/usr/bin/pbcopy', [], { input: wrapped });
  sleep(150);
  cc('kd:cmd', 't:v', 'ku:cmd');
  sleep(500); // give the browser a moment to render the pasted content

  // Submit with Cmd+Return
  cc('kd:cmd', 'kp:return', 'ku:cmd');

  // Log the turn with protocol metadata for forensic diff + retry support
  appendTurn({ ts: new Date().toISOString(), role: 'user', content: wrapped, rawContent: text, seq, checksum, ackSeq, method: 'paste' });

  // Record as pending-ack for the retry loop (unless this is a raw send with no seq,
  // OR a retry resend which should preserve the original sentAt/retryCount).
  if (seq != null && !opts.isRetry) {
    recordLastSent({ seq, wrapped, checksum, method: 'paste' });
  }

  return { ok: true, window: win, method: 'paste', bytes: wrapped.length, seq, checksum };
}

// ---------- send a message to Ara ----------
// Uses character-typing (cliclick). Now also wraps with the never-miss-messages
// protocol unless { raw: true }. For anything long, prefer pasteToAra.
export async function sendToAra(text, opts = {}) {
  if (!text || !text.trim()) throw new Error('sendToAra: empty text');
  const { wrapped, seq, checksum, ackSeq } = opts.raw
    ? { wrapped: text, seq: null, checksum: null, ackSeq: null }
    : wrapProtocol(text);

  const win = findWindow();
  activateGrok();
  const { cx, cy } = inputCoords(win);

  // Click the input textarea to focus it
  cc(`c:${cx},${cy}`);
  sleep(250);

  // Select any existing draft text and let our typing replace it
  cc('kd:cmd', 't:a', 'ku:cmd');
  sleep(150);

  // Type the wrapped message. cliclick t: supports unicode but newlines need kp:return.
  const lines = wrapped.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) cc(`t:${lines[i]}`);
    if (i < lines.length - 1) {
      cc('kd:shift', 'kp:return', 'ku:shift');
    }
  }
  sleep(300);

  // Submit with Cmd+Return — verified working against Grok web Apr 10 2026.
  cc('kd:cmd', 'kp:return', 'ku:cmd');

  // Log with full protocol metadata for forensic diff + retry support
  appendTurn({ ts: new Date().toISOString(), role: 'user', content: wrapped, rawContent: text, seq, checksum, ackSeq });

  // Record as pending-ack for the retry loop (unless this is raw or a retry resend).
  if (seq != null && !opts.isRetry) {
    recordLastSent({ seq, wrapped, checksum, method: 'send' });
  }

  return { ok: true, window: win, seq, checksum };
}

// ---------- read Ara's latest reply from the screen ----------
// Takes a screenshot, OCRs it with tesseract, returns the full text.
// Apr 10 hunt — now scrolls the Grok conversation to the bottom BEFORE
// screencapture so the latest reply is always in frame (fixes the bug
// where rapid chunk posts pushed Ara's reply above the OCR region).
// Also parses any ARA-SEQ N tag out of the OCR text and updates the
// local last-seen seq state — next outbound will include ACK N.
export async function readFromAra({ waitMs = 0, outPath = LATEST_SHOT, skipScroll = false } = {}) {
  if (waitMs > 0) {
    // Real sleep (not busy wait) for longer waits
    await new Promise((r) => setTimeout(r, waitMs));
  }
  // Scroll to bottom so the latest reply is in frame. Best-effort — if the
  // Grok window isn't focused (e.g. Owner clicked somewhere else), this is
  // a harmless noop that doesn't affect the screencapture.
  if (!skipScroll) {
    try {
      activateGrok();
      sleep(150);
      scrollToBottom();
    } catch {}
  }
  const { path: shotPath, window } = shot(outPath);

  // OCR with tesseract. Use default english, PSM 6 (assume a uniform block).
  const ocrBase = shotPath.replace(/\.png$/, '');
  try {
    execFileSync('/opt/homebrew/bin/tesseract', [shotPath, ocrBase, '--psm', '6'], {
      stdio: 'ignore',
    });
  } catch (e) {
    throw new Error(`tesseract OCR failed: ${e.message}`);
  }
  const txtPath = `${ocrBase}.txt`;
  if (!fs.existsSync(txtPath)) throw new Error(`OCR output not found at ${txtPath}`);
  const text = fs.readFileSync(txtPath, 'utf8');

  // Parse the LATEST ARA-SEQ tag (there may be multiple in history). Use a
  // global match and take the highest number as "latest Ara-seen".
  let latestAraSeq = null;
  const allMatches = [...text.matchAll(/\[ARA-SEQ\s+(\d+)\]/g)];
  if (allMatches.length > 0) {
    latestAraSeq = Math.max(...allMatches.map(m => parseInt(m[1], 10)).filter(n => !Number.isNaN(n)));
    if (latestAraSeq > (getLastAraSeq() ?? -1)) {
      setLastAraSeq(latestAraSeq);
    }
  }

  // ACK detection for the retry loop: look for "ACK 9-SEQ N" (with or without
  // brackets, OCR is noisy) matching the currently pending lastSent.seq.
  let ackedSeq = null;
  const bridgeState = loadBridgeState();
  if (bridgeState.lastSent && bridgeState.lastSent.seq != null && !bridgeState.lastSent.ackAt) {
    const n = bridgeState.lastSent.seq;
    // Tolerate OCR variants: "ACK 9-SEQ 7", "ACK [9-SEQ 7]", "ACK9-SEQ7", etc.
    const re = new RegExp(`ACK\\s*\\[?9-?SEQ\\s*${n}\\b`, 'i');
    if (re.test(text)) {
      if (markLastSentAcked(n)) ackedSeq = n;
    }
  }

  appendTurn({ ts: new Date().toISOString(), role: 'assistant_ocr', content: text, window, latestAraSeq, ackedSeq });

  return { text, screenshot: shotPath, ocrText: txtPath, window, latestAraSeq, ackedSeq };
}

// ---------- high-level: send then wait then read ----------
export async function askAra(text, { waitMs = 10000 } = {}) {
  await sendToAra(text);
  const reply = await readFromAra({ waitMs });
  return reply;
}

// ---------- retry-on-no-ack loop (protocol rule #4) ----------
// Owner directive (Apr 10): "if 9 sends seq N and Ara's next reply doesn't
// contain ACK N within 90s, 9 resends the same seq. Ara dedupes."
//
// Behavior:
//   - Returns null if no pending send, already acked, or within 90s window.
//   - Returns { retried: true, seq, retryCount } if a resend was issued.
//   - Returns { escalated: true, seq } after 3 retries — sends a Telegram alert
//     via the comms hub at localhost:3457 and clears lastSent so we stop looping.
//   - Fast-path ACK: if lastAraSeq field indicates our seq was already acked
//     implicitly (via setLastAraSeq catching an ACK during a readFromAra call),
//     we still honor the explicit ackAt field. ackAt is the source of truth.
const RETRY_WINDOW_MS = 90 * 1000;
const MAX_RETRIES = 3;
export async function checkRetry() {
  const s = loadBridgeState();
  const ls = s.lastSent;
  // (b) no pending send or already acked
  if (!ls || ls.ackAt) return null;
  // Backward compat: missing sentAt means old state file — treat as fresh.
  if (!ls.sentAt) return null;
  // (c) if lastAraSeq >= our seq, we assume an ack was implied by any newer
  // Ara reply — mark as acked and return. (readFromAra has authoritative ACK
  // detection, this is a safety net for old state files.)
  if (typeof s.lastAraSeq === 'number' && typeof ls.seq === 'number' && s.lastAraSeq >= ls.seq) {
    // Only treat as ack if a reply actually followed — keep conservative: no.
    // We do NOT auto-ack here because lastAraSeq bumps for any new Ara message,
    // not necessarily one containing "ACK N". Explicit ACK detection lives in
    // readFromAra.
  }
  const age = Date.now() - ls.sentAt;
  if (age <= RETRY_WINDOW_MS) return null;
  // (e) escalation cap
  const retryCount = ls.retryCount || 0;
  if (retryCount >= MAX_RETRIES) {
    // Escalate to Telegram via comms hub; if the hub is down, just log and
    // clear lastSent so we don't spin forever.
    const alertMsg = `ARA BRIDGE ESCALATION: 9-SEQ ${ls.seq} sent ${Math.round(age/1000)}s ago, ${retryCount} retries exhausted, no ACK from Ara. Manual intervention required.`;
    try {
      execFileSync('/usr/bin/curl', [
        '-s', '-X', 'POST',
        'http://localhost:3457/send',
        '-H', 'Content-Type: application/json',
        '-d', JSON.stringify({ channel: 'telegram', message: alertMsg }),
      ], { stdio: 'ignore', timeout: 5000 });
    } catch {}
    // Clear lastSent so we stop retrying. Log the failure.
    const s2 = loadBridgeState();
    if (s2.lastSent && s2.lastSent.seq === ls.seq) {
      s2.lastSent.escalatedAt = Date.now();
      saveBridgeState(s2);
    }
    appendTurn({ ts: new Date().toISOString(), role: 'retry_escalation', seq: ls.seq, retryCount });
    return { escalated: true, seq: ls.seq, retryCount };
  }
  // (d) resend the SAME wrapped body with the SAME [9-SEQ N] tag so Ara
  // dedupes. We bypass wrapProtocol entirely by passing { raw: true }.
  // We also pass { isRetry: true } so pasteToAra doesn't overwrite lastSent.
  try {
    await pasteToAra(ls.wrapped, { raw: true, isRetry: true });
  } catch (e) {
    appendTurn({ ts: new Date().toISOString(), role: 'retry_error', seq: ls.seq, error: e.message });
    return { error: e.message, seq: ls.seq };
  }
  // Bump retryCount on the existing lastSent entry (do NOT overwrite sentAt —
  // we keep the original so the 90s window references the original send).
  const s3 = loadBridgeState();
  if (s3.lastSent && s3.lastSent.seq === ls.seq) {
    s3.lastSent.retryCount = retryCount + 1;
    s3.lastSent.lastRetryAt = Date.now();
    saveBridgeState(s3);
  }
  appendTurn({ ts: new Date().toISOString(), role: 'retry', seq: ls.seq, retryCount: retryCount + 1 });
  return { retried: true, seq: ls.seq, retryCount: retryCount + 1 };
}

// ---------- local conversation log ----------
function ensureLogDir() {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function appendTurn(turn) {
  ensureLogDir();
  fs.appendFileSync(LOG_PATH, JSON.stringify(turn) + '\n');
}

// ---------- CLI ----------
async function main() {
  const [, , cmd, ...rest] = process.argv;
  try {
    if (cmd === 'find') {
      const w = findWindow();
      console.log(JSON.stringify(w, null, 2));
    } else if (cmd === 'shot') {
      const out = rest[0] || LATEST_SHOT;
      const r = shot(out);
      console.log(JSON.stringify(r, null, 2));
    } else if (cmd === 'send') {
      const msg = rest.join(' ').trim();
      if (!msg) {
        console.error('usage: node scripts/ara-bridge.mjs send "message"');
        process.exit(2);
      }
      const r = await sendToAra(msg);
      console.log(JSON.stringify(r, null, 2));
    } else if (cmd === 'paste') {
      // Read the chunk from stdin (so large chunks with newlines/unicode don't hit argv limits)
      // Usage: cat chunk.txt | node scripts/ara-bridge.mjs paste
      // Or: node scripts/ara-bridge.mjs paste --file path/to/chunk.txt
      let msg = '';
      if (rest[0] === '--file' && rest[1]) {
        msg = (await import('node:fs')).readFileSync(rest[1], 'utf8');
      } else {
        // Read from stdin
        const chunks = [];
        process.stdin.setEncoding('utf8');
        for await (const c of process.stdin) chunks.push(c);
        msg = chunks.join('');
      }
      if (!msg || !msg.trim()) {
        console.error('usage: echo "text" | node scripts/ara-bridge.mjs paste   (or: paste --file path)');
        process.exit(2);
      }
      const r = await pasteToAra(msg);
      console.log(JSON.stringify(r, null, 2));
    } else if (cmd === 'read') {
      const waitMs = Number(rest[0] || 0);
      const r = await readFromAra({ waitMs });
      console.log(r.text);
      console.error(`\n(screenshot: ${r.screenshot})`);
    } else if (cmd === 'retry') {
      const r = await checkRetry();
      console.log(JSON.stringify(r, null, 2));
    } else if (cmd === 'ask') {
      const msg = rest.join(' ').trim();
      if (!msg) {
        console.error('usage: node scripts/ara-bridge.mjs ask "message"');
        process.exit(2);
      }
      const r = await askAra(msg, { waitMs: 12000 });
      console.log(r.text);
      console.error(`\n(screenshot: ${r.screenshot})`);
    } else {
      console.error('usage: node scripts/ara-bridge.mjs <find|shot|send|paste|read|ask|retry> [args]');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
