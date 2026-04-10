#!/usr/bin/env node
/**
 * your9-calendar.mjs — AI CEO Calendar Management System
 * Your9 by 9 Enterprises
 *
 * High-level calendar intelligence layer that wraps the Google Calendar connector
 * in your9-integrations.mjs with CEO-grade scheduling logic:
 *
 *   getCalendar()         — Fetch upcoming events from primary (Google) and secondary (Outlook)
 *   createEvent()         — Create a calendar event with AI-generated agenda
 *   findAvailableSlots()  — Find open slots across a date range respecting existing commitments
 *   sendInvite()          — Create event + send confirmation email to all attendees
 *   blockTime()           — Reserve focus blocks or personal time
 *   sendMeetingPrep()     — 15-min pre-meeting briefing via the instance notification channel
 *
 * Secondary calendar (Outlook) is supported via Microsoft Graph API.
 * It is optional — if not configured, all operations fall back to Google only.
 *
 * Storage:
 *   instances/{id}/data/calendar/prep-sent.json  — tracks prep briefs already sent (prevents dupe)
 *   instances/{id}/data/calendar/blocked.json    — local record of blocks created by this module
 *
 * CLI:
 *   node scripts/your9-calendar.mjs --instance <id> --get-calendar [--days 7]
 *   node scripts/your9-calendar.mjs --instance <id> --find-slots --date 2026-04-14 --duration 60
 *   node scripts/your9-calendar.mjs --instance <id> --block-time --date 2026-04-14 --start 09:00 --end 12:00 --title "Deep Work"
 *   node scripts/your9-calendar.mjs --instance <id> --send-prep --event-id <googleEventId>
 *   node scripts/your9-calendar.mjs --instance <id> --check-prep   (run on cron — sends any due briefs)
 *
 * Exports (for use by your9-ceo.mjs and other agents):
 *   getCalendar(instanceDir, options)
 *   createEvent(instanceDir, eventSpec)
 *   findAvailableSlots(instanceDir, options)
 *   sendInvite(instanceDir, inviteSpec)
 *   blockTime(instanceDir, blockSpec)
 *   sendMeetingPrep(instanceDir, eventId)
 */

import {
  existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const INSTANCES = join(ROOT, 'instances');
const LOG_FILE  = join(ROOT, 'logs', 'your9-calendar.log');

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const SONNET_MODEL = 'claude-sonnet-4-5';  // agenda generation, briefing writing
// Opus not used here — agenda/briefing are Sonnet-grade tasks

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  const ts  = new Date().toISOString();
  const line = `[${ts}] CALENDAR: ${msg}`;
  process.stdout.write(line + '\n');
  try {
    mkdirSync(join(ROOT, 'logs'), { recursive: true });
    appendFileSync(LOG_FILE, line + '\n');
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = (argv[i + 1] && !argv[i + 1].startsWith('--'))
        ? argv[++i]
        : true;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// .env loader — does NOT pollute process.env
// ---------------------------------------------------------------------------

function loadEnv(envPath) {
  const env = {};
  if (!existsSync(envPath)) return env;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
    env[k] = v;
  }
  return env;
}

function getApiKey(instanceDir) {
  // First try instance-level key, then fall back to project root .env
  const instEnv = loadEnv(join(instanceDir, 'config', '.env'));
  if (instEnv.ANTHROPIC_API_KEY) return instEnv.ANTHROPIC_API_KEY;
  const rootEnv = loadEnv(join(ROOT, '.env'));
  return rootEnv.ANTHROPIC_API_KEY || '';
}

// ---------------------------------------------------------------------------
// Anthropic HTTPS helper — no SDK dependency
// ---------------------------------------------------------------------------

function anthropicPost(apiKey, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, res => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        try {
          const d = JSON.parse(buf);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(d);
          } else {
            reject(new Error(`Anthropic ${res.statusCode}: ${d.error?.message || buf}`));
          }
        } catch (e) {
          reject(new Error(`Anthropic parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Google Calendar raw API helpers
// These call the Google Calendar REST API directly — the integrations layer
// only exposes calendar.list and calendar.create. For update/delete/freebusy
// we need direct access.
// ---------------------------------------------------------------------------

function googleGet(accessToken, path, qs = {}) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams(qs).toString();
    const fullPath = query ? `${path}?${query}` : path;
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: fullPath,
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let data;
        try { data = JSON.parse(raw); } catch { data = raw; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Google GET ${path} → ${res.statusCode}: ${typeof data === 'object' ? JSON.stringify(data) : data}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function googlePost(accessToken, path, body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: 'www.googleapis.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let data;
        try { data = JSON.parse(raw); } catch { data = raw; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Google ${method} ${path} → ${res.statusCode}: ${typeof data === 'object' ? JSON.stringify(data) : data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function googleDelete(accessToken, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, res => {
      if (res.statusCode === 204 || (res.statusCode >= 200 && res.statusCode < 300)) {
        resolve({ deleted: true });
      } else {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          reject(new Error(`Google DELETE ${path} → ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
        });
      }
      res.on('data', () => {});
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Microsoft Graph (Outlook) helpers — secondary calendar, optional
// Credential fields expected in secrets.outlook:
//   access_token  — Graph API access token
//   refresh_token — for auto-refresh
//   client_id, client_secret, tenant_id — for refresh
//   token_expiry  — ISO timestamp
// ---------------------------------------------------------------------------

async function outlookRefreshIfNeeded(creds) {
  if (!creds) return null;
  if (creds.access_token && creds.token_expiry) {
    const expiry = new Date(creds.token_expiry).getTime();
    if (Date.now() < expiry - 60000) return creds.access_token;
  }
  if (!creds.refresh_token || !creds.client_id || !creds.client_secret || !creds.tenant_id) {
    return null; // can't refresh, skip Outlook
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refresh_token,
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    scope: 'https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Mail.Send offline_access',
  }).toString();

  const token = await new Promise((resolve, reject) => {
    const data = Buffer.from(body);
    const req = https.request({
      hostname: 'login.microsoftonline.com',
      path: `/${creds.tenant_id}/oauth2/v2.0/token`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': data.byteLength,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const d = JSON.parse(Buffer.concat(chunks).toString());
          if (d.access_token) {
            creds.access_token  = d.access_token;
            creds.token_expiry  = new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString();
            if (d.refresh_token) creds.refresh_token = d.refresh_token;
            resolve(d.access_token);
          } else {
            resolve(null); // refresh failed — skip Outlook
          }
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
  return token;
}

function graphGet(accessToken, path, qs = {}) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams(qs).toString();
    const fullPath = query ? `${path}?${query}` : path;
    const req = https.request({
      hostname: 'graph.microsoft.com',
      path: fullPath,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const d = JSON.parse(Buffer.concat(chunks).toString());
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(d);
          } else {
            reject(new Error(`Graph GET ${path} → ${res.statusCode}: ${d.error?.message || ''}`));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Credentials loading from the integrations layer
// Replicates the integrations layer decryption to avoid a circular dependency.
// Uses the same key source (YOUR9_INT_KEY in instances/{id}/config/.env).
// ---------------------------------------------------------------------------

async function loadSecrets(instanceDir) {
  const envPath = join(instanceDir, 'config', '.env');
  const env     = loadEnv(envPath);
  const hexKey  = env['YOUR9_INT_KEY'];
  if (!hexKey || hexKey.length !== 64) return {};

  const secretsPath = join(instanceDir, 'config', 'integrations-secrets.enc');
  if (!existsSync(secretsPath)) return {};

  try {
    const { createDecipheriv } = await import('crypto');
    const key        = Buffer.from(hexKey, 'hex');
    const fileBuffer = readFileSync(secretsPath);
    if (fileBuffer.length < 16) return {};
    const iv         = fileBuffer.slice(0, 16);
    const ciphertext = fileBuffer.slice(16);
    const decipher   = createDecipheriv('aes-256-cbc', key, iv);
    const plain      = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
    return JSON.parse(plain);
  } catch {
    return {};
  }
}

async function getGoogleCreds(instanceDir) {
  const secrets = await loadSecrets(instanceDir);
  const creds   = secrets['google_workspace'];
  if (!creds) throw new Error('Google Workspace not configured for this instance. Run configureIntegration first.');
  return creds;
}

async function getGoogleToken(instanceDir) {
  const creds = await getGoogleCreds(instanceDir);

  // Check if current token is still valid
  if (creds.access_token && creds.token_expiry) {
    const expiry = new Date(creds.token_expiry).getTime();
    if (Date.now() < expiry - 60000) return creds.access_token;
  }

  // Refresh
  if (!creds.refresh_token) throw new Error('Google: no refresh_token — re-authorize via your9-integrations.mjs');
  if (!creds.client_id || !creds.client_secret) {
    throw new Error('Google: client_id and client_secret required for token refresh');
  }

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: creds.refresh_token,
    client_id:     creds.client_id,
    client_secret: creds.client_secret,
  }).toString();

  const refreshData = await new Promise((resolve, reject) => {
    const buf = Buffer.from(body);
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path:     '/token',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': buf.byteLength,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });

  if (!refreshData.access_token) {
    throw new Error(`Google token refresh failed: ${JSON.stringify(refreshData)}`);
  }
  return refreshData.access_token;
}

async function getOutlookToken(instanceDir) {
  const secrets = await loadSecrets(instanceDir);
  const creds   = secrets['outlook'];
  if (!creds) return null; // Outlook is optional
  return outlookRefreshIfNeeded(creds);
}

// ---------------------------------------------------------------------------
// Local data store helpers (prep-sent, blocked)
// ---------------------------------------------------------------------------

function calendarDataDir(instanceDir) {
  const dir = join(instanceDir, 'data', 'calendar');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function loadJson(filePath, defaultVal = {}) {
  if (!existsSync(filePath)) return defaultVal;
  try { return JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return defaultVal; }
}

function saveJson(filePath, data) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Agenda generation — Sonnet writes the meeting agenda
// ---------------------------------------------------------------------------

async function generateAgenda(apiKey, { title, attendees, purpose, context = '' }) {
  const attendeeList = attendees.length
    ? attendees.map(a => (typeof a === 'string' ? a : `${a.name || ''} (${a.email || ''})`)).join(', ')
    : 'No external attendees';

  const prompt = `You are an AI executive assistant writing a concise, professional meeting agenda.

Meeting: ${title}
Attendees: ${attendeeList}
Purpose: ${purpose || 'General business discussion'}
${context ? `Business context: ${context}` : ''}

Write a structured agenda with 3-5 bullet points. Each point should be actionable. Keep it under 150 words. No preamble — start directly with the agenda items.`;

  try {
    const res = await anthropicPost(apiKey, {
      model: SONNET_MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.content?.[0]?.text?.trim() || 'Agenda pending.';
  } catch (err) {
    log(`Agenda generation failed (non-fatal): ${err.message}`);
    return `• Introductions and context\n• ${purpose || 'Main discussion'}\n• Action items and next steps`;
  }
}

// ---------------------------------------------------------------------------
// Meeting prep briefing — Sonnet writes the 15-min pre-meeting brief
// ---------------------------------------------------------------------------

async function generateMeetingPrep(apiKey, { event, attendeeInfo = [], businessContext = '' }) {
  const attendeeDetails = attendeeInfo.length
    ? attendeeInfo.map(a => `- ${a.name || a.email}: ${a.title || ''} at ${a.company || 'unknown company'}`).join('\n')
    : '- No detailed attendee info available';

  const prompt = `You are an AI CEO briefing a founder 15 minutes before a meeting.

Meeting: ${event.summary}
Time: ${event.start}
Location/Link: ${event.location || event.conferenceLink || 'Not specified'}
Attendees:
${attendeeDetails}

${event.description ? `Agenda:\n${event.description}\n` : ''}
${businessContext ? `Business context: ${businessContext}` : ''}

Write a tight pre-meeting brief. Include:
1. Who you're meeting (1 line per person — name, role, why they matter)
2. What to accomplish in this meeting (2-3 bullet points)
3. Suggested talking points or questions (2-3 bullets)
4. Any known context or history

Keep it under 250 words. Tone: confident, direct. No fluff.`;

  try {
    const res = await anthropicPost(apiKey, {
      model: SONNET_MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.content?.[0]?.text?.trim() || 'Meeting brief unavailable.';
  } catch (err) {
    log(`Prep generation failed: ${err.message}`);
    return `Meeting in 15 minutes: ${event.summary}\nAttendees: ${event.attendees?.join(', ') || 'unknown'}\nLocation: ${event.location || 'not specified'}`;
  }
}

// ---------------------------------------------------------------------------
// Notification — send prep brief via instance's notification config
// Reads the notification endpoint from instances/{id}/config/config.json
// Falls back to logging if no notification config.
// ---------------------------------------------------------------------------

async function sendNotification(instanceDir, message) {
  const configPath = join(instanceDir, 'config', 'config.json');
  const config     = loadJson(configPath);
  const webhook    = config.notificationWebhook || config.telegramWebhook || null;

  if (!webhook) {
    log(`[NOTIFY — no webhook configured] ${message}`);
    return { sent: false, reason: 'no notification webhook configured' };
  }

  // Webhook format: POST { text: message }
  return new Promise((resolve) => {
    let url;
    try { url = new URL(webhook); } catch {
      log(`Invalid notification webhook URL: ${webhook}`);
      resolve({ sent: false, reason: 'invalid webhook URL' });
      return;
    }

    const body   = JSON.stringify({ text: message });
    const isHttp  = url.protocol === 'http:';
    const lib    = isHttp ? http : https;

    const req = lib.request({
      hostname: url.hostname,
      port:     url.port || (isHttp ? 80 : 443),
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      res.on('data', () => {});
      res.on('end', () => {
        resolve({ sent: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
      });
    });
    req.on('error', err => {
      log(`Notification send failed: ${err.message}`);
      resolve({ sent: false, reason: err.message });
    });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Normalize events from Google Calendar API response
// ---------------------------------------------------------------------------

function normalizeGoogleEvent(e) {
  const attendees = (e.attendees || []).map(a => ({
    email:         a.email,
    name:          a.displayName || a.email,
    responseStatus: a.responseStatus || 'needsAction',
    self:          a.self || false,
  }));
  return {
    id:            e.id,
    source:        'google',
    summary:       e.summary || '(No title)',
    start:         e.start?.dateTime || e.start?.date || '',
    end:           e.end?.dateTime   || e.end?.date   || '',
    location:      e.location || '',
    description:   e.description || '',
    attendees,
    htmlLink:      e.htmlLink || '',
    conferenceLink: e.conferenceData?.entryPoints?.[0]?.uri || '',
    status:        e.status || 'confirmed',
    recurrence:    e.recurrence || null,
    organizer:     e.organizer?.email || '',
  };
}

function normalizeOutlookEvent(e) {
  const attendees = (e.attendees || []).map(a => ({
    email:         a.emailAddress?.address || '',
    name:          a.emailAddress?.name    || '',
    responseStatus: a.status?.response     || 'none',
    self:          false,
  }));
  return {
    id:            e.id,
    source:        'outlook',
    summary:       e.subject || '(No title)',
    start:         e.start?.dateTime || '',
    end:           e.end?.dateTime   || '',
    location:      e.location?.displayName || '',
    description:   e.bodyPreview || '',
    attendees,
    htmlLink:      e.webLink || '',
    conferenceLink: e.onlineMeetingUrl || '',
    status:        e.showAs || 'busy',
    recurrence:    e.recurrence || null,
    organizer:     e.organizer?.emailAddress?.address || '',
  };
}

// ---------------------------------------------------------------------------
// Working hours config
// Default: Mon-Fri 9am-6pm in the instance's configured timezone
// ---------------------------------------------------------------------------

function getWorkingHours(instanceDir) {
  const config = loadJson(join(instanceDir, 'config', 'config.json'));
  return {
    timezone:   config.timezone         || 'America/New_York',
    startHour:  config.workStartHour    ?? 9,
    endHour:    config.workEndHour      ?? 18,
    workDays:   config.workDays         || [1, 2, 3, 4, 5], // Mon-Fri
    slotBuffer: config.calSlotBuffer    ?? 15, // minutes of buffer between meetings
  };
}

// ---------------------------------------------------------------------------
// Slot finder — parses busy times and returns open slots
// ---------------------------------------------------------------------------

function findOpenSlots(busyIntervals, dateStr, durationMinutes, workingHours) {
  const { startHour, endHour } = workingHours;

  // Build a day-start and day-end in UTC-like ms (we work in absolute ms)
  // dateStr format: YYYY-MM-DD
  const [year, month, day] = dateStr.split('-').map(Number);
  const dayStart = new Date(Date.UTC(year, month - 1, day, startHour, 0, 0)).getTime();
  const dayEnd   = new Date(Date.UTC(year, month - 1, day, endHour, 0, 0)).getTime();
  const duration = durationMinutes * 60 * 1000;
  const buffer   = (workingHours.slotBuffer || 15) * 60 * 1000;

  // Sort and merge overlapping busy intervals
  const sorted = busyIntervals
    .map(b => ({
      start: new Date(b.start).getTime(),
      end:   new Date(b.end).getTime() + buffer,
    }))
    .filter(b => b.end > dayStart && b.start < dayEnd)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const b of sorted) {
    if (merged.length && b.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, b.end);
    } else {
      merged.push({ ...b });
    }
  }

  // Walk the day, find gaps >= duration
  const slots  = [];
  let cursor   = dayStart;

  for (const busy of merged) {
    if (cursor + duration <= busy.start) {
      // There's a slot before this busy block
      slots.push({
        start:     new Date(cursor).toISOString(),
        end:       new Date(cursor + duration).toISOString(),
        durationMinutes,
      });
    }
    cursor = Math.max(cursor, busy.end);
  }

  // Check for slot after last busy block
  if (cursor + duration <= dayEnd) {
    slots.push({
      start:     new Date(cursor).toISOString(),
      end:       new Date(cursor + duration).toISOString(),
      durationMinutes,
    });
  }

  // Return up to 6 options (don't overwhelm the founder)
  return slots.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * getCalendar(instanceDir, options)
 *
 * Fetch upcoming events from Google Calendar (primary) and optionally Outlook (secondary).
 *
 * options:
 *   days          {number}  How many days ahead to look (default: 7)
 *   calendarId    {string}  Google calendar ID (default: 'primary')
 *   maxResults    {number}  Max events per source (default: 20)
 *   includePast   {boolean} Include events that have already started (default: false)
 *
 * Returns:
 *   { google: Event[], outlook: Event[], combined: Event[], total: number }
 */
export async function getCalendar(instanceDir, options = {}) {
  const {
    days        = 7,
    calendarId  = 'primary',
    maxResults  = 20,
    includePast = false,
  } = options;

  const token    = await getGoogleToken(instanceDir);
  const timeMin  = includePast ? undefined : new Date().toISOString();
  const timeMax  = new Date(Date.now() + days * 86400000).toISOString();

  log(`getCalendar — fetching ${days} days ahead (Google + Outlook)`);

  // Google Calendar
  const gData = await googleGet(token, `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    maxResults:   Math.min(maxResults, 100),
    orderBy:      'startTime',
    singleEvents: 'true',
    ...(timeMin ? { timeMin } : {}),
    timeMax,
  });

  const googleEvents = (gData.items || []).map(normalizeGoogleEvent);

  // Outlook (optional)
  let outlookEvents = [];
  try {
    const outlookToken = await getOutlookToken(instanceDir);
    if (outlookToken) {
      const start  = timeMin || new Date().toISOString();
      const oData  = await graphGet(outlookToken, '/v1.0/me/calendarView', {
        startDateTime: start,
        endDateTime:   timeMax,
        $top:          String(Math.min(maxResults, 50)),
        $orderby:      'start/dateTime',
        $select:       'id,subject,start,end,location,attendees,bodyPreview,webLink,onlineMeetingUrl,showAs,organizer,recurrence',
      });
      outlookEvents = (oData.value || []).map(normalizeOutlookEvent);
    }
  } catch (err) {
    log(`Outlook calendar fetch failed (non-fatal): ${err.message}`);
  }

  // Merge and sort by start time
  const combined = [...googleEvents, ...outlookEvents]
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  return {
    google:   googleEvents,
    outlook:  outlookEvents,
    combined,
    total:    combined.length,
  };
}

/**
 * createEvent(instanceDir, eventSpec)
 *
 * Create a Google Calendar event with an AI-generated agenda in the description.
 * If description is provided it is used as context for agenda generation, not as the final description.
 *
 * eventSpec:
 *   summary       {string}   Event title (required)
 *   start         {string}   ISO 8601 start datetime (required)
 *   end           {string}   ISO 8601 end datetime (required)
 *   attendees     {string[]|{email,name}[]}  Attendee emails (optional)
 *   purpose       {string}   Meeting purpose — used to generate agenda (optional)
 *   context       {string}   Business context for AI agenda (optional)
 *   location      {string}   Location or video link (optional)
 *   calendarId    {string}   Google calendar ID (default: 'primary')
 *   skipAgenda    {boolean}  Skip AI agenda generation (optional, default: false)
 *   timeZone      {string}   Timezone for the event (default: 'America/New_York')
 *   sendUpdates   {string}   'all'|'externalOnly'|'none' (default: 'all')
 *
 * Returns:
 *   { id, htmlLink, status, agenda, event: normalizedEvent }
 */
export async function createEvent(instanceDir, eventSpec) {
  const {
    summary,
    start,
    end,
    attendees  = [],
    purpose    = '',
    context    = '',
    location   = '',
    calendarId = 'primary',
    skipAgenda = false,
    timeZone   = 'America/New_York',
    sendUpdates = 'all',
  } = eventSpec;

  if (!summary) throw new Error('createEvent requires summary');
  if (!start)   throw new Error('createEvent requires start');
  if (!end)     throw new Error('createEvent requires end');

  const token  = await getGoogleToken(instanceDir);
  const apiKey = getApiKey(instanceDir);

  // Normalize attendee format
  const normalizedAttendees = attendees.map(a =>
    typeof a === 'string' ? { email: a } : { email: a.email, displayName: a.name }
  );

  // Generate agenda unless caller explicitly skips
  let agenda = '';
  if (!skipAgenda && apiKey) {
    agenda = await generateAgenda(apiKey, {
      title:     summary,
      attendees: normalizedAttendees,
      purpose,
      context,
    });
  }

  const event = {
    summary,
    location,
    description: agenda || purpose || '',
    start: { dateTime: start, timeZone },
    end:   { dateTime: end,   timeZone },
    attendees: normalizedAttendees,
  };

  log(`createEvent — "${summary}" @ ${start}`);
  const calPath = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${sendUpdates}`;
  const result  = await googlePost(token, calPath, event);

  return {
    id:      result.id,
    htmlLink: result.htmlLink,
    status:  'created',
    agenda,
    event:   normalizeGoogleEvent(result),
  };
}

/**
 * findAvailableSlots(instanceDir, options)
 *
 * Find open time slots across the requested date range using Google's freebusy API.
 * Considers both Google and Outlook busy times when Outlook is configured.
 *
 * options:
 *   date           {string}   Target date YYYY-MM-DD (required, or use dateRange)
 *   dateRange      {string[]} Array of YYYY-MM-DD strings to check across multiple days
 *   durationMinutes {number}  Meeting duration in minutes (default: 60)
 *   attendeeEmails {string[]} Check attendee availability too (optional)
 *   calendarId     {string}   Google calendar ID (default: 'primary')
 *
 * Returns:
 *   { slots: { date, start, end, durationMinutes }[], checkedDays: number }
 */
export async function findAvailableSlots(instanceDir, options = {}) {
  const {
    date,
    dateRange,
    durationMinutes = 60,
    attendeeEmails  = [],
    calendarId      = 'primary',
  } = options;

  const dates = dateRange || (date ? [date] : []);
  if (!dates.length) throw new Error('findAvailableSlots requires date or dateRange');

  const workingHours = getWorkingHours(instanceDir);
  const token        = await getGoogleToken(instanceDir);

  // Build freebusy request for each date
  const allSlots = [];

  for (const d of dates) {
    const [year, month, day] = d.split('-').map(Number);
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getDay();

    // Skip non-work days
    if (!workingHours.workDays.includes(dayOfWeek)) {
      log(`findAvailableSlots — ${d} is not a work day, skipping`);
      continue;
    }

    const timeMin = new Date(Date.UTC(year, month - 1, day, 0, 0, 0)).toISOString();
    const timeMax = new Date(Date.UTC(year, month - 1, day, 23, 59, 59)).toISOString();

    // Build list of calendars to check
    const items = [{ id: calendarId }];
    for (const email of attendeeEmails) {
      items.push({ id: email });
    }

    const freeBusyResp = await googlePost(
      token,
      '/calendar/v3/freeBusy',
      {
        timeMin,
        timeMax,
        items,
      },
    );

    // Collect all busy intervals
    const busyIntervals = [];
    const calendars = freeBusyResp.calendars || {};
    for (const calData of Object.values(calendars)) {
      for (const b of (calData.busy || [])) {
        busyIntervals.push(b);
      }
    }

    // Also check Outlook busy times
    try {
      const outlookToken = await getOutlookToken(instanceDir);
      if (outlookToken) {
        const oData = await graphGet(outlookToken, '/v1.0/me/calendarView', {
          startDateTime: timeMin,
          endDateTime:   timeMax,
          $select:       'start,end,showAs',
        });
        for (const e of (oData.value || [])) {
          if (e.showAs !== 'free') {
            busyIntervals.push({ start: e.start.dateTime, end: e.end.dateTime });
          }
        }
      }
    } catch { /* Outlook optional */ }

    const daySlots = findOpenSlots(busyIntervals, d, durationMinutes, workingHours);
    for (const s of daySlots) {
      allSlots.push({ date: d, ...s });
    }
  }

  log(`findAvailableSlots — ${allSlots.length} slots found across ${dates.length} day(s)`);
  return {
    slots:       allSlots,
    checkedDays: dates.length,
  };
}

/**
 * sendInvite(instanceDir, inviteSpec)
 *
 * Create the event AND send a confirmation email to each attendee.
 * Uses gmail.send via the integrations layer for the email.
 * The invite email includes the AI-generated agenda.
 *
 * inviteSpec: same as createEvent eventSpec, plus:
 *   fromName    {string}   Sender display name in the email body (optional)
 *   emailSubject {string}  Override email subject (optional)
 *
 * Returns:
 *   { event: createdEvent, emailsSent: number, emailErrors: string[] }
 */
export async function sendInvite(instanceDir, inviteSpec) {
  // Step 1: Create the event (Google sends calendar invites automatically to attendees
  // if sendUpdates = 'all', which is our default). The Google calendar invite IS the
  // official invite. We additionally send a personalized confirmation email.

  const event = await createEvent(instanceDir, {
    ...inviteSpec,
    sendUpdates: 'all',
  });

  const attendees = inviteSpec.attendees || [];
  const emailErrors = [];
  let emailsSent = 0;

  if (attendees.length === 0) {
    return { event, emailsSent: 0, emailErrors: [] };
  }

  // Build the confirmation email body
  const startFormatted = new Date(inviteSpec.start).toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });

  const agendaSection = event.agenda
    ? `\n\nAgenda:\n${event.agenda}`
    : '';

  const locationSection = inviteSpec.location
    ? `\nLocation / Link: ${inviteSpec.location}`
    : '';

  const emailBody = `Hi,

You're confirmed for: ${inviteSpec.summary}
When: ${startFormatted}${locationSection}${agendaSection}

A calendar invite has been sent separately. Looking forward to it.`;

  const subject = inviteSpec.emailSubject || `Confirmed: ${inviteSpec.summary}`;

  // Send confirmation email to each attendee
  const { executeIntegration } = await import('./your9-integrations.mjs');

  for (const attendee of attendees) {
    const toEmail = typeof attendee === 'string' ? attendee : attendee.email;
    if (!toEmail) continue;

    try {
      await executeIntegration(instanceDir, 'google_workspace', 'gmail.send', {
        to:      toEmail,
        subject,
        body:    emailBody,
      });
      emailsSent++;
      log(`sendInvite — email sent to ${toEmail}`);
    } catch (err) {
      const msg = `Failed to email ${toEmail}: ${err.message}`;
      log(`sendInvite ERROR — ${msg}`);
      emailErrors.push(msg);
    }
  }

  return { event, emailsSent, emailErrors };
}

/**
 * blockTime(instanceDir, blockSpec)
 *
 * Create a focus block or personal time reservation on Google Calendar.
 * These are created as "busy" events that block scheduling.
 *
 * blockSpec:
 *   date          {string}  YYYY-MM-DD (required)
 *   start         {string}  HH:MM start time (required)
 *   end           {string}  HH:MM end time (required)
 *   title         {string}  Block title (default: 'Focus Block')
 *   reason        {string}  Internal reason logged locally (optional)
 *   calendarId    {string}  Google calendar ID (default: 'primary')
 *   timeZone      {string}  Timezone (default: from config or 'America/New_York')
 *   color         {string}  Google event color ID '1'–'11' (optional)
 *
 * Returns:
 *   { id, htmlLink, status, block: { date, start, end, title } }
 */
export async function blockTime(instanceDir, blockSpec) {
  const {
    date,
    start: startTime,
    end:   endTime,
    title      = 'Focus Block',
    reason     = '',
    calendarId = 'primary',
    timeZone,
    color,
  } = blockSpec;

  if (!date)      throw new Error('blockTime requires date (YYYY-MM-DD)');
  if (!startTime) throw new Error('blockTime requires start (HH:MM)');
  if (!endTime)   throw new Error('blockTime requires end (HH:MM)');

  const workingHours = getWorkingHours(instanceDir);
  const tz           = timeZone || workingHours.timezone || 'America/New_York';
  const token        = await getGoogleToken(instanceDir);

  const startISO = `${date}T${startTime}:00`;
  const endISO   = `${date}T${endTime}:00`;

  const eventBody = {
    summary:     title,
    description: reason ? `[BLOCKED] ${reason}` : '[BLOCKED — Focus time]',
    start:       { dateTime: startISO, timeZone: tz },
    end:         { dateTime: endISO,   timeZone: tz },
    transparency: 'opaque', // marks as busy
    ...(color ? { colorId: color } : {}),
  };

  log(`blockTime — "${title}" on ${date} ${startTime}–${endTime}`);
  const calPath = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const result  = await googlePost(token, calPath, eventBody);

  // Persist locally
  const dataDir     = calendarDataDir(instanceDir);
  const blockedPath = join(dataDir, 'blocked.json');
  const blocked     = loadJson(blockedPath, []);
  blocked.push({
    id:        result.id,
    date,
    start:     startISO,
    end:       endISO,
    title,
    reason,
    createdAt: new Date().toISOString(),
  });
  saveJson(blockedPath, blocked);

  return {
    id:      result.id,
    htmlLink: result.htmlLink,
    status:  'blocked',
    block:   { date, start: startISO, end: endISO, title },
  };
}

/**
 * sendMeetingPrep(instanceDir, eventId)
 *
 * Fetch the event details, generate a pre-meeting brief via Sonnet,
 * and send it via the instance's notification channel.
 *
 * Called manually or by the --check-prep cron mode which fires this
 * for any event starting within the next 15–20 minutes.
 *
 * Returns:
 *   { sent: boolean, brief: string, eventId, eventSummary }
 */
export async function sendMeetingPrep(instanceDir, eventId) {
  const token  = await getGoogleToken(instanceDir);
  const apiKey = getApiKey(instanceDir);

  // Fetch the event
  const eventData = await googleGet(token, `/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`);
  const event     = normalizeGoogleEvent(eventData);

  log(`sendMeetingPrep — "${event.summary}" @ ${event.start}`);

  // Load business context from instance reasoning file if available
  let businessContext = '';
  const reasoningPath = join(instanceDir, 'data', 'initial-reasoning.json');
  if (existsSync(reasoningPath)) {
    try {
      const r = JSON.parse(readFileSync(reasoningPath, 'utf-8'));
      businessContext = r.businessContext || r.companyDescription || '';
    } catch { /* non-fatal */ }
  }

  // Build basic attendee info from event (no CRM lookup here — keep it simple)
  const attendeeInfo = event.attendees
    .filter(a => !a.self)
    .map(a => ({ email: a.email, name: a.name || a.email, title: '', company: '' }));

  // Generate the brief
  const brief = await generateMeetingPrep(apiKey, { event, attendeeInfo, businessContext });

  // Check if we already sent prep for this event (prevent duplicate sends)
  const dataDir   = calendarDataDir(instanceDir);
  const sentPath  = join(dataDir, 'prep-sent.json');
  const sentMap   = loadJson(sentPath, {});

  if (sentMap[eventId]) {
    log(`sendMeetingPrep — prep already sent for ${eventId}, skipping`);
    return { sent: false, reason: 'already sent', eventId, eventSummary: event.summary };
  }

  // Send notification
  const heading = `MEETING IN 15 MIN: ${event.summary}`;
  const message = `${heading}\n\n${brief}`;
  const result  = await sendNotification(instanceDir, message);

  // Mark as sent
  sentMap[eventId] = { sentAt: new Date().toISOString(), summary: event.summary };
  saveJson(sentPath, sentMap);

  log(`sendMeetingPrep — brief sent (${result.sent ? 'ok' : 'fallback to log'})`);
  return { sent: true, brief, eventId, eventSummary: event.summary };
}

/**
 * checkAndSendPrep(instanceDir)
 *
 * Cron mode: fetch the next 24h of events. For any event starting
 * in the 13–20 minute window (to tolerate cron drift), send prep brief
 * if not already sent.
 *
 * Run this every 5 minutes via cron or a scheduler.
 *
 * Returns:
 *   { checked: number, sent: string[] }
 */
export async function checkAndSendPrep(instanceDir) {
  const now     = Date.now();
  const windowMin = 13 * 60 * 1000;  // 13 minutes
  const windowMax = 20 * 60 * 1000;  // 20 minutes

  const calendar = await getCalendar(instanceDir, { days: 1, maxResults: 50 });
  const toSend   = calendar.google.filter(e => {
    const startMs = new Date(e.start).getTime();
    const diff    = startMs - now;
    return diff >= windowMin && diff <= windowMax;
  });

  const sent = [];
  for (const event of toSend) {
    try {
      const res = await sendMeetingPrep(instanceDir, event.id);
      if (res.sent) sent.push(event.summary);
    } catch (err) {
      log(`checkAndSendPrep ERROR for "${event.summary}": ${err.message}`);
    }
  }

  return { checked: calendar.google.length, sent };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args       = parseArgs(process.argv);
  const instanceId = args.instance;

  if (!instanceId) {
    console.error('Usage: node scripts/your9-calendar.mjs --instance <customer-id> [options]');
    console.error('Options:');
    console.error('  --get-calendar     [--days N]');
    console.error('  --find-slots       --date YYYY-MM-DD [--duration N]');
    console.error('  --block-time       --date YYYY-MM-DD --start HH:MM --end HH:MM [--title "..."]');
    console.error('  --send-prep        --event-id <googleEventId>');
    console.error('  --check-prep       (cron mode — send briefs for meetings in next 15 min)');
    process.exit(1);
  }

  const instanceDir = join(INSTANCES, instanceId);
  if (!existsSync(instanceDir)) {
    console.error(`Instance not found: ${instanceDir}`);
    process.exit(1);
  }

  try {
    if (args['get-calendar']) {
      const days   = args.days ? parseInt(args.days, 10) : 7;
      const result = await getCalendar(instanceDir, { days });
      console.log(`\n=== Calendar — next ${days} days (${result.total} events) ===\n`);
      for (const e of result.combined) {
        const src  = e.source === 'outlook' ? '[Outlook]' : '[Google]';
        const when = new Date(e.start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const att  = e.attendees.filter(a => !a.self).map(a => a.name || a.email).join(', ');
        console.log(`${src} ${when} — ${e.summary}${att ? ` (with: ${att})` : ''}`);
      }
      return;
    }

    if (args['find-slots']) {
      if (!args.date) { console.error('--find-slots requires --date YYYY-MM-DD'); process.exit(1); }
      const duration = args.duration ? parseInt(args.duration, 10) : 60;
      const result   = await findAvailableSlots(instanceDir, {
        date: args.date,
        durationMinutes: duration,
      });
      console.log(`\n=== Available slots on ${args.date} (${duration} min) ===\n`);
      if (result.slots.length === 0) {
        console.log('No available slots found for the requested duration.');
      } else {
        for (const s of result.slots) {
          const start = new Date(s.start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          const end   = new Date(s.end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          console.log(`  ${start} – ${end}`);
        }
      }
      return;
    }

    if (args['block-time']) {
      const required = ['date', 'start', 'end'];
      for (const r of required) {
        if (!args[r]) { console.error(`--block-time requires --${r}`); process.exit(1); }
      }
      const result = await blockTime(instanceDir, {
        date:  args.date,
        start: args.start,
        end:   args.end,
        title: args.title || 'Focus Block',
        reason: args.reason || '',
      });
      console.log(`\nBlocked: ${result.block.title} on ${result.block.date} (event ID: ${result.id})`);
      if (result.htmlLink) console.log(`Link: ${result.htmlLink}`);
      return;
    }

    if (args['send-prep']) {
      if (!args['event-id']) { console.error('--send-prep requires --event-id'); process.exit(1); }
      const result = await sendMeetingPrep(instanceDir, args['event-id']);
      if (result.sent) {
        console.log(`\nPrep sent for: ${result.eventSummary}`);
        console.log('\n--- Brief ---');
        console.log(result.brief);
      } else {
        console.log(`Prep not sent: ${result.reason}`);
      }
      return;
    }

    if (args['check-prep']) {
      const result = await checkAndSendPrep(instanceDir);
      console.log(`Checked ${result.checked} events. Sent prep for: ${result.sent.join(', ') || 'none'}`);
      return;
    }

    console.error('No action specified. Use --get-calendar, --find-slots, --block-time, --send-prep, or --check-prep');
    process.exit(1);

  } catch (err) {
    console.error(`\nError: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

// Run if this is the entry point
const isMain = process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/.*\//, ''));
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main();
}
