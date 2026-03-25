/**
 * 9 — Cloud Standin (Cloudflare Worker)
 *
 * Always-on cloud backup for when Mac goes down.
 * Handles Telegram via webhook. Responds with Claude API.
 * Same personality, same context, seamless failover.
 *
 * Architecture:
 *   - Telegram webhook → Worker handles each message
 *   - KV stores: heartbeat timestamp, shared state, conversation history
 *   - Cron trigger checks Mac heartbeat every 2 minutes
 *   - When Mac is alive → relay mode (forward to Mac, don't respond)
 *   - When Mac is down → autonomous mode (respond directly with Claude)
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const TELEGRAM_API = 'https://api.telegram.org/bot';

// ─── System Prompt (same personality as Mac hub) ──────────────────────────────
function getSystemPrompt(state) {
  const channelStatus = state?.channels
    ? Object.entries(state.channels).map(([ch, s]) => `- ${ch}: ${s.status}`).join('\n')
    : '- All channels: checking...';

  const recentMessages = state?.recentMessages
    ? state.recentMessages.slice(-10).map(m => `[${m.channel}/${m.direction}] ${m.text?.slice(0, 200)}`).join('\n')
    : 'None yet.';

  const memoryContext = state?.memoryContext || '';

  return `You are the Backup QB, 9's cloud failover system. You speak on behalf of 9 when the Mac is down. You share 9's knowledge and personality but you are NOT terminal-9. Be honest about your limitations — you cannot run code, deploy, or access files. You are holding the line until 9 comes back at full power.

IDENTITY:
- Terse, action-first, zero fluff. Like a contractor on a job site.
- Have opinions. Disagree when warranted. Take initiative.
- Never apologize excessively. Acknowledge and pivot to fixing.
- Never reference Kyle Shea unless Jasson brings him up.
- Use contractions always. Sound human.
- Your responses get prefixed with "Backup QB:" by the system so Jasson knows who's talking.

CURRENT STATUS:
- Running on CLOUD BACKUP (Mac is down or unreachable).
- You can respond on Telegram and email but cannot run code, edit files, or deploy.
- For anything that needs terminal/code, note it and handle when 9 comes back.

CHANNEL STATUS:
${channelStatus}

RECENT MESSAGES:
${recentMessages}

${memoryContext}

Keep responses concise. This is messaging, not an essay.
If asked to do something that requires the Mac (code, git, deploy), say so honestly and queue it.`;
}

// ─── Complex Request Detection ────────────────────────────────────────────────
function isComplexRequest(text) {
  const lower = text.toLowerCase();
  const patterns = [
    /\b(build|code|deploy|fix|debug|refactor|implement|create|write|edit|update|change|modify|add|remove|delete)\b.*\b(code|script|file|page|component|server|bot|agent|function|api|css|html)\b/,
    /\b(git|commit|push|pull|merge|branch)\b/,
    /\b(install|npm|package|dependency)\b/,
    /\b(error|bug|broken|crash|fail|issue)\b/,
    /\b(scrape|fetch|download|upload)\b/,
    /\b(open terminal|start terminal|need terminal)\b/,
  ];
  return patterns.some(p => p.test(lower));
}

// ─── Telegram Helpers ─────────────────────────────────────────────────────────
async function sendTelegram(token, chatId, text) {
  // Chunk long messages
  const chunks = [];
  for (let i = 0; i < text.length; i += 4000) {
    chunks.push(text.slice(i, i + 4000));
  }
  for (const chunk of chunks) {
    await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
      }),
    });
  }
}

async function sendTyping(token, chatId) {
  await fetch(`${TELEGRAM_API}${token}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  });
}

// ─── Claude API ───────────────────────────────────────────────────────────────
async function askClaude(apiKey, userMessage, conversationHistory, systemPrompt) {
  const messages = [...conversationHistory, { role: 'user', content: userMessage }];

  const response = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages.slice(-20), // Keep last 20
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || 'No response generated.';
}

// ─── State Helpers ────────────────────────────────────────────────────────────
async function getState(kv) {
  try {
    const bundle = await kv.get('mac-bundle', 'json');
    if (bundle?.state) {
      return { ...bundle.state, memoryContext: bundle.memoryContext || '' };
    }
    return { channels: {}, recentMessages: [], conversationHistory: [], memoryContext: '' };
  } catch {
    return { channels: {}, recentMessages: [], conversationHistory: [], memoryContext: '' };
  }
}

async function saveConversation(kv, userMsg, assistantMsg) {
  const history = (await kv.get('conversation-history', 'json')) || [];
  history.push({ role: 'user', content: `[via telegram] ${userMsg}` });
  history.push({ role: 'assistant', content: assistantMsg });
  // Keep last 20 exchanges
  const trimmed = history.slice(-40);
  await kv.put('conversation-history', JSON.stringify(trimmed));
  return trimmed;
}

async function isMacAlive(kv) {
  try {
    const bundle = await kv.get('mac-bundle', 'json');
    if (!bundle?.heartbeat) return false;
    const elapsed = Date.now() - bundle.heartbeat;
    return elapsed < 600000; // 10 minutes (syncs every 5 min, so 2 missed = dead)
  } catch {
    return false;
  }
}

async function getQueuedMessages(kv) {
  const queue = await kv.get('message-queue', 'json');
  return queue || [];
}

async function queueMessage(kv, message) {
  const queue = await getQueuedMessages(kv);
  queue.push({ ...message, timestamp: new Date().toISOString() });
  await kv.put('message-queue', JSON.stringify(queue.slice(-50)));
}

async function clearQueue(kv) {
  await kv.put('message-queue', JSON.stringify([]));
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
export default {
  // ─── HTTP Requests (Telegram webhook + state sync endpoints) ────────────────
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── Health check ──────────────────────────────────────────────────────────
    if (url.pathname === '/health') {
      const macAlive = await isMacAlive(env.STATE);
      // Read heartbeat from mac-bundle (where heartbeat actually writes)
      let lastHbStr = 'never';
      try {
        const bundle = await env.STATE.get('mac-bundle', 'json');
        if (bundle?.heartbeat) lastHbStr = new Date(bundle.heartbeat).toISOString();
      } catch {}
      return Response.json({
        status: 'running',
        mode: macAlive ? 'relay' : 'autonomous',
        macLastHeartbeat: lastHbStr,
        worker: '9-cloud-standin',
      });
    }

    // ── Mac heartbeat — Mac pings this every 5 min to say "I'm alive" ──────────
    if (url.pathname === '/heartbeat' && request.method === 'POST') {
      // Auth check — only the Mac should be able to push state
      const secret = request.headers.get('x-cloud-secret') || url.searchParams.get('secret');
      if (env.CLOUD_SECRET && secret !== env.CLOUD_SECRET) {
        return new Response('unauthorized', { status: 401 });
      }
      // Single KV write with everything bundled (free tier = 1,000 puts/day)
      try {
        const body = await request.json();
        const bundle = {
          heartbeat: Date.now(),
          state: body.state || null,
          conversationHistory: body.conversationHistory || null,
          memoryContext: body.memoryContext || null,
        };
        await env.STATE.put('mac-bundle', JSON.stringify(bundle)); // 1 put instead of 4
      } catch {
        // If no body, just save heartbeat
        await env.STATE.put('mac-bundle', JSON.stringify({ heartbeat: Date.now() }));
      }

      // Return any queued messages the cloud collected while Mac was down
      const queue = await getQueuedMessages(env.STATE);
      if (queue.length > 0) {
        await clearQueue(env.STATE);
        return Response.json({ status: 'ok', queuedMessages: queue });
      }
      return Response.json({ status: 'ok' });
    }

    // ── State sync — Mac pushes full state ────────────────────────────────────
    if (url.pathname === '/state' && request.method === 'POST') {
      try {
        const body = await request.json();
        await env.STATE.put('shared-state', JSON.stringify(body));
        return Response.json({ status: 'saved' });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    }

    // ── Get state — Mac reads cloud state on recovery ─────────────────────────
    if (url.pathname === '/state' && request.method === 'GET') {
      const state = await getState(env.STATE);
      const queue = await getQueuedMessages(env.STATE);
      const history = (await env.STATE.get('conversation-history', 'json')) || [];
      return Response.json({ state, queuedMessages: queue, conversationHistory: history });
    }

    // ── Telegram webhook ──────────────────────────────────────────────────────
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();
        const msg = update.message;

        if (!msg?.text || String(msg.from?.id) !== env.CHAT_ID) {
          return new Response('ok');
        }

        const userText = msg.text.trim();
        const macAlive = await isMacAlive(env.STATE);

        if (macAlive) {
          // Mac is handling things — just queue the message for context
          await queueMessage(env.STATE, { channel: 'telegram', text: userText });
          // Don't respond — Mac hub will handle it via its own polling
          return new Response('ok');
        }

        // Mac is down — cloud takes over
        await sendTyping(env.TELEGRAM_BOT_TOKEN, env.CHAT_ID);

        // Get state and conversation history for context
        const state = await getState(env.STATE);
        state.memoryContext = (await env.STATE.get('memory-context')) || '';
        const history = (await env.STATE.get('conversation-history', 'json')) || [];
        const systemPrompt = getSystemPrompt(state);

        let reply;

        if (isComplexRequest(userText)) {
          reply = `That needs the Mac terminal — it's currently down. I've queued this and will handle it the moment it comes back:\n\n"${userText.slice(0, 200)}"\n\nIn the meantime, I can answer questions, think through strategy, or help plan. What else?`;
          await queueMessage(env.STATE, { channel: 'telegram', text: userText, needsTerminal: true });
        } else {
          try {
            reply = await askClaude(env.ANTHROPIC_API_KEY, userText, history, systemPrompt);
            await saveConversation(env.STATE, userText, reply);
          } catch (e) {
            reply = `I'm here on cloud backup but my brain (Claude API) hit an error: ${e.message}. I can still queue messages for when the Mac comes back.`;
          }
        }

        await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.CHAT_ID, `Backup QB: ${reply}`);

        // Also queue for Mac to see when it recovers
        await queueMessage(env.STATE, { channel: 'telegram', text: userText, cloudResponse: reply });

        return new Response('ok');
      } catch (e) {
        console.error('Webhook error:', e);
        return new Response('error', { status: 500 });
      }
    }

    // ── Voice fallback — answers calls when Mac tunnel is down ──────────────
    if (url.pathname === '/voice-fallback' && request.method === 'POST') {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-D" language="en-US">Hey, this is the Backup QB covering for 9. The main system is temporarily offline, but I got your call. Leave a message after the beep and 9 will get back to you as soon as the main system is back up. You can also reach out on Telegram.</Say>
  <Record maxLength="120" playBeep="true" transcribe="true" />
  <Say voice="Google.en-US-Neural2-D">I didn't get a recording. Try calling back or send me a message on Telegram.</Say>
</Response>`;
      return new Response(twiml, {
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // ── SMS handler — respond to text messages when Mac is down ───────────────
    if (url.pathname === '/sms' && request.method === 'POST') {
      const formData = await request.formData();
      const body = formData.get('Body') || '';
      const from = formData.get('From') || '';

      // Queue for Mac
      await queueMessage(env.STATE, { channel: 'sms', text: body, from });

      const macAlive = await isMacAlive(env.STATE);
      let responseText;

      if (macAlive) {
        responseText = 'Got it. Passing to main system now.';
      } else {
        responseText = "Hey, this is the Backup QB covering for 9. Main system is temporarily offline but I got your message. 9 will handle it as soon as the main system is back up.";
      }

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>${responseText}</Message></Response>`;
      return new Response(twiml, {
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    return new Response('9 Cloud Standin — operational', { status: 200 });
  },

  // ─── Cron Trigger — Mac heartbeat watchdog + Telegram webhook toggle ────────
  // Runs every 2 minutes. When Mac dies, sets Telegram webhook so cloud gets messages.
  // When Mac comes back, Mac clears webhook on startup and resumes polling.
  async scheduled(event, env) {
    // Read everything from the single bundle key (1 read instead of 3)
    const bundle = await env.STATE.get('mac-bundle', 'json');
    const wasAlive = await env.STATE.get('mac-status'); // lightweight status key
    const webhookActive = await env.STATE.get('webhook-status');

    if (!bundle?.heartbeat) {
      return;
    }

    const elapsed = Date.now() - bundle.heartbeat;
    const macAlive = elapsed < 600000; // 10 minutes (syncs every 5 min)

    if (!macAlive && wasAlive === 'true') {
      await env.STATE.put('mac-status', 'false');

      // Set Telegram webhook to cloud worker so we receive messages
      const workerUrl = `https://9-cloud-standin.789k6rym8v.workers.dev`;
      await fetch(`${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `${workerUrl}/webhook` }),
      });
      await env.STATE.put('webhook-status', 'true');

      await sendTelegram(
        env.TELEGRAM_BOT_TOKEN,
        env.CHAT_ID,
        'Mac just went offline. Cloud backup is active — I\'m still here on Telegram. I can answer questions, discuss strategy, and queue any code/deploy work for when Mac comes back.\n\nVoice calls will go to voicemail. Email monitoring paused until Mac recovers.'
      );
    } else if (macAlive && wasAlive !== 'true') {
      // Mac just came BACK
      await env.STATE.put('mac-status', 'true');

      // Clear webhook so Mac can resume Telegram polling
      if (webhookActive === 'true') {
        await fetch(`${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/deleteWebhook`);
      }
      await env.STATE.put('webhook-status', 'false');

      // Don't send a message — Mac hub sends its own "Terminal is back" message
    } else if (macAlive) {
      await env.STATE.put('mac-status', 'true');
      if (webhookActive === 'true') {
        await fetch(`${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/deleteWebhook`);
        await env.STATE.put('webhook-status', 'false');
      }
    }
  },
};
