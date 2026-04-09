#!/usr/bin/env node
/**
 * Pepper Tools — Task execution layer for Pepper (formerly Jules)
 *
 * HTTP service on port 3490 that Pepper's Telegram bot calls when
 * she detects a task request (food ordering, weather, etc.)
 *
 * Each tool is a POST endpoint that accepts JSON and returns a result.
 * Pepper's Claude prompt includes tool descriptions so she knows when
 * to call them vs just chatting.
 */

import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import { URL } from 'node:url';

// ─── Load .env ──────────────────────────────────────────────────────────────
const envPath = new URL('../.env', import.meta.url).pathname;
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const PORT = 3490;
const LOG_FILE = new URL('../logs/pepper-tools.log', import.meta.url).pathname;

function log(msg) {
  const line = `[${new Date().toISOString()}] pepper-tools: ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// ─── Tool: Domino's Pizza Ordering ──────────────────────────────────────────
async function toolDominosOrder(params) {
  // params: { item: "pepperoni pizza", size: "large", address: "..." }
  log(`Dominos order: ${JSON.stringify(params)}`);

  try {
    const { Order, Customer, Item, NearbyStores } = await import('dominos');

    const address = params.address || process.env.DOMINOS_ADDRESS || '655 Nordyke Rd, Cincinnati, OH 45255';
    const customer = new Customer({
      address,
      firstName: process.env.DOMINOS_FIRST_NAME || 'Jasson',
      lastName: process.env.DOMINOS_LAST_NAME || 'Fishback',
      phone: process.env.DOMINOS_PHONE || '5135551234',
      email: process.env.DOMINOS_EMAIL || 'emailfishback@gmail.com',
    });

    // Find nearest store
    const nearbyStores = await new NearbyStores(address);
    let store = null;
    for (const s of nearbyStores.stores) {
      if (s.IsOnlineCapable && s.IsDeliveryStore && s.IsOpen && s.ServiceIsOpen?.Delivery) {
        store = s;
        break;
      }
    }
    if (!store) return { success: false, error: 'No open Dominos delivery stores found nearby.' };

    // Map common items to Domino's codes
    const itemMap = {
      'pepperoni pizza': { code: '14SCREEN', options: { X: { '1/1': '1' }, C: { '1/1': '1' }, P: { '1/1': '1.5' } } },
      'cheese pizza': { code: '14SCREEN', options: { X: { '1/1': '1' }, C: { '1/1': '1.5' } } },
      'meat lovers': { code: '14SCREEN', options: { X: { '1/1': '1' }, C: { '1/1': '1' }, P: { '1/1': '1' }, S: { '1/1': '1' }, B: { '1/1': '1' }, H: { '1/1': '1' } } },
    };

    const itemKey = (params.item || 'pepperoni pizza').toLowerCase();
    const itemConfig = itemMap[itemKey] || itemMap['pepperoni pizza'];

    const pizzaItem = new Item({ ...itemConfig, quantity: parseInt(params.quantity) || 1 });
    const order = new Order(customer);
    order.storeID = store.StoreID;
    order.addItem(pizzaItem);

    // Validate and price (always do this)
    await order.validate();
    await order.price();

    const amounts = order.amountsBreakdown;
    const result = {
      success: true,
      dryRun: true, // Always dry run unless explicitly told to place
      store: { id: store.StoreID, address: store.AddressDescription, phone: store.Phone },
      item: params.item || 'pepperoni pizza',
      subtotal: amounts?.foodAndBeverage,
      tax: amounts?.tax,
      deliveryFee: amounts?.deliveryFee,
      total: amounts?.customer,
      estimatedTime: '30-45 minutes',
      message: `Found a ${params.item || 'pepperoni pizza'} at Domino's Store #${store.StoreID}. Total: $${amounts?.customer}. Say "confirm order" to place it.`
    };

    log(`Dominos result: ${JSON.stringify(result)}`);
    return result;
  } catch (e) {
    log(`Dominos error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ─── Tool: Weather ──────────────────────────────────────────────────────────
async function toolWeather(params) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return { success: false, error: 'Weather API not configured' };

  const lat = params.lat || 39.1031; // Cincinnati default
  const lon = params.lon || -84.5120;

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=imperial`;
    const resp = await fetch(url);
    const data = await resp.json();

    return {
      success: true,
      temp: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      description: data.weather?.[0]?.description,
      humidity: data.main.humidity,
      wind: Math.round(data.wind.speed),
      message: `It's ${Math.round(data.main.temp)}°F in Cincinnati right now. ${data.weather?.[0]?.description}. Feels like ${Math.round(data.main.feels_like)}°F.`
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── Tool: Web Search (via DuckDuckGo Instant Answer API) ──────────────────
async function toolWebSearch(params) {
  const query = params.query;
  if (!query) return { success: false, error: 'No search query provided' };

  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const resp = await fetch(url);
    const data = await resp.json();

    const answer = data.AbstractText || data.Answer || data.Definition || '';
    const source = data.AbstractSource || data.AnswerType || '';
    const relatedTopics = (data.RelatedTopics || []).slice(0, 3).map(t => t.Text).filter(Boolean);

    if (answer) {
      return { success: true, message: `${answer}${source ? ` (${source})` : ''}` };
    }
    if (relatedTopics.length) {
      return { success: true, message: `Here's what I found:\n${relatedTopics.map(t => `• ${t}`).join('\n')}` };
    }
    return { success: true, message: `Couldn't find a quick answer for "${query}". Here's a search link: https://www.google.com/search?q=${encodeURIComponent(query)}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── Tool: Email Check (IMAP over TLS) ────────────────────────────────────
async function toolEmailCheck(params) {
  const email = process.env.ALPACA_EMAIL || 'emailfishback@gmail.com';
  const appPassword = process.env.GMAIL_APP_PASSWORD;
  if (!appPassword) return { success: false, error: 'Gmail app password not configured' };

  const count = Math.min(params.count || 5, 10);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { sock.end(); } catch {}
      resolve({ success: false, error: 'IMAP timeout' });
    }, 15000);

    let fullBuf = '', state = 'connect', tag = 1;

    const sock = tls.connect(993, 'imap.gmail.com', { servername: 'imap.gmail.com' }, () => {
      log('IMAP connected');
    });

    function send(cmd) {
      const t = `A${tag++}`;
      log(`IMAP >> ${t} ${cmd.startsWith('LOGIN') ? 'LOGIN ***' : cmd}`);
      sock.write(`${t} ${cmd}\r\n`);
      return t;
    }

    function finish(result) {
      clearTimeout(timeout);
      state = 'done';
      try { send('LOGOUT'); sock.end(); } catch {}
      resolve(result);
    }

    sock.on('data', (chunk) => {
      fullBuf += chunk.toString();

      // Process only on complete lines
      if (!fullBuf.includes('\r\n')) return;

      if (state === 'connect' && fullBuf.includes('* OK')) {
        state = 'login';
        send(`LOGIN ${email} ${appPassword}`);
      } else if (state === 'login' && /A\d+ OK/m.test(fullBuf)) {
        fullBuf = '';
        state = 'select';
        send('SELECT INBOX');
      } else if (state === 'select' && /A\d+ OK/m.test(fullBuf)) {
        fullBuf = '';
        state = 'search';
        send('SEARCH ALL');
      } else if (state === 'search' && /A\d+ OK/m.test(fullBuf)) {
        const searchLine = fullBuf.match(/\* SEARCH (.+)/);
        if (!searchLine) {
          finish({ success: true, message: 'Inbox is empty.', emails: [] });
          return;
        }
        const ids = searchLine[1].trim().split(/\s+/).filter(Boolean);
        const fetchIds = ids.slice(-count).reverse();
        fullBuf = '';
        state = 'fetch';
        send(`FETCH ${fetchIds.join(',')} BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)]`);
      } else if (state === 'fetch' && /A\d+ OK/m.test(fullBuf)) {
        // Parse all email headers from the accumulated FETCH response
        const emails = [];
        const blocks = fullBuf.split(/\* \d+ FETCH/);
        for (const block of blocks) {
          const from = block.match(/From:\s*(.+)/i);
          const subject = block.match(/Subject:\s*(.+)/i);
          const date = block.match(/Date:\s*(.+)/i);
          if (from || subject) {
            emails.push({
              from: (from?.[1] || 'unknown').trim(),
              subject: (subject?.[1] || '(no subject)').trim(),
              date: (date?.[1] || '').trim()
            });
          }
        }
        const summary = emails.length
          ? emails.map((e, i) => `${i + 1}. From: ${e.from}\n   Subject: ${e.subject}\n   Date: ${e.date}`).join('\n\n')
          : 'No emails found.';
        finish({ success: true, message: `Your ${emails.length} most recent emails:\n\n${summary}`, emails });
      }
    });

    sock.on('error', (e) => {
      clearTimeout(timeout);
      resolve({ success: false, error: `IMAP error: ${e.message}` });
    });
  });
}

// ─── Tool Registry ──────────────────────────────────────────────────────────
const TOOLS = {
  'dominos-order': { fn: toolDominosOrder, description: 'Order pizza from Dominos' },
  'weather': { fn: toolWeather, description: 'Get current weather' },
  'web-search': { fn: toolWebSearch, description: 'Search the web' },
  'email-check': { fn: toolEmailCheck, description: 'Check recent emails from Gmail' },
};

// ─── HTTP Server ────────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 64 * 1024) reject(new Error('Too large')); });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ service: 'pepper-tools', status: 'running', tools: Object.keys(TOOLS), uptime: process.uptime() }));
    return;
  }

  if (req.url === '/tools') {
    res.writeHead(200);
    res.end(JSON.stringify(Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description }))));
    return;
  }

  // POST /execute — run a tool
  if (req.method === 'POST' && req.url === '/execute') {
    try {
      const body = await parseBody(req);
      const { tool, params } = body;

      if (!tool || !TOOLS[tool]) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: `Unknown tool: ${tool}. Available: ${Object.keys(TOOLS).join(', ')}` }));
        return;
      }

      log(`Executing tool: ${tool} with params: ${JSON.stringify(params)}`);
      const result = await TOOLS[tool].fn(params || {});
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found. Try GET /health, GET /tools, or POST /execute' }));
});

server.listen(PORT, () => {
  log(`Pepper Tools service running on port ${PORT}`);
  log(`Available tools: ${Object.keys(TOOLS).join(', ')}`);
});
