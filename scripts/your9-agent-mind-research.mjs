#!/usr/bin/env node
/**
 * your9-agent-mind-research.mjs — The Mind: Research & Intel Agent
 * Your9 by 9 Enterprises
 *
 * Performs real research via Anthropic API (Sonnet) with web search, compiles
 * structured markdown reports, saves them to the instance's reports directory,
 * and notifies the founder via Telegram with a summary.
 *
 * Invoked by the hub when the CEO delegates a research task via:
 *   [DELEGATE:mind] Research top 3 competitors in the mortgage space.
 *
 * Can also be run standalone for testing:
 *   node scripts/your9-agent-mind-research.mjs \
 *     --instance <customer-id> \
 *     --query "What are the top 5 FHA lenders in Ohio?"
 *
 * Can run as a long-lived agent watching for tasks:
 *   node scripts/your9-agent-mind-research.mjs --instance <customer-id> --watch
 *
 * Flags:
 *   --instance    Customer ID (required)
 *   --query       Research question (standalone mode)
 *   --task-file   Path to a specific task JSON file to process
 *   --watch       Poll tasks directory for new research assignments
 *   --follow-up   Comma-separated follow-up questions to chain after initial research
 *   --notify      Send Telegram summary to founder (default: true, set "false" to skip)
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync,
  readdirSync, renameSync
} from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

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

let logPath = null;

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] MIND: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  if (logPath) {
    try { appendFileSync(logPath, line + '\n'); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Raw HTTPS helpers — same pattern as hub
// ---------------------------------------------------------------------------

function httpsPost(hostname, path, headers, body, timeoutMs = 120000) {
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
          catch (e) { reject(new Error(`JSON parse failed: ${e.message} — body: ${buf.slice(0, 500)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('HTTPS request timed out')); });
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Anthropic API — research call with web search tool
// ---------------------------------------------------------------------------

async function researchWithWebSearch(anthropicKey, systemPrompt, query, maxTokens = 8192) {
  const body = {
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: maxTokens,
    system: systemPrompt,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 10,
      }
    ],
    messages: [
      { role: 'user', content: query }
    ],
  };

  const result = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body,
    120000
  );

  if (result.error) {
    throw new Error(`Anthropic API error: ${result.error.message || JSON.stringify(result.error)}`);
  }

  // Extract text blocks from the response — web search results are interleaved
  const textBlocks = (result.content || []).filter(b => b.type === 'text');
  if (textBlocks.length === 0) {
    throw new Error(`Anthropic returned no text content: ${JSON.stringify(result).slice(0, 300)}`);
  }

  // Collect citations from web_search_tool_result blocks
  const citations = [];
  for (const block of (result.content || [])) {
    if (block.type === 'web_search_tool_result' && block.content) {
      for (const item of block.content) {
        if (item.type === 'web_search_result' && item.url) {
          citations.push({
            title: item.title || 'Untitled',
            url: item.url,
            snippet: (item.page_content || '').slice(0, 200),
          });
        }
      }
    }
  }

  // Deduplicate citations by URL
  const seen = new Set();
  const uniqueCitations = citations.filter(c => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });

  return {
    text: textBlocks.map(b => b.text).join('\n\n'),
    citations: uniqueCitations,
    model: result.model,
    usage: result.usage,
    stopReason: result.stop_reason,
  };
}

// ---------------------------------------------------------------------------
// Anthropic API — plain call (for follow-ups without web search)
// ---------------------------------------------------------------------------

async function callClaude(anthropicKey, systemPrompt, messages, maxTokens = 4096) {
  const body = {
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  };

  const result = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body,
    60000
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
// Telegram notification
// ---------------------------------------------------------------------------

async function sendTelegramNotification(botToken, chatId, text) {
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
        chat_id: chatId, text: chunk, parse_mode: 'Markdown'
      });
    } catch {
      // Retry without parse_mode if Markdown fails
      try {
        await httpsPost('api.telegram.org', `/bot${botToken}/sendMessage`, {}, {
          chat_id: chatId, text: chunk
        });
      } catch (e) {
        log(`Telegram send failed: ${e.message}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report builder — structured markdown from research results
// ---------------------------------------------------------------------------

function buildReport({ query, primaryResearch, followUpResults, instanceConfig, timestamp }) {
  const lines = [];

  lines.push(`# Research Report: ${query}`);
  lines.push('');
  lines.push(`**Prepared by:** The Mind (Research & Intel Agent)`);
  lines.push(`**Business:** ${instanceConfig.name}`);
  lines.push(`**Date:** ${new Date(timestamp).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`);
  lines.push(`**Model:** ${primaryResearch.model || 'claude-sonnet-4-5'}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Primary findings
  lines.push('## Findings');
  lines.push('');
  lines.push(primaryResearch.text);
  lines.push('');

  // Follow-up research sections
  if (followUpResults && followUpResults.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Follow-Up Research');
    lines.push('');
    for (const fu of followUpResults) {
      lines.push(`### ${fu.question}`);
      lines.push('');
      lines.push(fu.text);
      lines.push('');
      if (fu.citations && fu.citations.length > 0) {
        lines.push('**Additional Sources:**');
        for (const c of fu.citations) {
          lines.push(`- [${c.title}](${c.url})`);
        }
        lines.push('');
      }
    }
  }

  // Sources / citations
  if (primaryResearch.citations && primaryResearch.citations.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Sources');
    lines.push('');
    for (let i = 0; i < primaryResearch.citations.length; i++) {
      const c = primaryResearch.citations[i];
      lines.push(`${i + 1}. [${c.title}](${c.url})`);
      if (c.snippet) {
        lines.push(`   > ${c.snippet}`);
      }
    }
    lines.push('');
  }

  // Suggested follow-ups
  lines.push('---');
  lines.push('');
  lines.push('## Suggested Follow-Up Questions');
  lines.push('');
  lines.push('_To be populated by the CEO based on findings above._');
  lines.push('');

  // Metadata
  lines.push('---');
  lines.push('');
  lines.push('## Metadata');
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Query | ${query} |`);
  lines.push(`| Timestamp | ${timestamp} |`);
  lines.push(`| Primary sources | ${primaryResearch.citations?.length || 0} |`);
  lines.push(`| Follow-up questions | ${followUpResults?.length || 0} |`);
  if (primaryResearch.usage) {
    lines.push(`| Input tokens | ${primaryResearch.usage.input_tokens || 'N/A'} |`);
    lines.push(`| Output tokens | ${primaryResearch.usage.output_tokens || 'N/A'} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('*Report generated by The Mind -- Your9 by 9 Enterprises*');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Build Telegram summary from research results
// ---------------------------------------------------------------------------

function buildTelegramSummary(query, primaryText) {
  // Extract first 3 substantive bullet points or sentences from the research
  const sentences = primaryText
    .split(/\n/)
    .map(s => s.trim())
    .filter(s => s.length > 20 && !s.startsWith('#') && !s.startsWith('---') && !s.startsWith('|'));

  const bullets = [];
  for (const s of sentences) {
    // Prefer lines that start with bullet markers or numbered items
    const clean = s.replace(/^[-*\d.]+\s*/, '').trim();
    if (clean.length > 20 && bullets.length < 3) {
      // Truncate long lines
      bullets.push(clean.length > 150 ? clean.slice(0, 147) + '...' : clean);
    }
  }

  // Fallback if no good bullets found
  if (bullets.length === 0) {
    const fallback = primaryText.slice(0, 200).replace(/\n/g, ' ').trim();
    bullets.push(fallback);
  }

  const topicShort = query.length > 60 ? query.slice(0, 57) + '...' : query;
  const summary = [
    `Research complete: *${topicShort}*`,
    '',
    'Key findings:',
    ...bullets.map(b => `  - ${b}`),
    '',
    'Full report available in your dashboard.',
  ].join('\n');

  return summary;
}

// ---------------------------------------------------------------------------
// Research system prompt — instructs Sonnet how to research
// ---------------------------------------------------------------------------

function buildResearchSystemPrompt(instanceConfig) {
  const industryLabel = instanceConfig.industryContext?.label || instanceConfig.industry || 'General';
  const businessName = instanceConfig.name;

  return `You are The Mind, the Research & Intel agent for ${businessName} (${industryLabel} industry).

Your job is to produce thorough, accurate, structured research reports. You have access to web search — USE IT for every research task to get current, real data.

## Output Format

Structure your response as follows:

### Executive Summary
2-3 sentences capturing the key takeaway.

### Key Findings
Numbered list of the most important discoveries. Each finding should have:
- A clear headline
- Supporting data or evidence
- Source attribution where possible

### Analysis
Deeper dive into implications for ${businessName}. Connect findings to the business context.

### Recommendations
3-5 actionable next steps the CEO or owner should consider, ranked by priority.

### Risk Factors
Any caveats, data gaps, or risks the owner should be aware of.

## Rules
- ALWAYS use web search to get current data. Never rely solely on training data.
- Cite sources. If a claim comes from a specific source, attribute it.
- Never fabricate statistics, quotes, or data points.
- If you cannot find reliable data on something, say so explicitly.
- Be concise but thorough. Quality over length.
- Frame everything through the lens of ${businessName}'s business.
- Regulatory context for ${industryLabel} applies — flag compliance considerations.
- Lead with what matters most. The owner is busy.`;
}

// ---------------------------------------------------------------------------
// Core research pipeline
// ---------------------------------------------------------------------------

async function executeResearch({ anthropicKey, query, followUpQuestions, instanceConfig }) {
  const timestamp = new Date().toISOString();
  const systemPrompt = buildResearchSystemPrompt(instanceConfig);

  log(`Starting research: "${query.slice(0, 100)}"`);

  // Primary research with web search
  const primaryResearch = await researchWithWebSearch(
    anthropicKey,
    systemPrompt,
    `Research the following thoroughly using web search:\n\n${query}`,
    8192
  );

  log(`Primary research complete. ${primaryResearch.citations.length} sources found. ${primaryResearch.usage?.output_tokens || '?'} tokens.`);

  // Follow-up questions (chained research)
  const followUpResults = [];
  if (followUpQuestions && followUpQuestions.length > 0) {
    for (const fq of followUpQuestions) {
      const trimmed = fq.trim();
      if (!trimmed) continue;

      log(`Follow-up research: "${trimmed.slice(0, 80)}"`);

      try {
        const fuResult = await researchWithWebSearch(
          anthropicKey,
          systemPrompt,
          `Context from prior research:\n${primaryResearch.text.slice(0, 2000)}\n\nFollow-up question:\n${trimmed}`,
          4096
        );

        followUpResults.push({
          question: trimmed,
          text: fuResult.text,
          citations: fuResult.citations,
        });

        log(`Follow-up complete: "${trimmed.slice(0, 50)}"`);
      } catch (e) {
        log(`Follow-up failed for "${trimmed.slice(0, 50)}": ${e.message}`);
        followUpResults.push({
          question: trimmed,
          text: `Research failed: ${e.message}`,
          citations: [],
        });
      }
    }
  }

  // Generate suggested follow-up questions from the CEO's perspective
  let suggestedFollowUps = [];
  try {
    const fuPrompt = `Based on this research, suggest exactly 3 follow-up questions the business owner should ask next. Return ONLY the questions, one per line, numbered 1-3. No preamble.\n\nResearch topic: ${query}\n\nFindings:\n${primaryResearch.text.slice(0, 3000)}`;
    const fuText = await callClaude(anthropicKey, systemPrompt, [{ role: 'user', content: fuPrompt }], 512);
    suggestedFollowUps = fuText.split('\n').filter(l => l.trim().match(/^\d/)).slice(0, 3);
  } catch (e) {
    log(`Follow-up generation failed (non-fatal): ${e.message}`);
  }

  // Build the report
  const report = buildReport({
    query,
    primaryResearch,
    followUpResults,
    instanceConfig,
    timestamp,
  });

  // Inject suggested follow-ups into the report
  const finalReport = report.replace(
    '_To be populated by the CEO based on findings above._',
    suggestedFollowUps.length > 0
      ? suggestedFollowUps.join('\n')
      : '_No follow-up questions generated._'
  );

  // Build Telegram summary
  const telegramSummary = buildTelegramSummary(query, primaryResearch.text);

  return {
    report: finalReport,
    summary: telegramSummary,
    query,
    timestamp,
    citationCount: primaryResearch.citations.length,
    followUpCount: followUpResults.length,
    usage: primaryResearch.usage,
  };
}

// ---------------------------------------------------------------------------
// Save report to instance data/reports/
// ---------------------------------------------------------------------------

function saveReport(instanceDir, query, reportMarkdown) {
  const reportsDir = join(instanceDir, 'data', 'reports');
  mkdirSync(reportsDir, { recursive: true });

  // Filename: timestamp + sanitized topic
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  const filename = `${ts}-${slug}.md`;
  const reportPath = join(reportsDir, filename);

  writeFileSync(reportPath, reportMarkdown);
  log(`Report saved: ${reportPath}`);

  return reportPath;
}

// ---------------------------------------------------------------------------
// Process a task file from instances/{id}/data/tasks/
// ---------------------------------------------------------------------------

async function processTaskFile(taskPath, ctx) {
  let task;
  try {
    task = JSON.parse(readFileSync(taskPath, 'utf-8'));
  } catch (e) {
    log(`Cannot parse task file ${taskPath}: ${e.message}`);
    return null;
  }

  // Only process mind agent tasks that are pending/running research
  if (task.agentId !== 'mind') return null;
  if (task.status === 'completed' || task.status === 'report-delivered') return null;

  const query = task.task || task.query;
  if (!query) {
    log(`Task file has no query/task field: ${taskPath}`);
    return null;
  }

  // Mark as running
  updateTaskFile(taskPath, { status: 'researching', researchStartedAt: new Date().toISOString() });

  try {
    const result = await executeResearch({
      anthropicKey: ctx.anthropicKey,
      query,
      followUpQuestions: task.followUpQuestions || [],
      instanceConfig: ctx.instanceConfig,
    });

    // Save report
    const reportPath = saveReport(ctx.instanceDir, query, result.report);

    // Update task
    updateTaskFile(taskPath, {
      status: 'report-delivered',
      reportPath,
      summary: result.summary,
      citationCount: result.citationCount,
      completedAt: new Date().toISOString(),
    });

    // Notify founder via Telegram
    if (ctx.botToken && ctx.ownerChatId && ctx.notify !== false) {
      await sendTelegramNotification(ctx.botToken, ctx.ownerChatId, result.summary);
      log('Telegram notification sent to founder');
    }

    return result;
  } catch (e) {
    log(`Research failed for task: ${e.message}`);
    updateTaskFile(taskPath, {
      status: 'failed',
      error: e.message,
      failedAt: new Date().toISOString(),
    });
    return null;
  }
}

function updateTaskFile(taskPath, updates) {
  try {
    const existing = JSON.parse(readFileSync(taskPath, 'utf-8'));
    writeFileSync(taskPath, JSON.stringify({ ...existing, ...updates }, null, 2));
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------------------------------
// Watch mode — poll tasks directory for new mind research tasks
// ---------------------------------------------------------------------------

async function watchMode(ctx) {
  const taskDir = join(ctx.instanceDir, 'data', 'tasks');
  mkdirSync(taskDir, { recursive: true });

  log('Watch mode started — polling for research tasks every 10 seconds');

  const processed = new Set();

  while (true) {
    try {
      const files = readdirSync(taskDir)
        .filter(f => f.endsWith('-task.json'))
        .sort();

      for (const f of files) {
        if (processed.has(f)) continue;

        const taskPath = join(taskDir, f);
        let task;
        try {
          task = JSON.parse(readFileSync(taskPath, 'utf-8'));
        } catch { continue; }

        if (task.agentId !== 'mind') {
          processed.add(f);
          continue;
        }

        if (task.status === 'completed' || task.status === 'report-delivered' || task.status === 'failed') {
          processed.add(f);
          continue;
        }

        // New research task found
        log(`New research task found: ${f}`);
        await processTaskFile(taskPath, ctx);
        processed.add(f);
      }
    } catch (e) {
      log(`Watch poll error: ${e.message}`);
    }

    await sleep(10000);
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Instance validation and config loading
// ---------------------------------------------------------------------------

function loadInstanceContext(customerId) {
  const instanceDir = join(INSTANCES_DIR, customerId);

  if (!existsSync(instanceDir)) {
    console.error(`FATAL: Instance not found: ${instanceDir}`);
    console.error(`Run provisioner first: node scripts/your9-provision.mjs --name "..." --industry "..." --id ${customerId}`);
    process.exit(1);
  }

  const configPath = join(instanceDir, 'config', 'customer.json');
  if (!existsSync(configPath)) {
    console.error(`FATAL: Customer config missing: ${configPath}`);
    process.exit(1);
  }

  const instanceConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

  // Load env — instance first, platform fallback
  const instanceEnv = loadEnvFile(join(instanceDir, 'config', '.env'));
  const platformEnv = loadEnvFile(join(ROOT, '.env'));

  const anthropicKey = (
    instanceEnv.ANTHROPIC_API_KEY && !instanceEnv.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER_')
  ) ? instanceEnv.ANTHROPIC_API_KEY : platformEnv.ANTHROPIC_API_KEY;

  if (!anthropicKey || anthropicKey.startsWith('PLACEHOLDER_')) {
    console.error('FATAL: No valid ANTHROPIC_API_KEY found in instance or platform .env');
    process.exit(1);
  }

  const botToken = (
    instanceEnv.TELEGRAM_BOT_TOKEN && !instanceEnv.TELEGRAM_BOT_TOKEN.startsWith('PLACEHOLDER_')
  ) ? instanceEnv.TELEGRAM_BOT_TOKEN : null;

  const ownerChatId = (
    instanceEnv.TELEGRAM_OWNER_CHAT_ID && !instanceEnv.TELEGRAM_OWNER_CHAT_ID.startsWith('PLACEHOLDER_')
  ) ? instanceEnv.TELEGRAM_OWNER_CHAT_ID : null;

  return {
    instanceDir,
    instanceConfig,
    anthropicKey,
    botToken,
    ownerChatId,
  };
}

// ---------------------------------------------------------------------------
// Main — standalone entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.instance) {
    console.error('Usage:');
    console.error('  Standalone:  node scripts/your9-agent-mind-research.mjs --instance <id> --query "..."');
    console.error('  Task file:   node scripts/your9-agent-mind-research.mjs --instance <id> --task-file <path>');
    console.error('  Watch mode:  node scripts/your9-agent-mind-research.mjs --instance <id> --watch');
    process.exit(1);
  }

  const ctx = loadInstanceContext(args.instance);

  // Set up logging
  const logDir = join(ctx.instanceDir, 'logs');
  mkdirSync(logDir, { recursive: true });
  const logDate = new Date().toISOString().slice(0, 10);
  logPath = join(logDir, `mind-${logDate}.log`);

  // Notification preference
  ctx.notify = args.notify !== 'false';

  log(`The Mind agent started for: ${ctx.instanceConfig.name}`);

  // Watch mode — long-lived agent
  if (args.watch) {
    await watchMode(ctx);
    return;
  }

  // Task file mode — process a single delegated task
  if (args['task-file']) {
    const taskFilePath = args['task-file'];
    if (!existsSync(taskFilePath)) {
      console.error(`Task file not found: ${taskFilePath}`);
      process.exit(1);
    }
    const result = await processTaskFile(taskFilePath, ctx);
    if (result) {
      log('Task complete. Report delivered.');
      // Output summary to stdout for the hub to capture
      process.stdout.write(JSON.stringify({
        status: 'completed',
        summary: result.summary,
        citationCount: result.citationCount,
        followUpCount: result.followUpCount,
      }) + '\n');
    } else {
      log('Task processing returned no result.');
      process.exit(1);
    }
    return;
  }

  // Standalone query mode
  if (!args.query) {
    console.error('Provide --query, --task-file, or --watch');
    process.exit(1);
  }

  const query = args.query;
  const followUpQuestions = args['follow-up']
    ? args['follow-up'].split(',').map(q => q.trim()).filter(Boolean)
    : [];

  const result = await executeResearch({
    anthropicKey: ctx.anthropicKey,
    query,
    followUpQuestions,
    instanceConfig: ctx.instanceConfig,
  });

  // Save report
  const reportPath = saveReport(ctx.instanceDir, query, result.report);
  log(`Report saved to: ${reportPath}`);

  // Send Telegram notification
  if (ctx.botToken && ctx.ownerChatId && ctx.notify) {
    await sendTelegramNotification(ctx.botToken, ctx.ownerChatId, result.summary);
    log('Telegram notification sent');
  }

  // Output structured result to stdout for hub integration
  const output = {
    status: 'completed',
    query,
    reportPath,
    summary: result.summary,
    citationCount: result.citationCount,
    followUpCount: result.followUpCount,
    timestamp: result.timestamp,
  };

  console.log('\n' + JSON.stringify(output, null, 2));
}

// ---------------------------------------------------------------------------
// Export for hub integration — the hub can import and call this directly
// ---------------------------------------------------------------------------

export { executeResearch, saveReport, buildTelegramSummary, sendTelegramNotification, processTaskFile };

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch(err => {
  console.error(`MIND FATAL: ${err.message}`);
  if (logPath) {
    try { appendFileSync(logPath, `[${new Date().toISOString()}] FATAL: ${err.message}\n${err.stack}\n`); } catch {}
  }
  process.exit(1);
});
