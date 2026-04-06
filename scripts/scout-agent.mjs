#!/usr/bin/env node
/**
 * SCOUT — Audit & Discovery Agent (Persistent)
 * Continuous universe health scoring. Re-runs gold standard dimensions.
 * Monitors product health, brand consistency, user experience gaps.
 */

import { runAgent, shell, ROOT } from './agent-base.mjs';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const workQueue = [
  {
    id: 'ainflgm-live-audit',
    priority: 1,
    title: 'Audit ainflgm.com live site health',
    description: 'Check HTTP status, load time, SSL cert, sitemap, robots.txt, viewport meta, and all tool pages for errors. Draft window April 23-25 makes this urgent.',
    dimension: 'User Experience'
  },
  {
    id: 'brand-consistency-scan',
    priority: 2,
    title: 'Scan all public pages for brand consistency',
    description: 'Check ainflgm.com pages for consistent branding, broken links, dead images, mixed content warnings.',
    dimension: 'Brand / Design'
  },
  {
    id: 'documentation-coverage',
    priority: 3,
    title: 'Audit documentation coverage',
    description: 'Check which products/services have README, runbook, user guide, API docs. Flag gaps per gold standard rubric.',
    dimension: 'Documentation'
  },
  {
    id: 'business-model-audit',
    priority: 4,
    title: 'Audit revenue readiness across all products',
    description: 'For each product: is there pricing defined? Payment integration? User tracking? Revenue path documented?',
    dimension: 'Business Model'
  },
  {
    id: 'universe-health-rescore',
    priority: 5,
    title: 'Re-score universe health against gold standard rubric',
    description: 'Using all audit findings from Wendy, FORT, Tee, and SCOUT, produce an updated universe health score (target: improvement from 42.8/100 baseline).',
    dimension: 'Overall'
  }
];

async function gatherEvidence(taskId) {
  const evidence = {};

  if (taskId === 'ainflgm-live-audit') {
    evidence.httpStatus = shell(`curl -s -o /dev/null -w "HTTP %{http_code} | Size: %{size_download}B | Time: %{time_total}s | SSL: %{ssl_verify_result}" --max-time 10 https://ainflgm.com`);
    evidence.sitemap = shell(`curl -s https://ainflgm.com/sitemap.xml 2>/dev/null | grep "<loc>" | head -20`);
    evidence.robotsTxt = shell(`curl -s https://ainflgm.com/robots.txt 2>/dev/null | head -20`);
    evidence.viewportMeta = shell(`curl -s https://ainflgm.com | grep -i "viewport" | head -3`);
    // Check each tool page
    const pages = shell(`curl -s https://ainflgm.com/sitemap.xml 2>/dev/null | grep -oP '(?<=<loc>)[^<]+' | head -20`);
    if (pages && !pages.startsWith('[ERROR')) {
      const urls = pages.split('\n').filter(u => u.startsWith('http'));
      for (const url of urls.slice(0, 15)) {
        const name = url.split('/').pop() || 'index';
        evidence[`page_${name}`] = shell(`curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${url}"`);
      }
    }
    evidence.mediaQueries = shell(`grep -c "@media" dist/*.html 2>/dev/null | head -20`);
  }

  if (taskId === 'brand-consistency-scan') {
    evidence.htmlPages = shell(`ls dist/*.html 2>/dev/null`);
    evidence.titleTags = shell(`for f in dist/*.html; do echo "=== $(basename $f) ==="; grep -o "<title>[^<]*</title>" "$f" 2>/dev/null; done | head -40`);
    evidence.metaDescriptions = shell(`for f in dist/*.html; do echo "=== $(basename $f) ==="; grep -o 'meta.*description.*content="[^"]*"' "$f" 2>/dev/null; done | head -40`);
    evidence.brandNames = shell(`grep -ohP "(AiNFLGM|PlayAiGM|9 Enterprises|ainflgm|playaigm)" dist/*.html 2>/dev/null | sort | uniq -c | sort -rn`);
    evidence.brokenLinks = shell(`grep -oh 'href="[^"]*"' dist/*.html 2>/dev/null | sort -u | head -30`);
  }

  if (taskId === 'documentation-coverage') {
    evidence.readmes = shell(`find . -name "README.md" -not -path "*/node_modules/*" -not -path "*/.venv/*" 2>/dev/null`);
    evidence.docsDir = shell(`ls docs/ 2>/dev/null`);
    evidence.apiDocs = shell(`find . -name "*api*doc*" -o -name "*swagger*" -o -name "*openapi*" 2>/dev/null | grep -v node_modules | head -10`);
    evidence.runbooks = shell(`find . -name "*runbook*" -o -name "*playbook*" -o -name "*incident*" 2>/dev/null | grep -v node_modules | head -10`);
    evidence.userGuides = shell(`find . -name "*guide*" -o -name "*tutorial*" -o -name "*getting-started*" 2>/dev/null | grep -v node_modules | head -10`);
  }

  if (taskId === 'business-model-audit') {
    evidence.stripeIntegration = shell(`grep -rl "stripe\\|payment\\|billing\\|subscription" scripts/*.mjs 2>/dev/null`);
    evidence.adsensePresence = shell(`grep -c "adsbygoogle\\|ca-pub" dist/*.html 2>/dev/null | grep -v ":0$"`);
    evidence.pricingPages = shell(`grep -rl "pricing\\|price\\|plan\\|tier" dist/*.html 2>/dev/null`);
    evidence.analyticsPresence = shell(`grep -c "umami\\|analytics\\|gtag\\|ga(" dist/*.html 2>/dev/null | grep -v ":0$"`);
    evidence.userTracking = shell(`grep -rl "user.*track\\|session.*track\\|visitor\\|engagement" scripts/*.mjs 2>/dev/null`);
  }

  if (taskId === 'universe-health-rescore') {
    // Collect all completed audit reports
    evidence.wendyReports = shell(`ls logs/wendy-task-*.md 2>/dev/null`);
    evidence.fortReports = shell(`ls logs/fort-task-*.md 2>/dev/null`);
    evidence.teeReports = shell(`ls logs/tee-task-*.md 2>/dev/null`);
    evidence.scoutReports = shell(`ls logs/scout-task-*.md 2>/dev/null`);
    // Read summaries from each
    const reportFiles = shell(`ls logs/wendy-task-*.md logs/fort-task-*.md logs/tee-task-*.md logs/scout-task-*.md 2>/dev/null`).split('\n').filter(Boolean);
    for (const f of reportFiles.slice(0, 15)) {
      const name = f.split('/').pop().replace('.md', '');
      // Read just the findings/recommendations sections
      const content = existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '';
      const findingsIdx = content.indexOf('FINDINGS');
      if (findingsIdx > -1) {
        evidence[`report_${name}`] = content.substring(findingsIdx, findingsIdx + 1000);
      } else {
        evidence[`report_${name}`] = content.substring(0, 500);
      }
    }
    evidence.baselineScore = '42.8/100 (SCOUT audit April 5, 2026)';
    evidence.runningProcesses = shell(`ps aux | grep -E "node.*scripts/" | grep -v grep | wc -l`);
    evidence.teamAgents = shell(`for p in 3480 3481 3483 3484; do echo "Port $p: $(curl -s --max-time 2 http://localhost:$p/health 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get(\"displayName\",\"?\"), d.get(\"completedTasks\",0), \"/\", d.get(\"totalTasks\",0))' 2>/dev/null || echo 'DOWN')"; done`);
  }

  return evidence;
}

runAgent({
  name: 'scout',
  displayName: 'SCOUT',
  port: 3484,
  role: 'Audit & Discovery specialist. Continuous universe health scoring, brand consistency, documentation coverage, business model readiness.',
  workQueue,
  gatherEvidence
}).catch(e => { console.error(`SCOUT FATAL: ${e.message}`); process.exit(1); });
