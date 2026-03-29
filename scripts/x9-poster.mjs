#!/usr/bin/env node
/**
 * x9-poster.mjs
 * Post tweets to X/Twitter via the v2 API.
 *
 * CLI usage:
 *   node scripts/x9-poster.mjs "tweet text here"
 *
 * Importable usage:
 *   import { postTweet } from './scripts/x9-poster.mjs';
 *   const url = await postTweet('tweet text here');
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { TwitterApi } from 'twitter-api-v2';

// ---------------------------------------------------------------------------
// Manual .env parser — no dotenv dependency required
// ---------------------------------------------------------------------------
function loadEnv(envPath) {
  let raw;
  try {
    raw = readFileSync(envPath, 'utf-8');
  } catch {
    throw new Error(`Could not read .env file at: ${envPath}`);
  }

  const vars = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

// ---------------------------------------------------------------------------
// Resolve project root (two levels up from this file)
// ---------------------------------------------------------------------------
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const ENV_PATH = resolve(PROJECT_ROOT, '.env');

// ---------------------------------------------------------------------------
// Build Twitter client from .env credentials
// ---------------------------------------------------------------------------
function buildClient() {
  const env = loadEnv(ENV_PATH);

  const required = ['X_API_KEY', 'X_API_KEY_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'];
  const missing = required.filter(k => !env[k]);
  if (missing.length) {
    throw new Error(`Missing X credentials in .env: ${missing.join(', ')}`);
  }

  return new TwitterApi({
    appKey: env.X_API_KEY,
    appSecret: env.X_API_KEY_SECRET,
    accessToken: env.X_ACCESS_TOKEN,
    accessSecret: env.X_ACCESS_TOKEN_SECRET,
  });
}

// ---------------------------------------------------------------------------
// Core exported function
// ---------------------------------------------------------------------------
/**
 * Post a tweet and return the public URL.
 * @param {string} text - Tweet text (max 280 chars)
 * @returns {Promise<string>} Tweet URL
 */
export async function postTweet(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Tweet text must be a non-empty string.');
  }
  if (text.length > 280) {
    throw new Error(`Tweet exceeds 280 characters (${text.length}).`);
  }

  const client = buildClient();
  const result = await client.v2.tweet(text);

  // Resolve the Twitter username for the URL
  const me = await client.v2.me();
  const username = me.data.username;
  const tweetId = result.data.id;
  const url = `https://x.com/${username}/status/${tweetId}`;

  return url;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const text = process.argv[2];

  if (!text) {
    console.error('Usage: node scripts/x9-poster.mjs "tweet text here"');
    process.exit(1);
  }

  postTweet(text)
    .then(url => {
      console.log('Tweet posted successfully.');
      console.log('URL:', url);
    })
    .catch(err => {
      console.error('Failed to post tweet:', err.message);
      if (err.data) {
        console.error('API response:', JSON.stringify(err.data, null, 2));
      }
      process.exit(1);
    });
}
