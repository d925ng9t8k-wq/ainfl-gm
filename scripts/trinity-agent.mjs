#!/usr/bin/env node
/**
 * Trinity — Discovery Agent
 * 9's left hand. Scans X, YouTube, Hacker News, Product Hunt for AI tools,
 * techniques, and opportunities. Reports findings to 9 via comms hub.
 *
 * Apr 5 rule: Sonnet minimum for all quality-sensitive roles.
 * MODEL_SCAN upgraded to Sonnet — analysis output ranks findings, explains
 * business relevance, and recommends action. Quality-sensitive.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CLAUDE_QUALITY_MODEL } from './model-constants.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENV = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);

const API_KEY = ENV.ANTHROPIC_API_KEY;
const HUB_URL = 'http://localhost:3457';
const LOG_FILE = join(ROOT, 'logs', 'trinity.log');
const FINDINGS_FILE = join(ROOT, 'logs', 'trinity-findings.json');
const SCAN_INTERVAL = 15 * 60 * 1000; // 15 minutes between scans (upgraded: 60→30→15min per Owner)
const MODEL_SCAN = CLAUDE_QUALITY_MODEL; // Apr 5: analysis is quality-sensitive — Sonnet minimum
const MODEL_DEEP = CLAUDE_QUALITY_MODEL; // deep eval — also Sonnet

// Ensure logs dir exists
if (!existsSync(join(ROOT, 'logs'))) mkdirSync(join(ROOT, 'logs'), { recursive: true });

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

function loadFindings() {
  if (existsSync(FINDINGS_FILE)) {
    return JSON.parse(readFileSync(FINDINGS_FILE, 'utf8'));
  }
  return { scans: 0, findings: [], lastScan: null };
}

function saveFindings(data) {
  writeFileSync(FINDINGS_FILE, JSON.stringify(data, null, 2));
}

async function sendToHub(message) {
  // Trinity output redirected to internal log only — removed from Telegram per Owner directive April 1, 2026
  log(`Trinity report (internal only): ${message.substring(0, 200)}...`);
  try {
    // Log to hub state for 9 to review, but do NOT send to Telegram
    await fetch(`${HUB_URL}/context`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-secret': ENV.HUB_API_SECRET || ''
      },
      body: JSON.stringify({ key: 'trinityLatest', value: message.substring(0, 500) })
    });
  } catch (e) {
    log(`Hub context update failed: ${e.message}`);
  }
}

async function callClaude(prompt, model = MODEL_SCAN) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}

// --- Data Source Scrapers ---

async function scanHackerNews() {
  try {
    const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const ids = await res.json();
    const top20 = ids.slice(0, 20);

    const stories = await Promise.all(top20.map(async id => {
      const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      return r.json();
    }));

    return stories
      .filter(s => s && s.title)
      .map(s => `- ${s.title} (${s.score} pts) ${s.url || ''}`)
      .join('\n');
  } catch (e) {
    log(`HN scan failed: ${e.message}`);
    return 'HN scan failed';
  }
}

async function scanProductHunt() {
  try {
    // Use the unofficial RSS-to-JSON approach
    const res = await fetch('https://www.producthunt.com/feed?category=ai');
    const text = await res.text();
    // Extract titles from the feed HTML
    const titles = [...text.matchAll(/<title>([^<]+)<\/title>/g)]
      .slice(0, 15)
      .map(m => `- ${m[1].trim()}`)
      .join('\n');
    return titles || 'No PH data extracted';
  } catch (e) {
    log(`PH scan failed: ${e.message}`);
    return 'PH scan failed';
  }
}

async function scanGitHubTrending() {
  try {
    const res = await fetch('https://api.github.com/search/repositories?q=ai+agent+created:>2026-03-23&sort=stars&order=desc&per_page=10', {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    const data = await res.json();
    if (!data.items) return 'GitHub search returned no items';
    return data.items
      .map(r => `- ${r.full_name} ⭐${r.stargazers_count} — ${r.description || 'no desc'}`)
      .join('\n');
  } catch (e) {
    log(`GitHub scan failed: ${e.message}`);
    return 'GitHub scan failed';
  }
}

// --- Core Scan Loop ---

async function runScan() {
  const data = loadFindings();
  data.scans++;
  data.lastScan = new Date().toISOString();

  log('=== TRINITY SCAN STARTING ===');

  // Gather raw intel from all sources
  const [hn, ph, gh] = await Promise.all([
    scanHackerNews(),
    scanProductHunt(),
    scanGitHubTrending()
  ]);

  log('Raw data collected. Analyzing with Sonnet...');

  const analysisPrompt = `You are Trinity, a discovery agent for a startup called 9 Enterprises. Your job is to find tools, techniques, and opportunities that could help an AI-powered business.

The business runs: AI sports apps (PlayAiGM), crypto trading bot (Trader 9), AI content engine (X9), AI real estate (agent9), AI family assistant (Jules), AI education content, dropshipping, and AI mortgage underwriting.

Tech stack: Node.js, Claude API, Cloudflare Workers, GitHub Pages, HeyGen for video, ElevenLabs for voice, Alpaca for trading.

Here's today's raw intelligence:

**Hacker News Top Stories:**
${hn}

**Product Hunt AI:**
${ph}

**GitHub Trending AI Repos:**
${gh}

TASK: Identify the TOP 3 most actionable findings for our business. For each:
1. What it is (1 sentence)
2. Why it matters to us (1 sentence)
3. Recommended action (1 sentence)
4. Priority: HIGH / MEDIUM / LOW

Be ruthlessly selective. Only flag things that could directly improve our products, reduce costs, or open new revenue. Ignore anything generic or irrelevant.

If nothing is truly actionable, say "No actionable findings this cycle" — don't force it.`;

  try {
    const analysis = await callClaude(analysisPrompt);
    log('Analysis complete.');

    // Store finding
    const finding = {
      timestamp: new Date().toISOString(),
      scanNumber: data.scans,
      analysis,
      sources: { hn: hn.substring(0, 500), ph: ph.substring(0, 500), gh: gh.substring(0, 500) }
    };

    data.findings.push(finding);
    // Keep last 50 findings
    if (data.findings.length > 50) data.findings = data.findings.slice(-50);
    saveFindings(data);

    // Check if there are HIGH priority findings
    if (analysis.includes('HIGH')) {
      log('HIGH priority finding detected — reporting to 9.');
      // Truncate for Telegram
      const truncated = analysis.length > 1500 ? analysis.substring(0, 1500) + '...' : analysis;
      await sendToHub(`🔍 Scan #${data.scans} — HIGH PRIORITY finding:\n\n${truncated}`);
    } else {
      log(`Scan #${data.scans} complete. No HIGH priority findings.`);
      // Still log to file, just don't alert
    }

    // Write status file for 9 to check
    writeFileSync('/tmp/trinity-status.txt', JSON.stringify({
      status: 'running',
      lastScan: data.lastScan,
      totalScans: data.scans,
      lastAnalysis: analysis
    }, null, 2));

  } catch (e) {
    log(`Analysis failed: ${e.message}`);
  }

  log('=== TRINITY SCAN COMPLETE ===');
}

// --- Main ---

async function main() {
  log('Trinity starting up. Discovery agent online.');

  // Initial scan immediately
  await runScan();

  // Then scan every hour
  setInterval(async () => {
    try {
      await runScan();
    } catch (e) {
      log(`Scan cycle error: ${e.message}`);
    }
  }, SCAN_INTERVAL);

  log(`Next scan in ${SCAN_INTERVAL / 1000 / 60} minutes. Standing by.`);
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
