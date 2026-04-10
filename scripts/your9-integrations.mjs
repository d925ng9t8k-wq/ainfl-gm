#!/usr/bin/env node
/**
 * your9-integrations.mjs — External Tool Integration Layer
 * Your9 by 9 Enterprises
 *
 * Secure integration framework for connecting Your9 instances to real
 * business tools: Google Workspace, Slack, CRM (HubSpot/Salesforce),
 * and Accounting (QuickBooks).
 *
 * Storage layout:
 *   instances/{id}/config/
 *     integrations.json         — Registry of available + configured integrations
 *     integrations-secrets.enc  — AES-256-CBC encrypted credentials (per-instance key)
 *
 * Per-instance encryption follows the same pattern as your9-knowledge-base.mjs:
 *   Key stored in instances/{id}/config/.env as YOUR9_INT_KEY (64 hex chars).
 *   Generated automatically on first use.
 *   IV is unique per write, stored in the enc file header.
 *
 * Exports:
 *   executeIntegration(instanceDir, tool, action, params) — Run an action
 *   listIntegrations(instanceDir)                         — Available + status
 *   configureIntegration(instanceDir, tool, credentials)  — Store creds securely
 *
 * CLI:
 *   node scripts/your9-integrations.mjs --instance <id> --list
 *   node scripts/your9-integrations.mjs --instance <id> --configure <tool>
 *   node scripts/your9-integrations.mjs --instance <id> --execute <tool> --action <action> --params '{}'
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync, statSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import https from 'https';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEY_ENV_VAR = 'YOUR9_INT_KEY';
const SECRETS_FILE = 'integrations-secrets.enc';
const REGISTRY_FILE = 'integrations.json';

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

// ---------------------------------------------------------------------------
// .env loader — does NOT pollute process.env
// ---------------------------------------------------------------------------

function loadEnvFile(envPath) {
  const env = {};
  if (!existsSync(envPath)) return env;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    const v = trimmed.slice(eqIdx + 1).trim().replace(/^"(.*)"$/, '$1');
    env[k] = v;
  }
  return env;
}

function writeEnvKey(envPath, key, value) {
  let content = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
  const lines = content.split('\n').filter(l => !l.startsWith(`${key}=`));
  lines.push(`${key}=${value}`);
  writeFileSync(envPath, lines.join('\n').trim() + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Per-instance encryption key management
// ---------------------------------------------------------------------------

function getInstanceKey(instanceDir) {
  const envPath = join(instanceDir, 'config', '.env');
  const env = loadEnvFile(envPath);

  if (env[KEY_ENV_VAR] && env[KEY_ENV_VAR].length === 64) {
    return Buffer.from(env[KEY_ENV_VAR], 'hex');
  }

  const key = randomBytes(32);
  const hexKey = key.toString('hex');
  mkdirSync(join(instanceDir, 'config'), { recursive: true });
  writeEnvKey(envPath, KEY_ENV_VAR, hexKey);
  return key;
}

// ---------------------------------------------------------------------------
// AES-256-CBC encryption / decryption
// File format: [16-byte IV][ciphertext]
// ---------------------------------------------------------------------------

function encryptSecrets(key, plaintext) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf-8')), cipher.final()]);
  return Buffer.concat([iv, encrypted]);
}

function decryptSecrets(key, fileBuffer) {
  if (fileBuffer.length < 16) throw new Error('Invalid secrets file — too short');
  const iv = fileBuffer.slice(0, 16);
  const ciphertext = fileBuffer.slice(16);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}

// ---------------------------------------------------------------------------
// Secrets store — load and save the full credentials map
// ---------------------------------------------------------------------------

function loadSecrets(instanceDir) {
  const secretsPath = join(instanceDir, 'config', SECRETS_FILE);
  if (!existsSync(secretsPath)) return {};
  const key = getInstanceKey(instanceDir);
  try {
    const raw = readFileSync(secretsPath);
    const json = decryptSecrets(key, raw);
    return JSON.parse(json);
  } catch (err) {
    throw new Error(`Failed to decrypt integrations secrets: ${err.message}`);
  }
}

function saveSecrets(instanceDir, secrets) {
  mkdirSync(join(instanceDir, 'config'), { recursive: true });
  const key = getInstanceKey(instanceDir);
  const encrypted = encryptSecrets(key, JSON.stringify(secrets, null, 2));
  writeFileSync(join(instanceDir, 'config', SECRETS_FILE), encrypted);
}

// ---------------------------------------------------------------------------
// Integration registry — the public (non-secret) config
// ---------------------------------------------------------------------------

const DEFAULT_REGISTRY = {
  google_workspace: {
    tool: 'google_workspace',
    label: 'Google Workspace',
    description: 'Gmail read/send, Google Calendar, Google Drive',
    actions: ['gmail.read', 'gmail.send', 'gmail.search', 'calendar.list', 'calendar.create', 'drive.list', 'drive.read'],
    configured: false,
    configuredAt: null,
  },
  slack: {
    tool: 'slack',
    label: 'Slack',
    description: 'Send messages, read channels, create threads',
    actions: ['message.send', 'channel.list', 'channel.history', 'thread.reply'],
    configured: false,
    configuredAt: null,
  },
  hubspot: {
    tool: 'hubspot',
    label: 'HubSpot CRM',
    description: 'Contact lookup, deal creation, activity logging',
    actions: ['contact.lookup', 'contact.create', 'deal.create', 'deal.list', 'activity.log'],
    configured: false,
    configuredAt: null,
  },
  salesforce: {
    tool: 'salesforce',
    label: 'Salesforce CRM',
    description: 'Contact lookup, opportunity creation, activity logging',
    actions: ['contact.lookup', 'contact.create', 'opportunity.create', 'opportunity.list', 'activity.log'],
    configured: false,
    configuredAt: null,
  },
  quickbooks: {
    tool: 'quickbooks',
    label: 'QuickBooks',
    description: 'Invoice creation, expense tracking, financial reports',
    actions: ['invoice.create', 'invoice.list', 'expense.create', 'expense.list', 'report.profit_loss'],
    configured: false,
    configuredAt: null,
  },
};

function loadRegistry(instanceDir) {
  const registryPath = join(instanceDir, 'config', REGISTRY_FILE);
  if (!existsSync(registryPath)) return { ...DEFAULT_REGISTRY };
  try {
    return JSON.parse(readFileSync(registryPath, 'utf-8'));
  } catch {
    return { ...DEFAULT_REGISTRY };
  }
}

function saveRegistry(instanceDir, registry) {
  mkdirSync(join(instanceDir, 'config'), { recursive: true });
  writeFileSync(join(instanceDir, 'config', REGISTRY_FILE), JSON.stringify(registry, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// HTTP helper — lightweight fetch for Node without external deps
// ---------------------------------------------------------------------------

function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let data = raw;
        try { data = JSON.parse(raw); } catch { /* leave as string */ }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${typeof data === 'object' ? JSON.stringify(data) : data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Google Workspace Integration
// ---------------------------------------------------------------------------
//
// Credential fields expected in secrets:
//   access_token   — OAuth 2.0 access token (short-lived)
//   refresh_token  — OAuth 2.0 refresh token (long-lived, for auto-refresh)
//   client_id      — Google OAuth client ID
//   client_secret  — Google OAuth client secret
//   token_expiry   — ISO timestamp of access_token expiry
//
// OAuth flow is external to this module (handled during configureIntegration).
// This module expects valid tokens already provisioned.
// ---------------------------------------------------------------------------

const GoogleWorkspace = {

  async _getAccessToken(creds) {
    // If token is still valid (with 60s buffer), return it
    if (creds.access_token && creds.token_expiry) {
      const expiry = new Date(creds.token_expiry).getTime();
      if (Date.now() < expiry - 60000) {
        return creds.access_token;
      }
    }

    // Refresh using refresh_token
    if (!creds.refresh_token) throw new Error('Google: no refresh_token — re-authorize');
    if (!creds.client_id || !creds.client_secret) {
      throw new Error('Google: client_id and client_secret required for token refresh');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refresh_token,
      client_id: creds.client_id,
      client_secret: creds.client_secret,
    }).toString();

    const res = await httpRequest({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);

    if (!res.data.access_token) throw new Error('Google token refresh failed: no access_token returned');

    // Caller is responsible for persisting the updated token
    creds.access_token = res.data.access_token;
    creds.token_expiry = new Date(Date.now() + (res.data.expires_in || 3600) * 1000).toISOString();
    return creds.access_token;
  },

  async _apiGet(creds, path, qs = {}) {
    const token = await GoogleWorkspace._getAccessToken(creds);
    const query = new URLSearchParams(qs).toString();
    return httpRequest({
      hostname: 'www.googleapis.com',
      path: query ? `${path}?${query}` : path,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  async _apiPost(creds, path, body) {
    const token = await GoogleWorkspace._getAccessToken(creds);
    const bodyStr = JSON.stringify(body);
    return httpRequest({
      hostname: 'www.googleapis.com',
      path,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, bodyStr);
  },

  // gmail.read — fetch a specific message by ID
  async 'gmail.read'(creds, { messageId, userId = 'me' }) {
    if (!messageId) throw new Error('gmail.read requires messageId');
    const res = await GoogleWorkspace._apiGet(creds, `/gmail/v1/users/${userId}/messages/${messageId}`, { format: 'full' });
    const msg = res.data;
    const headers = {};
    for (const h of (msg.payload?.headers || [])) headers[h.name] = h.value;

    // Extract body text
    let body = '';
    const parts = msg.payload?.parts || [];
    if (parts.length) {
      for (const part of parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          body = Buffer.from(part.body.data, 'base64url').toString('utf-8');
          break;
        }
      }
    } else if (msg.payload?.body?.data) {
      body = Buffer.from(msg.payload.body.data, 'base64url').toString('utf-8');
    }

    return {
      id: msg.id,
      threadId: msg.threadId,
      subject: headers['Subject'] || '',
      from: headers['From'] || '',
      to: headers['To'] || '',
      date: headers['Date'] || '',
      snippet: msg.snippet || '',
      body,
    };
  },

  // gmail.search — search inbox by query string
  async 'gmail.search'(creds, { query = '', maxResults = 10, userId = 'me' }) {
    const res = await GoogleWorkspace._apiGet(creds, `/gmail/v1/users/${userId}/messages`, {
      q: query,
      maxResults: Math.min(maxResults, 50),
    });
    const messages = res.data.messages || [];
    return {
      count: messages.length,
      messages: messages.map(m => ({ id: m.id, threadId: m.threadId })),
    };
  },

  // gmail.send — send an email
  async 'gmail.send'(creds, { to, subject, body, cc = '', userId = 'me' }) {
    if (!to || !subject || !body) throw new Error('gmail.send requires to, subject, body');
    const raw = [
      `To: ${to}`,
      cc ? `Cc: ${cc}` : null,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].filter(Boolean).join('\r\n');

    const encoded = Buffer.from(raw).toString('base64url');
    const res = await GoogleWorkspace._apiPost(creds, `/gmail/v1/users/${userId}/messages/send`, { raw: encoded });
    return { id: res.data.id, threadId: res.data.threadId, status: 'sent' };
  },

  // calendar.list — list upcoming events
  async 'calendar.list'(creds, { calendarId = 'primary', maxResults = 10, timeMin = null }) {
    const params = {
      maxResults: Math.min(maxResults, 50),
      orderBy: 'startTime',
      singleEvents: true,
      timeMin: timeMin || new Date().toISOString(),
    };
    const res = await GoogleWorkspace._apiGet(creds, `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, params);
    const items = res.data.items || [];
    return {
      count: items.length,
      events: items.map(e => ({
        id: e.id,
        summary: e.summary || '',
        start: e.start?.dateTime || e.start?.date || '',
        end: e.end?.dateTime || e.end?.date || '',
        location: e.location || '',
        description: e.description || '',
        attendees: (e.attendees || []).map(a => a.email),
      })),
    };
  },

  // calendar.create — create a calendar event
  async 'calendar.create'(creds, { calendarId = 'primary', summary, start, end, description = '', attendees = [], location = '' }) {
    if (!summary || !start || !end) throw new Error('calendar.create requires summary, start, end');
    const event = {
      summary,
      description,
      location,
      start: { dateTime: start, timeZone: 'UTC' },
      end: { dateTime: end, timeZone: 'UTC' },
      attendees: attendees.map(email => ({ email })),
    };
    const res = await GoogleWorkspace._apiPost(creds, `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, event);
    return { id: res.data.id, htmlLink: res.data.htmlLink, status: 'created' };
  },

  // drive.list — list files in Drive
  async 'drive.list'(creds, { query = '', maxResults = 10, folderId = null }) {
    let q = query;
    if (folderId) q = `'${folderId}' in parents${q ? ` and ${q}` : ''}`;
    const res = await GoogleWorkspace._apiGet(creds, '/drive/v3/files', {
      q,
      pageSize: Math.min(maxResults, 50),
      fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink)',
    });
    const files = res.data.files || [];
    return { count: files.length, files };
  },

  // drive.read — download a file's text content
  async 'drive.read'(creds, { fileId }) {
    if (!fileId) throw new Error('drive.read requires fileId');
    // Get file metadata first
    const meta = await GoogleWorkspace._apiGet(creds, `/drive/v3/files/${fileId}`, {
      fields: 'id,name,mimeType',
    });
    const mimeType = meta.data.mimeType || '';

    // Google Docs/Sheets/Slides need export
    const exportMap = {
      'application/vnd.google-apps.document': 'text/plain',
      'application/vnd.google-apps.spreadsheet': 'text/csv',
    };

    let path;
    if (exportMap[mimeType]) {
      path = `/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMap[mimeType])}`;
    } else {
      path = `/drive/v3/files/${fileId}?alt=media`;
    }

    const token = await GoogleWorkspace._getAccessToken(creds);
    const res = await httpRequest({
      hostname: 'www.googleapis.com',
      path,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    return {
      fileId,
      name: meta.data.name,
      mimeType,
      content: typeof res.data === 'string' ? res.data : JSON.stringify(res.data),
    };
  },

  connect(creds) {
    if (!creds.access_token && !creds.refresh_token) {
      throw new Error('Google Workspace: access_token or refresh_token required');
    }
    return { connected: true, tool: 'google_workspace' };
  },
};

// ---------------------------------------------------------------------------
// Slack Integration
// ---------------------------------------------------------------------------
//
// Credential fields:
//   bot_token  — Slack Bot Token (xoxb-...)
// ---------------------------------------------------------------------------

const Slack = {

  async _api(creds, method, payload = {}) {
    if (!creds.bot_token) throw new Error('Slack: bot_token required');
    const bodyStr = JSON.stringify(payload);
    const res = await httpRequest({
      hostname: 'slack.com',
      path: `/api/${method}`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.bot_token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, bodyStr);
    if (!res.data.ok) {
      throw new Error(`Slack API error (${method}): ${res.data.error || 'unknown'}`);
    }
    return res.data;
  },

  // message.send — post a message to a channel or DM
  async 'message.send'(creds, { channel, text, blocks = null }) {
    if (!channel || !text) throw new Error('slack.message.send requires channel and text');
    const payload = { channel, text };
    if (blocks) payload.blocks = blocks;
    const res = await Slack._api(creds, 'chat.postMessage', payload);
    return { ts: res.ts, channel: res.channel, status: 'sent' };
  },

  // channel.list — list public channels
  async 'channel.list'(creds, { limit = 20, types = 'public_channel,private_channel' }) {
    const res = await Slack._api(creds, 'conversations.list', {
      limit: Math.min(limit, 200),
      types,
      exclude_archived: true,
    });
    const channels = (res.channels || []).map(c => ({
      id: c.id,
      name: c.name,
      topic: c.topic?.value || '',
      memberCount: c.num_members || 0,
      isPrivate: c.is_private,
    }));
    return { count: channels.length, channels };
  },

  // channel.history — read recent messages from a channel
  async 'channel.history'(creds, { channel, limit = 20, oldest = null }) {
    if (!channel) throw new Error('slack.channel.history requires channel');
    const payload = { channel, limit: Math.min(limit, 100) };
    if (oldest) payload.oldest = oldest;
    const res = await Slack._api(creds, 'conversations.history', payload);
    const messages = (res.messages || []).map(m => ({
      ts: m.ts,
      user: m.user || m.bot_id || 'unknown',
      text: m.text || '',
      threadTs: m.thread_ts || null,
      replyCount: m.reply_count || 0,
    }));
    return { count: messages.length, messages };
  },

  // thread.reply — post a reply to an existing thread
  async 'thread.reply'(creds, { channel, threadTs, text }) {
    if (!channel || !threadTs || !text) throw new Error('slack.thread.reply requires channel, threadTs, text');
    const res = await Slack._api(creds, 'chat.postMessage', {
      channel,
      thread_ts: threadTs,
      text,
    });
    return { ts: res.ts, channel: res.channel, status: 'replied' };
  },

  connect(creds) {
    if (!creds.bot_token) throw new Error('Slack: bot_token required');
    return { connected: true, tool: 'slack' };
  },
};

// ---------------------------------------------------------------------------
// CRM Connector — Abstract interface for HubSpot and Salesforce
// ---------------------------------------------------------------------------
//
// HubSpot credential fields:
//   provider    — 'hubspot'
//   access_token — HubSpot private app token or OAuth token
//
// Salesforce credential fields:
//   provider       — 'salesforce'
//   access_token   — OAuth access token
//   instance_url   — e.g. https://yourorg.salesforce.com
//   refresh_token  — for token refresh (optional)
//   client_id      — for token refresh (optional)
//   client_secret  — for token refresh (optional)
// ---------------------------------------------------------------------------

const CRM = {

  // -- HubSpot internals --

  async _hubspotGet(creds, path, qs = {}) {
    const query = new URLSearchParams(qs).toString();
    return httpRequest({
      hostname: 'api.hubapi.com',
      path: query ? `${path}?${query}` : path,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        'Content-Type': 'application/json',
      },
    });
  },

  async _hubspotPost(creds, path, body) {
    const bodyStr = JSON.stringify(body);
    return httpRequest({
      hostname: 'api.hubapi.com',
      path,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, bodyStr);
  },

  // -- Salesforce internals --

  async _sfGet(creds, path, qs = {}) {
    const url = new URL(creds.instance_url);
    const query = new URLSearchParams(qs).toString();
    return httpRequest({
      hostname: url.hostname,
      path: query ? `${path}?${query}` : path,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        'Content-Type': 'application/json',
      },
    });
  },

  async _sfPost(creds, path, body) {
    const url = new URL(creds.instance_url);
    const bodyStr = JSON.stringify(body);
    return httpRequest({
      hostname: url.hostname,
      path,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, bodyStr);
  },

  // contact.lookup — find a contact by email
  async 'contact.lookup'(creds, { email, name = null }) {
    if (!email && !name) throw new Error('crm.contact.lookup requires email or name');
    const provider = creds.provider || 'hubspot';

    if (provider === 'hubspot') {
      if (email) {
        const res = await CRM._hubspotGet(creds, `/crm/v3/objects/contacts/${encodeURIComponent(email)}`, {
          idProperty: 'email',
          properties: 'firstname,lastname,email,phone,company,jobtitle',
        });
        const p = res.data.properties || {};
        return {
          found: true,
          id: res.data.id,
          email: p.email,
          name: `${p.firstname || ''} ${p.lastname || ''}`.trim(),
          phone: p.phone || '',
          company: p.company || '',
          title: p.jobtitle || '',
        };
      }
      // Name search via filter
      const res = await CRM._hubspotPost(creds, '/crm/v3/objects/contacts/search', {
        filterGroups: [{ filters: [{ propertyName: 'lastname', operator: 'CONTAINS_TOKEN', value: name }] }],
        properties: ['firstname', 'lastname', 'email', 'phone', 'company'],
        limit: 5,
      });
      const results = (res.data.results || []).map(r => ({
        id: r.id,
        name: `${r.properties.firstname || ''} ${r.properties.lastname || ''}`.trim(),
        email: r.properties.email || '',
        phone: r.properties.phone || '',
        company: r.properties.company || '',
      }));
      return { found: results.length > 0, count: results.length, results };
    }

    if (provider === 'salesforce') {
      const soql = email
        ? `SELECT Id,FirstName,LastName,Email,Phone,Account.Name,Title FROM Contact WHERE Email = '${email}' LIMIT 1`
        : `SELECT Id,FirstName,LastName,Email,Phone,Account.Name,Title FROM Contact WHERE LastName LIKE '%${name}%' LIMIT 5`;
      const res = await CRM._sfGet(creds, '/services/data/v58.0/query', { q: soql });
      const records = res.data.records || [];
      if (records.length === 0) return { found: false };
      const r = records[0];
      return {
        found: true,
        id: r.Id,
        email: r.Email || '',
        name: `${r.FirstName || ''} ${r.LastName || ''}`.trim(),
        phone: r.Phone || '',
        company: r.Account?.Name || '',
        title: r.Title || '',
        all: records.length > 1 ? records.slice(1) : undefined,
      };
    }

    throw new Error(`CRM: unknown provider '${provider}'. Use 'hubspot' or 'salesforce'.`);
  },

  // contact.create — create a new contact
  async 'contact.create'(creds, { email, firstName, lastName, phone = '', company = '', title = '' }) {
    if (!email) throw new Error('crm.contact.create requires email');
    const provider = creds.provider || 'hubspot';

    if (provider === 'hubspot') {
      const res = await CRM._hubspotPost(creds, '/crm/v3/objects/contacts', {
        properties: {
          email,
          firstname: firstName || '',
          lastname: lastName || '',
          phone,
          company,
          jobtitle: title,
        },
      });
      return { id: res.data.id, status: 'created', provider: 'hubspot' };
    }

    if (provider === 'salesforce') {
      const res = await CRM._sfPost(creds, '/services/data/v58.0/sobjects/Contact/', {
        Email: email,
        FirstName: firstName || '',
        LastName: lastName || '',
        Phone: phone,
        Title: title,
      });
      return { id: res.data.id, status: 'created', provider: 'salesforce' };
    }

    throw new Error(`CRM: unknown provider '${provider}'`);
  },

  // deal.create — create a deal/opportunity
  async 'deal.create'(creds, { name, amount = 0, stage = null, contactId = null, closeDate = null }) {
    if (!name) throw new Error('crm.deal.create requires name');
    const provider = creds.provider || 'hubspot';

    if (provider === 'hubspot') {
      const props = {
        dealname: name,
        amount: String(amount),
        dealstage: stage || 'appointmentscheduled',
        closedate: closeDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      };
      const res = await CRM._hubspotPost(creds, '/crm/v3/objects/deals', { properties: props });
      const dealId = res.data.id;

      // Associate with contact if provided
      if (contactId) {
        await CRM._hubspotPost(creds, `/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/3`, {});
      }

      return { id: dealId, status: 'created', provider: 'hubspot' };
    }

    if (provider === 'salesforce') {
      const body = {
        Name: name,
        Amount: amount,
        StageName: stage || 'Prospecting',
        CloseDate: closeDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      };
      if (contactId) body.ContactId = contactId;
      const res = await CRM._sfPost(creds, '/services/data/v58.0/sobjects/Opportunity/', body);
      return { id: res.data.id, status: 'created', provider: 'salesforce' };
    }

    throw new Error(`CRM: unknown provider '${provider}'`);
  },

  // deal.list — list recent deals
  async 'deal.list'(creds, { limit = 10, stage = null }) {
    const provider = creds.provider || 'hubspot';

    if (provider === 'hubspot') {
      const filters = stage
        ? [{ filters: [{ propertyName: 'dealstage', operator: 'EQ', value: stage }] }]
        : [];
      const res = await CRM._hubspotPost(creds, '/crm/v3/objects/deals/search', {
        filterGroups: filters,
        properties: ['dealname', 'amount', 'dealstage', 'closedate'],
        sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
        limit: Math.min(limit, 50),
      });
      return {
        count: res.data.total || 0,
        deals: (res.data.results || []).map(d => ({
          id: d.id,
          name: d.properties.dealname,
          amount: d.properties.amount,
          stage: d.properties.dealstage,
          closeDate: d.properties.closedate,
        })),
      };
    }

    if (provider === 'salesforce') {
      const whereClause = stage ? `WHERE StageName = '${stage}'` : '';
      const soql = `SELECT Id,Name,Amount,StageName,CloseDate FROM Opportunity ${whereClause} ORDER BY CreatedDate DESC LIMIT ${Math.min(limit, 50)}`;
      const res = await CRM._sfGet(creds, '/services/data/v58.0/query', { q: soql });
      const records = res.data.records || [];
      return {
        count: records.length,
        deals: records.map(r => ({
          id: r.Id,
          name: r.Name,
          amount: r.Amount,
          stage: r.StageName,
          closeDate: r.CloseDate,
        })),
      };
    }

    throw new Error(`CRM: unknown provider '${provider}'`);
  },

  // activity.log — log a note/activity against a contact
  async 'activity.log'(creds, { contactId, note, activityType = 'NOTE', timestamp = null }) {
    if (!contactId || !note) throw new Error('crm.activity.log requires contactId and note');
    const provider = creds.provider || 'hubspot';

    if (provider === 'hubspot') {
      const res = await CRM._hubspotPost(creds, '/crm/v3/objects/notes', {
        properties: {
          hs_note_body: note,
          hs_timestamp: timestamp || new Date().toISOString(),
        },
      });
      const noteId = res.data.id;
      // Associate note with contact
      await CRM._hubspotPost(creds, `/crm/v3/objects/notes/${noteId}/associations/contacts/${contactId}/202`, {});
      return { id: noteId, status: 'logged', provider: 'hubspot' };
    }

    if (provider === 'salesforce') {
      const body = {
        WhoId: contactId,
        Subject: activityType,
        Description: note,
        ActivityDate: (timestamp || new Date().toISOString()).split('T')[0],
        Status: 'Completed',
      };
      const res = await CRM._sfPost(creds, '/services/data/v58.0/sobjects/Task/', body);
      return { id: res.data.id, status: 'logged', provider: 'salesforce' };
    }

    throw new Error(`CRM: unknown provider '${provider}'`);
  },

  connect(creds) {
    const provider = creds.provider || 'hubspot';
    if (!creds.access_token) throw new Error(`CRM (${provider}): access_token required`);
    if (provider === 'salesforce' && !creds.instance_url) {
      throw new Error('CRM (salesforce): instance_url required');
    }
    return { connected: true, tool: provider };
  },
};

// ---------------------------------------------------------------------------
// Accounting Connector — Abstract interface for QuickBooks
// ---------------------------------------------------------------------------
//
// Credential fields:
//   access_token    — OAuth 2.0 access token
//   refresh_token   — OAuth 2.0 refresh token
//   client_id       — QuickBooks OAuth client ID
//   client_secret   — QuickBooks OAuth client secret
//   realm_id        — QuickBooks company ID (realmId)
//   token_expiry    — ISO timestamp for access_token
//   sandbox         — true/false (uses sandbox API endpoint if true)
// ---------------------------------------------------------------------------

const Accounting = {

  _baseUrl(creds) {
    return creds.sandbox
      ? 'sandbox-quickbooks.api.intuit.com'
      : 'quickbooks.api.intuit.com';
  },

  async _getAccessToken(creds) {
    if (creds.access_token && creds.token_expiry) {
      const expiry = new Date(creds.token_expiry).getTime();
      if (Date.now() < expiry - 60000) return creds.access_token;
    }

    if (!creds.refresh_token) throw new Error('QuickBooks: no refresh_token — re-authorize');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refresh_token,
    }).toString();

    const authHeader = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64');
    const res = await httpRequest({
      hostname: 'oauth.platform.intuit.com',
      path: '/oauth2/v1/tokens/bearer',
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
      },
    }, body);

    if (!res.data.access_token) throw new Error('QuickBooks token refresh failed');
    creds.access_token = res.data.access_token;
    creds.token_expiry = new Date(Date.now() + (res.data.expires_in || 3600) * 1000).toISOString();
    if (res.data.refresh_token) creds.refresh_token = res.data.refresh_token;
    return creds.access_token;
  },

  async _query(creds, sql) {
    const token = await Accounting._getAccessToken(creds);
    const encoded = encodeURIComponent(sql);
    return httpRequest({
      hostname: Accounting._baseUrl(creds),
      path: `/v3/company/${creds.realm_id}/query?query=${encoded}&minorversion=65`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
  },

  async _post(creds, entity, body) {
    const token = await Accounting._getAccessToken(creds);
    const bodyStr = JSON.stringify(body);
    return httpRequest({
      hostname: Accounting._baseUrl(creds),
      path: `/v3/company/${creds.realm_id}/${entity}?minorversion=65`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        Accept: 'application/json',
      },
    }, bodyStr);
  },

  // invoice.create — create a new invoice
  async 'invoice.create'(creds, { customerId, lineItems, dueDate = null, memo = '' }) {
    if (!customerId || !lineItems || !lineItems.length) {
      throw new Error('quickbooks.invoice.create requires customerId and lineItems');
    }

    const lines = lineItems.map((item, i) => ({
      Id: String(i + 1),
      LineNum: i + 1,
      Amount: item.amount,
      DetailType: 'SalesItemLineDetail',
      Description: item.description || '',
      SalesItemLineDetail: {
        Qty: item.qty || 1,
        UnitPrice: item.unitPrice || item.amount,
        ItemRef: item.itemRef ? { value: item.itemRef } : undefined,
      },
    }));

    const invoice = {
      CustomerRef: { value: customerId },
      Line: lines,
      DueDate: dueDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      PrivateNote: memo,
    };

    const res = await Accounting._post(creds, 'invoice', invoice);
    const inv = res.data.Invoice;
    return {
      id: inv.Id,
      docNumber: inv.DocNumber,
      totalAmount: inv.TotalAmt,
      balance: inv.Balance,
      status: 'created',
    };
  },

  // invoice.list — list recent invoices
  async 'invoice.list'(creds, { limit = 10, customerId = null }) {
    const where = customerId ? ` WHERE CustomerRef = '${customerId}'` : '';
    const res = await Accounting._query(creds,
      `SELECT * FROM Invoice${where} ORDERBY MetaData.CreateTime DESC MAXRESULTS ${Math.min(limit, 50)}`
    );
    const items = res.data.QueryResponse?.Invoice || [];
    return {
      count: items.length,
      invoices: items.map(inv => ({
        id: inv.Id,
        docNumber: inv.DocNumber,
        customer: inv.CustomerRef?.name || '',
        totalAmount: inv.TotalAmt,
        balance: inv.Balance,
        dueDate: inv.DueDate,
        status: inv.EmailStatus,
      })),
    };
  },

  // expense.create — create a purchase/expense
  async 'expense.create'(creds, { vendorId, amount, accountId, memo = '', txnDate = null }) {
    if (!amount || !accountId) throw new Error('quickbooks.expense.create requires amount and accountId');

    const purchase = {
      PaymentType: 'Cash',
      AccountRef: { value: accountId },
      TotalAmt: amount,
      PrivateNote: memo,
      TxnDate: txnDate || new Date().toISOString().split('T')[0],
      Line: [{
        Amount: amount,
        DetailType: 'AccountBasedExpenseLineDetail',
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: accountId },
        },
      }],
    };

    if (vendorId) purchase.EntityRef = { value: vendorId, type: 'Vendor' };

    const res = await Accounting._post(creds, 'purchase', purchase);
    const purchase2 = res.data.Purchase;
    return {
      id: purchase2.Id,
      totalAmount: purchase2.TotalAmt,
      txnDate: purchase2.TxnDate,
      status: 'created',
    };
  },

  // expense.list — list recent expenses
  async 'expense.list'(creds, { limit = 10 }) {
    const res = await Accounting._query(creds,
      `SELECT * FROM Purchase ORDERBY MetaData.CreateTime DESC MAXRESULTS ${Math.min(limit, 50)}`
    );
    const items = res.data.QueryResponse?.Purchase || [];
    return {
      count: items.length,
      expenses: items.map(p => ({
        id: p.Id,
        vendor: p.EntityRef?.name || '',
        totalAmount: p.TotalAmt,
        txnDate: p.TxnDate,
        memo: p.PrivateNote || '',
      })),
    };
  },

  // report.profit_loss — fetch P&L summary
  async 'report.profit_loss'(creds, { startDate = null, endDate = null }) {
    const token = await Accounting._getAccessToken(creds);
    const start = startDate || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    const res = await httpRequest({
      hostname: Accounting._baseUrl(creds),
      path: `/v3/company/${creds.realm_id}/reports/ProfitAndLoss?start_date=${start}&end_date=${end}&minorversion=65`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    const report = res.data;
    const summary = report.Header || {};
    return {
      period: `${start} to ${end}`,
      reportName: summary.ReportName || 'Profit and Loss',
      currency: summary.Currency || 'USD',
      raw: report,
    };
  },

  connect(creds) {
    if (!creds.access_token && !creds.refresh_token) {
      throw new Error('QuickBooks: access_token or refresh_token required');
    }
    if (!creds.realm_id) throw new Error('QuickBooks: realm_id required');
    return { connected: true, tool: 'quickbooks' };
  },
};

// ---------------------------------------------------------------------------
// Integration resolver — maps tool name to module
// ---------------------------------------------------------------------------

function resolveIntegration(tool) {
  switch (tool) {
    case 'google_workspace': return GoogleWorkspace;
    case 'slack':            return Slack;
    case 'hubspot':
    case 'salesforce':       return CRM;
    case 'quickbooks':       return Accounting;
    default:
      throw new Error(`Unknown integration tool: '${tool}'. Available: google_workspace, slack, hubspot, salesforce, quickbooks`);
  }
}

// For HubSpot/Salesforce, the secrets key is always 'crm' but we inject provider
function resolveSecretsKey(tool) {
  if (tool === 'hubspot' || tool === 'salesforce') return 'crm';
  return tool;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * listIntegrations(instanceDir)
 * Returns the registry of available integrations and their configured status.
 */
export function listIntegrations(instanceDir) {
  if (!existsSync(instanceDir)) throw new Error(`Instance directory not found: ${instanceDir}`);
  const registry = loadRegistry(instanceDir);
  return Object.values(registry);
}

/**
 * configureIntegration(instanceDir, tool, credentials)
 * Encrypts and stores credentials for the given tool.
 * Updates the registry to mark the tool as configured.
 *
 * credentials: object with the fields required by the integration module.
 *   For CRM tools (hubspot/salesforce), include provider: 'hubspot' or 'salesforce'.
 */
export function configureIntegration(instanceDir, tool, credentials) {
  if (!existsSync(instanceDir)) throw new Error(`Instance directory not found: ${instanceDir}`);

  // Validate the credentials format by calling connect()
  const integration = resolveIntegration(tool);
  integration.connect(credentials); // throws if invalid

  // Load existing secrets, merge, save
  const secrets = loadSecrets(instanceDir);
  const key = resolveSecretsKey(tool);
  secrets[key] = { ...credentials, updatedAt: new Date().toISOString() };
  saveSecrets(instanceDir, secrets);

  // Update registry
  const registry = loadRegistry(instanceDir);
  const registryKey = (tool === 'hubspot' || tool === 'salesforce') ? tool : tool;
  if (registry[registryKey]) {
    registry[registryKey].configured = true;
    registry[registryKey].configuredAt = new Date().toISOString();
  } else {
    // Dynamic entry for any tool not in the defaults
    registry[registryKey] = {
      tool: registryKey,
      configured: true,
      configuredAt: new Date().toISOString(),
    };
  }
  saveRegistry(instanceDir, registry);

  return { status: 'configured', tool, configuredAt: registry[registryKey].configuredAt };
}

/**
 * executeIntegration(instanceDir, tool, action, params)
 * Executes the given action on the given tool.
 *
 * tool    — 'google_workspace' | 'slack' | 'hubspot' | 'salesforce' | 'quickbooks'
 * action  — e.g. 'gmail.send', 'channel.list', 'contact.lookup'
 * params  — action-specific parameters object
 *
 * Returns the action result or throws on error.
 */
export async function executeIntegration(instanceDir, tool, action, params = {}) {
  if (!existsSync(instanceDir)) throw new Error(`Instance directory not found: ${instanceDir}`);

  const integration = resolveIntegration(tool);

  // Verify action is supported
  const registry = loadRegistry(instanceDir);
  const registryKey = tool;
  const entry = registry[registryKey];
  if (entry && entry.actions && !entry.actions.includes(action)) {
    throw new Error(`Action '${action}' not supported by ${tool}. Available: ${entry.actions.join(', ')}`);
  }

  // Check integration is configured
  if (!entry || !entry.configured) {
    throw new Error(`Integration '${tool}' is not configured for this instance. Run configureIntegration first.`);
  }

  // Load credentials
  const secrets = loadSecrets(instanceDir);
  const key = resolveSecretsKey(tool);
  const creds = secrets[key];
  if (!creds) throw new Error(`No credentials found for '${tool}'. Run configureIntegration first.`);

  // Inject provider for CRM tools
  if ((tool === 'hubspot' || tool === 'salesforce') && !creds.provider) {
    creds.provider = tool;
  }

  // Look up the action handler
  if (typeof integration[action] !== 'function') {
    throw new Error(`Action '${action}' is not implemented for ${tool}`);
  }

  const result = await integration[action](creds, params);

  // If creds were updated (e.g. token refresh), persist the update
  if (creds.access_token !== secrets[key]?.access_token || creds.token_expiry !== secrets[key]?.token_expiry) {
    secrets[key] = { ...creds, updatedAt: new Date().toISOString() };
    saveSecrets(instanceDir, secrets);
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.instance) {
    console.error('Usage: node scripts/your9-integrations.mjs --instance <customer-id> [--list | --configure <tool> | --execute <tool> --action <action> --params <json>]');
    process.exit(1);
  }

  const instanceDir = join(INSTANCES_DIR, args.instance);
  if (!existsSync(instanceDir)) {
    console.error(`Instance not found: ${instanceDir}`);
    process.exit(1);
  }

  if (args.list) {
    const integrations = listIntegrations(instanceDir);
    console.log('\nAvailable integrations:');
    for (const i of integrations) {
      const status = i.configured ? `[CONFIGURED ${i.configuredAt?.split('T')[0]}]` : '[NOT CONFIGURED]';
      console.log(`  ${i.tool.padEnd(20)} ${i.label || ''} ${status}`);
      if (i.actions) console.log(`    Actions: ${i.actions.join(', ')}`);
    }
    return;
  }

  if (args.configure) {
    const tool = args.configure;
    console.log(`Configuring ${tool}...`);
    console.log('Paste credentials JSON (one line):');
    process.stdin.setEncoding('utf-8');
    let input = '';
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', () => {
      try {
        const credentials = JSON.parse(input.trim());
        const result = configureIntegration(instanceDir, tool, credentials);
        console.log('Configured:', JSON.stringify(result, null, 2));
      } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
      }
    });
    return;
  }

  if (args.execute) {
    const tool = args.execute;
    const action = args.action;
    if (!action) {
      console.error('--execute requires --action <action>');
      process.exit(1);
    }
    let params = {};
    if (args.params) {
      try {
        params = JSON.parse(args.params);
      } catch {
        console.error('--params must be valid JSON');
        process.exit(1);
      }
    }
    try {
      const result = await executeIntegration(instanceDir, tool, action, params);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
    return;
  }

  console.error('No command given. Use --list, --configure <tool>, or --execute <tool> --action <action>');
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
