# AiNFL GM — Automated X/Twitter Posting

This directory contains the infrastructure for automatically posting to X (Twitter) on a schedule using GitHub Actions and the X API v2.

## How It Works

1. **`content.json`** — Contains 30 pre-written posts with scheduled dates.
2. **`post.js`** — Node.js script that reads the next unposted entry, posts it via the X API v2, and marks it as posted.
3. **`.github/workflows/social-posts.yml`** — GitHub Actions workflow that runs twice daily (10 AM and 6 PM ET) and calls `post.js`.

Each time the workflow runs, it posts ONE tweet (the next unposted entry whose scheduled time has passed), then commits the updated `content.json` back to the repo so the same post is never sent twice.

## Setup: X API Credentials

### 1. Create an X Developer Account

1. Go to [developer.x.com](https://developer.x.com) and sign in with the account that will post tweets.
2. Apply for a developer account (Free tier is sufficient for posting).
3. Create a **Project** and an **App** inside it.

### 2. Set App Permissions

1. In your app's settings, set **User authentication settings**:
   - App permissions: **Read and Write**
   - Type of App: **Web App, Automated App or Bot**
   - Callback URL: `https://example.com` (not used, but required)
   - Website URL: `https://ainflgm.com`

### 3. Generate Keys and Tokens

Under your app's "Keys and Tokens" tab, generate:

| Token | GitHub Secret Name |
|-------|-------------------|
| API Key | `X_API_KEY` |
| API Key Secret | `X_API_SECRET` |
| Access Token | `X_ACCESS_TOKEN` |
| Access Token Secret | `X_ACCESS_SECRET` |

Make sure the Access Token has **Read and Write** permissions. If it was generated before you changed permissions, regenerate it.

### 4. Add Secrets to GitHub

1. Go to your repo's **Settings > Secrets and variables > Actions**.
2. Add each of the four secrets listed above.

### 5. Enable the Workflow

The workflow is already defined in `.github/workflows/social-posts.yml`. Once secrets are added, it will run automatically on the cron schedule.

You can also trigger it manually from the **Actions** tab using the "Run workflow" button.

## Alternative: RSS-to-Social Bridge

If you prefer not to use the X API directly, you can use the RSS feed at `/public/feed.xml` with a service like:

- **[dlvr.it](https://dlvr.it)** — Monitors RSS feeds and auto-posts new items to X
- **[IFTTT](https://ifttt.com)** — "If new RSS item, then post to X"
- **[Buffer](https://buffer.com)** — RSS feed integration for social scheduling
- **[Zapier](https://zapier.com)** — RSS trigger to X action

Simply point any of these services at `https://ainflgm.com/feed.xml`.

## Adding More Posts

Edit `content.json` and add new entries to the `posts` array:

```json
{
  "id": 31,
  "text": "Your tweet text here (max 280 characters)",
  "posted": false,
  "scheduled": "2026-04-03T10:00:00"
}
```

The script picks the next unposted entry whose `scheduled` time has passed, so ordering and IDs don't strictly matter — but keeping them sequential makes it easier to manage.

## Local Testing

You can test the posting script locally (it will actually post if credentials are valid):

```bash
export X_API_KEY="your-key"
export X_API_SECRET="your-secret"
export X_ACCESS_TOKEN="your-token"
export X_ACCESS_SECRET="your-token-secret"
node social/post.js
```

## Dry Run

To test without actually posting, temporarily comment out the `fetch` call in `post.js` and add a `console.log` instead.
