import { readFileSync, writeFileSync } from 'fs';
import { TwitterApi } from 'twitter-api-v2';

const CONTENT_PATH = new URL('../social/content.json', import.meta.url);

async function main() {
  // Read content file
  const content = JSON.parse(readFileSync(CONTENT_PATH, 'utf-8'));

  // Find the first unposted tweet
  const nextPost = content.posts.find(p => !p.posted);

  if (!nextPost) {
    console.log('All scheduled content has been posted');
    process.exit(0);
  }

  console.log(`Posting tweet id=${nextPost.id}: "${nextPost.text.slice(0, 60)}..."`);

  // Initialize Twitter client with OAuth 1.0a credentials
  const client = new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  });

  try {
    const result = await client.v2.tweet(nextPost.text);
    console.log(`Tweet posted successfully. Tweet ID: ${result.data.id}`);
  } catch (err) {
    console.error('Failed to post tweet:', err.message);
    if (err.data) {
      console.error('API response:', JSON.stringify(err.data, null, 2));
    }
    // Don't crash — exit cleanly so the workflow doesn't fail hard
    process.exit(0);
  }

  // Mark as posted with timestamp
  nextPost.posted = true;
  nextPost.postedAt = new Date().toISOString();

  // Write updated content back
  writeFileSync(CONTENT_PATH, JSON.stringify(content, null, 2) + '\n', 'utf-8');
  console.log('Updated content.json — marked post as posted.');
}

main();
