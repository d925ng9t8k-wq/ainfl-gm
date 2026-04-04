#!/usr/bin/env node
/**
 * youtube-transcript.mjs — Zero-dependency YouTube transcript extractor
 * Uses only built-in Node.js modules (https, zlib, url).
 *
 * Exports: getTranscript(url) → { title, channel, transcript, duration, videoId }
 * CLI:     node scripts/youtube-transcript.mjs <youtube_url>
 */

import https from 'https';
import zlib from 'zlib';
import { URL } from 'url';

const ANDROID_CONTEXT = { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } };
const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 12) gzip';

function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    if (u.searchParams.has('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(?:embed|v|shorts)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  } catch {}
  const m = url.match(/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        ...headers,
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const cookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        return httpsGet(res.headers.location, { ...headers, Cookie: cookies }).then(r => resolve({ ...r, cookies })).catch(reject);
      }
      const setCookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      const chunks = [];
      const stream = res.headers['content-encoding'] === 'gzip' ? res.pipe(zlib.createGunzip()) : res;
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), cookies: setCookies }));
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Request timeout')));
  });
}

function httpsPost(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Request timeout')));
    req.write(body);
    req.end();
  });
}

function parseXmlTranscript(xml) {
  const texts = [];
  const re = /<p[^>]*t="[\d]+"[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const text = m[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
      .replace(/<[^>]+>/g, '').trim();
    if (text) texts.push(text);
  }
  return texts.join(' ').replace(/\s+/g, ' ').trim();
}

export async function getTranscript(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error(`Cannot parse video ID from: ${url}`);

  // Step 1: Fetch page HTML — captures session cookies YouTube requires
  const { body: html, cookies } = await httpsGet(`https://www.youtube.com/watch?v=${videoId}`);

  // Step 2: Extract InnerTube API key from page
  const keyMatch = html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/);
  const apiKey = keyMatch?.[1] ?? 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

  // Step 3: POST to InnerTube with ANDROID client + session cookies
  // ANDROID client returns caption URLs without the exp=xpe PO token requirement
  const playerData = await httpsPost(
    `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`,
    { context: ANDROID_CONTEXT, videoId },
    { 'User-Agent': ANDROID_UA, 'Accept-Language': 'en-US', Cookie: cookies }
  );

  const details = playerData?.videoDetails ?? {};
  const title = details.title ?? 'Unknown';
  const channel = details.author ?? 'Unknown';
  const duration = parseInt(details.lengthSeconds ?? '0', 10);

  const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) {
    return { title, channel, transcript: null, duration, videoId, error: 'No captions available' };
  }

  // Prefer English auto-generated, then any English, then first available
  const pick = tracks.find(t => t.languageCode === 'en' && t.kind === 'asr')
    ?? tracks.find(t => t.languageCode?.startsWith('en'))
    ?? tracks[0];

  // Step 4: Fetch XML transcript with session cookies
  const { body: xml } = await httpsGet(pick.baseUrl, { Cookie: cookies });
  const transcript = parseXmlTranscript(xml);

  return { title, channel, transcript, duration, videoId };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node scripts/youtube-transcript.mjs <youtube_url>');
    process.exit(1);
  }
  getTranscript(url).then(({ title, channel, duration, videoId, transcript, error }) => {
    console.log(`Title:   ${title}`);
    console.log(`Channel: ${channel}`);
    console.log(`ID:      ${videoId}`);
    console.log(`Duration: ${Math.floor(duration / 60)}m ${duration % 60}s`);
    if (error) { console.error(`\nError: ${error}`); process.exit(1); }
    console.log(`\nTranscript (${transcript.split(' ').length} words):\n`);
    console.log(transcript);
  }).catch(e => { console.error(`Fatal: ${e.message}`); process.exit(1); });
}
