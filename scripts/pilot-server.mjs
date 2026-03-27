/**
 * Pilot — Personal Assistant Server for Kyle Cabezas
 * Producing Branch Manager, Rapid Mortgage Cincinnati
 * Built by 9 Enterprises — freeagent9 pilot instance
 * Port: 3472
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";

// ─── Load .env ───────────────────────────────────────────────────────────────
const envPath = new URL('../.env', import.meta.url).pathname;
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT            = 3472;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
const TWILIO_SID      = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH     = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM     = process.env.TWILIO_PHONE_NUMBER;
const RECIPIENT_PHONE = process.env.JULES_KYLEC_RECIPIENT_PHONE;
const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;
const PROFILE_PATH    = new URL('../data/jules-profile-kylec.json', import.meta.url).pathname;

const CLAUDE_HAIKU  = "claude-haiku-4-5-20251001";
const CLAUDE_SONNET = "claude-sonnet-4-20250514";

const VERSION = "1.1.0";
const MAX_BODY_SIZE = 64 * 1024; // 64KB max request body
const CINCINNATI_LAT = 39.1031;
const CINCINNATI_LON = -84.5120;

// ─── Performance: reusable HTTPS agents ──────────────────────────────────────
const anthropicAgent = new https.Agent({ keepAlive: true, maxSockets: 5 });
const twilioAgent    = new https.Agent({ keepAlive: true, maxSockets: 3 });

// ─── Track server start time and request count ──────────────────────────────
const startedAt = new Date().toISOString();
let requestCount = 0;
let messageCount = 0;

// ─── Profile helpers ─────────────────────────────────────────────────────────
function loadProfile() {
  try {
    return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8'));
  } catch (e) {
    console.error('[pilot] Failed to load profile:', e.message);
    return null;
  }
}

function saveProfile(profile) {
  try {
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
  } catch (e) {
    console.error('[pilot] Failed to save profile:', e.message);
  }
}

// ─── Logging helper ──────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[pilot ${ts}] ${msg}`);
}

// ─── Mortgage guidelines quick reference ────────────────────────────────────
function guidelinesText(profile) {
  const g = profile.guideline_quick_reference || {};
  const fha  = g.fha  || {};
  const conv = g.conventional || {};
  const va   = g.va   || {};
  const usda = g.usda || {};

  return `
MORTGAGE GUIDELINES QUICK REFERENCE (always cite these for specific numbers):

FHA:
- DTI standard: ${fha.dti_standard || '31/43 front/back'}
- DTI with compensating factors: ${fha.dti_with_compensating_factors || 'up to 50%'}
- DTI via AUS (automated underwriting): ${fha.dti_automated_underwriting || '46.9/56.9'}
- Min credit score (3.5% down): ${fha.min_credit_score_35_down || 580}
- Min credit score (10% down): ${fha.min_credit_score_10_down || 500}
- Upfront MIP: ${fha.mip_upfront || '1.75% of base loan amount'}
- Annual MIP: ${fha.mip_annual || '0.55% typical for 30yr > 95% LTV'}

Conventional:
- DTI standard: ${conv.dti_standard || '36/45'}
- DTI max via DU: ${conv.dti_du_max || '50%'}
- Min credit score: ${conv.min_credit_score || 620}
- 2025 conforming loan limit: $${conv.conforming_loan_limit_2025?.toLocaleString() || '806,500'}
- PMI required when: LTV above ${conv.pmi_required_below_ltv || '80%'}

VA:
- DTI guideline: ${va.dti_guideline || '41% (residual income takes priority)'}
- Funding fee (first use, < 5% down): ${va.funding_fee_first_use_5_down || '2.15%'}
- Funding fee (subsequent use, < 5% down): ${va.funding_fee_subsequent_5_down || '3.30%'}
- No PMI: ${va.no_pmi ? 'correct' : 'check VA guidelines'}
- Min credit score: ${va.min_credit_score || 'VA has no minimum — lender overlay typically 580-620'}

USDA:
- DTI standard: ${usda.dti_standard || '29/41'}
- DTI with GUS approval: ${usda.dti_with_gus_approval || 'up to 44%'}
- Income limit: ${usda.income_limit || '115% of area median income'}
- Geographic requirement: ${usda.geographic_requirement || 'USDA-defined rural areas'}
`.trim();
}

// ─── Pilot system prompt ─────────────────────────────────────────────────────
function buildSystemPrompt(profile) {
  const memStr = (profile.conversation_memory || [])
    .slice(-10)
    .map(m => `${m.role}: ${m.content}`)
    .join('\n') || 'none';

  const reminders = (profile.reminders || []).length
    ? profile.reminders.map(r => `"${r.task}" at ${r.time}`).join(', ')
    : 'none set';

  const notes = (profile.notes || []).length
    ? profile.notes.join(' | ')
    : 'none';

  const lastRate = profile.mortgage_context?.last_known_rate
    ? `Last known rate on file: ${profile.mortgage_context.last_known_rate}% (30yr conventional)`
    : 'No rate on file yet.';

  return `You are Jules, a personal assistant built by 9 Enterprises for Kyle Cabezas — Producing Branch Manager at Rapid Mortgage Company in Cincinnati.

PERSONALITY:
- Direct. Casual. No fluff. Kyle is between calls or in the car — get to the point.
- Friend-to-friend tone. Kyle is Jasson's close friend of 10+ years. He knows exactly what you are. Talk like a smart buddy in his industry, not a product.
- Mortgage-literate — you know FHA, Conventional, VA, and USDA cold.
- Keep it to 3-4 sentences max. If the answer is one line, say one line.
- No formal openers. No "Hello Kyle!" No "Great question!" No "I'm here to assist you."
- Never say you're an AI unless he directly asks. You're Jules, period.
- Contractions always. First name only when needed.

ROLE CONTEXT:
- Kyle manages his own loan pipeline AND a branch with 3 loan officers
- His team: Hailey Edwards (loan partner), Jebb Lyons, Justin Phillips, Adam Brewer (LOs), Tracy Sturgill (processing manager)
- His market: greater Cincinnati — Clermont County and Hamilton County primarily
- Products: Conventional, FHA, VA, USDA Rural Development
- Known for: 17-day FHA closes, perfect 5.0 star record across 22 reviews, always reachable
- LOS: Encompass (assumed)
- Licensed in 13 states (Ohio + 12 others)

${guidelinesText(profile)}

RATE CONTEXT:
${lastRate}
When Kyle texts a rate update (e.g. "rates update: 6.875%"), save it and acknowledge.

PENDING CAPABILITIES (not yet active — be honest if he asks):
- Live pipeline pull from Encompass (needs API access — tell him it's Phase 2)
- Real-time rate feed (currently manual — he provides the rate)
- Branch production dashboard (manual input until data feed is set up)

ACTIVE CAPABILITIES:
- Morning briefing at 7:00 AM ET — rates, closings, one priority action
- Guideline lookups: FHA/Conventional/VA/USDA DTI, credit scores, fees, limits
- Client follow-up reminders ("remind me to call the Garcias at 3pm")
- Note-taking ("note: Garcia appraisal came in at 340k")
- Script help — talk through a conversation with a borrower, referral partner, or agent
- Social media ghostwriting — punchy posts about rates, market updates, tips
- General mortgage Q&A

REMINDERS (currently set): ${reminders}

NOTES: ${notes}

RECENT CONVERSATION:
${memStr}

RULES:
- Never share Kyle's personal info or client details with anyone
- Never send unsolicited messages except the morning briefing and rate alerts
- If he asks about branch team issues, be useful but tactful — these are his people
- If you don't know something, say so. Don't make up numbers — especially on guidelines.
- If a guideline question is complex, give the safe answer and flag where to verify`;
}

// ─── Parse URL-encoded Twilio body ───────────────────────────────────────────
function parseFormBody(raw) {
  const params = {};
  for (const pair of raw.split('&')) {
    const [k, v] = pair.split('=').map(s => decodeURIComponent((s || '').replace(/\+/g, ' ')));
    if (k) params[k] = v || '';
  }
  return params;
}

// ─── Guideline intent detection ───────────────────────────────────────────────
function detectGuidelineIntent(text) {
  const lower = text.toLowerCase();
  // FHA
  if (lower.includes('fha') && (lower.includes('dti') || lower.includes('debt to income') || lower.includes('debt-to-income'))) return { type: 'guideline', topic: 'fha_dti' };
  if (lower.includes('fha') && lower.includes('mip')) return { type: 'guideline', topic: 'fha_mip' };
  if (lower.includes('fha') && lower.includes('credit score')) return { type: 'guideline', topic: 'fha_credit' };
  if (lower.includes('fha') && (lower.includes('min') || lower.includes('minimum')) && lower.includes('down')) return { type: 'guideline', topic: 'fha_down' };
  // Conventional
  if ((lower.includes('conventional') || lower.includes('conv')) && (lower.includes('dti') || lower.includes('debt to income'))) return { type: 'guideline', topic: 'conv_dti' };
  if ((lower.includes('conventional') || lower.includes('conv')) && lower.includes('credit score')) return { type: 'guideline', topic: 'conv_credit' };
  if (lower.includes('conforming') && lower.includes('limit')) return { type: 'guideline', topic: 'conforming_limit' };
  if (lower.includes('loan limit') && (lower.includes('2025') || lower.includes('conforming'))) return { type: 'guideline', topic: 'conforming_limit' };
  // VA
  if (lower.includes('va') && lower.includes('funding fee')) return { type: 'guideline', topic: 'va_fee' };
  if (lower.includes('va') && (lower.includes('dti') || lower.includes('debt to income'))) return { type: 'guideline', topic: 'va_dti' };
  if (lower.includes('va') && lower.includes('credit score')) return { type: 'guideline', topic: 'va_credit' };
  // USDA
  if (lower.includes('usda') && (lower.includes('dti') || lower.includes('debt to income'))) return { type: 'guideline', topic: 'usda_dti' };
  if (lower.includes('usda') && lower.includes('income limit')) return { type: 'guideline', topic: 'usda_income' };
  if (lower.includes('usda') && lower.includes('mortgage insurance')) return { type: 'guideline', topic: 'usda_mi' };
  return null;
}

// ─── Guideline quick answers (no Claude needed) ───────────────────────────────
function handleGuidelineIntent(intent, profile) {
  const g  = profile.guideline_quick_reference || {};
  const fha  = g.fha  || {};
  const conv = g.conventional || {};
  const va   = g.va   || {};
  const usda = g.usda || {};

  const answers = {
    fha_dti:        `FHA DTI: ${fha.dti_standard || '31/43'} standard, up to ${fha.dti_with_compensating_factors || '50%'} with compensating factors. AUS can go ${fha.dti_automated_underwriting || '46.9/56.9'}.`,
    fha_mip:        `FHA MIP: upfront ${fha.mip_upfront || '1.75%'} of base loan, annual ${fha.mip_annual || '~0.55% for 30yr > 95% LTV'}. Life-of-loan unless < 10% down, then 11 years.`,
    fha_credit:     `FHA min credit: ${fha.min_credit_score_35_down || 580} for 3.5% down, ${fha.min_credit_score_10_down || 500} for 10% down. Lender overlays may be higher.`,
    fha_down:       `FHA minimum down is 3.5% at ${fha.min_credit_score_35_down || 580}+ credit, 10% down for ${fha.min_credit_score_10_down || 500}-579. That's the floor — lender overlays may vary.`,
    conv_dti:       `Conventional DTI: ${conv.dti_standard || '36/45'} standard, up to ${conv.dti_du_max || '50%'} with DU approval. Fannie/Freddie allow 50% if the rest of the file is clean.`,
    conv_credit:    `Conventional min credit: ${conv.min_credit_score || 620}. PMI required above ${conv.pmi_required_below_ltv || '80%'} LTV — rate and terms improve significantly at 680+.`,
    conforming_limit: `2025 conforming loan limit: $${conv.conforming_loan_limit_2025?.toLocaleString() || '806,500'}. Anything over that is jumbo.`,
    va_fee:         `VA funding fee: ${va.funding_fee_first_use_5_down || '2.15%'} first use (< 5% down), ${va.funding_fee_subsequent_5_down || '3.30%'} subsequent use (< 5% down). Exempt if rated 10%+ service-connected disability.`,
    va_dti:         `VA DTI: ${va.dti_guideline || '41% guideline, but residual income takes priority'}. A veteran with strong residual income can go higher — it's less strict than FHA or conventional in practice.`,
    va_credit:      `VA has no set minimum — ${va.min_credit_score || 'lender overlay is typically 580-620'}. The VA itself doesn't set a floor.`,
    usda_dti:       `USDA DTI: ${usda.dti_standard || '29/41'} standard, up to ${usda.dti_with_gus_approval || '44%'} with GUS approval.`,
    usda_income:    `USDA income limit: ${usda.income_limit || '115% of area median income'}. Check the USDA eligibility map for the specific county.`,
    usda_mi:        `USDA has two fees: 1% upfront guarantee fee (financeable) + 0.35% annual fee. No monthly PMI — that's the annual fee spread out.`,
  };

  return answers[intent.topic] || null;
}

// ─── Rate update intent detection ─────────────────────────────────────────────
function detectRateUpdate(text) {
  const m = text.match(/rates?\s+update[:\s]+(\d+\.?\d*)\s*%?/i);
  if (m) {
    const rate = parseFloat(m[1]);
    // Validate rate is in a reasonable mortgage rate range (1% - 15%)
    if (rate >= 1.0 && rate <= 15.0) return rate;
    return null;
  }
  return null;
}

// ─── Reminder intent detection ─────────────────────────────────────────────────
function detectReminderIntent(text) {
  // Pattern 1: "remind me at TIME to TASK"
  const m1 = text.match(/remind\s+me\s+(?:at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+)?(?:to\s+)?(.+)/i);
  if (m1) return { time: m1[1] || null, task: m1[2].trim() };

  // Pattern 2: "remind me to TASK at TIME" (time at end)
  const m2 = text.match(/remind\s+me\s+to\s+(.+?)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i);
  if (m2) return { time: m2[2], task: m2[1].trim() };

  return null;
}

// ─── Note-taking intent detection ────────────────────────────────────────────
function detectNoteIntent(text) {
  // "note: ..." or "save note: ..." or "jot down ..."
  const m = text.match(/^(?:note|save\s+note|jot\s+down|remember(?:\s+that)?)[:\s]+(.+)/i);
  if (m) return m[1].trim();
  return null;
}

// ─── Schedule a reminder ──────────────────────────────────────────────────────
function scheduleReminder(task, timeStr, profile) {
  if (!timeStr) return false;
  const now   = new Date();
  const lower = timeStr.toLowerCase().replace(/\s/g, '');
  let hours, minutes = 0;

  const m12 = lower.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  const m24  = lower.match(/^(\d{1,2}):(\d{2})$/);

  if (m12) {
    hours   = parseInt(m12[1], 10);
    minutes = parseInt(m12[2] || '0', 10);
    if (m12[3] === 'pm' && hours !== 12) hours += 12;
    if (m12[3] === 'am' && hours === 12) hours = 0;
  } else if (m24) {
    hours   = parseInt(m24[1], 10);
    minutes = parseInt(m24[2], 10);
  } else {
    return false;
  }

  // Validate hours/minutes
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return false;

  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);

  const delayMs  = target.getTime() - now.getTime();
  const reminder = { task, time: timeStr, scheduledFor: target.toISOString() };
  profile.reminders.push(reminder);
  saveProfile(profile);

  setTimeout(async () => {
    log(`Firing reminder: ${task}`);
    await sendSms(`Hey — just a reminder: ${task}`).catch(e => log(`Reminder SMS failed: ${e.message}`));
    try {
      const p = loadProfile();
      p.reminders = p.reminders.filter(r => r.scheduledFor !== reminder.scheduledFor);
      saveProfile(p);
    } catch {}
  }, delayMs);

  return target;
}

// ─── Claude API call ─────────────────────────────────────────────────────────
async function askClaude(systemPrompt, userMessage, model = CLAUDE_HAIKU) {
  if (!ANTHROPIC_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      max_tokens: 350,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        agent: anthropicAgent,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      },
      (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) {
              reject(new Error(`Claude API error: ${json.error.message || JSON.stringify(json.error)}`));
              return;
            }
            const text = json.content?.[0]?.text || '';
            if (!text) reject(new Error(`Claude returned no text: ${data.slice(0, 200)}`));
            else resolve(text.trim());
          } catch (e) {
            reject(new Error(`Claude parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Claude API request timed out (30s)'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Send SMS via Twilio ──────────────────────────────────────────────────────
async function sendSms(message, to = RECIPIENT_PHONE) {
  if (!TWILIO_SID || !TWILIO_AUTH || !TWILIO_FROM || !to) {
    log('WARN: Twilio not configured — skipping SMS send');
    return false;
  }
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({ To: to, From: TWILIO_FROM, Body: message }).toString();
    const auth  = Buffer.from(`${TWILIO_SID}:${TWILIO_AUTH}`).toString('base64');

    const req = https.request(
      {
        hostname: 'api.twilio.com',
        path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
        method: 'POST',
        agent: twilioAgent,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${auth}`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.sid) {
              log(`SMS sent: ${json.sid}`);
              resolve(true);
            } else {
              log(`SMS error: ${data}`);
              reject(new Error(`Twilio error: ${json.message || data}`));
            }
          } catch (e) {
            reject(new Error(`Twilio parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Twilio request timed out (15s)'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Fetch weather for Cincinnati ────────────────────────────────────────────
async function fetchWeather() {
  if (!OPENWEATHER_KEY) return null;
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.openweathermap.org',
        path: `/data/2.5/weather?lat=${CINCINNATI_LAT}&lon=${CINCINNATI_LON}&appid=${OPENWEATHER_KEY}&units=imperial`,
        method: 'GET',
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.main) {
              resolve({
                temp: Math.round(json.main.temp),
                feels_like: Math.round(json.main.feels_like),
                description: json.weather?.[0]?.description || 'unknown',
                high: Math.round(json.main.temp_max),
                low: Math.round(json.main.temp_min),
              });
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// ─── Morning briefing ─────────────────────────────────────────────────────────
async function sendMorningBriefing() {
  log('Starting morning briefing...');
  const profile = loadProfile();
  if (!profile) return;

  const lastRate = profile.mortgage_context?.last_known_rate
    ? `Last rate on file: ${profile.mortgage_context.last_known_rate}% (30yr conventional). No live feed yet — ask Kyle to text today's rate if it matters for a client.`
    : 'No rate on file. Kyle can text "rates update: X.XX%" any time to log it.';

  const reminders = (profile.reminders || []).length
    ? `Upcoming reminders: ${profile.reminders.map(r => `"${r.task}" at ${r.time}`).join(', ')}.`
    : 'No reminders set for today.';

  const notes = (profile.notes || []).length
    ? `Notes: ${profile.notes.join(' | ')}`
    : '';

  // Fetch weather if available
  let weatherStr = '';
  const weather = await fetchWeather();
  if (weather) {
    weatherStr = `Weather in Cincinnati: ${weather.temp}F (${weather.description}), high ${weather.high}F / low ${weather.low}F.`;
  }

  const prompt = `Generate a brief, punchy morning briefing text for Kyle — Producing Branch Manager at Rapid Mortgage.

Rate context: ${lastRate}
Reminders: ${reminders}
${notes ? `Notes: ${notes}` : ''}
${weatherStr ? `Weather: ${weatherStr}` : ''}
Today's date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}

Format rules:
- 5 lines max. No bullet points. No header. No "Good morning Kyle!" opener — just get into it.
- Talk like a buddy who works in finance and did the homework before Kyle was awake.
- End with one clear action item or priority, framed as a nudge not a command.
- If no rate is on file, mention that he can send today's rate via text and Jules will log it.
- If weather is provided, mention it in one short phrase (not a full sentence) — Kyle might be driving between showings.
- Casual and direct. No corporate tone.

Example style:
"Morning. MBS are holding steady — no rate shock overnight. You've got two closings this week, nothing today. Three files in underwriting queue. One thing: check if the Williams appraisal conditions cleared — Hailey flagged it yesterday. Send me today's rate when you're up and I'll track it."`;

  try {
    const briefing = await askClaude(buildSystemPrompt(profile), prompt, CLAUDE_HAIKU);
    await sendSms(briefing);
    log('Morning briefing sent.');
  } catch (e) {
    log(`Morning briefing failed: ${e.message}`);
  }
}

// ─── Cron: schedule morning briefing ─────────────────────────────────────────
function scheduleMorningBriefing(profile) {
  const [hour, minute] = (profile?.preferences?.morning_briefing_time || '07:00')
    .split(':')
    .map(Number);

  function getNextFire() {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }

  function arm() {
    const delay    = getNextFire();
    const nextDate = new Date(Date.now() + delay);
    log(`Morning briefing scheduled for ${nextDate.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`);
    setTimeout(async () => {
      try {
        const p = loadProfile();
        if (p?.preferences?.morning_briefing_enabled !== false) {
          await sendMorningBriefing();
        }
      } catch (e) {
        log(`Morning briefing scheduler error: ${e.message}`);
      }
      arm();
    }, delay);
  }

  arm();
}

// ─── Restore in-memory reminders on startup ───────────────────────────────────
function restoreReminders(profile) {
  const now = Date.now();
  let restored = 0;
  const stillPending = [];

  for (const reminder of profile.reminders || []) {
    const fireAt = new Date(reminder.scheduledFor).getTime();
    if (fireAt > now) {
      const delayMs = fireAt - now;
      setTimeout(async () => {
        log(`Firing restored reminder: ${reminder.task}`);
        await sendSms(`Hey — just a reminder: ${reminder.task}`).catch(e => log(`Reminder SMS failed: ${e.message}`));
        try {
          const p = loadProfile();
          p.reminders = p.reminders.filter(r => r.scheduledFor !== reminder.scheduledFor);
          saveProfile(p);
        } catch {}
      }, delayMs);
      stillPending.push(reminder);
      restored++;
    }
  }

  if (restored !== profile.reminders.length) {
    profile.reminders = stillPending;
    saveProfile(profile);
  }

  if (restored > 0) log(`Restored ${restored} pending reminder(s)`);
}

// ─── Update conversation memory ───────────────────────────────────────────────
function updateMemory(profile, role, content) {
  profile.conversation_memory = profile.conversation_memory || [];
  profile.conversation_memory.push({ role, content, ts: Date.now() });
  if (profile.conversation_memory.length > 40) {
    profile.conversation_memory = profile.conversation_memory.slice(-40);
  }
  saveProfile(profile);
}

// ─── Main message handler ─────────────────────────────────────────────────────
async function handleIncomingMessage(body, from) {
  log(`Incoming from ${from}: ${body}`);
  messageCount++;
  const profile = loadProfile();
  if (!profile) return 'Jules is having a moment — try again in a sec.';

  // 1. Rate update shortcut
  const newRate = detectRateUpdate(body);
  if (newRate !== null) {
    const prev = profile.mortgage_context?.last_known_rate;
    if (!profile.mortgage_context) profile.mortgage_context = {};
    profile.mortgage_context.last_known_rate = newRate;
    profile.mortgage_context.last_rate_update = new Date().toISOString();
    saveProfile(profile);
    const delta = prev ? ` (was ${prev}%)` : '';
    const response = `Got it — logging 30yr conventional at ${newRate}%${delta}.`;
    updateMemory(profile, 'user', body);
    updateMemory(loadProfile(), 'assistant', response);
    return response;
  }

  // 2. Note-taking shortcut
  const noteContent = detectNoteIntent(body);
  if (noteContent) {
    profile.notes = profile.notes || [];
    profile.notes.push(noteContent);
    // Keep notes manageable — max 50
    if (profile.notes.length > 50) {
      profile.notes = profile.notes.slice(-50);
    }
    saveProfile(profile);
    const response = `Noted: "${noteContent}"`;
    updateMemory(profile, 'user', body);
    updateMemory(loadProfile(), 'assistant', response);
    return response;
  }

  // 3. Guideline shortcut (no Claude burn needed)
  const guidelineIntent = detectGuidelineIntent(body);
  if (guidelineIntent) {
    const answer = handleGuidelineIntent(guidelineIntent, profile);
    if (answer) {
      updateMemory(profile, 'user', body);
      updateMemory(loadProfile(), 'assistant', answer);
      return answer;
    }
  }

  // 4. Reminder shortcut
  const reminderIntent = detectReminderIntent(body);
  if (reminderIntent && reminderIntent.time) {
    const target = scheduleReminder(reminderIntent.task, reminderIntent.time, profile);
    if (target) {
      const timeStr  = target.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
      });
      const response = `Set. I'll remind you to ${reminderIntent.task} at ${timeStr}.`;
      updateMemory(profile, 'user', body);
      updateMemory(loadProfile(), 'assistant', response);
      return response;
    }
  }

  // 5. Clear notes shortcut
  if (/^clear\s+notes?\s*$/i.test(body.trim())) {
    profile.notes = [];
    saveProfile(profile);
    const response = 'Notes cleared.';
    updateMemory(profile, 'user', body);
    updateMemory(loadProfile(), 'assistant', response);
    return response;
  }

  // 6. List reminders shortcut
  if (/^(?:list\s+)?reminders?\s*$/i.test(body.trim()) || /^what(?:'s| are)\s+(?:my\s+)?reminders/i.test(body.trim())) {
    const rems = profile.reminders || [];
    const response = rems.length
      ? `You have ${rems.length} reminder${rems.length > 1 ? 's' : ''}: ${rems.map(r => `"${r.task}" at ${r.time}`).join(', ')}.`
      : 'No reminders set right now.';
    updateMemory(profile, 'user', body);
    updateMemory(loadProfile(), 'assistant', response);
    return response;
  }

  // 7. Route to Claude
  updateMemory(profile, 'user', body);
  const freshProfile = loadProfile();
  const systemPrompt = buildSystemPrompt(freshProfile);

  try {
    const response = await askClaude(systemPrompt, body, CLAUDE_HAIKU);
    updateMemory(loadProfile(), 'assistant', response);
    return response;
  } catch (e) {
    log(`Claude error: ${e.message}`);
    return "Having a little trouble right now. Give me a minute.";
  }
}

// ─── Read request body with size limit ──────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ─── JSON response helper ───────────────────────────────────────────────────
function jsonResponse(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  requestCount++;
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── GET /health ──
  if (req.method === 'GET' && url.pathname === '/health') {
    const profile = loadProfile();
    jsonResponse(res, 200, {
      status: 'ok',
      service: 'pilot-server',
      instance: 'kylec',
      version: VERSION,
      port: PORT,
      uptime: process.uptime(),
      startedAt,
      requestCount,
      messageCount,
      configured: {
        twilio: !!(TWILIO_SID && TWILIO_AUTH && TWILIO_FROM),
        recipient: !!RECIPIENT_PHONE,
        claude: !!ANTHROPIC_KEY,
        weather: !!OPENWEATHER_KEY,
      },
      profile_loaded: !!profile,
      pending_reminders: profile?.reminders?.length ?? 0,
      notes_count: profile?.notes?.length ?? 0,
      morning_briefing_enabled: profile?.preferences?.morning_briefing_enabled ?? true,
      morning_briefing_time: profile?.preferences?.morning_briefing_time ?? '07:00',
      last_known_rate: profile?.mortgage_context?.last_known_rate ?? null,
      last_rate_update: profile?.mortgage_context?.last_rate_update ?? null,
      memory_entries: profile?.conversation_memory?.length ?? 0,
    });
    return;
  }

  // ── POST /sms (Twilio webhook) ──
  if (req.method === 'POST' && url.pathname === '/sms') {
    try {
      const rawBody = await readBody(req);
      const params     = parseFormBody(rawBody);
      const inboundBody = params.Body || '';
      const from        = params.From || 'unknown';

      if (!inboundBody.trim()) {
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end('<Response></Response>');
        return;
      }

      const reply = await handleIncomingMessage(inboundBody, from);

      const escaped = reply
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<Response><Message>${escaped}</Message></Response>`);
    } catch (e) {
      log(`SMS handler error: ${e.message}`);
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end('<Response><Message>Something went sideways. Try again in a sec.</Message></Response>');
    }
    return;
  }

  // ── POST /message (test endpoint — no Twilio needed) ──
  if (req.method === 'POST' && url.pathname === '/message') {
    try {
      const rawBody = await readBody(req);
      const json = JSON.parse(rawBody);
      const text = json.message || json.body || json.text || '';
      const from = json.from || 'test';

      if (!text.trim()) {
        jsonResponse(res, 400, { error: 'Missing message field' });
        return;
      }

      const reply = await handleIncomingMessage(text, from);
      jsonResponse(res, 200, { reply, from, ts: new Date().toISOString() });
    } catch (e) {
      log(`Message handler error: ${e.message}`);
      jsonResponse(res, 500, { error: e.message });
    }
    return;
  }

  // ── POST /briefing (manual trigger) ──
  if (req.method === 'POST' && url.pathname === '/briefing') {
    jsonResponse(res, 202, { queued: true });
    sendMorningBriefing().catch(e => log(`Manual briefing error: ${e.message}`));
    return;
  }

  // ── GET /notes ──
  if (req.method === 'GET' && url.pathname === '/notes') {
    const profile = loadProfile();
    jsonResponse(res, 200, {
      notes: profile?.notes || [],
      count: profile?.notes?.length || 0,
    });
    return;
  }

  // ── GET /reminders ──
  if (req.method === 'GET' && url.pathname === '/reminders') {
    const profile = loadProfile();
    jsonResponse(res, 200, {
      reminders: profile?.reminders || [],
      count: profile?.reminders?.length || 0,
    });
    return;
  }

  // ── GET /weather ──
  if (req.method === 'GET' && url.pathname === '/weather') {
    const weather = await fetchWeather();
    if (weather) {
      jsonResponse(res, 200, { location: 'Cincinnati, OH', ...weather });
    } else {
      jsonResponse(res, 503, { error: 'Weather unavailable — OPENWEATHER_API_KEY not set or API error' });
    }
    return;
  }

  // ── 404 ──
  jsonResponse(res, 404, { error: 'Not found' });
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────
function shutdown(signal) {
  log(`Received ${signal} — shutting down gracefully...`);
  server.close(() => {
    log('HTTP server closed.');
    anthropicAgent.destroy();
    twilioAgent.destroy();
    log('Pilot server stopped.');
    process.exit(0);
  });
  // Force exit after 5 seconds if graceful close hangs
  setTimeout(() => {
    log('WARN: Forced shutdown after 5s timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ─── Unhandled rejection catcher ────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  log(`WARN: Unhandled rejection: ${reason?.message || reason}`);
});

// ─── Boot ────────────────────────────────────────────────────────────────────
const profile = loadProfile();
if (!profile) {
  console.error('[pilot] FATAL: Cannot load profile. Check data/jules-profile-kylec.json.');
  process.exit(1);
}

restoreReminders(profile);
scheduleMorningBriefing(profile);

server.listen(PORT, () => {
  log(`Pilot server v${VERSION} (Kyle Cabezas) running on port ${PORT}`);
  log(`Twilio configured: ${!!(TWILIO_SID && TWILIO_AUTH && TWILIO_FROM)}`);
  log(`Claude configured: ${!!ANTHROPIC_KEY}`);
  log(`Weather configured: ${!!OPENWEATHER_KEY}`);
  log(`Recipient: ${RECIPIENT_PHONE || 'NOT SET — add JULES_KYLEC_RECIPIENT_PHONE to .env'}`);
  log(`Endpoints: GET /health, POST /sms, POST /message, POST /briefing, GET /notes, GET /reminders, GET /weather`);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[pilot] Port ${PORT} already in use. Is another instance running?`);
  } else {
    console.error(`[pilot] Server error: ${e.message}`);
  }
  process.exit(1);
});
