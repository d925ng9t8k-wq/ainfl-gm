#!/usr/bin/env node
/**
 * your9-multichannel.mjs — Multi-Channel Communication Layer
 * Your9 by 9 Enterprises
 *
 * Provides a unified abstraction layer over all communication channels.
 * Every inbound message from any channel normalizes to a standard envelope
 * before reaching the CEO. Every outbound response routes back through the
 * originating channel with formatting adapted for that channel.
 *
 * Supported channels:
 *   telegram  — bot polling (already wired in your9-hub.mjs, this provides the abstraction)
 *   sms       — Twilio raw HTTPS (two-way: send via API, receive via webhook)
 *   whatsapp  — Twilio WhatsApp sandbox or Business API (two-way)
 *   email     — Resend for outbound, webhook for inbound, thread-aware
 *
 * Usage:
 *   node scripts/your9-multichannel.mjs --instance <customer-id>
 *
 * Exports:
 *   routeInbound(channel, rawMessage)                      — normalize inbound → standard envelope
 *   routeOutbound(channel, message, instanceDir)           — send response back through same channel
 *   listChannels(instanceDir)                              — active channels for this instance
 *   configureChannel(instanceDir, channel, credentials)    — write channel config to disk
 *
 * Channel config lives at: instances/{id}/config/channels.json
 *
 * Standard message envelope:
 *   {
 *     channel:     string,          // 'telegram' | 'sms' | 'whatsapp' | 'email'
 *     from:        string,          // phone, chat_id, email, or Telegram username
 *     text:        string,          // normalized message body
 *     attachments: Array<{type, url, name}>,
 *     timestamp:   string,          // ISO 8601
 *     raw:         object,          // original payload from channel
 *     threadId:    string|null,     // email thread ID or null
 *     messageId:   string|null,     // channel-specific message ID for threading
 *   }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { createServer } from 'http';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');

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
// .env loader — same pattern as your9-hub.mjs, does NOT pollute process.env
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
// Logging
// ---------------------------------------------------------------------------

let _logPath = null;

function log(instanceDir, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] MULTICHANNEL: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  const lp = _logPath || (instanceDir ? join(instanceDir, 'logs', 'multichannel.log') : null);
  if (lp) {
    try { appendFileSync(lp, line + '\n'); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Channel registry — read/write channels.json
// ---------------------------------------------------------------------------

const CHANNELS_FILENAME = 'channels.json';

/**
 * Load channel registry for an instance.
 * Returns object: { [channelName]: { enabled, credentials, ... } }
 */
function loadChannelRegistry(instanceDir) {
  const cfgPath = join(instanceDir, 'config', CHANNELS_FILENAME);
  if (!existsSync(cfgPath)) return {};
  try {
    return JSON.parse(readFileSync(cfgPath, 'utf-8'));
  } catch (e) {
    log(instanceDir, `Channel registry parse failed (non-fatal): ${e.message}`);
    return {};
  }
}

function saveChannelRegistry(instanceDir, registry) {
  const cfgDir = join(instanceDir, 'config');
  mkdirSync(cfgDir, { recursive: true });
  const cfgPath = join(cfgDir, CHANNELS_FILENAME);
  writeFileSync(cfgPath, JSON.stringify(registry, null, 2));
}

// ---------------------------------------------------------------------------
// Public API: listChannels
// ---------------------------------------------------------------------------

/**
 * List active channels for an instance.
 * Returns: Array<{ channel: string, enabled: boolean, configured: boolean }>
 */
export function listChannels(instanceDir) {
  const registry = loadChannelRegistry(instanceDir);
  return Object.entries(registry).map(([channel, cfg]) => ({
    channel,
    enabled: cfg.enabled === true,
    configured: !!(cfg.credentials && Object.keys(cfg.credentials).length > 0),
    meta: cfg.meta || {},
  }));
}

// ---------------------------------------------------------------------------
// Public API: configureChannel
// ---------------------------------------------------------------------------

/**
 * Write channel credentials and enable it.
 * credentials should be an object with channel-specific keys (see per-channel notes below).
 *
 * Telegram:  { botToken, chatId }
 * SMS:       { twilioAccountSid, twilioAuthToken, twilioPhone, ownerPhone }
 * WhatsApp:  { twilioAccountSid, twilioAuthToken, twilioWhatsAppFrom, ownerWhatsApp }
 * Email:     { resendApiKey, fromAddress, fromName, ownerEmail }
 */
export function configureChannel(instanceDir, channel, credentials) {
  const valid = ['telegram', 'sms', 'whatsapp', 'email'];
  if (!valid.includes(channel)) {
    throw new Error(`Unknown channel: ${channel}. Valid channels: ${valid.join(', ')}`);
  }
  const registry = loadChannelRegistry(instanceDir);
  registry[channel] = {
    enabled: true,
    credentials,
    configuredAt: new Date().toISOString(),
    meta: registry[channel]?.meta || {},
  };
  saveChannelRegistry(instanceDir, registry);
  log(instanceDir, `Channel configured: ${channel}`);
  return registry[channel];
}

// ---------------------------------------------------------------------------
// Raw HTTPS helpers — same pattern as your9-hub.mjs, no SDK deps
// ---------------------------------------------------------------------------

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const isJson = typeof body !== 'string';
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      res => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
          catch { resolve({ status: res.statusCode, body: buf }); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('HTTPS POST timed out')); });
    req.write(data);
    req.end();
  });
}

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET', headers: headers || {} },
      res => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
          catch { resolve({ status: res.statusCode, body: buf }); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('HTTPS GET timed out')); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Inbound normalization — per channel
// ---------------------------------------------------------------------------

/**
 * Normalize a raw Telegram update into a standard envelope.
 * rawMessage: Telegram Update object (from getUpdates or webhook)
 */
function normalizeTelegram(rawMessage) {
  const msg = rawMessage.message || rawMessage.edited_message || rawMessage;
  const text = msg.text || msg.caption || '';
  const from = msg.from
    ? (msg.from.username ? `@${msg.from.username}` : String(msg.from.id))
    : String(msg.chat?.id || 'unknown');

  const attachments = [];
  if (msg.photo) {
    // Largest photo is last in the array
    const photo = msg.photo[msg.photo.length - 1];
    attachments.push({ type: 'photo', fileId: photo.file_id, name: 'photo.jpg' });
  }
  if (msg.document) {
    attachments.push({ type: 'document', fileId: msg.document.file_id, name: msg.document.file_name || 'file' });
  }
  if (msg.voice) {
    attachments.push({ type: 'voice', fileId: msg.voice.file_id, name: 'voice.ogg' });
  }

  return {
    channel: 'telegram',
    from,
    chatId: String(msg.chat?.id || msg.from?.id || ''),
    text,
    attachments,
    timestamp: msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString(),
    raw: rawMessage,
    threadId: null,
    messageId: String(msg.message_id || ''),
  };
}

/**
 * Normalize a raw Twilio SMS webhook payload into a standard envelope.
 * rawMessage: parsed body of the Twilio SMS webhook (application/x-www-form-urlencoded parsed)
 */
function normalizeSms(rawMessage) {
  return {
    channel: 'sms',
    from: rawMessage.From || '',
    chatId: rawMessage.From || '',
    text: rawMessage.Body || '',
    attachments: _parseTwilioMedia(rawMessage),
    timestamp: new Date().toISOString(),
    raw: rawMessage,
    threadId: null,
    messageId: rawMessage.SmsSid || rawMessage.MessageSid || null,
  };
}

/**
 * Normalize a Twilio WhatsApp webhook payload.
 * Payload shape is identical to SMS — Twilio uses the same webhook format.
 */
function normalizeWhatsApp(rawMessage) {
  const envelope = normalizeSms(rawMessage);
  envelope.channel = 'whatsapp';
  // WhatsApp From/To are prefixed with "whatsapp:" in Twilio — strip for display
  envelope.from = (envelope.from || '').replace(/^whatsapp:/, '');
  envelope.chatId = envelope.from;
  return envelope;
}

/**
 * Extract MMS media attachments from a Twilio webhook payload.
 */
function _parseTwilioMedia(body) {
  const attachments = [];
  const numMedia = parseInt(body.NumMedia || '0', 10);
  for (let i = 0; i < numMedia; i++) {
    const url = body[`MediaUrl${i}`];
    const contentType = body[`MediaContentType${i}`] || 'application/octet-stream';
    if (url) {
      const type = contentType.startsWith('image/') ? 'image'
        : contentType.startsWith('video/') ? 'video'
        : contentType.startsWith('audio/') ? 'audio'
        : 'file';
      attachments.push({ type, url, name: `media-${i}`, contentType });
    }
  }
  return attachments;
}

/**
 * Normalize an inbound email webhook payload into a standard envelope.
 * Supports Resend inbound webhook format and a generic fallback.
 * rawMessage should be the parsed JSON body of the webhook.
 */
function normalizeEmail(rawMessage) {
  // Resend inbound format: { from, to, subject, text, html, headers, ... }
  // Generic fallback: any object with from + text/body fields
  const from = rawMessage.from || rawMessage.sender || rawMessage.From || '';
  const text = rawMessage.text
    || rawMessage.plain
    || (rawMessage.html ? _stripHtml(rawMessage.html) : '')
    || rawMessage.body
    || '';
  const subject = rawMessage.subject || rawMessage.Subject || '(no subject)';
  const messageId = rawMessage.messageId || rawMessage['message-id'] || rawMessage.id || null;
  const inReplyTo = rawMessage.inReplyTo || rawMessage['in-reply-to'] || null;

  // Build thread ID from In-Reply-To or Message-ID
  const threadId = inReplyTo || messageId;

  const attachments = (rawMessage.attachments || []).map(a => ({
    type: 'file',
    url: a.url || null,
    name: a.filename || a.name || 'attachment',
    contentType: a.contentType || 'application/octet-stream',
    size: a.size || null,
  }));

  return {
    channel: 'email',
    from,
    chatId: from,
    text: `[Subject: ${subject}]\n\n${text}`,
    subject,
    attachments,
    timestamp: rawMessage.date || rawMessage.Date || new Date().toISOString(),
    raw: rawMessage,
    threadId,
    messageId,
    inReplyTo,
  };
}

/** Strip HTML tags for plain text extraction (lightweight, no parser dependency). */
function _stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Public API: routeInbound
// ---------------------------------------------------------------------------

/**
 * Normalize a raw inbound message from any channel into the standard envelope.
 *
 * channel:     'telegram' | 'sms' | 'whatsapp' | 'email'
 * rawMessage:  Raw payload from the channel (Telegram Update, Twilio body, email webhook body)
 *
 * Returns: Standard message envelope (see top-level JSDoc)
 */
export function routeInbound(channel, rawMessage) {
  switch (channel) {
    case 'telegram':  return normalizeTelegram(rawMessage);
    case 'sms':       return normalizeSms(rawMessage);
    case 'whatsapp':  return normalizeWhatsApp(rawMessage);
    case 'email':     return normalizeEmail(rawMessage);
    default:
      throw new Error(`routeInbound: unknown channel "${channel}"`);
  }
}

// ---------------------------------------------------------------------------
// Outbound formatting — adapt CEO response per channel
// ---------------------------------------------------------------------------

/**
 * Format a text response for a specific channel:
 *   telegram  — preserve Markdown (Telegram renders it)
 *   sms       — strip all Markdown, plain text, 1600 char limit (Twilio splits at 160)
 *   whatsapp  — WhatsApp supports *bold* and _italic_ (subset of Markdown)
 *   email     — convert Markdown to HTML
 */
function formatForChannel(channel, text) {
  switch (channel) {
    case 'telegram':
      return _truncate(text, 4000); // Telegram limit
    case 'sms':
      return _truncate(_stripMarkdown(text), 1600);
    case 'whatsapp':
      return _truncate(_markdownToWhatsApp(text), 4096);
    case 'email':
      return _markdownToHtml(text);
    default:
      return text;
  }
}

function _truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function _stripMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')     // **bold**
    .replace(/\*(.+?)\*/g, '$1')         // *italic*
    .replace(/__(.+?)__/g, '$1')         // __underline__
    .replace(/_(.+?)_/g, '$1')           // _italic_
    .replace(/~~(.+?)~~/g, '$1')         // ~~strikethrough~~
    .replace(/`{3}[\s\S]*?`{3}/g, '')   // ```code blocks```
    .replace(/`(.+?)`/g, '$1')           // `inline code`
    .replace(/^#{1,6}\s+/gm, '')         // ## headers
    .replace(/^\s*[-*+]\s+/gm, '- ')     // bullet points normalized
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // [link text](url) → link text
    .trim();
}

function _markdownToWhatsApp(text) {
  // WhatsApp supports *bold*, _italic_, ~strikethrough~, ```monospace```
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*')  // **bold** → *bold*
    .replace(/__(.+?)__/g, '_$1_')      // __italic__ → _italic_
    .replace(/~~(.+?)~~/g, '~$1~')      // ~~strike~~ → ~strike~
    .replace(/^#{1,6}\s+/gm, '*')       // ## headers → *bold prefix
    .trim();
}

function _markdownToHtml(text) {
  // Convert Markdown to minimal HTML for email
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`{3}([\s\S]*?)`{3}/g, '<pre><code>$1</code></pre>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h1>$1</h1>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    .replace(/^\s*[-*+]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  // Wrap li items in ul
  html = html.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');
  return `<p>${html}</p>`;
}

// ---------------------------------------------------------------------------
// Outbound senders — one per channel
// ---------------------------------------------------------------------------

async function sendTelegram(creds, chatId, text) {
  const { botToken } = creds;
  if (!botToken) throw new Error('Telegram: botToken not configured');

  const MAX = 4000;
  // Split long messages
  const chunks = [];
  let remaining = String(text);
  while (remaining.length > MAX) {
    chunks.push(remaining.slice(0, MAX));
    remaining = remaining.slice(MAX);
  }
  chunks.push(remaining);

  for (const chunk of chunks) {
    // Try Markdown first, fall back to plain text
    try {
      const r = await httpsPost('api.telegram.org', `/bot${botToken}/sendMessage`, {}, {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
      });
      if (r.body && r.body.ok === false) {
        throw new Error(r.body.description || 'Telegram API error');
      }
    } catch {
      const r = await httpsPost('api.telegram.org', `/bot${botToken}/sendMessage`, {}, {
        chat_id: chatId,
        text: chunk,
      });
      if (r.body && r.body.ok === false) {
        throw new Error(r.body.description || 'Telegram API error (plain text fallback)');
      }
    }
  }
}

async function sendSms(creds, toPhone, text) {
  const { twilioAccountSid, twilioAuthToken, twilioPhone } = creds;
  if (!twilioAccountSid || !twilioAuthToken || !twilioPhone) {
    throw new Error('SMS: twilioAccountSid, twilioAuthToken, and twilioPhone are required');
  }

  const authHeader = 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');
  const body = new URLSearchParams({
    From: twilioPhone,
    To: toPhone,
    Body: text,
  }).toString();

  const r = await httpsPost(
    'api.twilio.com',
    `/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
    { Authorization: authHeader },
    body
  );

  if (r.status >= 400) {
    const err = typeof r.body === 'object' ? (r.body.message || JSON.stringify(r.body)) : r.body;
    throw new Error(`Twilio SMS failed (${r.status}): ${err}`);
  }

  return r.body;
}

async function sendWhatsApp(creds, toNumber, text) {
  const { twilioAccountSid, twilioAuthToken, twilioWhatsAppFrom } = creds;
  if (!twilioAccountSid || !twilioAuthToken || !twilioWhatsAppFrom) {
    throw new Error('WhatsApp: twilioAccountSid, twilioAuthToken, and twilioWhatsAppFrom are required');
  }

  const authHeader = 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');
  // Ensure whatsapp: prefix
  const from = twilioWhatsAppFrom.startsWith('whatsapp:') ? twilioWhatsAppFrom : `whatsapp:${twilioWhatsAppFrom}`;
  const to = toNumber.startsWith('whatsapp:') ? toNumber : `whatsapp:${toNumber}`;

  const body = new URLSearchParams({
    From: from,
    To: to,
    Body: text,
  }).toString();

  const r = await httpsPost(
    'api.twilio.com',
    `/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
    { Authorization: authHeader },
    body
  );

  if (r.status >= 400) {
    const err = typeof r.body === 'object' ? (r.body.message || JSON.stringify(r.body)) : r.body;
    throw new Error(`Twilio WhatsApp failed (${r.status}): ${err}`);
  }

  return r.body;
}

async function sendEmail(creds, toEmail, subject, htmlBody, replyToMessageId) {
  const { resendApiKey, fromAddress, fromName } = creds;
  if (!resendApiKey || !fromAddress) {
    throw new Error('Email: resendApiKey and fromAddress are required');
  }

  const payload = {
    from: fromName ? `${fromName} <${fromAddress}>` : fromAddress,
    to: [toEmail],
    subject,
    html: htmlBody,
  };

  // Thread support: include In-Reply-To and References headers for email threading
  if (replyToMessageId) {
    payload.headers = {
      'In-Reply-To': replyToMessageId,
      'References': replyToMessageId,
    };
  }

  const r = await httpsPost(
    'api.resend.com',
    '/emails',
    { Authorization: `Bearer ${resendApiKey}` },
    payload
  );

  if (r.status >= 400) {
    const err = typeof r.body === 'object' ? (r.body.message || JSON.stringify(r.body)) : r.body;
    throw new Error(`Resend email failed (${r.status}): ${err}`);
  }

  return r.body;
}

// ---------------------------------------------------------------------------
// Public API: routeOutbound
// ---------------------------------------------------------------------------

/**
 * Route a CEO response back through the originating channel.
 *
 * channel:     'telegram' | 'sms' | 'whatsapp' | 'email'
 * message:     Object containing:
 *              - text: string (CEO's response, may contain Markdown)
 *              - envelope: the original inbound envelope (for routing back to sender)
 *              - subject: string (email only, for reply subject)
 * instanceDir: Absolute path to instance directory
 *
 * Returns: { ok: boolean, channelResponse: any, error: string|null }
 */
export async function routeOutbound(channel, message, instanceDir) {
  const { text, envelope, subject } = message;
  const registry = loadChannelRegistry(instanceDir);
  const channelCfg = registry[channel];

  if (!channelCfg || !channelCfg.enabled) {
    return { ok: false, error: `Channel "${channel}" is not configured or not enabled`, channelResponse: null };
  }

  const creds = channelCfg.credentials || {};
  const formatted = formatForChannel(channel, text);

  try {
    let channelResponse = null;

    switch (channel) {
      case 'telegram': {
        // Route back to the chat ID from the inbound envelope
        const chatId = envelope?.chatId || creds.chatId;
        if (!chatId) throw new Error('Telegram: no chatId to reply to');
        await sendTelegram(creds, chatId, formatted);
        channelResponse = { chatId };
        break;
      }

      case 'sms': {
        const toPhone = envelope?.from || creds.ownerPhone;
        if (!toPhone) throw new Error('SMS: no destination phone number');
        channelResponse = await sendSms(creds, toPhone, formatted);
        break;
      }

      case 'whatsapp': {
        const toNumber = envelope?.from || creds.ownerWhatsApp;
        if (!toNumber) throw new Error('WhatsApp: no destination number');
        channelResponse = await sendWhatsApp(creds, toNumber, formatted);
        break;
      }

      case 'email': {
        const toEmail = envelope?.from || creds.ownerEmail;
        if (!toEmail) throw new Error('Email: no destination email address');
        const replySubject = subject
          || (envelope?.subject ? `Re: ${envelope.subject}` : 'From your AI CEO');
        const htmlBody = _markdownToHtml(text); // Always send HTML for email
        channelResponse = await sendEmail(creds, toEmail, replySubject, htmlBody, envelope?.messageId);
        break;
      }

      default:
        throw new Error(`routeOutbound: unknown channel "${channel}"`);
    }

    log(instanceDir, `Outbound sent via ${channel} to ${envelope?.from || 'owner'}`);
    return { ok: true, channelResponse, error: null };

  } catch (e) {
    log(instanceDir, `Outbound failed via ${channel}: ${e.message}`);
    return { ok: false, channelResponse: null, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Context preservation — conversation history with channel tracking
// ---------------------------------------------------------------------------

/**
 * Append a message to the conversation history, tagging it with the originating channel.
 * History file: instances/{id}/comms/history.jsonl
 *
 * entry: {
 *   role:    'user' | 'assistant'
 *   content: string
 *   channel: string
 * }
 */
export function appendToHistory(instanceDir, role, content, channel) {
  const commsDir = join(instanceDir, 'comms');
  mkdirSync(commsDir, { recursive: true });
  const histPath = join(commsDir, 'history.jsonl');
  const entry = {
    role,
    content,
    channel: channel || 'unknown',
    timestamp: new Date().toISOString(),
  };
  try {
    appendFileSync(histPath, JSON.stringify(entry) + '\n');
    // Rotate at 500 lines — keep last 400
    const lines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length > 500) {
      writeFileSync(histPath, lines.slice(-400).join('\n') + '\n');
    }
  } catch (e) {
    log(instanceDir, `History append failed (non-fatal): ${e.message}`);
  }
}

/**
 * Load recent conversation history for the Claude context window.
 * Returns messages in Claude API format: Array<{ role, content }>
 * Includes channel tag as a prefix so the CEO knows where each message came from.
 */
export function loadHistory(instanceDir, maxMessages = 40) {
  const histPath = join(instanceDir, 'comms', 'history.jsonl');
  if (!existsSync(histPath)) return [];
  try {
    const lines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
    const parsed = lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    return parsed.slice(-maxMessages).map(entry => ({
      role: entry.role,
      // Prefix user messages with [via channel] so CEO has full context
      content: entry.role === 'user' && entry.channel
        ? `[via ${entry.channel}] ${entry.content}`
        : entry.content,
    }));
  } catch (e) {
    log(instanceDir, `History load failed (non-fatal): ${e.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Webhook server — receives inbound messages from all channels
// ---------------------------------------------------------------------------

/**
 * Start a webhook server for an instance to receive inbound channel messages.
 *
 * Webhook endpoints:
 *   POST /webhook/telegram   — Telegram webhook (alternative to long-polling)
 *   POST /webhook/sms        — Twilio SMS inbound
 *   POST /webhook/whatsapp   — Twilio WhatsApp inbound
 *   POST /webhook/email      — Resend or generic email inbound
 *
 * onMessage(envelope): async callback called with the normalized envelope
 * port: webhook server port (default: reads YOUR9_WEBHOOK_PORT from instance .env, else 4100+hash)
 *
 * Returns: { server, port }
 */
export function startWebhookServer(instanceDir, instanceId, onMessage, port) {
  const envPath = join(instanceDir, 'config', '.env');
  const env = loadEnvFile(envPath);
  const resolvedPort = port
    || parseInt(env.YOUR9_WEBHOOK_PORT || '0', 10)
    || _deriveWebhookPort(instanceId);

  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    const url = req.url.split('?')[0]; // Strip query string
    let channel = null;

    if (url === '/webhook/telegram')  channel = 'telegram';
    else if (url === '/webhook/sms')       channel = 'sms';
    else if (url === '/webhook/whatsapp')  channel = 'whatsapp';
    else if (url === '/webhook/email')     channel = 'email';
    else {
      res.writeHead(404);
      res.end('Unknown webhook endpoint');
      return;
    }

    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        let parsed;
        const contentType = req.headers['content-type'] || '';

        if (contentType.includes('application/x-www-form-urlencoded')) {
          // Twilio sends form-encoded payloads
          parsed = Object.fromEntries(new URLSearchParams(body));
        } else {
          parsed = JSON.parse(body);
        }

        const envelope = routeInbound(channel, parsed);
        log(instanceDir, `Webhook inbound: ${channel} from ${envelope.from}`);

        // Respond to Twilio immediately with empty TwiML to prevent retries
        if (channel === 'sms' || channel === 'whatsapp') {
          res.writeHead(200, { 'Content-Type': 'text/xml' });
          res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }

        // Process asynchronously after responding
        try {
          await onMessage(envelope);
        } catch (e) {
          log(instanceDir, `onMessage callback error: ${e.message}`);
        }

      } catch (e) {
        log(instanceDir, `Webhook parse error (${channel}): ${e.message}`);
        res.writeHead(400);
        res.end(e.message);
      }
    });
  });

  server.listen(resolvedPort, '127.0.0.1', () => {
    log(instanceDir, `Webhook server listening on port ${resolvedPort}`);
    log(instanceDir, `Endpoints: /webhook/telegram, /webhook/sms, /webhook/whatsapp, /webhook/email`);
  });

  server.on('error', err => {
    log(instanceDir, `Webhook server error: ${err.message}`);
  });

  return { server, port: resolvedPort };
}

function _deriveWebhookPort(instanceId) {
  let hash = 0;
  for (let i = 0; i < instanceId.length; i++) {
    hash = (hash * 31 + instanceId.charCodeAt(i)) >>> 0;
  }
  return 4100 + (hash % 900);
}

// ---------------------------------------------------------------------------
// Default channel registry — creates a channels.json with sensible defaults
// if one doesn't exist yet. Called by provisioning flow.
// ---------------------------------------------------------------------------

/**
 * Initialize a channel registry with defaults for a new instance.
 * Does NOT overwrite if channels.json already exists.
 * Only enables channels that are in the tier's allowedChannels list.
 */
export function initChannelRegistry(instanceDir, allowedChannels = ['telegram']) {
  const cfgPath = join(instanceDir, 'config', CHANNELS_FILENAME);
  if (existsSync(cfgPath)) return; // Never clobber existing config

  const registry = {};
  const all = ['telegram', 'sms', 'whatsapp', 'email'];

  for (const ch of all) {
    registry[ch] = {
      enabled: allowedChannels.includes(ch),
      credentials: {},
      configuredAt: null,
      meta: {
        description: _channelDescription(ch),
        requiredCredentials: _channelRequiredCreds(ch),
      },
    };
  }

  saveChannelRegistry(instanceDir, registry);
  log(instanceDir, `Channel registry initialized. Enabled: ${allowedChannels.join(', ')}`);
}

function _channelDescription(channel) {
  const desc = {
    telegram:  'Telegram bot — low-latency, Markdown support, free',
    sms:       'SMS via Twilio — works on any phone, plain text only',
    whatsapp:  'WhatsApp via Twilio — rich formatting, widely used',
    email:     'Email via Resend — HTML support, full threading',
  };
  return desc[channel] || channel;
}

function _channelRequiredCreds(channel) {
  const creds = {
    telegram:  ['botToken', 'chatId'],
    sms:       ['twilioAccountSid', 'twilioAuthToken', 'twilioPhone', 'ownerPhone'],
    whatsapp:  ['twilioAccountSid', 'twilioAuthToken', 'twilioWhatsAppFrom', 'ownerWhatsApp'],
    email:     ['resendApiKey', 'fromAddress', 'fromName', 'ownerEmail'],
  };
  return creds[channel] || [];
}

// ---------------------------------------------------------------------------
// CLI entrypoint — run this file directly to test channel config
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const instanceId = args.instance;

  if (!instanceId) {
    console.error('Usage: node scripts/your9-multichannel.mjs --instance <customer-id>');
    console.error('       node scripts/your9-multichannel.mjs --instance <customer-id> --list-channels');
    console.error('       node scripts/your9-multichannel.mjs --instance <customer-id> --test-outbound <channel>');
    process.exit(1);
  }

  const instanceDir = join(INSTANCES_DIR, instanceId);
  if (!existsSync(instanceDir)) {
    console.error(`Instance not found: ${instanceDir}`);
    process.exit(1);
  }

  _logPath = join(instanceDir, 'logs', 'multichannel.log');
  mkdirSync(join(instanceDir, 'logs'), { recursive: true });

  // --list-channels
  if (args['list-channels']) {
    const channels = listChannels(instanceDir);
    console.log('\nChannel registry for', instanceId);
    console.log('─'.repeat(60));
    for (const ch of channels) {
      const status = ch.enabled ? (ch.configured ? 'ENABLED + CONFIGURED' : 'ENABLED (needs creds)') : 'disabled';
      console.log(`  ${ch.channel.padEnd(12)} ${status}`);
      if (ch.meta.description) console.log(`    ${ch.meta.description}`);
      if (!ch.configured && ch.meta.requiredCredentials?.length) {
        console.log(`    Required: ${ch.meta.requiredCredentials.join(', ')}`);
      }
    }
    console.log('');
    return;
  }

  // --test-outbound <channel>
  if (args['test-outbound']) {
    const channel = args['test-outbound'];
    const testText = `**Test message** from your9-multichannel.mjs\nChannel: ${channel}\nTimestamp: ${new Date().toISOString()}`;
    console.log(`\nTesting outbound via ${channel}...`);
    const result = await routeOutbound(channel, { text: testText, envelope: null }, instanceDir);
    console.log('Result:', JSON.stringify(result, null, 2));
    return;
  }

  // --init-registry
  if (args['init-registry']) {
    const customerCfgPath = join(instanceDir, 'config', 'customer.json');
    let allowedChannels = ['telegram'];
    if (existsSync(customerCfgPath)) {
      try {
        const customer = JSON.parse(readFileSync(customerCfgPath, 'utf-8'));
        allowedChannels = customer.tierConfig?.channels || ['telegram'];
      } catch {}
    }
    initChannelRegistry(instanceDir, allowedChannels);
    console.log('Channel registry initialized.');
    const channels = listChannels(instanceDir);
    for (const ch of channels) {
      console.log(`  ${ch.channel}: ${ch.enabled ? 'enabled' : 'disabled'}`);
    }
    return;
  }

  // Default: print usage summary
  console.log(`\nyour9-multichannel.mjs — instance: ${instanceId}`);
  console.log('Flags: --list-channels | --init-registry | --test-outbound <channel>');
  console.log('\nExports: routeInbound, routeOutbound, listChannels, configureChannel,');
  console.log('         appendToHistory, loadHistory, startWebhookServer, initChannelRegistry');
}

// Only run main() when executed directly, not when imported as a module
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => {
    console.error('Fatal:', e.message);
    process.exit(1);
  });
}
