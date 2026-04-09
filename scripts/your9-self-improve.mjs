#!/usr/bin/env node
/**
 * your9-self-improve.mjs — Agent Self-Improvement Loop Engine
 * Your9 by 9 Enterprises
 *
 * The system where Your9 agents evolve themselves over time.
 *
 * Flow:
 *   1. Performance Analysis  — Sonnet reviews completed task history for the
 *      target agent. Identifies patterns: what worked, what was slow, what the
 *      founder revised or rejected.
 *   2. Improvement Proposals — Sonnet produces specific, scoped change proposals
 *      (system prompt edits, process rule additions, escalation trigger tweaks).
 *   3. CEO Review            — Opus acts as the AI CEO and approves/rejects/edits
 *      each proposal. Only approved proposals move forward.
 *   4. Self-Upgrade          — Approved proposals are applied to the agent's
 *      system-prompt.md and config.json automatically.
 *   5. Improvement Log       — Every run (proposed, approved, rejected, applied)
 *      is written to instances/{id}/data/improvements/{timestamp}-{agent}.json
 *
 * Usage:
 *   node scripts/your9-self-improve.mjs \
 *     --instance <customer-id> \
 *     --agent <executor|mind|voice>
 *
 * Flags:
 *   --instance    Customer ID (required). Must exist in instances/ directory.
 *   --agent       Agent to analyze: executor | mind | voice (required)
 *   --dry-run     Run analysis + CEO review, log results, but do NOT apply changes.
 *   --min-tasks   Minimum completed tasks required to run analysis (default: 3)
 *   --max-tasks   Max completed tasks to feed into analysis context (default: 50)
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
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const ANALYSIS_MODEL  = 'claude-sonnet-4-5';  // Performance analysis + proposals
const CEO_REVIEW_MODEL = 'claude-opus-4-20250514'; // CEO approval gate

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

let improvementLogPath = null;

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] SELF-IMPROVE: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  if (improvementLogPath) {
    try { appendFileSync(improvementLogPath, line + '\n'); } catch {}
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
// Raw HTTPS helpers — no SDK dependency, matches hub pattern
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

async function callClaude(anthropicKey, model, systemPrompt, userMessage, maxTokens = 3000) {
  const result = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    {
      model,
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
    throw new Error(`Anthropic returned no content: ${JSON.stringify(result).slice(0, 300)}`);
  }

  return text;
}

// ---------------------------------------------------------------------------
// Instance loader
// ---------------------------------------------------------------------------

function loadInstance(customerId) {
  const instanceDir = join(INSTANCES_DIR, customerId);

  if (!existsSync(instanceDir)) {
    throw new Error(`Instance not found: ${customerId} (looked in ${INSTANCES_DIR})`);
  }

  const configPath = join(instanceDir, 'config', 'customer.json');
  if (!existsSync(configPath)) {
    throw new Error(`Customer config missing: ${configPath}`);
  }
  const instanceConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

  const envPath = join(instanceDir, 'config', '.env');
  const env = loadEnvFile(envPath);

  const anthropicKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey || anthropicKey.startsWith('PLACEHOLDER')) {
    throw new Error(`ANTHROPIC_API_KEY not set or is placeholder in ${envPath}`);
  }

  // Ensure improvement log dir exists
  const improvementsDir = join(instanceDir, 'data', 'improvements');
  if (!existsSync(improvementsDir)) mkdirSync(improvementsDir, { recursive: true });

  const logsDir = join(instanceDir, 'logs');
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

  return {
    customerId,
    instanceDir,
    instanceConfig,
    anthropicKey,
    logsDir,
    improvementsDir,
  };
}

// ---------------------------------------------------------------------------
// Agent loader — reads config.json + system-prompt.md for target agent
// ---------------------------------------------------------------------------

function loadAgentFiles(instanceDir, agentId) {
  const agentDir = join(instanceDir, 'agents', agentId);
  if (!existsSync(agentDir)) {
    throw new Error(`Agent directory not found: ${agentDir}`);
  }

  const configPath = join(agentDir, 'config.json');
  const promptPath = join(agentDir, 'system-prompt.md');

  if (!existsSync(configPath)) {
    throw new Error(`Agent config.json missing: ${configPath}`);
  }
  if (!existsSync(promptPath)) {
    throw new Error(`Agent system-prompt.md missing: ${promptPath}`);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const systemPrompt = readFileSync(promptPath, 'utf-8');

  return { agentDir, configPath, promptPath, config, systemPrompt };
}

// ---------------------------------------------------------------------------
// Task reader — reads completed tasks for the target agent
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'report-delivered']);

function readCompletedTasksForAgent(taskDir, agentId, maxTasks = 50) {
  if (!existsSync(taskDir)) return [];

  let files;
  try {
    files = readdirSync(taskDir).filter(f => f.endsWith('-task.json')).sort();
  } catch {
    return [];
  }

  const tasks = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(taskDir, f), 'utf-8'));
      const status = (raw.status || '').toLowerCase();
      // Only include tasks assigned to this agent with a terminal status
      if (!TERMINAL_STATUSES.has(status)) continue;
      const taskAgent = (raw.agentId || raw.agent || '').toLowerCase();
      if (taskAgent && taskAgent !== agentId.toLowerCase()) continue;
      tasks.push(raw);
    } catch {
      // Skip malformed files
    }
  }

  // Most recent first, capped at maxTasks
  return tasks.reverse().slice(0, maxTasks);
}

// ---------------------------------------------------------------------------
// STEP 1 — Performance Analysis
// Format completed tasks into a readable context block for Sonnet
// ---------------------------------------------------------------------------

function buildTaskContext(tasks) {
  if (tasks.length === 0) return 'No completed tasks found.';

  return tasks.map((t, i) => {
    const lines = [
      `--- Task ${i + 1} ---`,
      `Status:      ${t.status || 'unknown'}`,
      `Task:        ${(t.task || t.description || 'unknown').slice(0, 300)}`,
    ];
    if (t.result)       lines.push(`Result:      ${String(t.result).slice(0, 300)}`);
    if (t.summary)      lines.push(`Summary:     ${String(t.summary).slice(0, 300)}`);
    if (t.durationMs)   lines.push(`Duration:    ${Math.round(t.durationMs / 1000)}s`);
    if (t.founderNote)  lines.push(`Founder note: ${String(t.founderNote).slice(0, 300)}`);
    if (t.revised)      lines.push(`Revised:     YES — ${String(t.revisedReason || 'no reason given').slice(0, 200)}`);
    if (t.rejected)     lines.push(`Rejected:    YES — ${String(t.rejectedReason || 'no reason given').slice(0, 200)}`);
    if (t.slowFlag)     lines.push(`Slow flag:   YES`);
    if (t.completedAt)  lines.push(`Completed:   ${t.completedAt}`);
    return lines.join('\n');
  }).join('\n\n');
}

const ANALYSIS_SYSTEM_PROMPT = `You are a performance analyst for an AI agent system called Your9. Your job is to review an AI agent's completed task history and produce specific, actionable improvement proposals.

You output ONLY a valid JSON object. No preamble, no commentary outside the JSON.

JSON schema:
{
  "summary": "2-3 sentence plain English summary of what you observed",
  "patterns": {
    "strengths": ["..."],
    "weaknesses": ["..."],
    "revisions": ["any patterns in tasks the founder revised or rejected"],
    "speed": "assessment of task speed patterns"
  },
  "proposals": [
    {
      "id": "prop-1",
      "type": "system_prompt_edit | process_rule | escalation_trigger | config_change",
      "title": "Short title of the change",
      "rationale": "Why this change is warranted based on observed patterns",
      "change": "Exact text to add to system prompt OR exact config key/value change",
      "risk": "low | medium | high",
      "expectedImpact": "What improvement this produces"
    }
  ]
}

Rules:
- Only propose changes backed by concrete evidence from the task history.
- Do not propose changes if there is no clear performance pattern.
- Proposals must be specific and scoped — not vague ("be better").
- Max 5 proposals per run. Prioritize by impact.
- Risk = high only if the change could fundamentally alter the agent's behavior.
- system_prompt_edit: the "change" field must be the exact text block to append or the exact replacement diff.
- config_change: the "change" field must be a JSON object with key and new value.
- Never propose to remove core Soul Code rules or hard constraints.`;

async function analyzePerformance(anthropicKey, agentConfig, tasks, instanceConfig) {
  const taskContext = buildTaskContext(tasks);
  const agentName = agentConfig.config.name || agentConfig.config.id;
  const agentRole = agentConfig.config.role || 'Agent';
  const businessName = instanceConfig.name;
  const industry = instanceConfig.industryContext?.label || instanceConfig.industry;

  const userMessage = `Analyze performance for: ${agentName} (${agentRole}) at ${businessName} (${industry})

Current system prompt (for context on what the agent is supposed to do):
${agentConfig.systemPrompt.slice(0, 2000)}

Completed task history (${tasks.length} tasks):
${taskContext}

Identify patterns. Produce improvement proposals if warranted.`;

  log(`Running performance analysis via ${ANALYSIS_MODEL}...`);
  const raw = await callClaude(anthropicKey, ANALYSIS_MODEL, ANALYSIS_SYSTEM_PROMPT, userMessage, 3000);

  // Parse JSON response — strip markdown fences if present
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    throw new Error(`Analysis returned invalid JSON: ${e.message}\n---\n${raw.slice(0, 500)}`);
  }
}

// ---------------------------------------------------------------------------
// STEP 2 — CEO Review
// Opus acts as the AI CEO and evaluates each proposal
// ---------------------------------------------------------------------------

const CEO_REVIEW_SYSTEM_PROMPT = `You are the AI CEO of a Your9 business instance. Your performance analyst has reviewed one of your agents and produced improvement proposals.

Your job is to evaluate each proposal and decide: APPROVE, REJECT, or MODIFY.

You output ONLY a valid JSON object. No preamble, no commentary outside the JSON.

JSON schema:
{
  "overallAssessment": "1-2 sentences on the quality of the analysis",
  "decisions": [
    {
      "proposalId": "prop-1",
      "decision": "approve | reject | modify",
      "reasoning": "Why you made this decision",
      "modifiedChange": "If decision is modify: the corrected change text. Otherwise null."
    }
  ],
  "ceoNote": "Optional note to log with this improvement cycle"
}

Approval criteria:
- Evidence-backed: the rationale cites specific task patterns, not assumptions
- Scoped: the change is narrow and won't cause unintended regressions
- Safe: does not remove Soul Code hard rules, does not grant new permissions
- Proportional: the change matches the severity of the observed problem

Reject if:
- The evidence is weak or pattern is only 1-2 data points
- The change is too broad or vague
- The change conflicts with the agent's core purpose or Soul Code
- The change grants capabilities or permissions the agent shouldn't have

Modify if:
- The direction is right but the specific wording needs tightening`;

async function ceoReview(anthropicKey, analysisResult, agentConfig, instanceConfig) {
  const agentName = agentConfig.config.name || agentConfig.config.id;
  const businessName = instanceConfig.name;

  const userMessage = `Review these improvement proposals for ${agentName} at ${businessName}.

Performance analysis summary:
${analysisResult.summary}

Patterns observed:
- Strengths: ${(analysisResult.patterns?.strengths || []).join('; ') || 'none noted'}
- Weaknesses: ${(analysisResult.patterns?.weaknesses || []).join('; ') || 'none noted'}
- Revisions: ${(analysisResult.patterns?.revisions || []).join('; ') || 'none noted'}
- Speed: ${analysisResult.patterns?.speed || 'not assessed'}

Proposals (${(analysisResult.proposals || []).length}):
${JSON.stringify(analysisResult.proposals || [], null, 2)}

Review each proposal and issue your decisions.`;

  log(`Running CEO review via ${CEO_REVIEW_MODEL}...`);
  const raw = await callClaude(anthropicKey, CEO_REVIEW_MODEL, CEO_REVIEW_SYSTEM_PROMPT, userMessage, 3000);

  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    throw new Error(`CEO review returned invalid JSON: ${e.message}\n---\n${raw.slice(0, 500)}`);
  }
}

// ---------------------------------------------------------------------------
// STEP 3 — Self-Upgrade
// Apply approved proposals to the agent's files
// ---------------------------------------------------------------------------

function applyProposals(agentFiles, proposals, ceoDecisions) {
  const decisionMap = {};
  for (const d of (ceoDecisions.decisions || [])) {
    decisionMap[d.proposalId] = d;
  }

  const applied = [];
  const rejected = [];

  for (const proposal of proposals) {
    const decision = decisionMap[proposal.id];
    if (!decision) {
      log(`  Proposal ${proposal.id}: no CEO decision found — skipping`);
      continue;
    }

    if (decision.decision === 'reject') {
      rejected.push({ proposal, decision });
      log(`  Proposal ${proposal.id}: REJECTED — ${decision.reasoning}`);
      continue;
    }

    // Use modified change if CEO modified it
    const changeText = decision.decision === 'modify'
      ? (decision.modifiedChange || proposal.change)
      : proposal.change;

    try {
      if (proposal.type === 'system_prompt_edit') {
        // Append the approved change to the system prompt with a clear header
        const separator = `\n\n---\n## Self-Improvement Update — ${new Date().toISOString()}\n\n`;
        const updatedPrompt = agentFiles.systemPrompt + separator + changeText;
        writeFileSync(agentFiles.promptPath, updatedPrompt, 'utf-8');
        // Refresh in-memory view for subsequent proposals in this run
        agentFiles.systemPrompt = updatedPrompt;
        applied.push({ proposal, decision, changeText });
        log(`  Proposal ${proposal.id}: APPLIED (system_prompt_edit)`);

      } else if (proposal.type === 'process_rule') {
        // Treat as system prompt append — process rules live in the prompt
        const separator = `\n\n---\n## Process Rule Added — ${new Date().toISOString()}\n\n`;
        const updatedPrompt = agentFiles.systemPrompt + separator + changeText;
        writeFileSync(agentFiles.promptPath, updatedPrompt, 'utf-8');
        agentFiles.systemPrompt = updatedPrompt;
        applied.push({ proposal, decision, changeText });
        log(`  Proposal ${proposal.id}: APPLIED (process_rule → appended to prompt)`);

      } else if (proposal.type === 'escalation_trigger') {
        // Add to config.json escalationTriggers array
        let parsedChange;
        try {
          parsedChange = typeof changeText === 'string' ? JSON.parse(changeText) : changeText;
        } catch {
          parsedChange = changeText; // treat as plain string trigger
        }
        const trigger = typeof parsedChange === 'string' ? parsedChange : String(changeText);
        if (!agentFiles.config.escalationTriggers) agentFiles.config.escalationTriggers = [];
        if (!agentFiles.config.escalationTriggers.includes(trigger)) {
          agentFiles.config.escalationTriggers.push(trigger);
          agentFiles.config.lastSelfImproveAt = new Date().toISOString();
          writeFileSync(agentFiles.configPath, JSON.stringify(agentFiles.config, null, 2), 'utf-8');
        }
        applied.push({ proposal, decision, changeText });
        log(`  Proposal ${proposal.id}: APPLIED (escalation_trigger added)`);

      } else if (proposal.type === 'config_change') {
        // Apply a key/value change to config.json
        let parsedChange;
        try {
          parsedChange = typeof changeText === 'string' ? JSON.parse(changeText) : changeText;
        } catch {
          log(`  Proposal ${proposal.id}: config_change JSON parse failed — skipping`);
          rejected.push({ proposal, decision: { ...decision, reasoning: 'Config change JSON invalid' } });
          continue;
        }
        if (typeof parsedChange === 'object' && parsedChange !== null) {
          Object.assign(agentFiles.config, parsedChange);
          agentFiles.config.lastSelfImproveAt = new Date().toISOString();
          writeFileSync(agentFiles.configPath, JSON.stringify(agentFiles.config, null, 2), 'utf-8');
          applied.push({ proposal, decision, changeText });
          log(`  Proposal ${proposal.id}: APPLIED (config_change: ${Object.keys(parsedChange).join(', ')})`);
        } else {
          log(`  Proposal ${proposal.id}: config_change is not an object — skipping`);
          rejected.push({ proposal, decision: { ...decision, reasoning: 'config_change value is not an object' } });
        }

      } else {
        log(`  Proposal ${proposal.id}: unknown type "${proposal.type}" — skipping`);
        rejected.push({ proposal, decision: { ...decision, reasoning: `Unknown type: ${proposal.type}` } });
      }
    } catch (e) {
      log(`  Proposal ${proposal.id}: APPLY FAILED — ${e.message}`);
      rejected.push({ proposal, decision, error: e.message });
    }
  }

  return { applied, rejected };
}

// ---------------------------------------------------------------------------
// STEP 4 — Write improvement log
// ---------------------------------------------------------------------------

function writeImprovementLog(improvementsDir, agentId, runData) {
  const ts = Date.now();
  const filename = `${ts}-${agentId}.json`;
  const logPath = join(improvementsDir, filename);
  writeFileSync(logPath, JSON.stringify(runData, null, 2), 'utf-8');
  log(`Improvement log written: ${logPath}`);
  return logPath;
}

// ---------------------------------------------------------------------------
// Main run
// ---------------------------------------------------------------------------

async function runSelfImprove(opts) {
  const {
    customerId,
    agentId,
    dryRun,
    minTasks,
    maxTasks,
  } = opts;

  log(`=== Self-Improvement Run ===`);
  log(`Instance: ${customerId} | Agent: ${agentId} | Dry run: ${dryRun}`);

  // Load instance
  const instance = loadInstance(customerId);
  const { instanceDir, instanceConfig, anthropicKey, improvementsDir, logsDir } = instance;

  // Set up log file
  improvementLogPath = join(logsDir, 'self-improve.log');

  // Load agent files
  const agentFiles = loadAgentFiles(instanceDir, agentId);
  log(`Agent loaded: ${agentFiles.config.name || agentId} (${agentFiles.config.role || 'unknown role'})`);

  // Read completed tasks for this agent
  const taskDir = join(instanceDir, 'data', 'tasks');
  const completedTasks = readCompletedTasksForAgent(taskDir, agentId, maxTasks);
  log(`Completed tasks found: ${completedTasks.length}`);

  if (completedTasks.length < minTasks) {
    log(`Not enough completed tasks (found ${completedTasks.length}, need ${minTasks}). Exiting.`);
    console.log(`\nNothing to improve yet. This agent needs at least ${minTasks} completed tasks.\nFound: ${completedTasks.length}`);
    return;
  }

  // Step 1 — Performance analysis
  let analysisResult;
  try {
    analysisResult = await analyzePerformance(anthropicKey, agentFiles, completedTasks, instanceConfig);
  } catch (e) {
    log(`Analysis failed: ${e.message}`);
    throw e;
  }

  const proposalCount = (analysisResult.proposals || []).length;
  log(`Analysis complete. ${proposalCount} proposals generated.`);
  log(`Summary: ${analysisResult.summary}`);

  if (proposalCount === 0) {
    log(`No proposals generated — agent performing well or insufficient pattern data.`);
    const logData = {
      runAt: new Date().toISOString(),
      customerId,
      agentId,
      agentName: agentFiles.config.name,
      tasksAnalyzed: completedTasks.length,
      dryRun,
      analysis: analysisResult,
      ceoReview: null,
      applied: [],
      rejected: [],
      outcome: 'no_proposals',
    };
    writeImprovementLog(improvementsDir, agentId, logData);
    console.log(`\nNo improvements needed. Agent is performing well based on ${completedTasks.length} tasks.`);
    return;
  }

  // Step 2 — CEO review
  let ceoDecisions;
  try {
    ceoDecisions = await ceoReview(anthropicKey, analysisResult, agentFiles, instanceConfig);
  } catch (e) {
    log(`CEO review failed: ${e.message}`);
    throw e;
  }

  const approvedCount = (ceoDecisions.decisions || []).filter(
    d => d.decision === 'approve' || d.decision === 'modify'
  ).length;
  const rejectedCount = (ceoDecisions.decisions || []).filter(
    d => d.decision === 'reject'
  ).length;

  log(`CEO review complete. Approved: ${approvedCount} | Rejected: ${rejectedCount}`);
  if (ceoDecisions.ceoNote) log(`CEO note: ${ceoDecisions.ceoNote}`);

  // Step 3 — Apply (unless dry run)
  let applied = [];
  let rejected = [];

  if (dryRun) {
    log(`DRY RUN — skipping file writes. Proposals would have been applied:`);
    for (const d of (ceoDecisions.decisions || [])) {
      log(`  ${d.proposalId}: ${d.decision.toUpperCase()} — ${d.reasoning}`);
    }
  } else {
    log(`Applying approved proposals...`);
    const result = applyProposals(agentFiles, analysisResult.proposals || [], ceoDecisions);
    applied = result.applied;
    rejected = result.rejected;
    log(`Applied: ${applied.length} | Rejected: ${rejected.length}`);
  }

  // Step 4 — Write improvement log
  const logData = {
    runAt: new Date().toISOString(),
    customerId,
    agentId,
    agentName: agentFiles.config.name,
    tasksAnalyzed: completedTasks.length,
    dryRun,
    analysis: analysisResult,
    ceoReview: ceoDecisions,
    applied: applied.map(a => ({
      proposalId: a.proposal.id,
      type: a.proposal.type,
      title: a.proposal.title,
      decision: a.decision.decision,
      reasoning: a.decision.reasoning,
    })),
    rejected: rejected.map(r => ({
      proposalId: r.proposal.id,
      type: r.proposal.type,
      title: r.proposal.title,
      decision: r.decision?.decision || 'error',
      reasoning: r.decision?.reasoning || r.error || 'unknown',
    })),
    outcome: dryRun ? 'dry_run' : applied.length > 0 ? 'improvements_applied' : 'all_rejected',
  };

  const logPath = writeImprovementLog(improvementsDir, agentId, logData);

  // Human-readable summary
  console.log('\n=== Self-Improvement Run Complete ===\n');
  console.log(`Agent:          ${agentFiles.config.name || agentId}`);
  console.log(`Instance:       ${instanceConfig.name} (${customerId})`);
  console.log(`Tasks analyzed: ${completedTasks.length}`);
  console.log(`Proposals:      ${proposalCount}`);
  console.log(`Approved:       ${approvedCount}`);
  console.log(`Rejected:       ${rejectedCount}`);
  console.log(`Applied:        ${dryRun ? 'N/A (dry run)' : applied.length}`);
  console.log(`Outcome:        ${logData.outcome}`);
  console.log('');
  console.log(`Analysis summary:`);
  console.log(`  ${analysisResult.summary}`);
  console.log('');
  if (ceoDecisions.ceoNote) {
    console.log(`CEO note: ${ceoDecisions.ceoNote}`);
    console.log('');
  }
  if (!dryRun && applied.length > 0) {
    console.log(`Applied improvements:`);
    for (const a of applied) {
      console.log(`  [${a.type}] ${a.proposalId}: ${a.title}`);
    }
    console.log('');
  }
  console.log(`Improvement log: ${logPath}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  const VALID_AGENTS = ['executor', 'mind', 'voice'];

  if (!args.instance || !args.agent) {
    console.error('Usage: node scripts/your9-self-improve.mjs --instance <customer-id> --agent <executor|mind|voice>');
    console.error('');
    console.error('Flags:');
    console.error('  --instance    Customer ID (required)');
    console.error('  --agent       executor | mind | voice (required)');
    console.error('  --dry-run     Analyze and review but do NOT apply changes');
    console.error('  --min-tasks   Minimum completed tasks needed to run (default: 3)');
    console.error('  --max-tasks   Max tasks to include in analysis context (default: 50)');
    process.exit(1);
  }

  const agentId = args.agent.toLowerCase();
  if (!VALID_AGENTS.includes(agentId)) {
    console.error(`Unknown agent "${agentId}". Valid options: ${VALID_AGENTS.join(', ')}`);
    process.exit(1);
  }

  const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';
  const minTasks = parseInt(args['min-tasks'] || '3', 10);
  const maxTasks = parseInt(args['max-tasks'] || '50', 10);

  if (isNaN(minTasks) || minTasks < 1) {
    console.error('--min-tasks must be a positive integer');
    process.exit(1);
  }
  if (isNaN(maxTasks) || maxTasks < minTasks) {
    console.error('--max-tasks must be >= min-tasks');
    process.exit(1);
  }

  try {
    await runSelfImprove({
      customerId: args.instance,
      agentId,
      dryRun,
      minTasks,
      maxTasks,
    });
  } catch (e) {
    log(`FATAL: ${e.message}`);
    console.error(`\nSelf-improvement run failed: ${e.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`SELF-IMPROVE FATAL: ${err.message}`);
  process.exit(1);
});
