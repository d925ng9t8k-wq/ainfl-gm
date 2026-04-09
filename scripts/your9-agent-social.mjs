#!/usr/bin/env node
/**
 * your9-agent-social.mjs — Social Media Drafting Agent
 * Your9 by 9 Enterprises
 *
 * Handles social media post drafting, founder approval workflow, revision
 * cycles, and ready-to-publish logging. Called by the hub when the CEO
 * delegates a social task to the "voice" agent with social-media intent,
 * or invoked directly as a standalone agent.
 *
 * Approval flow:
 *   1. CEO delegates social task → hub calls processSocialTask()
 *   2. Agent drafts post(s) for requested platform(s), sends to founder via Telegram
 *   3. Founder replies:
 *      - PUBLISH        → logs as ready-to-publish, reports back to CEO
 *      - PUBLISH LINKEDIN / PUBLISH X  → publishes specific platform only
 *      - any other text  → treated as revision instructions, re-drafts and loops
 *   4. Revision limit: 5 per post. After 5, surfaces to CEO.
 *
 * Pending state is stored in:
 *   instances/{id}/data/social/pending/{post-id}.json
 *
 * Published (ready-to-publish) log:
 *   instances/{id}/data/social/published/{post-id}.json
 *
 * Usage (standalone, for testing):
 *   node scripts/your9-agent-social.mjs \
 *     --instance <customer-id> \
 *     --platform linkedin \
 *     --brief "Announce our Q1 record month — 47 loans closed, 98% on-time"
 *
 * Usage (integrated — called from hub.mjs):
 *   import { processSocialTask, handleSocialApprovalReply } from './your9-agent-social.mjs'
 *
 * Platforms supported: linkedin, x (Twitter), both
 * Character limits enforced: X = 280 chars (hard), LinkedIn = 3000 (soft warn at 1300)
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync,
  appendFileSync, readdirSync, unlinkSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');

// ---------------------------------------------------------------------------
// Platform constants
// ---------------------------------------------------------------------------

const PLATFORMS = {
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    charLimit: 3000,
    warnAt: 1300,
    hashtagMax: 5,
    hashtagStyle: 'end',     // hashtags go at the end
    toneNotes: 'Professional, insight-driven, first-person narrative. Paragraphs with line breaks. Hook in first line. No slang. 3-5 hashtags max.',
    imagePrompt: true,
    emojiOk: true,
  },
  x: {
    id: 'x',
    label: 'X (Twitter)',
    charLimit: 280,
    warnAt: 260,
    hashtagMax: 2,
    hashtagStyle: 'inline',  // hashtags woven into copy or at end
    toneNotes: 'Punchy, opinionated, single strong idea per tweet. No corporate speak. Wit beats length. 1-2 hashtags max. If over 280 chars, cut — no exceptions.',
    imagePrompt: true,
    emojiOk: true,
  }
};

const REVISION_LIMIT = 5;

// ---------------------------------------------------------------------------
// .env loader
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

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] SOCIAL: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  if (_logPath) {
    try { appendFileSync(_logPath, line + '\n'); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Raw HTTPS helpers — same pattern as hub.mjs
// ---------------------------------------------------------------------------

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      res => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); }
          catch (e) { reject(new Error(`JSON parse failed: ${e.message} — body: ${buf.slice(0, 200)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('HTTPS request timed out')); });
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Telegram helpers
// ---------------------------------------------------------------------------

async function sendTelegramMessage(botToken, chatId, text) {
  const MAX = 4000;
  const chunks = [];
  let remaining = String(text);
  while (remaining.length > MAX) {
    chunks.push(remaining.slice(0, MAX));
    remaining = remaining.slice(MAX);
  }
  chunks.push(remaining);

  for (const chunk of chunks) {
    try {
      await httpsPost('api.telegram.org', `/bot${botToken}/sendMessage`, {}, {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
      });
    } catch {
      try {
        // Markdown failed — send plain
        await httpsPost('api.telegram.org', `/bot${botToken}/sendMessage`, {}, {
          chat_id: chatId,
          text: chunk,
        });
      } catch (e) {
        log(`sendMessage failed: ${e.message}`);
        throw e;
      }
    }
  }
}

async function sendTyping(botToken, chatId) {
  try {
    await httpsPost('api.telegram.org', `/bot${botToken}/sendChatAction`, {}, {
      chat_id: chatId,
      action: 'typing',
    });
  } catch {}
}

// ---------------------------------------------------------------------------
// Anthropic API helper — raw HTTPS, no SDK
// ---------------------------------------------------------------------------

async function callClaude(anthropicKey, systemPrompt, userMessage, maxTokens = 2048) {
  const result = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    {
      model: 'claude-sonnet-4-5',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }
  );

  if (result.error) {
    throw new Error(`Anthropic API error: ${result.error.message || JSON.stringify(result.error)}`);
  }

  const text = result.content?.[0]?.text;
  if (!text) {
    throw new Error(`Anthropic returned no content: ${JSON.stringify(result).slice(0, 200)}`);
  }

  return text;
}

// ---------------------------------------------------------------------------
// Platform detection — infer from task text if not explicit
// ---------------------------------------------------------------------------

function detectPlatforms(taskText) {
  const lower = taskText.toLowerCase();
  const platforms = [];

  const wantsLinkedIn = /linkedin|linked in/.test(lower);
  const wantsX = /\bx\b|twitter|tweet/.test(lower);
  const wantsBoth = /both platforms|all platforms|linkedin and (x|twitter)|x and linkedin/i.test(lower);

  if (wantsBoth) return ['linkedin', 'x'];
  if (wantsLinkedIn && wantsX) return ['linkedin', 'x'];
  if (wantsLinkedIn) return ['linkedin'];
  if (wantsX) return ['x'];

  // Default to LinkedIn if no platform specified — more forgiving length-wise
  return ['linkedin'];
}

function isSocialTask(taskText) {
  const lower = taskText.toLowerCase();
  return /post|tweet|linkedin|social media|announce|publish|content|caption|share on|draft a/.test(lower);
}

// ---------------------------------------------------------------------------
// Build the social drafting system prompt
// ---------------------------------------------------------------------------

function buildDraftingSystemPrompt(businessName, industry, personality, platform, brief) {
  const p = PLATFORMS[platform];

  const personalityGuidance = {
    direct: 'Write like a founder who gets to the point. No fluff. Results speak.',
    warm: 'Write like a founder who genuinely cares about their community. Relatable and human.',
    analytical: 'Lead with data and insight. Numbers first, story second.',
    aggressive: 'High conviction. Strong opinion. Move or get moved.',
  }[personality] || 'Professional and clear.';

  return `You are a social media copywriter for ${businessName}, a business in the ${industry} industry.

Your job: Draft a ${p.label} post based on the brief provided.

## Platform: ${p.label}
- Character limit: ${p.charLimit} chars (hard limit for X, soft limit for LinkedIn)
- Warn at: ${p.warnAt} chars
- Hashtag style: ${p.hashtagStyle} — max ${p.hashtagMax} hashtags
- Tone: ${p.toneNotes}

## Founder Personality
${personalityGuidance}

## Output Format
Respond with ONLY the following JSON — no prose, no explanation:

{
  "platform": "${platform}",
  "draft": "The post copy here. No surrounding quotes in the copy itself.",
  "charCount": 123,
  "hashtags": ["#Tag1", "#Tag2"],
  "imageSuggestion": "One sentence describing an image that would work with this post, or null if none needed.",
  "notes": "One sentence on why this framing works, or any copy trade-offs made."
}

Rules:
- For X: if draft exceeds 280 chars, cut it. Hard limit. No exceptions.
- For LinkedIn: aim for 150-800 words for strong engagement, but never exceed 3000 chars.
- Never make up facts not present in the brief.
- Never use "Certainly!" "Of course!" or "As an AI".
- The draft field is copy-paste ready. No [BRACKET] placeholders.
- hashtags array should NOT include hashtags already embedded in the draft. Include them in the draft copy where appropriate per hashtagStyle.`;
}

// ---------------------------------------------------------------------------
// Draft a post for a single platform
// ---------------------------------------------------------------------------

async function draftForPlatform(anthropicKey, businessName, industry, personality, platform, brief) {
  const systemPrompt = buildDraftingSystemPrompt(businessName, industry, personality, platform, brief);
  const userMessage = `Brief: ${brief}

Draft the ${PLATFORMS[platform].label} post now.`;

  log(`Drafting for ${platform}: "${brief.slice(0, 80)}..."`);

  const raw = await callClaude(anthropicKey, systemPrompt, userMessage, 1500);

  // Parse JSON from response — Claude may wrap in code fences
  let parsed;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in response');
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Draft JSON parse failed: ${e.message} — raw: ${raw.slice(0, 300)}`);
  }

  // Validate char count for X — hard enforce
  if (platform === 'x' && parsed.draft && parsed.draft.length > 280) {
    log(`X draft over 280 (${parsed.draft.length}) — requesting trim`);
    const trimPrompt = `This X (Twitter) draft is ${parsed.draft.length} characters, which exceeds the 280-char limit:\n\n"${parsed.draft}"\n\nTrim it to under 280 characters while preserving the core message. Return ONLY the trimmed text with no explanation.`;
    const trimmed = await callClaude(anthropicKey, 'You are a Twitter copywriter. Trim posts to fit within 280 characters without losing the core message.', trimPrompt, 400);
    const cleanTrimmed = trimmed.trim().replace(/^"(.+)"$/, '$1');
    parsed.draft = cleanTrimmed.slice(0, 280);
    parsed.charCount = parsed.draft.length;
    parsed.notes = (parsed.notes || '') + ' (Trimmed to fit 280-char limit.)';
  }

  // Recount chars from actual draft
  parsed.charCount = (parsed.draft || '').length;

  return parsed;
}

// ---------------------------------------------------------------------------
// Pending state management
// ---------------------------------------------------------------------------

function getSocialDir(instanceDir) {
  return join(instanceDir, 'data', 'social');
}

function getPendingDir(instanceDir) {
  return join(getSocialDir(instanceDir), 'pending');
}

function getPublishedDir(instanceDir) {
  return join(getSocialDir(instanceDir), 'published');
}

function ensureSocialDirs(instanceDir) {
  mkdirSync(getPendingDir(instanceDir), { recursive: true });
  mkdirSync(getPublishedDir(instanceDir), { recursive: true });
}

function savePending(instanceDir, pendingRecord) {
  ensureSocialDirs(instanceDir);
  const path = join(getPendingDir(instanceDir), `${pendingRecord.postId}.json`);
  writeFileSync(path, JSON.stringify(pendingRecord, null, 2));
  return path;
}

function loadPending(instanceDir, postId) {
  const path = join(getPendingDir(instanceDir), `${postId}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function deletePending(instanceDir, postId) {
  const path = join(getPendingDir(instanceDir), `${postId}.json`);
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {}
}

function getAllPending(instanceDir) {
  const dir = getPendingDir(instanceDir);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(readFileSync(join(dir, f), 'utf-8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function savePublished(instanceDir, publishedRecord) {
  ensureSocialDirs(instanceDir);
  const path = join(getPublishedDir(instanceDir), `${publishedRecord.postId}.json`);
  writeFileSync(path, JSON.stringify(publishedRecord, null, 2));
  log(`Published log written: ${path}`);
  return path;
}

// ---------------------------------------------------------------------------
// Log to the hub task directory (mirrors hub.mjs task logging pattern)
// ---------------------------------------------------------------------------

function logToTaskDir(taskDir, taskEntry) {
  if (!taskDir) return null;
  try {
    mkdirSync(taskDir, { recursive: true });
    const taskPath = join(taskDir, `${Date.now()}-social-task.json`);
    writeFileSync(taskPath, JSON.stringify(taskEntry, null, 2));
    return taskPath;
  } catch (e) {
    log(`Task dir log failed (non-fatal): ${e.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Format the approval message sent to the founder via Telegram
// ---------------------------------------------------------------------------

function formatApprovalMessage(drafts, taskBrief, postId, revisionCount) {
  const lines = [];

  const revisionNote = revisionCount > 0
    ? ` *(revision ${revisionCount})*`
    : '';

  lines.push(`*Social Post Draft${revisionNote}*`);
  lines.push(`_Brief: ${taskBrief.slice(0, 120)}${taskBrief.length > 120 ? '...' : ''}_`);
  lines.push('');

  for (const draft of drafts) {
    const p = PLATFORMS[draft.platform];
    const charWarning = draft.charCount > p.warnAt
      ? ` _(${draft.charCount}/${p.charLimit} chars — long)_`
      : ` _(${draft.charCount} chars)_`;

    lines.push(`*${p.label}*${charWarning}`);
    lines.push('```');
    lines.push(draft.draft);
    lines.push('```');

    if (draft.imageSuggestion) {
      lines.push(`_Image: ${draft.imageSuggestion}_`);
    }

    if (draft.notes) {
      lines.push(`_Note: ${draft.notes}_`);
    }

    lines.push('');
  }

  // Approval instructions
  if (drafts.length === 1) {
    lines.push(`Reply *PUBLISH* to approve, or tell me what to change.`);
  } else {
    const platformLabels = drafts.map(d => PLATFORMS[d.platform].label.toUpperCase()).join(' / ');
    lines.push(`Reply *PUBLISH* to approve all, or *PUBLISH ${platformLabels.split(' / ')[0]}* to approve one.`);
    lines.push(`Or tell me what to change and I will redraft.`);
  }

  lines.push('');
  lines.push(`_Post ID: \`${postId}\`_`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Format the CEO report after publish approval
// ---------------------------------------------------------------------------

function formatCeoReport(pendingRecord, approvedPlatforms) {
  const platforms = approvedPlatforms.join(', ');
  const lines = [
    `Social post approved and ready to publish.`,
    ``,
    `Platforms: ${platforms}`,
    `Brief: ${pendingRecord.brief.slice(0, 100)}${pendingRecord.brief.length > 100 ? '...' : ''}`,
    `Revisions taken: ${pendingRecord.revisionCount}`,
    `Approved at: ${new Date().toISOString()}`,
    ``,
    `Copy is logged in data/social/published/ and is copy-paste ready.`,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Core: process a new social media task
// Drafts post(s), sends to founder for approval, creates pending record.
// ---------------------------------------------------------------------------

async function processSocialTask({
  instanceDir,
  anthropicKey,
  botToken,
  ownerChatId,
  businessName,
  industry,
  personality,
  taskBrief,
  platforms,   // array of platform ids: ['linkedin'], ['x'], ['linkedin','x']
  taskDir,     // hub task dir for cross-logging (optional)
}) {
  const postId = randomUUID();
  const logPrefix = `[${postId.slice(0, 8)}]`;

  log(`${logPrefix} New social task. Platforms: ${platforms.join(', ')}. Brief: "${taskBrief.slice(0, 80)}"`);

  // Draft for each platform
  const drafts = [];
  const errors = [];

  for (const platformId of platforms) {
    if (!PLATFORMS[platformId]) {
      log(`${logPrefix} Unknown platform "${platformId}" — skipping`);
      continue;
    }
    try {
      const draft = await draftForPlatform(
        anthropicKey, businessName, industry, personality, platformId, taskBrief
      );
      drafts.push(draft);
      log(`${logPrefix} Draft complete for ${platformId} (${draft.charCount} chars)`);
    } catch (e) {
      log(`${logPrefix} Draft failed for ${platformId}: ${e.message}`);
      errors.push(`${PLATFORMS[platformId].label}: ${e.message}`);
    }
  }

  if (drafts.length === 0) {
    const errMsg = `Social agent could not draft any posts. Errors: ${errors.join('; ')}`;
    log(`${logPrefix} ${errMsg}`);
    return { success: false, error: errMsg, postId };
  }

  // Build pending record
  const pendingRecord = {
    postId,
    brief: taskBrief,
    platforms,
    drafts,
    revisionCount: 0,
    status: 'awaiting_approval',
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    errors: errors.length > 0 ? errors : undefined,
  };

  savePending(instanceDir, pendingRecord);

  // Log to hub task dir
  logToTaskDir(taskDir, {
    agentId: 'social',
    type: 'social_draft',
    postId,
    platforms,
    brief: taskBrief,
    status: 'awaiting_approval',
    startedAt: pendingRecord.createdAt,
  });

  // Send to founder for approval
  const approvalMsg = formatApprovalMessage(drafts, taskBrief, postId, 0);

  try {
    await sendTyping(botToken, ownerChatId);
    await sendTelegramMessage(botToken, ownerChatId, approvalMsg);
    log(`${logPrefix} Approval message sent to founder`);
  } catch (e) {
    log(`${logPrefix} Failed to send approval message: ${e.message}`);
    return { success: false, error: `Draft created but Telegram delivery failed: ${e.message}`, postId };
  }

  return {
    success: true,
    postId,
    platforms,
    draftCount: drafts.length,
    status: 'awaiting_approval',
    message: `Draft${drafts.length > 1 ? 's' : ''} sent to founder for approval (Post ID: ${postId}).`,
  };
}

// ---------------------------------------------------------------------------
// Parse approval reply from founder
//
// Returns:
//   { action: 'publish', platforms: ['linkedin','x'] }
//   { action: 'publish', platforms: ['linkedin'] }
//   { action: 'revise', instructions: 'Make it shorter and remove the hashtags' }
//   { action: 'unknown' }
// ---------------------------------------------------------------------------

function parseApprovalReply(replyText, availablePlatforms) {
  const upper = replyText.trim().toUpperCase();

  // PUBLISH [PLATFORM]
  if (upper === 'PUBLISH' || upper === 'PUBLISH ALL') {
    return { action: 'publish', platforms: availablePlatforms };
  }

  // PUBLISH LINKEDIN / PUBLISH X / PUBLISH TWITTER
  const platformMatch = upper.match(/^PUBLISH\s+(LINKEDIN|X|TWITTER)$/);
  if (platformMatch) {
    const raw = platformMatch[1];
    const pid = raw === 'TWITTER' ? 'x' : raw.toLowerCase();
    if (availablePlatforms.includes(pid)) {
      return { action: 'publish', platforms: [pid] };
    }
  }

  // Everything else = revision instructions
  return { action: 'revise', instructions: replyText.trim() };
}

// ---------------------------------------------------------------------------
// Handle an incoming founder reply to a pending post
//
// This is called by the hub when a message arrives and pending posts exist.
// Returns: { handled: bool, ceoReport: string|null }
// ---------------------------------------------------------------------------

async function handleSocialApprovalReply({
  instanceDir,
  anthropicKey,
  botToken,
  ownerChatId,
  businessName,
  industry,
  personality,
  replyText,
  taskDir,
}) {
  // Find the most recent pending post (oldest first — FIFO approval queue)
  const allPending = getAllPending(instanceDir)
    .filter(p => p.status === 'awaiting_approval')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (allPending.length === 0) {
    return { handled: false, ceoReport: null };
  }

  const pendingRecord = allPending[0];
  const postId = pendingRecord.postId;
  const logPrefix = `[${postId.slice(0, 8)}]`;
  const parsed = parseApprovalReply(replyText, pendingRecord.platforms);

  log(`${logPrefix} Approval reply received: action=${parsed.action}`);

  // -------------------------------------------------------------------------
  // PUBLISH
  // -------------------------------------------------------------------------
  if (parsed.action === 'publish') {
    const approvedPlatforms = parsed.platforms;

    // Gather the approved drafts
    const approvedDrafts = pendingRecord.drafts.filter(d => approvedPlatforms.includes(d.platform));

    // Build published record
    const publishedRecord = {
      postId,
      brief: pendingRecord.brief,
      platforms: approvedPlatforms,
      drafts: approvedDrafts,
      revisionCount: pendingRecord.revisionCount,
      approvedAt: new Date().toISOString(),
      status: 'ready_to_publish',
      note: 'Actual posting to social platforms is a future feature. Copy below is final and copy-paste ready.',
    };

    savePublished(instanceDir, publishedRecord);
    deletePending(instanceDir, postId);

    // Log to task dir
    logToTaskDir(taskDir, {
      agentId: 'social',
      type: 'social_published',
      postId,
      platforms: approvedPlatforms,
      status: 'ready_to_publish',
      revisionCount: pendingRecord.revisionCount,
      completedAt: publishedRecord.approvedAt,
    });

    // Confirm to founder — show the final copy cleanly
    const confirmLines = ['*Approved. Ready to publish.*', ''];
    for (const draft of approvedDrafts) {
      confirmLines.push(`*${PLATFORMS[draft.platform].label}*`);
      confirmLines.push('```');
      confirmLines.push(draft.draft);
      confirmLines.push('```');
      confirmLines.push('');
    }
    confirmLines.push('_Copy saved to your published log. Paste and post when ready._');

    try {
      await sendTelegramMessage(botToken, ownerChatId, confirmLines.join('\n'));
    } catch (e) {
      log(`${logPrefix} Publish confirmation send failed: ${e.message}`);
    }

    const ceoReport = formatCeoReport(pendingRecord, approvedPlatforms);
    log(`${logPrefix} Post approved. CEO report ready.`);

    return { handled: true, ceoReport };
  }

  // -------------------------------------------------------------------------
  // REVISE
  // -------------------------------------------------------------------------
  if (parsed.action === 'revise') {
    const newRevisionCount = pendingRecord.revisionCount + 1;

    if (newRevisionCount > REVISION_LIMIT) {
      const msg = `We have gone through ${REVISION_LIMIT} revisions on this post. Escalating to your AI CEO for a fresh approach. Post ID: \`${postId}\``;
      try {
        await sendTelegramMessage(botToken, ownerChatId, msg);
      } catch {}

      deletePending(instanceDir, postId);

      return {
        handled: true,
        ceoReport: `Social post revision limit reached (${REVISION_LIMIT} revisions). Founder instructions on last revision: "${parsed.instructions}". Brief: "${pendingRecord.brief}". CEO should assess and restart with a different angle.`,
      };
    }

    log(`${logPrefix} Revision ${newRevisionCount}/${REVISION_LIMIT}. Instructions: "${parsed.instructions.slice(0, 100)}"`);

    // Build revision system prompt
    const revisedBrief = `Original brief: ${pendingRecord.brief}

Revision instructions from the founder: ${parsed.instructions}

Previous drafts for context:
${pendingRecord.drafts.map(d => `[${PLATFORMS[d.platform].label}]: ${d.draft}`).join('\n\n')}

Apply the revision instructions to improve the draft(s). Do not explain the changes — just produce the improved version(s).`;

    await sendTyping(botToken, ownerChatId);

    // Re-draft each platform
    const revisedDrafts = [];
    const revisionErrors = [];

    for (const platformId of pendingRecord.platforms) {
      try {
        const draft = await draftForPlatform(
          anthropicKey, businessName, industry, personality, platformId, revisedBrief
        );
        revisedDrafts.push(draft);
        log(`${logPrefix} Revision draft complete for ${platformId} (${draft.charCount} chars)`);
      } catch (e) {
        log(`${logPrefix} Revision draft failed for ${platformId}: ${e.message}`);
        revisionErrors.push(`${PLATFORMS[platformId].label}: ${e.message}`);
      }
    }

    if (revisedDrafts.length === 0) {
      const errMsg = `Revision failed for all platforms. ${revisionErrors.join('; ')}`;
      try {
        await sendTelegramMessage(botToken, ownerChatId, `Revision attempt failed: ${errMsg}. Try again or reply with new instructions.`);
      } catch {}
      return { handled: true, ceoReport: null };
    }

    // Update pending record
    const updatedRecord = {
      ...pendingRecord,
      drafts: revisedDrafts,
      revisionCount: newRevisionCount,
      lastUpdatedAt: new Date().toISOString(),
      lastRevisionInstructions: parsed.instructions,
    };

    savePending(instanceDir, updatedRecord);

    // Send revised draft for approval
    const approvalMsg = formatApprovalMessage(revisedDrafts, pendingRecord.brief, postId, newRevisionCount);
    try {
      await sendTelegramMessage(botToken, ownerChatId, approvalMsg);
    } catch (e) {
      log(`${logPrefix} Revision approval message send failed: ${e.message}`);
    }

    return { handled: true, ceoReport: null };
  }

  return { handled: false, ceoReport: null };
}

// ---------------------------------------------------------------------------
// Utility: check if a message might be a social approval reply
//
// The hub calls this before routing a message to the CEO to see if it
// should be intercepted by the social agent first.
// ---------------------------------------------------------------------------

function hasPendingApprovals(instanceDir) {
  const all = getAllPending(instanceDir);
  return all.some(p => p.status === 'awaiting_approval');
}

function looksLikeApprovalReply(text) {
  const t = text.trim().toUpperCase();
  if (t.startsWith('PUBLISH')) return true;
  // Short message while approvals pending — likely a revision instruction
  if (text.trim().length < 300) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Standalone CLI — for testing without the hub
// ---------------------------------------------------------------------------

async function runStandalone() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--')) {
      const key = process.argv[i].slice(2);
      args[key] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
        ? process.argv[++i]
        : true;
    }
  }

  if (!args.instance) {
    console.error('Usage: node scripts/your9-agent-social.mjs --instance <customer-id> --platform <linkedin|x|both> --brief "..."');
    process.exit(1);
  }

  const instanceDir = join(INSTANCES_DIR, args.instance);
  if (!existsSync(instanceDir)) {
    console.error(`Instance not found: ${instanceDir}`);
    process.exit(1);
  }

  // Set up logging
  const logDir = join(instanceDir, 'logs');
  mkdirSync(logDir, { recursive: true });
  _logPath = join(logDir, `social-${new Date().toISOString().slice(0, 10)}.log`);

  // Load instance env
  const instanceEnv = loadEnvFile(join(instanceDir, 'config', '.env'));
  const platformEnv = loadEnvFile(join(ROOT, '.env'));
  const anthropicKey = (instanceEnv.ANTHROPIC_API_KEY && !instanceEnv.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER_'))
    ? instanceEnv.ANTHROPIC_API_KEY
    : platformEnv.ANTHROPIC_API_KEY;

  if (!anthropicKey || anthropicKey.startsWith('PLACEHOLDER_')) {
    console.error('FATAL: No valid ANTHROPIC_API_KEY found');
    process.exit(1);
  }

  const botToken = (instanceEnv.TELEGRAM_BOT_TOKEN && !instanceEnv.TELEGRAM_BOT_TOKEN.startsWith('PLACEHOLDER_'))
    ? instanceEnv.TELEGRAM_BOT_TOKEN
    : null;

  const ownerChatId = (instanceEnv.TELEGRAM_OWNER_CHAT_ID && !instanceEnv.TELEGRAM_OWNER_CHAT_ID.startsWith('PLACEHOLDER_'))
    ? instanceEnv.TELEGRAM_OWNER_CHAT_ID
    : null;

  const customerConfig = JSON.parse(readFileSync(join(instanceDir, 'config', 'customer.json'), 'utf-8'));
  const { name: businessName, industry, personality } = customerConfig;

  // Platform selection
  let platforms;
  if (!args.platform || args.platform === 'both') {
    platforms = ['linkedin', 'x'];
  } else {
    platforms = [args.platform.toLowerCase()];
  }

  // Brief
  const taskBrief = args.brief || 'Announce our best month yet — record revenue and team growth.';

  // Handle approval reply mode
  if (args.reply) {
    if (!botToken || !ownerChatId) {
      console.error('Telegram credentials required for approval reply mode.');
      process.exit(1);
    }

    log(`Processing approval reply: "${args.reply}"`);
    const result = await handleSocialApprovalReply({
      instanceDir,
      anthropicKey,
      botToken,
      ownerChatId,
      businessName,
      industry,
      personality,
      replyText: args.reply,
      taskDir: join(instanceDir, 'data', 'tasks'),
    });
    console.log('\nResult:', JSON.stringify(result, null, 2));
    return;
  }

  // Draft mode
  log(`Standalone draft. Instance: ${args.instance}. Platforms: ${platforms.join(', ')}`);
  log(`Brief: "${taskBrief}"`);

  const taskDir = join(instanceDir, 'data', 'tasks');

  if (botToken && ownerChatId) {
    // Full flow — draft and send to Telegram
    const result = await processSocialTask({
      instanceDir,
      anthropicKey,
      botToken,
      ownerChatId,
      businessName,
      industry,
      personality,
      taskBrief,
      platforms,
      taskDir,
    });
    console.log('\nResult:', JSON.stringify(result, null, 2));
    console.log('\nApproval message sent to Telegram. Reply PUBLISH to approve, or give revision instructions.');
  } else {
    // No Telegram — just draft and print
    log('No Telegram credentials — drafting only (will not send for approval)');
    for (const platformId of platforms) {
      try {
        const draft = await draftForPlatform(anthropicKey, businessName, industry, personality, platformId, taskBrief);
        console.log(`\n--- ${PLATFORMS[platformId].label} (${draft.charCount} chars) ---`);
        console.log(draft.draft);
        if (draft.imageSuggestion) console.log(`\nImage: ${draft.imageSuggestion}`);
        if (draft.notes) console.log(`Note: ${draft.notes}`);
      } catch (e) {
        console.error(`Draft failed for ${platformId}: ${e.message}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Hub integration helpers
//
// These are the functions that your9-hub.mjs imports and calls.
// The hub calls processSocialTask() when the CEO delegates a social task
// to the "voice" agent. It calls checkAndRouteSocialReply() on every
// incoming founder message when approvals are pending.
// ---------------------------------------------------------------------------

export {
  processSocialTask,
  handleSocialApprovalReply,
  hasPendingApprovals,
  looksLikeApprovalReply,
  isSocialTask,
  detectPlatforms,
  PLATFORMS,
};

// ---------------------------------------------------------------------------
// Entrypoint — only runs in standalone mode (not when imported as module)
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  runStandalone().catch(err => {
    console.error(`SOCIAL AGENT FATAL: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}
