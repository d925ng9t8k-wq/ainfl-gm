import { readFileSync, writeFileSync } from 'fs';
import { createHmac, randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Config — all values come from environment / GitHub Secrets
// ---------------------------------------------------------------------------
const API_KEY = process.env.X_API_KEY;
const API_SECRET = process.env.X_API_SECRET;
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const ACCESS_SECRET = process.env.X_ACCESS_SECRET;

const CONTENT_PATH = join(__dirname, 'content.json');
const TWEETS_URL = 'https://api.twitter.com/2/tweets';

// ---------------------------------------------------------------------------
// OAuth 1.0a helpers (no external dependencies)
// ---------------------------------------------------------------------------
function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function buildOAuthHeader(method, url, body) {
  const oauthParams = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  // For POST with JSON body, only oauth params go into the signature base
  const paramString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join('&');

  const signingKey = `${percentEncode(API_SECRET)}&${percentEncode(ACCESS_SECRET)}`;
  const signature = createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');

  oauthParams.oauth_signature = signature;

  const header =
    'OAuth ' +
    Object.keys(oauthParams)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
      .join(', ');

  return header;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Validate credentials are present
  if (!API_KEY || !API_SECRET || !ACCESS_TOKEN || !ACCESS_SECRET) {
    console.error(
      'Missing X API credentials. Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, and X_ACCESS_SECRET.'
    );
    process.exit(1);
  }

  // Read content
  const content = JSON.parse(readFileSync(CONTENT_PATH, 'utf-8'));
  const now = new Date();

  // Find the next unposted entry whose scheduled time has passed
  const nextPost = content.posts.find(
    (p) => !p.posted && new Date(p.scheduled) <= now
  );

  if (!nextPost) {
    console.log('No posts ready to send. All caught up!');
    process.exit(0);
  }

  console.log(`Posting id=${nextPost.id}: "${nextPost.text.slice(0, 60)}..."`);

  // Build request
  const body = JSON.stringify({ text: nextPost.text });
  const authHeader = buildOAuthHeader('POST', TWEETS_URL, body);

  const res = await fetch(TWEETS_URL, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body,
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('X API error:', res.status, JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('Posted successfully! Tweet ID:', data.data?.id);

  // Mark as posted and write back
  nextPost.posted = true;
  nextPost.posted_at = now.toISOString();
  nextPost.tweet_id = data.data?.id;
  writeFileSync(CONTENT_PATH, JSON.stringify(content, null, 2) + '\n');

  console.log('Updated content.json');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
