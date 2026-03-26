#!/usr/bin/env node

/**
 * FHA Underwriter POC — CLI tool
 * Usage: node mortgage-ai/fha-agent.mjs "What is the minimum credit score for FHA?"
 *
 * Loads API key from .env in the project root (one directory up from mortgage-ai/).
 * Uses claude-haiku-4-5-20251001 for speed and cost efficiency.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Load API key from ../.env (manual parse, no dotenv dependency) ---
function loadEnv(envPath) {
  try {
    const raw = readFileSync(envPath, 'utf8');
    const env = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      env[key] = val;
    }
    return env;
  } catch (err) {
    throw new Error(`Could not read .env at ${envPath}: ${err.message}`);
  }
}

// --- Load system prompt ---
function loadSystemPrompt() {
  const promptPath = join(__dirname, 'fha-system-prompt.md');
  try {
    return readFileSync(promptPath, 'utf8');
  } catch (err) {
    throw new Error(`Could not read fha-system-prompt.md: ${err.message}`);
  }
}

// --- Call Claude API via raw fetch ---
async function askFHA(question, apiKey, systemPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: question,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// --- Main ---
async function main() {
  const question = process.argv.slice(2).join(' ').trim();

  if (!question) {
    console.error('Usage: node mortgage-ai/fha-agent.mjs "Your FHA question here"');
    console.error('Example: node mortgage-ai/fha-agent.mjs "What is the minimum down payment for FHA?"');
    process.exit(1);
  }

  const envPath = join(__dirname, '..', '.env');
  const env = loadEnv(envPath);
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY not found in .env');
    process.exit(1);
  }

  const systemPrompt = loadSystemPrompt();

  console.log(`\nQuestion: ${question}\n`);
  console.log('---');

  try {
    const answer = await askFHA(question, apiKey, systemPrompt);
    console.log(answer);
    console.log('\n---');
    console.log('Source: HUD Handbook 4000.1 | Always verify against current Mortgagee Letters');
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
