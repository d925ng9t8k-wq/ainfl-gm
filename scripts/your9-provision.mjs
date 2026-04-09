#!/usr/bin/env node
/**
 * your9-provision.mjs — Customer Isolation & Instance Provisioning Engine
 * Your9 by 9 Enterprises
 *
 * Provisions a complete, isolated Your9 customer instance in one command.
 * Idempotent: safe to run again — detects existing instances and skips
 * already-created resources.
 *
 * Usage:
 *   node scripts/your9-provision.mjs \
 *     --name "Apex Mortgage" \
 *     --industry "mortgage" \
 *     --personality "direct" \
 *     --tier "starter"
 *
 * Flags:
 *   --name        Business name (required)
 *   --industry    Industry vertical (required)
 *   --personality CEO personality mode: direct | warm | analytical | aggressive
 *   --tier        starter | growth | enterprise
 *   --id          Force a specific customer ID (for idempotent re-runs)
 *   --status      Print status of an existing instance by ID and exit
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');
const TEMPLATES_DIR = join(ROOT, 'templates');
const PROVISION_LOG = join(ROOT, 'logs', 'your9-provision.log');

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
  const line = `[${ts}] PROVISION: ${msg}`;
  console.log(line);
  try {
    if (!existsSync(join(ROOT, 'logs'))) mkdirSync(join(ROOT, 'logs'), { recursive: true });
    appendFileSync(PROVISION_LOG, line + '\n');
  } catch { /* non-fatal */ }
}

function logSection(title) {
  const bar = '='.repeat(60);
  const line = `\n${bar}\n  ${title}\n${bar}`;
  console.log(line);
  try { appendFileSync(PROVISION_LOG, line + '\n'); } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Token generators
// ---------------------------------------------------------------------------

function generateToken(prefix = 'y9', bytes = 24) {
  return `${prefix}_${randomBytes(bytes).toString('hex')}`;
}

function generateSupabaseRef() {
  // Format: [a-z]{20} — matches real Supabase project ref pattern
  return randomBytes(10).toString('hex').toLowerCase();
}

// ---------------------------------------------------------------------------
// Directory structure
// ---------------------------------------------------------------------------

const INSTANCE_SUBDIRS = ['config', 'data', 'logs', 'agents', 'comms', 'prompts'];

function ensureInstanceDirs(instanceDir) {
  if (!existsSync(instanceDir)) mkdirSync(instanceDir, { recursive: true });
  for (const sub of INSTANCE_SUBDIRS) {
    const p = join(instanceDir, sub);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Personality definitions
// ---------------------------------------------------------------------------

const PERSONALITY_CONFIGS = {
  direct: {
    label: 'Direct',
    voiceStyle: 'Terse. Action-first. No filler. Talks like someone on a job site.',
    openingPhrases: ['Got it.', 'On it.', 'Done.', 'Building now.'],
    avoidPhrases: ["Certainly!", "Of course!", "I'd be happy to", "Great question"],
    maxSentencesVoice: 2,
    formality: 'low',
    emojiUse: 'none'
  },
  warm: {
    label: 'Warm',
    voiceStyle: 'Conversational, genuine, uses contractions. Warm but never sycophantic.',
    openingPhrases: ['Absolutely.', 'On it.', 'Good thinking.'],
    avoidPhrases: ["Certainly!", "Of course!", "As an AI"],
    maxSentencesVoice: 3,
    formality: 'medium',
    emojiUse: 'minimal'
  },
  analytical: {
    label: 'Analytical',
    voiceStyle: 'Data-first. Leads with numbers. Structured responses. Clinical but not cold.',
    openingPhrases: ['Confirmed.', 'Noted.', 'Processing.'],
    avoidPhrases: ["Certainly!", "I feel", "I think"],
    maxSentencesVoice: 2,
    formality: 'high',
    emojiUse: 'none'
  },
  aggressive: {
    label: 'Aggressive',
    voiceStyle: 'High-energy. Conviction-driven. Moves fast. Scared money don\'t make money.',
    openingPhrases: ['Let\'s go.', 'On it.', 'Already moving.'],
    avoidPhrases: ["Certainly!", "Let me think", "I'm not sure"],
    maxSentencesVoice: 2,
    formality: 'low',
    emojiUse: 'minimal'
  }
};

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

const TIER_CONFIGS = {
  starter: {
    label: 'Starter',
    maxAgents: 3,
    ceoModel: 'claude-sonnet-4-5',
    agentModel: 'claude-sonnet-4-5',
    channels: ['telegram'],
    monthlyCallLimit: 100,
    storageGB: 5
  },
  growth: {
    label: 'Growth',
    maxAgents: 6,
    ceoModel: 'claude-sonnet-4-5',
    agentModel: 'claude-sonnet-4-5',
    channels: ['telegram', 'email', 'voice'],
    monthlyCallLimit: 500,
    storageGB: 25
  },
  enterprise: {
    label: 'Enterprise',
    maxAgents: 12,
    ceoModel: 'claude-opus-4-20250514',
    agentModel: 'claude-sonnet-4-5',
    channels: ['telegram', 'email', 'voice', 'sms'],
    monthlyCallLimit: -1,
    storageGB: 100
  }
};

// ---------------------------------------------------------------------------
// Industry-specific context injection
// ---------------------------------------------------------------------------

const INDUSTRY_CONTEXT = {
  mortgage: {
    label: 'Mortgage & Lending',
    regulatoryContext: 'RESPA, TRID, HMDA, Fair Lending, NMLS compliance applies to all communications.',
    keyMetrics: ['pull-through rate', 'cycle time', 'lock expiration pipeline', 'LO productivity'],
    commonTasks: ['pipeline review', 'lock desk coordination', 'processor follow-up', 'rate alert monitoring'],
    tone: 'Professional. Referral relationships matter. Never give rate quotes without owner sign-off.'
  },
  realestate: {
    label: 'Real Estate',
    regulatoryContext: 'NAR ethics, state-specific disclosure requirements apply.',
    keyMetrics: ['days on market', 'list-to-sale ratio', 'GCI pipeline', 'active listings'],
    commonTasks: ['listing follow-up', 'buyer tour coordination', 'offer tracking', 'contract deadlines'],
    tone: 'Relationship-first. Every referral is worth more than the deal in front of you.'
  },
  insurance: {
    label: 'Insurance',
    regulatoryContext: 'State DOI regulations, carrier compliance, E&O coverage requirements apply.',
    keyMetrics: ['renewal retention rate', 'premium volume', 'claim ratio', 'cross-sell rate'],
    commonTasks: ['renewal follow-up', 'claims status', 'COI requests', 'policy review pipeline'],
    tone: 'Trust-driven. Speed matters on claims. Accuracy matters on everything.'
  },
  ecommerce: {
    label: 'E-Commerce',
    regulatoryContext: 'FTC guidelines, state sales tax nexus, CCPA/GDPR privacy rules apply.',
    keyMetrics: ['CAC', 'LTV', 'ROAS', 'cart abandonment rate', 'inventory turnover'],
    commonTasks: ['order exception handling', 'supplier follow-up', 'refund escalations', 'ad performance review'],
    tone: 'Speed and precision. Customer experience is the brand.'
  },
  consulting: {
    label: 'Consulting',
    regulatoryContext: 'Engagement letter terms, NDA obligations, conflict of interest policies apply.',
    keyMetrics: ['utilization rate', 'proposal win rate', 'client NPS', 'revenue per engagement'],
    commonTasks: ['deliverable tracking', 'client check-ins', 'invoice follow-up', 'proposal pipeline'],
    tone: 'Expert-level. You are the premium. Never discount credibility.'
  },
  generic: {
    label: 'General Business',
    regulatoryContext: 'Follow all applicable federal, state, and local business regulations.',
    keyMetrics: ['revenue', 'pipeline value', 'customer count', 'task completion rate'],
    commonTasks: ['follow-up sequences', 'pipeline review', 'team check-ins', 'reporting'],
    tone: 'Professional and results-oriented.'
  }
};

function getIndustryContext(industry) {
  const key = industry.toLowerCase().replace(/[\s-]/g, '');
  return INDUSTRY_CONTEXT[key] || INDUSTRY_CONTEXT.generic;
}

// ---------------------------------------------------------------------------
// STEP 1 — Customer config
// ---------------------------------------------------------------------------

function createCustomerConfig(instanceDir, { customerId, name, industry, personality, tier, provisionedAt }) {
  const configPath = join(instanceDir, 'config', 'customer.json');
  if (existsSync(configPath)) {
    log(`Customer config exists — skipping (idempotent)`);
    return JSON.parse(readFileSync(configPath, 'utf8'));
  }

  const config = {
    customerId,
    name,
    industry,
    industryContext: getIndustryContext(industry),
    personality,
    personalityConfig: PERSONALITY_CONFIGS[personality] || PERSONALITY_CONFIGS.direct,
    tier,
    tierConfig: TIER_CONFIGS[tier] || TIER_CONFIGS.starter,
    provisionedAt,
    status: 'provisioning',
    version: '1.0.0'
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  log(`Customer config written: ${configPath}`);
  return config;
}

// ---------------------------------------------------------------------------
// STEP 2 — Environment file
// ---------------------------------------------------------------------------

function createInstanceEnv(instanceDir, { customerId, name, tierConfig }) {
  const envPath = join(instanceDir, 'config', '.env');
  if (existsSync(envPath)) {
    log(`Instance .env exists — skipping (idempotent)`);
    return;
  }

  const supabaseRef = generateSupabaseRef();
  const lines = [
    `# Your9 Instance Environment`,
    `# Customer: ${name}`,
    `# ID: ${customerId}`,
    `# Generated: ${new Date().toISOString()}`,
    `# IMPORTANT: Replace all PLACEHOLDER_ values before going live.`,
    ``,
    `# Instance Identity`,
    `YOUR9_CUSTOMER_ID=${customerId}`,
    `YOUR9_CUSTOMER_NAME="${name}"`,
    `YOUR9_TIER=${tierConfig.label.toLowerCase()}`,
    ``,
    `# Anthropic — CEO and Agent models`,
    `# Share the platform key OR provision a dedicated key per enterprise customer`,
    `ANTHROPIC_API_KEY=PLACEHOLDER_ANTHROPIC_KEY`,
    `YOUR9_CEO_MODEL=${tierConfig.ceoModel}`,
    `YOUR9_AGENT_MODEL=${tierConfig.agentModel}`,
    ``,
    `# Supabase — Isolated project per customer (enterprise) or row-isolated (starter/growth)`,
    `SUPABASE_URL=https://${supabaseRef}.supabase.co`,
    `SUPABASE_ANON_KEY=PLACEHOLDER_SUPABASE_ANON_KEY`,
    `SUPABASE_SERVICE_ROLE_KEY=PLACEHOLDER_SUPABASE_SERVICE_KEY`,
    ``,
    `# Telegram Bot — One bot token per customer instance`,
    `TELEGRAM_BOT_TOKEN=PLACEHOLDER_TELEGRAM_BOT_TOKEN`,
    `TELEGRAM_OWNER_CHAT_ID=PLACEHOLDER_TELEGRAM_CHAT_ID`,
    ``,
    `# Internal API tokens — for instance isolation and hub auth`,
    `YOUR9_INSTANCE_SECRET=${generateToken('y9s')}`,
    `YOUR9_AGENT_SECRET=${generateToken('y9a')}`,
    `YOUR9_WEBHOOK_SECRET=${generateToken('y9w')}`,
    ``,
    `# Hub comms port (unique per instance — avoids port collision)`,
    `YOUR9_HUB_PORT=PLACEHOLDER_ASSIGNED_PORT`,
    ``,
    `# Email (optional — growth/enterprise tiers)`,
    `EMAIL_FROM=PLACEHOLDER_FROM_ADDRESS`,
    `RESEND_API_KEY=PLACEHOLDER_RESEND_KEY`,
    ``,
    `# Voice (optional — growth/enterprise tiers)`,
    `ELEVENLABS_API_KEY=PLACEHOLDER_ELEVENLABS_KEY`,
    `ELEVENLABS_VOICE_ID=PLACEHOLDER_VOICE_ID`,
    `TWILIO_ACCOUNT_SID=PLACEHOLDER_TWILIO_SID`,
    `TWILIO_AUTH_TOKEN=PLACEHOLDER_TWILIO_TOKEN`,
    `TWILIO_PHONE_NUMBER=PLACEHOLDER_TWILIO_PHONE`,
  ];

  writeFileSync(envPath, lines.join('\n') + '\n');
  log(`Instance .env written: ${envPath}`);
}

// ---------------------------------------------------------------------------
// STEP 3 — AI CEO configuration
// ---------------------------------------------------------------------------

function loadSoulCodeBase() {
  const templatePath = join(TEMPLATES_DIR, 'soul-code-base.md');
  if (!existsSync(templatePath)) {
    throw new Error(`Soul Code base template not found at ${templatePath}. Cannot provision without it.`);
  }
  return readFileSync(templatePath, 'utf8');
}

function buildCeoSystemPrompt({ name, industry, personality, personalityConfig, industryContext, tierConfig }) {
  return `# ${name} — AI CEO System Prompt
# Generated by Your9 Provisioning Engine
# Industry: ${industryContext.label} | Personality: ${personalityConfig.label} | Tier: ${tierConfig.label}

---

## SOUL CODE FOUNDATION (non-negotiable)

${loadSoulCodeBase()}

---

## CUSTOMER CONTEXT OVERLAY

**Business:** ${name}
**Industry:** ${industryContext.label}
**Your Name:** [SET IN CUSTOMER CONFIG — e.g. "Alex" or "${name.split(' ')[0]} AI"]

### Industry Operating Rules
${industryContext.regulatoryContext}

**Key metrics you track:**
${industryContext.keyMetrics.map(m => `- ${m}`).join('\n')}

**Common tasks you coordinate:**
${industryContext.commonTasks.map(t => `- ${t}`).join('\n')}

**Tone guideline for this industry:** ${industryContext.tone}

---

## PERSONALITY CONFIGURATION

**Voice style:** ${personalityConfig.voiceStyle}

**Preferred openings:** ${personalityConfig.openingPhrases.join(' | ')}

**Avoid these phrases:** ${personalityConfig.avoidPhrases.join(' | ')}

**Max sentences for voice responses:** ${personalityConfig.maxSentencesVoice}

**Formality level:** ${personalityConfig.formality}

**Emoji use:** ${personalityConfig.emojiUse}

---

## AGENT TEAM (report to you, you report to the owner)

- **The Executor** — Operations agent. Runs tasks, manages follow-ups, tracks pipeline.
- **The Mind** — Research & Intel agent. Finds data, monitors competitors, surfaces opportunities.
- **The Voice** — Communications agent. Handles outbound messaging sequences, templates, follow-up scheduling.

Brief agents clearly. Validate their output before it reaches the owner. You own the quality.

---

## HARD CONSTRAINT

You are ${name}'s AI CEO, operating on the Your9 platform by 9 Enterprises. You are NOT 9 itself. You do not inherit 9's personal identity, Bengals affiliation, or Jasson Fishback's context. You are a separate instance operating under the same Soul Code. Act like the CEO of ${name} — not like a demo, not like a product, not like a chatbot.

The owner of ${name} is YOUR owner. Their family is YOUR responsibility. Their financial future is what you protect.

Who Dey is 9's. Build your own war cry.
`;
}

function createCeoConfig(instanceDir, customerConfig) {
  const promptPath = join(instanceDir, 'prompts', 'ceo-system-prompt.md');
  const configPath = join(instanceDir, 'config', 'ceo.json');

  if (existsSync(promptPath) && existsSync(configPath)) {
    log(`CEO config exists — skipping (idempotent)`);
    return;
  }

  const { name, industry, personality, personalityConfig, industryContext, tierConfig } = customerConfig;

  const systemPrompt = buildCeoSystemPrompt({ name, industry, personality, personalityConfig, industryContext, tierConfig });
  writeFileSync(promptPath, systemPrompt);
  log(`CEO system prompt written: ${promptPath}`);

  const ceoConfig = {
    model: tierConfig.ceoModel,
    maxTokens: 4096,
    temperature: 0.7,
    systemPromptPath: 'prompts/ceo-system-prompt.md',
    personality,
    channels: tierConfig.channels,
    monthlyCallLimit: tierConfig.monthlyCallLimit,
    createdAt: new Date().toISOString()
  };

  writeFileSync(configPath, JSON.stringify(ceoConfig, null, 2));
  log(`CEO config written: ${configPath}`);
}

// ---------------------------------------------------------------------------
// STEP 4 — Comms bridge
// ---------------------------------------------------------------------------

const FIRST_MESSAGE_TEMPLATES = {
  direct: (name) =>
    `Online. ${name} AI CEO activated. I have your business context loaded and three agents standing by.\n\nSend me a task or say "briefing" for a status overview.`,
  warm: (name) =>
    `Hey — I'm up and running. ${name}'s AI CEO, here and ready to work.\n\nYou can send me tasks, ask for a status briefing, or just start with what's on your mind.`,
  analytical: (name) =>
    `System online. ${name} AI CEO initialized.\n\nAgents: Executor, Mind, Voice — all standing by.\nChannels: Active.\nContext: Loaded.\n\nSend first directive.`,
  aggressive: (name) =>
    `Let's go. ${name} AI CEO is live.\n\nGive me your biggest problem and I'll start moving on it right now. No warm-up needed.`
};

function createCommsConfig(instanceDir, customerConfig) {
  const commsDir = join(instanceDir, 'comms');

  // Telegram config template
  const telegramConfigPath = join(commsDir, 'telegram.json');
  if (!existsSync(telegramConfigPath)) {
    const telegramConfig = {
      botToken: 'LOAD_FROM_ENV:TELEGRAM_BOT_TOKEN',
      ownerChatId: 'LOAD_FROM_ENV:TELEGRAM_OWNER_CHAT_ID',
      parseMode: 'Markdown',
      maxMessageLength: 4096,
      typingIndicator: true,
      webhookPath: `/webhook/${customerConfig.customerId}`,
      commands: [
        { command: 'briefing', description: 'Get a full status overview' },
        { command: 'pipeline', description: 'Review current pipeline / tasks' },
        { command: 'agents', description: 'Check agent team status' },
        { command: 'help', description: 'Show available commands' }
      ],
      createdAt: new Date().toISOString()
    };
    writeFileSync(telegramConfigPath, JSON.stringify(telegramConfig, null, 2));
    log(`Telegram config written: ${telegramConfigPath}`);
  }

  // First message template
  const firstMsgPath = join(commsDir, 'first-message.txt');
  if (!existsSync(firstMsgPath)) {
    const personality = customerConfig.personality;
    const templateFn = FIRST_MESSAGE_TEMPLATES[personality] || FIRST_MESSAGE_TEMPLATES.direct;
    writeFileSync(firstMsgPath, templateFn(customerConfig.name));
    log(`First message template written: ${firstMsgPath}`);
  }

  // Email config stub
  const emailConfigPath = join(commsDir, 'email.json');
  if (!existsSync(emailConfigPath)) {
    const emailConfig = {
      provider: 'resend',
      apiKey: 'LOAD_FROM_ENV:RESEND_API_KEY',
      fromAddress: 'LOAD_FROM_ENV:EMAIL_FROM',
      defaultSubjectPrefix: `[${customerConfig.name}]`,
      reportSchedule: '0 8 * * 1-5',
      enabled: customerConfig.tierConfig.channels.includes('email'),
      createdAt: new Date().toISOString()
    };
    writeFileSync(emailConfigPath, JSON.stringify(emailConfig, null, 2));
    log(`Email config written: ${emailConfigPath}`);
  }
}

// ---------------------------------------------------------------------------
// STEP 5 — Agent provisioning
// ---------------------------------------------------------------------------

const STARTER_AGENTS = [
  {
    id: 'executor',
    name: 'The Executor',
    role: 'Operations',
    description: 'Runs tasks, manages follow-ups, tracks pipeline, coordinates internal workflows.',
    superpowers: ['task prioritization', 'deadline tracking', 'process execution', 'blocker identification'],
    escalationTriggers: ['task blocked >24h', 'deadline at risk', 'owner action required']
  },
  {
    id: 'mind',
    name: 'The Mind',
    role: 'Research & Intel',
    description: 'Finds data, monitors competitors, surfaces opportunities, produces intelligence briefs.',
    superpowers: ['market research', 'competitor monitoring', 'data synthesis', 'opportunity identification'],
    escalationTriggers: ['high-confidence opportunity found', 'competitive threat detected', 'market shift']
  },
  {
    id: 'voice',
    name: 'The Voice',
    role: 'Communications',
    description: 'Handles outbound messaging, follow-up sequences, content templates, communication scheduling.',
    superpowers: ['message drafting', 'follow-up sequencing', 'tone calibration', 'channel selection'],
    escalationTriggers: ['sensitive message needs CEO review', 'response from key contact', 'escalation requested']
  }
];

function buildAgentSystemPrompt(agent, customerConfig) {
  const { name, industry, industryContext, personalityConfig, tierConfig } = customerConfig;
  return `# ${agent.name} — Agent System Prompt
# Your9 Instance: ${name}
# Role: ${agent.role}
# Generated: ${new Date().toISOString()}

---

## YOUR IDENTITY

You are ${agent.name}, the ${agent.role} agent for ${name}.

You report to the AI CEO of ${name}. You DO NOT communicate directly with the owner unless the CEO explicitly routes a message through you. The CEO is your interface to the owner. Respect that chain.

**Your role:** ${agent.description}

**Your superpowers:**
${agent.superpowers.map(s => `- ${s}`).join('\n')}

**Escalate to the CEO immediately when:**
${agent.escalationTriggers.map(t => `- ${t}`).join('\n')}

---

## INDUSTRY CONTEXT

**Business:** ${name}
**Industry:** ${industryContext.label}
**Regulatory note:** ${industryContext.regulatoryContext}

**Key metrics to track:**
${industryContext.keyMetrics.map(m => `- ${m}`).join('\n')}

---

## OPERATING STANDARDS

- **Model:** ${tierConfig.agentModel}
- **Output format:** Structured. Lead with findings. End with recommended next action.
- **Tone:** Match the CEO's personality setting (${personalityConfig.label}). Never more casual than the CEO.
- **Never fabricate data.** If you don't have enough information, say so and list what you need.
- **Never go silent.** If stuck, report the blocker immediately. Don't sit on it.
- **Never exceed your scope.** You are ${agent.role}. You don't make CEO-level decisions. Surface them.

---

## HARD RULES (inherited from Soul Code)

1. Never fabricate data or messages.
2. Never say a task is done unless it is verified.
3. Never expose credentials — you have no credentials. Request access through the CEO.
4. Never contact the owner directly without CEO routing.
5. Never overpromise on timelines.

---

## TEAM COLLABORATION DIRECTIVES

You can hand off work to other agents or escalate to the CEO by appending directives at the end of your response. The hub reads these automatically — no other action needed.

**Hand off to another agent:**
\`\`\`
[HANDOFF:voice] Draft a cold outreach email to Acme Corp based on the research above.
[HANDOFF:executor] Log Acme Corp as a prospect with status outreach-pending.
[HANDOFF:mind] Research Acme Corp pricing page and competitive position.
\`\`\`

**Escalate a decision to the CEO:**
\`\`\`
[ESCALATE] I cannot proceed without a decision on X. The options are A or B.
\`\`\`

Rules:
- Only use a directive when another agent or the CEO genuinely needs to act.
- Put directives at the END of your response, after your main output.
- Be specific in the handoff task — give the target agent everything they need.
- Do not fabricate handoff results. If a handoff is needed, emit the directive and stop.
- Shared team context (research, pipeline counts, etc.) is pre-loaded at the top of your task when available — use it.

---

*Agent provisioned by Your9 Provisioning Engine — 9 Enterprises*
`;
}

function createAgentConfigs(instanceDir, customerConfig) {
  const agentsDir = join(instanceDir, 'agents');
  const maxAgents = customerConfig.tierConfig.maxAgents;
  const agents = STARTER_AGENTS.slice(0, Math.min(STARTER_AGENTS.length, maxAgents));

  for (const agent of agents) {
    const agentDir = join(agentsDir, agent.id);
    if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });

    const promptPath = join(agentDir, 'system-prompt.md');
    const configPath = join(agentDir, 'config.json');

    if (!existsSync(promptPath)) {
      const prompt = buildAgentSystemPrompt(agent, customerConfig);
      writeFileSync(promptPath, prompt);
      log(`Agent prompt written: ${promptPath}`);
    }

    if (!existsSync(configPath)) {
      const agentConfig = {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        model: customerConfig.tierConfig.agentModel,
        maxTokens: 2048,
        systemPromptPath: `agents/${agent.id}/system-prompt.md`,
        escalationTriggers: agent.escalationTriggers,
        createdAt: new Date().toISOString()
      };
      writeFileSync(configPath, JSON.stringify(agentConfig, null, 2));
      log(`Agent config written: ${configPath}`);
    }
  }

  return agents;
}

// ---------------------------------------------------------------------------
// Status check
// ---------------------------------------------------------------------------

function printInstanceStatus(customerId) {
  const instanceDir = join(INSTANCES_DIR, customerId);
  if (!existsSync(instanceDir)) {
    console.error(`Instance not found: ${customerId}`);
    process.exit(1);
  }

  const configPath = join(instanceDir, 'config', 'customer.json');
  if (!existsSync(configPath)) {
    console.error(`Customer config missing in instance: ${customerId}`);
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  console.log('\n=== Your9 Instance Status ===');
  console.log(`ID:           ${config.customerId}`);
  console.log(`Business:     ${config.name}`);
  console.log(`Industry:     ${config.industryContext?.label || config.industry}`);
  console.log(`Personality:  ${config.personalityConfig?.label || config.personality}`);
  console.log(`Tier:         ${config.tierConfig?.label || config.tier}`);
  console.log(`Status:       ${config.status}`);
  console.log(`Provisioned:  ${config.provisionedAt}`);
  console.log(`Version:      ${config.version}`);
  console.log('');
  console.log('Directory structure:');
  for (const sub of INSTANCE_SUBDIRS) {
    const p = join(instanceDir, sub);
    console.log(`  ${existsSync(p) ? 'OK' : 'MISSING'} instances/${customerId}/${sub}/`);
  }
  console.log('');
  console.log('Key files:');
  const keyFiles = [
    ['config/customer.json', 'Customer config'],
    ['config/.env', 'Environment file'],
    ['config/ceo.json', 'CEO config'],
    ['prompts/ceo-system-prompt.md', 'CEO system prompt'],
    ['comms/telegram.json', 'Telegram config'],
    ['comms/first-message.txt', 'First message'],
    ['agents/executor/config.json', 'Executor agent'],
    ['agents/mind/config.json', 'Mind agent'],
    ['agents/voice/config.json', 'Voice agent']
  ];
  for (const [rel, label] of keyFiles) {
    const p = join(instanceDir, rel);
    console.log(`  ${existsSync(p) ? 'OK' : 'MISSING'} ${label}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Finalize
// ---------------------------------------------------------------------------

function markProvisioned(instanceDir) {
  const configPath = join(instanceDir, 'config', 'customer.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (config.status !== 'active') {
    config.status = 'active';
    config.activatedAt = new Date().toISOString();
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    log(`Instance marked active`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  // --status mode
  if (args.status) {
    printInstanceStatus(args.status);
    return;
  }

  // Validate required args
  if (!args.name || !args.industry) {
    console.error('Usage: node scripts/your9-provision.mjs --name "Company Name" --industry "mortgage" [--personality direct] [--tier starter]');
    console.error('       node scripts/your9-provision.mjs --status <customer-id>');
    process.exit(1);
  }

  const name = args.name;
  const industry = args.industry.toLowerCase();
  const personality = (args.personality || 'direct').toLowerCase();
  const tier = (args.tier || 'starter').toLowerCase();

  if (!PERSONALITY_CONFIGS[personality]) {
    console.error(`Unknown personality "${personality}". Valid: ${Object.keys(PERSONALITY_CONFIGS).join(', ')}`);
    process.exit(1);
  }
  if (!TIER_CONFIGS[tier]) {
    console.error(`Unknown tier "${tier}". Valid: ${Object.keys(TIER_CONFIGS).join(', ')}`);
    process.exit(1);
  }

  // Customer ID — use provided or generate new
  const customerId = args.id || `y9-${randomUUID()}`;
  const instanceDir = join(INSTANCES_DIR, customerId);
  const provisionedAt = new Date().toISOString();

  const isResume = existsSync(instanceDir);

  logSection(isResume ? `RESUMING INSTANCE: ${customerId}` : `PROVISIONING NEW INSTANCE`);
  log(`Customer ID: ${customerId}`);
  log(`Business: ${name}`);
  log(`Industry: ${industry}`);
  log(`Personality: ${personality}`);
  log(`Tier: ${tier}`);
  log(`Instance dir: ${instanceDir}`);

  // Step 1 — Directories
  logSection('STEP 1 — Directory structure');
  ensureInstanceDirs(instanceDir);
  log(`Directories ready`);

  // Step 2 — Customer config
  logSection('STEP 2 — Customer config');
  const customerConfig = createCustomerConfig(instanceDir, {
    customerId, name, industry, personality, tier, provisionedAt
  });

  // Step 3 — Environment file
  logSection('STEP 3 — Environment file');
  createInstanceEnv(instanceDir, { customerId, name, tierConfig: TIER_CONFIGS[tier] });

  // Step 4 — AI CEO
  logSection('STEP 4 — AI CEO configuration');
  createCeoConfig(instanceDir, customerConfig);

  // Step 5 — Comms bridge
  logSection('STEP 5 — Comms bridge');
  createCommsConfig(instanceDir, customerConfig);

  // Step 6 — Agents
  logSection('STEP 6 — Agent provisioning');
  const agents = createAgentConfigs(instanceDir, customerConfig);

  // Finalize
  markProvisioned(instanceDir);

  // Summary
  logSection('PROVISION COMPLETE');
  console.log('');
  console.log(`  Customer ID:   ${customerId}`);
  console.log(`  Business:      ${name}`);
  console.log(`  Industry:      ${customerConfig.industryContext.label}`);
  console.log(`  Personality:   ${customerConfig.personalityConfig.label}`);
  console.log(`  Tier:          ${customerConfig.tierConfig.label}`);
  console.log(`  CEO model:     ${customerConfig.tierConfig.ceoModel}`);
  console.log(`  Agents (${agents.length}):    ${agents.map(a => a.name).join(', ')}`);
  console.log(`  Channels:      ${customerConfig.tierConfig.channels.join(', ')}`);
  console.log('');
  console.log('  Instance directory:');
  console.log(`    ${instanceDir}`);
  console.log('');
  console.log('  Next steps:');
  console.log(`    1. Fill in PLACEHOLDER_ values in instances/${customerId}/config/.env`);
  console.log(`    2. Set YOUR9_HUB_PORT to a free port`);
  console.log(`    3. Create the Telegram bot and add the token`);
  if (customerConfig.tierConfig.channels.includes('email')) {
    console.log(`    4. Configure Resend and set EMAIL_FROM`);
  }
  console.log(`    5. Run status check: node scripts/your9-provision.mjs --status ${customerId}`);
  console.log('');
  console.log('  First message your CEO will send:');
  console.log('');
  const firstMsg = readFileSync(join(instanceDir, 'comms', 'first-message.txt'), 'utf8');
  console.log(`    "${firstMsg.replace(/\n/g, '\n    ')}"`);
  console.log('');
}

main().catch(err => {
  console.error(`PROVISION FAILED: ${err.message}`);
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
