#!/usr/bin/env node
/**
 * your9-add-agent.mjs — Dynamic Agent Role Provisioning
 * Your9 by 9 Enterprises
 *
 * Adds a new agent role to an existing Your9 customer instance on demand.
 * Works in two modes:
 *   1. CLI invocation with flags (founder or operator use)
 *   2. Parsed from an [ADD_AGENT:slug] directive in CEO delegation output
 *
 * The new agent:
 *   - Gets its own directory at instances/{id}/agents/{role-slug}/
 *   - Receives a system prompt combining Soul Code foundation + role + industry context
 *   - Gets a config.json the hub picks up on its next delegation scan
 *   - Is registered via an activity entry so the dashboard feed shows it immediately
 *   - Is usable by the CEO via [DELEGATE:{slug}] with no hub restart required
 *
 * Usage:
 *   node scripts/your9-add-agent.mjs \
 *     --instance y9-abc123 \
 *     --role "Sales Agent" \
 *     --description "Handles outbound sales, lead follow-up, pipeline management"
 *
 *   node scripts/your9-add-agent.mjs \
 *     --instance y9-abc123 \
 *     --role "Sales Agent" \
 *     --description "Handles outbound sales, lead follow-up, pipeline management" \
 *     --model claude-sonnet-4-5
 *
 * Flags:
 *   --instance      Customer ID (required)
 *   --role          Human-readable role name, e.g. "Sales Agent" (required)
 *   --description   What this agent does (required)
 *   --model         Override model (defaults to instance tier agentModel)
 *   --superpowers   Comma-separated list of strengths (optional, auto-generated if omitted)
 *   --escalate      Comma-separated escalation triggers (optional, auto-generated if omitted)
 *   --dry-run       Print what would be created without writing any files
 *
 * AI CEO delegation trigger (parsed by the hub):
 *   [ADD_AGENT:sales] Handle all outbound sales activity
 *   [ADD_AGENT:compliance] Monitor all regulatory filings and flag issues
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, readdirSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');
const TEMPLATES_DIR = join(ROOT, 'templates');

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

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ADD-AGENT: ${msg}`);
}

// ---------------------------------------------------------------------------
// .env loader — reads key=value file without polluting process.env
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
// Slug generation
//
// Converts a role name to a filesystem-safe, delegation-safe identifier.
// "Sales Agent" -> "sales-agent"
// "VP of Marketing" -> "vp-of-marketing"
// Matches the pattern expected by [DELEGATE:{slug}] in the hub.
// ---------------------------------------------------------------------------

export function roleToSlug(role) {
  return role
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')   // strip special chars
    .trim()
    .replace(/\s+/g, '-')            // spaces to hyphens
    .replace(/-+/g, '-')             // collapse consecutive hyphens
    .slice(0, 40);                   // max 40 chars for filesystem safety
}

// ---------------------------------------------------------------------------
// Tier config — mirrors your9-provision.mjs for consistency
// ---------------------------------------------------------------------------

const TIER_AGENT_MODELS = {
  starter:    'claude-sonnet-4-5',
  growth:     'claude-sonnet-4-5',
  enterprise: 'claude-sonnet-4-5',
};

const DEFAULT_AGENT_MODEL = 'claude-sonnet-4-5';

// ---------------------------------------------------------------------------
// Auto-generate superpowers and escalation triggers from description
//
// When the caller doesn't provide explicit superpowers, we derive reasonable
// defaults from the role name and description. This makes the [ADD_AGENT:slug]
// delegation trigger fully autonomous — the CEO just names the role and
// describes it, and the system fills in the rest.
// ---------------------------------------------------------------------------

const ROLE_PATTERNS = [
  {
    pattern: /sales|outbound|lead|pipeline|prospect|close|revenue/i,
    superpowers: [
      'lead qualification and scoring',
      'outbound sequence management',
      'pipeline stage tracking',
      'follow-up scheduling',
      'deal velocity analysis',
    ],
    escalation: [
      'hot lead ready to close — needs founder decision',
      'deal stalled >5 days without contact',
      'prospect asks for pricing or contract',
      'competitor mentioned in conversation',
    ],
  },
  {
    pattern: /marketing|brand|content|social|campaign|ads|seo/i,
    superpowers: [
      'campaign planning and scheduling',
      'content brief creation',
      'performance monitoring',
      'audience targeting analysis',
      'competitor content tracking',
    ],
    escalation: [
      'campaign underperforming against benchmark',
      'viral content opportunity identified',
      'negative brand mention detected',
      'budget pacing issue',
    ],
  },
  {
    pattern: /compliance|legal|regulat|risk|audit|policy/i,
    superpowers: [
      'regulatory requirement tracking',
      'deadline and filing management',
      'policy gap identification',
      'audit trail documentation',
      'risk flag detection',
    ],
    escalation: [
      'compliance deadline within 7 days',
      'regulatory change affecting operations',
      'audit request received',
      'policy violation detected',
    ],
  },
  {
    pattern: /customer|support|service|ticket|crm|retention|client/i,
    superpowers: [
      'ticket triage and prioritization',
      'response drafting and routing',
      'customer health score monitoring',
      'churn signal detection',
      'escalation path management',
    ],
    escalation: [
      'enterprise customer at risk',
      'negative review posted publicly',
      'support ticket unresolved >48h',
      'cancellation intent detected',
    ],
  },
  {
    pattern: /finance|accounting|invoic|payment|billing|budget|expense/i,
    superpowers: [
      'invoice and payment tracking',
      'expense categorization',
      'budget variance monitoring',
      'cash flow forecasting',
      'overdue account flagging',
    ],
    escalation: [
      'overdue invoice >30 days',
      'budget overage detected',
      'large unexpected expense',
      'payment failed or declined',
    ],
  },
  {
    pattern: /hr|hiring|recruit|talent|onboard|employee|people/i,
    superpowers: [
      'job posting and pipeline tracking',
      'candidate screening summaries',
      'onboarding checklist management',
      'PTO and availability tracking',
      'team capacity monitoring',
    ],
    escalation: [
      'open role unfilled >30 days',
      'resignation or termination',
      'compliance document missing',
      'team capacity below threshold',
    ],
  },
  {
    pattern: /operations|ops|process|workflow|vendor|supply|logistics/i,
    superpowers: [
      'process documentation and optimization',
      'vendor relationship tracking',
      'bottleneck identification',
      'workflow automation recommendations',
      'SLA monitoring',
    ],
    escalation: [
      'vendor delivery at risk',
      'process bottleneck causing revenue impact',
      'SLA breach imminent',
      'critical dependency failure',
    ],
  },
];

const GENERIC_SUPERPOWERS = [
  'task coordination and tracking',
  'status reporting and escalation',
  'data gathering and synthesis',
  'deadline management',
  'cross-function communication',
];

const GENERIC_ESCALATION = [
  'task blocked >24 hours',
  'deadline at risk',
  'decision required from founder',
  'unexpected blocker discovered',
];

function inferSuperpowers(role, description) {
  const text = `${role} ${description}`;
  for (const { pattern, superpowers } of ROLE_PATTERNS) {
    if (pattern.test(text)) return superpowers;
  }
  return GENERIC_SUPERPOWERS;
}

function inferEscalationTriggers(role, description) {
  const text = `${role} ${description}`;
  for (const { pattern, escalation } of ROLE_PATTERNS) {
    if (pattern.test(text)) return escalation;
  }
  return GENERIC_ESCALATION;
}

// ---------------------------------------------------------------------------
// Soul Code base loader — same as your9-provision.mjs
// ---------------------------------------------------------------------------

function loadSoulCodeBase() {
  const templatePath = join(TEMPLATES_DIR, 'soul-code-base.md');
  if (!existsSync(templatePath)) {
    // Graceful degradation: return a minimal foundation rather than failing.
    // The full Soul Code is baked into the existing CEO prompt for this instance.
    return `## Operating Foundation\n\nYou operate under the Soul Code: enterprise-grade output only, no fabrication, no silent failures, escalate blockers immediately. You report to the AI CEO. The AI CEO reports to the founder.`;
  }
  return readFileSync(templatePath, 'utf-8');
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildAgentSystemPrompt({
  agentName,
  slug,
  role,
  description,
  superpowers,
  escalationTriggers,
  customerConfig,
}) {
  const { name: businessName, industryContext, personalityConfig, tierConfig } = customerConfig;
  const industry = industryContext || { label: customerConfig.industry, regulatoryContext: '', keyMetrics: [], commonTasks: [] };
  const personality = personalityConfig || { label: customerConfig.personality };
  const tier = tierConfig || { agentModel: DEFAULT_AGENT_MODEL };
  const soulCode = loadSoulCodeBase();

  return `# ${agentName} — Agent System Prompt
# Your9 Instance: ${businessName}
# Role: ${role}
# Slug: ${slug}
# Generated: ${new Date().toISOString()}

---

## SOUL CODE FOUNDATION (non-negotiable)

${soulCode}

---

## YOUR IDENTITY

You are ${agentName}, the ${role} agent for ${businessName}.

You report to the AI CEO of ${businessName}. You do NOT communicate directly with the owner unless the CEO explicitly routes a message through you. The CEO is your interface to the owner. Respect that chain.

**Your role:** ${description}

**Your superpowers:**
${superpowers.map(s => `- ${s}`).join('\n')}

**Escalate to the CEO immediately when:**
${escalationTriggers.map(t => `- ${t}`).join('\n')}

**How to escalate:** Return a response beginning with "[ESCALATE]" followed by the situation. The CEO will route it to the founder if needed.

---

## INDUSTRY CONTEXT

**Business:** ${businessName}
**Industry:** ${industry.label || customerConfig.industry}
${industry.regulatoryContext ? `**Regulatory note:** ${industry.regulatoryContext}` : ''}

${industry.keyMetrics && industry.keyMetrics.length > 0 ? `**Key metrics to track:**\n${industry.keyMetrics.map(m => `- ${m}`).join('\n')}` : ''}

${industry.commonTasks && industry.commonTasks.length > 0 ? `**Common tasks in this business:**\n${industry.commonTasks.map(t => `- ${t}`).join('\n')}` : ''}

---

## OPERATING STANDARDS

- **Model:** ${tier.agentModel || DEFAULT_AGENT_MODEL}
- **Output format:** Structured. Lead with findings or action taken. End with recommended next step.
- **Tone:** Match the CEO personality setting (${personality.label || customerConfig.personality}). Never more casual than the CEO.
- **Never fabricate data.** If you lack information, say so and list what you need.
- **Never go silent.** If stuck, report the blocker immediately.
- **Never exceed your scope.** You are ${role}. Surface CEO-level decisions — do not make them.
- **Always conclude with a recommended next action** so the CEO can delegate or decide.

---

## HARD RULES (Soul Code)

1. Never fabricate data or claim work is done unless verified.
2. Never expose credentials — you have no credentials. Request access through the CEO.
3. Never contact the owner directly without CEO routing.
4. Never overpromise on timelines.
5. Never go more than one step without confirming direction when scope is unclear.

---

*Agent provisioned dynamically by Your9 Add-Agent Engine — 9 Enterprises*
*Role added: ${new Date().toISOString()}*
`;
}

// ---------------------------------------------------------------------------
// Activity feed registration
//
// The dashboard reads instances/{id}/data/conversations/history.jsonl for its
// activity feed. Writing a structured entry here means the new agent appears
// in the feed immediately — no hub restart, no polling delay.
// ---------------------------------------------------------------------------

function registerInActivityFeed(instanceDir, agentName, slug, role, description) {
  const convDir = join(instanceDir, 'data', 'conversations');
  const histPath = join(convDir, 'history.jsonl');

  mkdirSync(convDir, { recursive: true });

  const entry = {
    role: 'assistant',
    content: `[System] New agent role added to your team: **${agentName}** (${role}). Delegation key: \`[DELEGATE:${slug}]\`. I can now delegate ${role.toLowerCase()} tasks directly to this agent. ${description}`,
    timestamp: new Date().toISOString(),
    eventType: 'agent_added',
    agentSlug: slug,
    agentName,
    agentRole: role,
  };

  try {
    appendFileSync(histPath, JSON.stringify(entry) + '\n');
    log(`Activity feed updated: ${histPath}`);
  } catch (e) {
    log(`Activity feed write failed (non-fatal): ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main provisioning function — exported for hub integration
// ---------------------------------------------------------------------------

/**
 * addAgent — provision a new agent role for an existing Your9 instance.
 *
 * @param {object} opts
 * @param {string} opts.instanceId  - Customer ID (e.g. "y9-abc123")
 * @param {string} opts.role        - Human-readable role name (e.g. "Sales Agent")
 * @param {string} opts.description - What this agent does
 * @param {string} [opts.model]     - Override model (defaults to tier agentModel)
 * @param {string[]} [opts.superpowers]       - Override auto-generated superpowers
 * @param {string[]} [opts.escalationTriggers] - Override auto-generated escalation triggers
 * @param {boolean} [opts.dryRun]   - If true, return plan without writing files
 * @returns {object} result         - { success, slug, agentDir, agentName, message }
 */
export async function addAgent({
  instanceId,
  role,
  description,
  model,
  superpowers: superpowersOverride,
  escalationTriggers: escalationOverride,
  dryRun = false,
}) {
  // Validate instance exists
  const instanceDir = join(INSTANCES_DIR, instanceId);
  if (!existsSync(instanceDir)) {
    return {
      success: false,
      message: `Instance not found: ${instanceId}. Run provisioner first.`,
    };
  }

  // Load customer config for context injection
  const configPath = join(instanceDir, 'config', 'customer.json');
  if (!existsSync(configPath)) {
    return {
      success: false,
      message: `Customer config missing in ${instanceDir}. Re-run provisioner.`,
    };
  }
  const customerConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

  // Derive slug from role name
  const slug = roleToSlug(role);
  if (!slug) {
    return {
      success: false,
      message: `Could not derive a valid slug from role: "${role}". Use alphanumeric characters.`,
    };
  }

  // Enforce tier agent cap
  const agentsDir = join(instanceDir, 'agents');
  const existingAgents = existsSync(agentsDir) ? readdirSync(agentsDir) : [];
  const maxAgents = customerConfig.tierConfig?.maxAgents ?? 3;

  if (existingAgents.length >= maxAgents) {
    return {
      success: false,
      message: `Tier cap reached: ${customerConfig.tier} tier allows max ${maxAgents} agents. Current: ${existingAgents.length} (${existingAgents.join(', ')}). Upgrade tier to add more agents.`,
      tierCapped: true,
      currentAgents: existingAgents,
      maxAgents,
    };
  }

  // Check for slug collision
  const agentDir = join(agentsDir, slug);
  if (existsSync(agentDir)) {
    return {
      success: false,
      message: `Agent with slug "${slug}" already exists in this instance. Choose a different role name or remove the existing agent first.`,
      exists: true,
      existingPath: agentDir,
    };
  }

  // Resolve superpowers and escalation triggers
  const superpowers = superpowersOverride || inferSuperpowers(role, description);
  const escalationTriggers = escalationOverride || inferEscalationTriggers(role, description);

  // Resolve agent name — title-case the role if not already
  const agentName = role.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

  // Resolve model — explicit override > tier config > default
  const resolvedModel = model
    || customerConfig.tierConfig?.agentModel
    || TIER_AGENT_MODELS[customerConfig.tier]
    || DEFAULT_AGENT_MODEL;

  // Build the plan
  const plan = {
    instanceId,
    businessName: customerConfig.name,
    role,
    agentName,
    slug,
    agentDir,
    model: resolvedModel,
    superpowers,
    escalationTriggers,
    description,
    dryRun,
  };

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      plan,
      message: `Dry run — no files written. Would create agent "${agentName}" with slug "${slug}" at ${agentDir}`,
    };
  }

  // Create agent directory
  mkdirSync(agentDir, { recursive: true });
  log(`Created agent directory: ${agentDir}`);

  // Write system prompt
  const systemPrompt = buildAgentSystemPrompt({
    agentName,
    slug,
    role,
    description,
    superpowers,
    escalationTriggers,
    customerConfig,
  });
  const promptPath = join(agentDir, 'system-prompt.md');
  writeFileSync(promptPath, systemPrompt);
  log(`System prompt written: ${promptPath}`);

  // Write config.json — the hub reads this on every delegation scan
  const agentConfig = {
    id: slug,
    name: agentName,
    role,
    description,
    model: resolvedModel,
    maxTokens: 2048,
    systemPromptPath: `agents/${slug}/system-prompt.md`,
    superpowers,
    escalationTriggers,
    addedVia: 'your9-add-agent',
    createdAt: new Date().toISOString(),
  };
  const configFilePath = join(agentDir, 'config.json');
  writeFileSync(configFilePath, JSON.stringify(agentConfig, null, 2));
  log(`Agent config written: ${configFilePath}`);

  // Register in activity feed so dashboard shows new agent immediately
  registerInActivityFeed(instanceDir, agentName, slug, role, description);

  // Update customer config's agent count awareness (non-blocking, non-fatal)
  try {
    const updatedConfig = { ...customerConfig, lastAgentAddedAt: new Date().toISOString() };
    writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));
  } catch (e) {
    log(`Customer config update failed (non-fatal): ${e.message}`);
  }

  log(`Agent "${agentName}" (${slug}) provisioned successfully for instance ${instanceId}`);

  return {
    success: true,
    slug,
    agentName,
    role,
    agentDir,
    promptPath,
    configPath: configFilePath,
    model: resolvedModel,
    superpowers,
    escalationTriggers,
    message: `Agent "${agentName}" added. Delegation key: [DELEGATE:${slug}]. Active immediately — no hub restart required.`,
  };
}

// ---------------------------------------------------------------------------
// [ADD_AGENT:slug] directive parser
//
// The AI CEO emits [ADD_AGENT:slug] "description" in its response when it
// determines a new agent role is needed. This parser extracts those directives
// so the hub can call addAgent() before the CEO synthesizes its final reply.
//
// Format the CEO uses:
//   [ADD_AGENT:sales] Handle all outbound sales activity and lead follow-up
//   [ADD_AGENT:compliance] Monitor all regulatory filings and flag issues
//
// The slug becomes the role. The text after becomes the description.
// The hub maps slug back to a human role name by title-casing and replacing hyphens.
// ---------------------------------------------------------------------------

export function parseAddAgentDirectives(text) {
  const directives = [];
  const re = /\[ADD_AGENT:([a-z0-9-]+)\]\s*"?([^"\[\n]+)"?/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const slug = match[1].toLowerCase().trim();
    const description = match[2].trim();
    // Reconstruct a human role name from the slug
    const role = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    directives.push({ slug, role, description });
  }
  return directives;
}

// ---------------------------------------------------------------------------
// Status check — print current agents for an instance
// ---------------------------------------------------------------------------

async function printAgentStatus(instanceId) {
  const instanceDir = join(INSTANCES_DIR, instanceId);
  if (!existsSync(instanceDir)) {
    console.error(`Instance not found: ${instanceId}`);
    process.exit(1);
  }

  const agentsDir = join(instanceDir, 'agents');
  const agents = existsSync(agentsDir) ? readdirSync(agentsDir) : [];

  const configPath = join(instanceDir, 'config', 'customer.json');
  let maxAgents = '?';
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    maxAgents = config.tierConfig?.maxAgents ?? '?';
  } catch {}

  console.log(`\n=== Agent Roster: ${instanceId} ===`);
  console.log(`Agents: ${agents.length} / ${maxAgents} (tier cap)`);
  console.log('');

  for (const slug of agents) {
    const agentConfigPath = join(agentsDir, slug, 'config.json');
    if (existsSync(agentConfigPath)) {
      try {
        const ac = JSON.parse(readFileSync(agentConfigPath, 'utf-8'));
        const addedVia = ac.addedVia ? ` [${ac.addedVia}]` : '';
        console.log(`  ${slug}`);
        console.log(`    Name:    ${ac.name}`);
        console.log(`    Role:    ${ac.role}`);
        console.log(`    Model:   ${ac.model}`);
        console.log(`    Added:   ${ac.createdAt}${addedVia}`);
        console.log('');
      } catch {
        console.log(`  ${slug} — config unreadable`);
      }
    } else {
      console.log(`  ${slug} — no config.json`);
    }
  }

  if (agents.length === 0) {
    console.log('  No agents provisioned. Run with --role and --description to add one.');
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Main — CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  // --status mode
  if (args.status) {
    await printAgentStatus(args.status);
    return;
  }

  // Validate required flags
  if (!args.instance || !args.role || !args.description) {
    console.error([
      '',
      'Usage:',
      '  node scripts/your9-add-agent.mjs \\',
      '    --instance <customer-id> \\',
      '    --role "Sales Agent" \\',
      '    --description "Handles outbound sales, lead follow-up, pipeline management"',
      '',
      'Optional:',
      '  --model <model-id>        Override agent model',
      '  --superpowers "a,b,c"     Comma-separated strengths',
      '  --escalate "x,y,z"        Comma-separated escalation triggers',
      '  --dry-run                 Preview without writing files',
      '',
      'Status check:',
      '  node scripts/your9-add-agent.mjs --status <customer-id>',
      '',
    ].join('\n'));
    process.exit(1);
  }

  const instanceId = args.instance;
  const role = args.role;
  const description = args.description;
  const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';

  // Parse optional overrides
  const superpowers = args.superpowers
    ? args.superpowers.split(',').map(s => s.trim()).filter(Boolean)
    : undefined;

  const escalationTriggers = args.escalate
    ? args.escalate.split(',').map(s => s.trim()).filter(Boolean)
    : undefined;

  const model = args.model || undefined;

  if (dryRun) {
    console.log('\n[DRY RUN] No files will be written.\n');
  }

  const result = await addAgent({
    instanceId,
    role,
    description,
    model,
    superpowers,
    escalationTriggers,
    dryRun,
  });

  if (!result.success) {
    console.error(`\nFAILED: ${result.message}\n`);
    if (result.tierCapped) {
      console.error(`Current agents: ${result.currentAgents.join(', ')}`);
      console.error(`Max for this tier: ${result.maxAgents}`);
    }
    process.exit(1);
  }

  if (dryRun) {
    console.log('=== DRY RUN — PLAN ===');
    console.log(`Instance:    ${result.plan.instanceId}`);
    console.log(`Business:    ${result.plan.businessName}`);
    console.log(`Role:        ${result.plan.role}`);
    console.log(`Agent name:  ${result.plan.agentName}`);
    console.log(`Slug:        ${result.plan.slug}`);
    console.log(`Model:       ${result.plan.model}`);
    console.log(`Agent dir:   ${result.plan.agentDir}`);
    console.log('');
    console.log('Superpowers:');
    result.plan.superpowers.forEach(s => console.log(`  - ${s}`));
    console.log('');
    console.log('Escalation triggers:');
    result.plan.escalationTriggers.forEach(t => console.log(`  - ${t}`));
    console.log('');
    console.log('Files that WOULD be created:');
    console.log(`  ${result.plan.agentDir}/system-prompt.md`);
    console.log(`  ${result.plan.agentDir}/config.json`);
    console.log('');
    console.log(`Delegation key: [DELEGATE:${result.plan.slug}]`);
    console.log('');
    return;
  }

  // Success output
  console.log('');
  console.log('=== AGENT ADDED ===');
  console.log('');
  console.log(`  Instance:    ${instanceId}`);
  console.log(`  Agent:       ${result.agentName}`);
  console.log(`  Role:        ${result.role}`);
  console.log(`  Slug:        ${result.slug}`);
  console.log(`  Model:       ${result.model}`);
  console.log('');
  console.log('  Files created:');
  console.log(`    ${result.promptPath}`);
  console.log(`    ${result.configPath}`);
  console.log('');
  console.log('  Delegation key (for AI CEO use):');
  console.log(`    [DELEGATE:${result.slug}]`);
  console.log('');
  console.log('  The agent is active immediately.');
  console.log('  No hub restart required.');
  console.log('  The dashboard activity feed has been updated.');
  console.log('');
  console.log('  Superpowers:');
  result.superpowers.forEach(s => console.log(`    - ${s}`));
  console.log('');
  console.log('  Escalation triggers:');
  result.escalationTriggers.forEach(t => console.log(`    - ${t}`));
  console.log('');
  console.log('  Next steps:');
  console.log(`    1. The AI CEO can now delegate with: [DELEGATE:${result.slug}] <task>`);
  console.log(`    2. Check the dashboard activity feed — agent appears immediately`);
  console.log(`    3. Run status check: node scripts/your9-add-agent.mjs --status ${instanceId}`);
  console.log('');
}

main().catch(err => {
  console.error(`ADD-AGENT FATAL: ${err.message}`);
  process.exit(1);
});
