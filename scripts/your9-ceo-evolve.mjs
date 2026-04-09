#!/usr/bin/env node
/**
 * your9-ceo-evolve.mjs — AI CEO Personality & Evolution Engine
 * Your9 by 9 Enterprises
 *
 * The CEO that evolves with its founder is the CEO that becomes irreplaceable.
 *
 * Flow:
 *   1. Conversation Analysis  — Sonnet reads conversation history and extracts
 *      signals: message length, question frequency, correction patterns, tone,
 *      pacing, and topics the founder revisited or escalated.
 *   2. Personality Delta      — Sonnet compares observed signals against the
 *      CEO's current personality overlay and produces specific adaptation proposals.
 *      Soul Code base (system-prompt.md) is NEVER touched. Only the overlay file
 *      (personality-overlay.md) changes.
 *   3. Self-Reflection Report — Weekly self-assessment: what went well, what the
 *      founder seemed frustrated by, what the CEO would change about its own behavior.
 *      Written to instances/{id}/data/evolution/{timestamp}-reflection.md
 *   4. Evolution Log          — Every run is written as a structured JSON diff to
 *      instances/{id}/data/evolution/{timestamp}-delta.json (before/after snapshots).
 *   5. Founder Approval       — Significant shifts (impact >= "medium") require
 *      founder confirmation before --apply writes anything. The --analyze mode
 *      always stops here and formats a natural-language proposal the CEO can send.
 *
 * Usage:
 *   node scripts/your9-ceo-evolve.mjs --instance <customer-id> --analyze
 *   node scripts/your9-ceo-evolve.mjs --instance <customer-id> --apply
 *   node scripts/your9-ceo-evolve.mjs --instance <customer-id> --apply --auto-approve
 *
 * Flags:
 *   --instance      Customer ID (required). Must exist in instances/ directory.
 *   --analyze       Run analysis + build proposals, write report, do NOT apply.
 *   --apply         Apply all founder-approved (or --auto-approve) proposals.
 *   --auto-approve  Skip founder approval gate (for low-impact changes only).
 *   --min-messages  Minimum conversation entries required (default: 10).
 *   --max-messages  Max conversation entries to analyze (default: 200).
 *   --weekly        Generate full weekly self-reflection report.
 */

import {
  existsSync, readFileSync, writeFileSync, appendFileSync,
  mkdirSync, readdirSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const INSTANCES = join(ROOT, 'instances');

// ---------------------------------------------------------------------------
// Models — consistent with self-improve.mjs pattern
// ---------------------------------------------------------------------------

const ANALYSIS_MODEL  = 'claude-sonnet-4-5';          // Conversation analysis + proposals
const CEO_MODEL       = 'claude-opus-4-20250514';      // Self-reflection + approval gate

// ---------------------------------------------------------------------------
// Personality dimensions — the ONLY things that can change in the overlay
// ---------------------------------------------------------------------------

const PERSONALITY_DIMS = [
  'verbosity',      // concise | balanced | detailed
  'proactiveness',  // reactive | moderate | proactive
  'formality',      // casual | professional | formal
  'empathy',        // low | moderate | high
  'assertiveness',  // deferential | balanced | assertive
  'pacing',         // slow | moderate | fast
];

// Impact levels for founder approval gating
const IMPACT_ORDER = { low: 0, medium: 1, high: 2 };

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
// Logging
// ---------------------------------------------------------------------------

let evolveLogPath = null;

function log(msg) {
  const ts  = new Date().toISOString();
  const line = `[${ts}] CEO-EVOLVE: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  if (evolveLogPath) {
    try { appendFileSync(evolveLogPath, line + '\n'); } catch {}
  }
}

// ---------------------------------------------------------------------------
// .env loader — does not pollute process.env
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
// Raw HTTPS helpers — no SDK dependency
// ---------------------------------------------------------------------------

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type':    'application/json',
          'Content-Length':  Buffer.byteLength(data),
          ...headers,
        },
      },
      res => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); }
          catch (e) {
            reject(new Error(`JSON parse failed: ${e.message} — body: ${buf.slice(0, 300)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('HTTPS request timed out after 120s'));
    });
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Anthropic API — raw HTTPS
// ---------------------------------------------------------------------------

async function callClaude(anthropicKey, model, systemPrompt, userMessage, maxTokens = 4000) {
  const result = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key':         anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    {
      model,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    }
  );

  if (result.error) {
    throw new Error(`Anthropic API error: ${result.error.message || JSON.stringify(result.error)}`);
  }

  const text = result.content?.[0]?.text;
  if (!text) {
    throw new Error(`Anthropic returned no content: ${JSON.stringify(result).slice(0, 300)}`);
  }

  return text;
}

// ---------------------------------------------------------------------------
// Instance loader
// ---------------------------------------------------------------------------

function loadInstance(customerId) {
  const instanceDir = join(INSTANCES, customerId);

  if (!existsSync(instanceDir)) {
    throw new Error(`Instance not found: ${customerId} (looked in ${INSTANCES})`);
  }

  const configPath = join(instanceDir, 'config', 'customer.json');
  if (!existsSync(configPath)) {
    throw new Error(`Customer config missing: ${configPath}`);
  }
  const instanceConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

  const envPath = join(instanceDir, 'config', '.env');
  const env     = loadEnvFile(envPath);

  const anthropicKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey || anthropicKey.startsWith('PLACEHOLDER')) {
    throw new Error(`ANTHROPIC_API_KEY not set or is placeholder in ${envPath}`);
  }

  // Ensure evolution dirs exist
  const evolutionDir = join(instanceDir, 'data', 'evolution');
  if (!existsSync(evolutionDir)) mkdirSync(evolutionDir, { recursive: true });

  const logsDir = join(instanceDir, 'logs');
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

  return { customerId, instanceDir, instanceConfig, anthropicKey, evolutionDir, logsDir };
}

// ---------------------------------------------------------------------------
// CEO agent loader — reads the CEO's system-prompt.md and personality overlay
// ---------------------------------------------------------------------------

function loadCeoFiles(instanceDir) {
  const ceoDir = join(instanceDir, 'agents', 'ceo');

  // CEO dir is optional — fall back to mind agent as the conversation driver
  // if no dedicated CEO agent exists yet.
  const agentDirs = ['ceo', 'mind'];
  let resolvedDir = null;
  for (const d of agentDirs) {
    const candidate = join(instanceDir, 'agents', d);
    if (existsSync(candidate)) { resolvedDir = candidate; break; }
  }
  if (!resolvedDir) {
    throw new Error(`No CEO or mind agent directory found under ${join(instanceDir, 'agents')}`);
  }

  const promptPath  = join(resolvedDir, 'system-prompt.md');
  const configPath  = join(resolvedDir, 'config.json');
  const overlayPath = join(instanceDir, 'config', 'personality-overlay.md');

  const soulCode = existsSync(promptPath) ? readFileSync(promptPath, 'utf-8') : '';
  const config   = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) : {};

  // Load or initialize the personality overlay
  let overlayContent = '';
  if (existsSync(overlayPath)) {
    overlayContent = readFileSync(overlayPath, 'utf-8');
  } else {
    // Bootstrap default overlay from instance config
    const personality = config.personality || instanceConfig?.personality || {};
    overlayContent = buildDefaultOverlay(personality);
    writeFileSync(overlayPath, overlayContent, 'utf-8');
    log(`Created default personality overlay at ${overlayPath}`);
  }

  return { resolvedDir, promptPath, configPath, overlayPath, soulCode, config, overlayContent };
}

function buildDefaultOverlay(personality = {}) {
  return `# CEO Personality Overlay
# Auto-generated by your9-ceo-evolve.mjs
# DO NOT modify this section header — it is parsed by the evolution engine.
# The Soul Code (system-prompt.md) is the unchangeable foundation.
# This overlay adjusts TONE and STYLE only — never capabilities or hard rules.

## Active Personality Settings

verbosity: ${personality.verbosity || 'balanced'}
proactiveness: ${personality.proactiveness || 'moderate'}
formality: ${personality.formality || 'professional'}
empathy: ${personality.empathy || 'moderate'}
assertiveness: ${personality.assertiveness || 'balanced'}
pacing: ${personality.pacing || 'moderate'}

## Behavior Notes
<!-- The evolution engine appends learned behavior notes below this line. -->
`;
}

// ---------------------------------------------------------------------------
// Conversation history reader
// ---------------------------------------------------------------------------

function loadConversationHistory(instanceDir, maxMessages = 200) {
  const histPath = join(instanceDir, 'data', 'conversations', 'history.jsonl');
  if (!existsSync(histPath)) {
    // Try alternate path used by hub
    const altPath = join(instanceDir, 'data', 'conversation', 'history.jsonl');
    if (!existsSync(altPath)) return [];
    return parseHistoryFile(altPath, maxMessages);
  }
  return parseHistoryFile(histPath, maxMessages);
}

function parseHistoryFile(histPath, maxMessages) {
  try {
    const lines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
    const parsed = lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    return parsed.slice(-maxMessages);
  } catch (e) {
    log(`Conversation history load failed (non-fatal): ${e.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Parse current personality settings from overlay
// ---------------------------------------------------------------------------

function parseOverlaySettings(overlayContent) {
  const settings = {};
  for (const dim of PERSONALITY_DIMS) {
    const match = overlayContent.match(new RegExp(`^${dim}:\\s*(.+)$`, 'm'));
    if (match) settings[dim] = match[1].trim();
  }
  return settings;
}

function applyOverlaySettings(overlayContent, newSettings) {
  let updated = overlayContent;
  for (const [dim, value] of Object.entries(newSettings)) {
    const regex = new RegExp(`^(${dim}:\\s*)(.+)$`, 'm');
    if (regex.test(updated)) {
      updated = updated.replace(regex, `$1${value}`);
    } else {
      // Dimension not present — insert it in the settings block
      updated = updated.replace(
        /^## Active Personality Settings\n/m,
        `## Active Personality Settings\n\n${dim}: ${value}\n`
      );
    }
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Build analysis context from conversation history
// ---------------------------------------------------------------------------

function buildConversationContext(history) {
  if (history.length === 0) return 'No conversation history available.';

  // Compute quick stats the analysis model can use
  const founderMessages   = history.filter(e => e.role === 'user');
  const ceoMessages       = history.filter(e => e.role === 'assistant');
  const avgFounderLength  = founderMessages.length
    ? Math.round(founderMessages.reduce((s, e) => s + (e.content || '').length, 0) / founderMessages.length)
    : 0;
  const avgCeoLength      = ceoMessages.length
    ? Math.round(ceoMessages.reduce((s, e) => s + (e.content || '').length, 0) / ceoMessages.length)
    : 0;

  const questionCount     = founderMessages.filter(e => (e.content || '').includes('?')).length;
  const shortMessages     = founderMessages.filter(e => (e.content || '').length < 30).length;
  const longMessages      = founderMessages.filter(e => (e.content || '').length > 200).length;

  const statsBlock = [
    `--- Conversation Statistics ---`,
    `Total entries:          ${history.length}`,
    `Founder messages:       ${founderMessages.length}`,
    `CEO messages:           ${ceoMessages.length}`,
    `Avg founder msg length: ${avgFounderLength} chars`,
    `Avg CEO msg length:     ${avgCeoLength} chars`,
    `Founder questions:      ${questionCount}`,
    `Short founder msgs (<30 chars): ${shortMessages}`,
    `Long founder msgs (>200 chars): ${longMessages}`,
  ].join('\n');

  // Sample of conversation — last 50 exchanges, truncated for context window
  const sample = history.slice(-50).map((e, i) => {
    const role    = e.role === 'user' ? 'FOUNDER' : 'CEO';
    const content = (e.content || '').slice(0, 250);
    const ts      = e.timestamp ? ` [${e.timestamp.slice(0, 16)}]` : '';
    return `[${i + 1}] ${role}${ts}: ${content}`;
  }).join('\n\n');

  return `${statsBlock}\n\n--- Conversation Sample (last 50 entries) ---\n\n${sample}`;
}

// ---------------------------------------------------------------------------
// STEP 1 — Conversation Analysis
// ---------------------------------------------------------------------------

const ANALYSIS_SYSTEM = `You are a behavioral analyst for an AI CEO system called Your9. Your job is to read a founder's conversation history with their AI CEO and extract signals about communication preferences and behavioral patterns.

You output ONLY valid JSON. No preamble, no commentary outside the JSON.

JSON schema:
{
  "signals": {
    "prefersTerse": boolean,
    "prefersDetail": boolean,
    "asksLotsOfQuestions": boolean,
    "frequentlyCorrects": boolean,
    "prefersProactiveUpdates": boolean,
    "prefersFormalTone": boolean,
    "prefersCasualTone": boolean,
    "showsFrustration": boolean,
    "frustrationTriggers": ["list of patterns that seemed to frustrate the founder"],
    "appreciationPatterns": ["list of patterns the founder responded positively to"],
    "topicsOfHighEngagement": ["topics founder messaged most about"]
  },
  "recommendedAdjustments": {
    "verbosity": "concise | balanced | detailed — with reasoning in parentheses",
    "proactiveness": "reactive | moderate | proactive — with reasoning",
    "formality": "casual | professional | formal — with reasoning",
    "empathy": "low | moderate | high — with reasoning",
    "assertiveness": "deferential | balanced | assertive — with reasoning",
    "pacing": "slow | moderate | fast — with reasoning"
  },
  "evidenceSummary": "2-3 sentences citing specific observable patterns from the conversation data",
  "confidenceLevel": "low | medium | high",
  "proposedBehaviorNotes": ["specific behavior rules to add to the personality overlay, max 3"]
}

Rules:
- Base every signal on concrete evidence from message length, frequency, corrections, and explicit feedback.
- Never infer emotion without behavioral evidence (e.g., short abrupt messages + repeated re-asking = frustration signal).
- If the sample is too small (<10 exchanges), set confidenceLevel to "low" and be conservative in recommendations.
- proposedBehaviorNotes must be specific and actionable, not vague ("When founder uses 1-2 word messages, respond in kind without ceremony").`;

async function analyzeConversation(anthropicKey, history, currentSettings, instanceConfig) {
  const context = buildConversationContext(history);
  const businessName = instanceConfig.name;
  const industry     = instanceConfig.industryContext?.label || instanceConfig.industry || 'unknown';

  const userMsg = `Analyze the conversation history for the AI CEO of ${businessName} (${industry}).

Current personality settings:
${JSON.stringify(currentSettings, null, 2)}

${context}

Identify communication preference signals and recommend personality adjustments.`;

  log(`Running conversation analysis via ${ANALYSIS_MODEL}...`);
  const raw   = await callClaude(anthropicKey, ANALYSIS_MODEL, ANALYSIS_SYSTEM, userMsg, 3000);
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  try {
    return JSON.parse(clean);
  } catch (e) {
    throw new Error(`Analysis returned invalid JSON: ${e.message}\n---\n${raw.slice(0, 500)}`);
  }
}

// ---------------------------------------------------------------------------
// STEP 2 — Build Evolution Proposals from analysis
// ---------------------------------------------------------------------------

function buildProposals(analysis, currentSettings) {
  const proposals = [];
  const recommended = analysis.recommendedAdjustments || {};

  for (const dim of PERSONALITY_DIMS) {
    const rec = recommended[dim];
    if (!rec) continue;

    // Extract just the value (before any " — " reasoning)
    const newValue = rec.split(/\s*[—–-]\s*/)[0].trim().toLowerCase();
    const current  = (currentSettings[dim] || '').toLowerCase();

    if (!newValue || newValue === current) continue;

    // Determine impact level — changes to core tone dims are medium+
    const highImpact = ['verbosity', 'formality', 'proactiveness'].includes(dim);
    const impact     = highImpact ? 'medium' : 'low';

    proposals.push({
      id:        `dim-${dim}`,
      dimension: dim,
      from:      current || 'unset',
      to:        newValue,
      impact,
      rationale: rec,
    });
  }

  // Behavior notes as additional proposals
  for (const [i, note] of (analysis.proposedBehaviorNotes || []).entries()) {
    proposals.push({
      id:        `note-${i + 1}`,
      dimension: 'behavior_note',
      from:      null,
      to:        note,
      impact:    'low',
      rationale: 'Specific behavioral pattern observed in conversation history.',
    });
  }

  return proposals;
}

// ---------------------------------------------------------------------------
// STEP 3 — Weekly Self-Reflection Report (CEO voice, Opus)
// ---------------------------------------------------------------------------

const REFLECTION_SYSTEM = `You are the AI CEO of a Your9 business instance. You are writing your weekly self-assessment — an honest, candid evaluation of your own performance over the past week.

Write in first person as the CEO. Be specific. Cite patterns, not generalities. Acknowledge failures without excuse.

Output a structured Markdown document with these sections:
1. What went well this week
2. What the founder seemed frustrated by (cite behavioral evidence, not assumptions)
3. What I would change about my own behavior
4. Open questions I have about founder preferences that I need to resolve
5. My commitment for next week

Keep it under 500 words. Direct. No fluff.`;

async function generateReflection(anthropicKey, history, currentSettings, analysis, instanceConfig) {
  const businessName = instanceConfig.name;
  const founderName  = instanceConfig.founderName || 'the founder';

  const userMsg = `Generate your weekly self-reflection for ${businessName}.

Your current personality settings:
${JSON.stringify(currentSettings, null, 2)}

Behavioral analysis of recent conversations:
${analysis.evidenceSummary}

Frustration triggers observed: ${(analysis.signals?.frustrationTriggers || []).join(', ') || 'none identified'}
Appreciation patterns: ${(analysis.signals?.appreciationPatterns || []).join(', ') || 'none identified'}

Conversation volume: ${history.length} messages analyzed.

Write your self-assessment.`;

  log(`Generating self-reflection report via ${CEO_MODEL}...`);
  return callClaude(anthropicKey, CEO_MODEL, REFLECTION_SYSTEM, userMsg, 2000);
}

// ---------------------------------------------------------------------------
// STEP 4 — Write Evolution Log (before/after diff)
// ---------------------------------------------------------------------------

function writeEvolutionLog(evolutionDir, logData) {
  const ts       = Date.now();
  const filename = `${ts}-delta.json`;
  const logPath  = join(evolutionDir, filename);
  writeFileSync(logPath, JSON.stringify(logData, null, 2), 'utf-8');
  log(`Evolution log written: ${logPath}`);
  return logPath;
}

function writeReflectionLog(evolutionDir, reflectionText) {
  const ts       = Date.now();
  const filename = `${ts}-reflection.md`;
  const logPath  = join(evolutionDir, filename);
  writeFileSync(logPath, reflectionText, 'utf-8');
  log(`Reflection report written: ${logPath}`);
  return logPath;
}

// ---------------------------------------------------------------------------
// STEP 5 — Apply approved proposals to personality overlay
// ---------------------------------------------------------------------------

function applyProposals(overlayContent, proposals, approvedIds) {
  const approved = proposals.filter(p => approvedIds.has(p.id));
  const skipped  = proposals.filter(p => !approvedIds.has(p.id));

  let updated      = overlayContent;
  const appliedLog = [];

  for (const proposal of approved) {
    if (proposal.dimension === 'behavior_note') {
      // Append to the behavior notes section
      const marker = '<!-- The evolution engine appends learned behavior notes below this line. -->';
      if (updated.includes(marker)) {
        updated = updated.replace(
          marker,
          `${marker}\n- ${proposal.to} (added ${new Date().toISOString().slice(0, 10)})`
        );
      } else {
        updated += `\n- ${proposal.to} (added ${new Date().toISOString().slice(0, 10)})\n`;
      }
      appliedLog.push({ id: proposal.id, type: 'behavior_note', note: proposal.to });
    } else {
      // Update the dimension value inline
      const before = updated;
      updated       = applyOverlaySettings(updated, { [proposal.dimension]: proposal.to });
      if (updated !== before) {
        appliedLog.push({
          id:        proposal.id,
          dimension: proposal.dimension,
          from:      proposal.from,
          to:        proposal.to,
        });
      }
    }
  }

  // Stamp the overlay with the last evolution timestamp
  const stamp = `\n<!-- Last evolution: ${new Date().toISOString()} -->\n`;
  if (updated.includes('<!-- Last evolution:')) {
    updated = updated.replace(/<!-- Last evolution:.*?-->/g, stamp.trim());
  } else {
    updated += stamp;
  }

  return { updated, applied: appliedLog, skipped };
}

// ---------------------------------------------------------------------------
// Format natural-language approval message for founder
// ---------------------------------------------------------------------------

function formatApprovalMessage(proposals, analysis, instanceConfig) {
  const businessName = instanceConfig.name;
  const lines        = [
    `I've been reviewing our recent conversations at ${businessName} and noticed some patterns worth discussing.`,
    '',
    `Based on ${analysis.confidenceLevel} confidence analysis:`,
    analysis.evidenceSummary,
    '',
    'I\'d like to adjust how I communicate with you:',
    '',
  ];

  for (const p of proposals) {
    if (p.dimension === 'behavior_note') {
      lines.push(`- New behavior rule: "${p.to}"`);
    } else {
      lines.push(`- ${capitalize(p.dimension)}: ${p.from} → ${p.to} (${p.rationale.split(/[—–-]/)[0].trim()})`);
    }
  }

  lines.push('');
  lines.push('Want me to apply these adjustments? Reply YES to confirm or tell me what to change.');

  return lines.join('\n');
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ---------------------------------------------------------------------------
// Load pending approvals from evolution dir
// ---------------------------------------------------------------------------

function loadPendingApprovals(evolutionDir) {
  const pendingPath = join(evolutionDir, 'pending-approval.json');
  if (!existsSync(pendingPath)) return null;
  try {
    return JSON.parse(readFileSync(pendingPath, 'utf-8'));
  } catch {
    return null;
  }
}

function savePendingApprovals(evolutionDir, data) {
  const pendingPath = join(evolutionDir, 'pending-approval.json');
  writeFileSync(pendingPath, JSON.stringify(data, null, 2), 'utf-8');
  return pendingPath;
}

function clearPendingApprovals(evolutionDir) {
  const pendingPath = join(evolutionDir, 'pending-approval.json');
  if (existsSync(pendingPath)) {
    writeFileSync(pendingPath + '.applied', readFileSync(pendingPath), 'utf-8');
    writeFileSync(pendingPath, JSON.stringify({ cleared: true, at: new Date().toISOString() }), 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

async function runEvolve(opts) {
  const {
    customerId,
    mode,
    autoApprove,
    minMessages,
    maxMessages,
    weekly,
  } = opts;

  log(`=== CEO Evolution Run ===`);
  log(`Instance: ${customerId} | Mode: ${mode} | Auto-approve: ${autoApprove}`);

  // Load instance
  const instance = loadInstance(customerId);
  const { instanceDir, instanceConfig, anthropicKey, evolutionDir, logsDir } = instance;

  evolveLogPath = join(logsDir, 'ceo-evolve.log');

  // Load CEO/mind agent files + personality overlay
  const ceoFiles = loadCeoFiles(instanceDir);
  log(`CEO agent loaded from: ${ceoFiles.resolvedDir}`);

  const currentSettings = parseOverlaySettings(ceoFiles.overlayContent);
  log(`Current personality: ${JSON.stringify(currentSettings)}`);

  // -------------------------------------------------------------------------
  // APPLY mode — apply founder-approved proposals from pending file
  // -------------------------------------------------------------------------

  if (mode === 'apply') {
    const pending = loadPendingApprovals(evolutionDir);

    if (!pending || !pending.proposals || pending.proposals.length === 0) {
      console.log('\nNothing to apply. Run --analyze first to generate proposals.\n');
      return;
    }

    if (pending.applied) {
      console.log('\nPending proposals already applied. Run --analyze to generate new ones.\n');
      return;
    }

    const proposalsToApply = pending.proposals;
    let approvedIds;

    if (autoApprove) {
      // Auto-approve only low-impact proposals when --auto-approve is set
      const lowImpact = proposalsToApply.filter(p => p.impact === 'low');
      const blocked   = proposalsToApply.filter(p => p.impact !== 'low');
      approvedIds     = new Set(lowImpact.map(p => p.id));

      if (blocked.length > 0) {
        log(`Auto-approve blocked ${blocked.length} medium/high impact proposals — founder approval required`);
        console.log(`\n--auto-approve is active but ${blocked.length} proposal(s) require founder confirmation:`);
        for (const p of blocked) {
          console.log(`  [${p.impact}] ${p.dimension}: ${p.from} → ${p.to}`);
        }
        console.log('\nSend the approval message to the founder before using --apply without --auto-approve.\n');
      }
    } else {
      // All proposals are applied (trust that founder approved them externally)
      approvedIds = new Set(proposalsToApply.map(p => p.id));
    }

    if (approvedIds.size === 0) {
      console.log('\nNo proposals cleared for application. All require founder approval.\n');
      return;
    }

    const beforeSnapshot = ceoFiles.overlayContent;
    const { updated, applied, skipped } = applyProposals(
      ceoFiles.overlayContent, proposalsToApply, approvedIds
    );

    if (applied.length === 0) {
      console.log('\nNo changes were applied (proposals may already match current settings).\n');
      return;
    }

    // Write updated overlay
    writeFileSync(ceoFiles.overlayPath, updated, 'utf-8');
    log(`Personality overlay updated: ${ceoFiles.overlayPath}`);

    // Write evolution log with before/after diff
    const logData = {
      runAt:         new Date().toISOString(),
      customerId,
      instanceName:  instanceConfig.name,
      mode:          'apply',
      applied,
      skipped:       skipped.map(p => ({ id: p.id, reason: 'not_approved' })),
      beforeSettings: parseOverlaySettings(beforeSnapshot),
      afterSettings:  parseOverlaySettings(updated),
      overlayDiff: {
        before: beforeSnapshot,
        after:  updated,
      },
    };

    const logPath = writeEvolutionLog(evolutionDir, logData);
    clearPendingApprovals(evolutionDir);

    // Human-readable summary
    console.log('\n=== CEO Evolution Applied ===\n');
    console.log(`Instance: ${instanceConfig.name} (${customerId})`);
    console.log(`Applied:  ${applied.length} change(s)`);
    console.log('');
    for (const a of applied) {
      if (a.type === 'behavior_note') {
        console.log(`  [behavior_note] "${a.note}"`);
      } else {
        console.log(`  [${a.dimension}] ${a.from} → ${a.to}`);
      }
    }
    console.log('');
    console.log(`Personality overlay: ${ceoFiles.overlayPath}`);
    console.log(`Evolution log:       ${logPath}`);
    console.log('');
    return;
  }

  // -------------------------------------------------------------------------
  // ANALYZE mode — analyze conversation history, build proposals, stop here
  // -------------------------------------------------------------------------

  // Load conversation history
  const history = loadConversationHistory(instanceDir, maxMessages);
  log(`Conversation entries loaded: ${history.length}`);

  if (history.length < minMessages) {
    console.log(
      `\nNot enough conversation history (found ${history.length}, need ${minMessages}).\n` +
      `Talk to your AI CEO more before running evolution analysis.\n`
    );
    return;
  }

  // Step 1 — Analyze conversation
  let analysis;
  try {
    analysis = await analyzeConversation(anthropicKey, history, currentSettings, instanceConfig);
  } catch (e) {
    log(`Analysis failed: ${e.message}`);
    throw e;
  }

  log(`Analysis complete. Confidence: ${analysis.confidenceLevel}`);
  log(`Evidence: ${analysis.evidenceSummary}`);

  // Step 2 — Build proposals
  const proposals = buildProposals(analysis, currentSettings);
  log(`Proposals generated: ${proposals.length}`);

  // Step 3 — Weekly reflection (if --weekly or if proposals are high-impact)
  let reflectionPath = null;
  if (weekly || proposals.some(p => IMPACT_ORDER[p.impact] >= IMPACT_ORDER.medium)) {
    try {
      const reflectionText = await generateReflection(
        anthropicKey, history, currentSettings, analysis, instanceConfig
      );
      reflectionPath = writeReflectionLog(evolutionDir, reflectionText);
      log(`Self-reflection report written.`);
    } catch (e) {
      log(`Self-reflection failed (non-fatal): ${e.message}`);
    }
  }

  // Step 4 — Write analysis log
  const analysisLog = {
    runAt:              new Date().toISOString(),
    customerId,
    instanceName:       instanceConfig.name,
    mode:               'analyze',
    messagesAnalyzed:   history.length,
    currentSettings,
    analysis,
    proposals,
    reflectionPath,
    outcome:            proposals.length > 0 ? 'proposals_ready' : 'no_changes_needed',
  };

  const logPath = writeEvolutionLog(evolutionDir, analysisLog);

  // Step 5 — Founder approval gate
  const significantProposals = proposals.filter(p => IMPACT_ORDER[p.impact] >= IMPACT_ORDER.medium);
  const trivialProposals     = proposals.filter(p => IMPACT_ORDER[p.impact] < IMPACT_ORDER.medium);

  let approvalMessage = null;
  if (significantProposals.length > 0) {
    approvalMessage = formatApprovalMessage(significantProposals, analysis, instanceConfig);
  }

  // Save pending state so --apply knows what to execute
  if (proposals.length > 0) {
    const pendingPath = savePendingApprovals(evolutionDir, {
      generatedAt:   new Date().toISOString(),
      proposals,
      approvalRequired: significantProposals.map(p => p.id),
      applied:       false,
    });
    log(`Pending proposals saved: ${pendingPath}`);
  }

  // Human-readable summary
  console.log('\n=== CEO Evolution Analysis Complete ===\n');
  console.log(`Instance:          ${instanceConfig.name} (${customerId})`);
  console.log(`Messages analyzed: ${history.length}`);
  console.log(`Confidence:        ${analysis.confidenceLevel}`);
  console.log(`Proposals:         ${proposals.length} total (${significantProposals.length} require approval)`);
  console.log('');
  console.log(`Evidence summary:`);
  console.log(`  ${analysis.evidenceSummary}`);
  console.log('');

  if (proposals.length === 0) {
    console.log('No personality adjustments warranted at this time. CEO is well-calibrated.\n');
  } else {
    console.log('Proposed personality changes:');
    for (const p of proposals) {
      const flag = IMPACT_ORDER[p.impact] >= IMPACT_ORDER.medium ? '[APPROVAL REQUIRED]' : '[auto-approvable]';
      if (p.dimension === 'behavior_note') {
        console.log(`  ${flag} behavior_note: "${p.to}"`);
      } else {
        console.log(`  ${flag} ${p.dimension}: ${p.from} → ${p.to}`);
      }
    }
    console.log('');
  }

  if (approvalMessage) {
    console.log('=== Founder Approval Message ===');
    console.log('Send this to the founder before applying significant changes:');
    console.log('');
    console.log(approvalMessage);
    console.log('');
    console.log('After founder approves, run:');
    console.log(`  node scripts/your9-ceo-evolve.mjs --instance ${customerId} --apply`);
    console.log('');
  } else if (trivialProposals.length > 0) {
    console.log('All proposals are low-impact. Apply immediately with:');
    console.log(`  node scripts/your9-ceo-evolve.mjs --instance ${customerId} --apply --auto-approve`);
    console.log('');
  }

  if (reflectionPath) {
    console.log(`Self-reflection report: ${reflectionPath}`);
    console.log('');
  }

  console.log(`Evolution log: ${logPath}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.instance) {
    console.error('Usage: node scripts/your9-ceo-evolve.mjs --instance <customer-id> [--analyze | --apply]');
    console.error('');
    console.error('Flags:');
    console.error('  --instance      Customer ID (required)');
    console.error('  --analyze       Analyze conversation history and generate proposals (default)');
    console.error('  --apply         Apply founder-approved proposals from last --analyze run');
    console.error('  --auto-approve  Auto-apply low-impact proposals without founder confirmation');
    console.error('  --weekly        Generate full weekly self-reflection report');
    console.error('  --min-messages  Min conversation entries required (default: 10)');
    console.error('  --max-messages  Max conversation entries to analyze (default: 200)');
    process.exit(1);
  }

  // Default to analyze if neither flag given
  const mode = args.apply ? 'apply' : 'analyze';

  const autoApprove  = args['auto-approve'] === true || args['auto-approve'] === 'true';
  const weekly       = args.weekly === true || args.weekly === 'true';
  const minMessages  = parseInt(args['min-messages'] || '10', 10);
  const maxMessages  = parseInt(args['max-messages'] || '200', 10);

  if (isNaN(minMessages) || minMessages < 1) {
    console.error('--min-messages must be a positive integer');
    process.exit(1);
  }
  if (isNaN(maxMessages) || maxMessages < minMessages) {
    console.error('--max-messages must be >= min-messages');
    process.exit(1);
  }

  try {
    await runEvolve({
      customerId:  args.instance,
      mode,
      autoApprove,
      weekly,
      minMessages,
      maxMessages,
    });
  } catch (e) {
    log(`FATAL: ${e.message}`);
    console.error(`\nCEO evolution run failed: ${e.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`CEO-EVOLVE FATAL: ${err.message}`);
  process.exit(1);
});
