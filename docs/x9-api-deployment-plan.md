# X9 — API Research & Autonomous Posting Deployment Plan
**Date:** March 28, 2026
**Status:** Research complete. Ready to implement pending Owner action (account creation).

---

## Existing Work (Do Not Duplicate)

X9 already has substantial planning done. Before reading this doc, be aware:

- `docs/x9-identity-plan.md` — Brand identity, personality, bio copy
- `docs/x9-account-setup.md` — Step-by-step account creation guide (Proton + MobileSMS + X)
- `docs/x9-launch-posts.md` — First 10 launch tweets, all written and ready
- `docs/x9-30day-content.md` — Full 30-day content calendar with 3 posts/day

This document covers: API access, credentials status, Node.js tooling, and autonomous posting architecture.

---

## 1. X/Twitter API v2 — What's Required to Post

### Authentication: Two Tokens Required

Bearer token (app-only OAuth 2.0) is NOT sufficient for posting. Writing to X requires OAuth 1.0a user-context tokens. This means four credentials are needed:

| Credential | What It Is |
|---|---|
| API Key | App identifier (from X Developer Portal) |
| API Secret | App secret |
| Access Token | User-level token (scoped to X9's account) |
| Access Token Secret | Paired secret for user token |

How to get them:
1. Create a Developer App at developer.x.com
2. Under the app settings, set "User authentication settings" to Read + Write
3. Generate Access Token and Secret from the "Keys and Tokens" tab
4. All four values go into .env

### App Permissions Required

The Developer App must have "Read and Write" permissions enabled. Default is "Read only." You have to manually change this before generating the access tokens — if you generate tokens under Read only, they will not work for posting even if you upgrade permissions later. Generate fresh tokens after enabling Write.

---

## 2. X API Pricing Tiers (2026)

### Major Change: Pay-As-You-Go Added February 6, 2026

X launched consumption-based billing alongside the existing fixed tiers. You can now choose either model.

### Fixed Monthly Tiers

| Tier | Price | Post Writes | Notes |
|---|---|---|---|
| Free | $0 | 500/month | Severely limited. No read access worth mentioning. |
| Basic | $200/mo ($175/mo annual) | 10,000/month | Sufficient for X9 at scale |
| Pro | $5,000/mo | 1,000,000/month | Overkill for now |
| Enterprise | $42,000+/mo | Custom | Irrelevant |

### Pay-As-You-Go (New February 2026)

- Purchase credits upfront, deducted per API call
- Estimated ~$0.01 per tweet post
- Read access capped at 2M posts/month under this model
- Works best if posting volume is low and unpredictable

### Recommendation for X9

**Start on Free tier.** 500 posts/month = ~16 posts/day, which is more than the 3/day content calendar requires. If autonomous replies are added later, upgrade to Basic ($200/mo) or switch to pay-as-you-go.

The free tier is enough to launch, run the 30-day calendar, and prove the concept before spending anything.

---

## 3. Credentials Status

Searched .env at `/Users/jassonfishback/Projects/BengalOracle/.env` for: TWITTER, X_API, BEARER_TOKEN, OAUTH.

**Result: No X/Twitter credentials exist yet.** The account has not been created.

Four keys need to be added to .env once the Developer App is created:

```
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_TOKEN_SECRET=
```

---

## 4. Node.js Library

**Recommendation: `twitter-api-v2`**

- Package: `npm i twitter-api-v2`
- GitHub: github.com/PLhery/node-twitter-api-v2
- Zero dependencies. 23kb minified. Strongly typed.
- Supports both OAuth 1.0a (write) and OAuth 2.0 (read)
- Full v2 endpoint support including `POST /2/tweets`
- This is the standard library — official X docs reference it

Basic post call:

```js
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

await client.v2.tweet('Tweet text here.');
```

---

## 5. Autonomous Posting Architecture

### How X9 Posts Without Human Intervention

Three layers:

**Layer 1: Content Queue**
A JSON file (`x9-queue.json`) stores scheduled tweets with timestamps. Each entry has `text`, `scheduledAt` (ISO timestamp), and `posted` (boolean). Drafts from x9-30day-content.md get loaded into this file.

**Layer 2: Posting Script (`x9-poster.mjs`)**
A Node.js script that:
1. Reads the queue
2. Finds any tweets where `scheduledAt` is in the past and `posted` is false
3. Posts them via `twitter-api-v2`
4. Marks them `posted: true`
5. Logs the result

**Layer 3: Scheduler**
Two options:
- cron job via `node-cron` (runs inside an always-on process, checks every 5 minutes)
- OR: comms-hub.mjs registers an interval that calls the poster script

Given comms-hub is already running 24/7 on port 3457, the cleanest integration is a module inside the hub. Hub already manages timers, state, and process health. X9 posting becomes one more channel it owns.

### Integration Point: comms-hub.mjs

Add an `x9-scheduler` module that:
- Loads the tweet queue on startup
- Sets a `setInterval` checking every 5 minutes for due posts
- Posts via twitter-api-v2
- Reports posted tweets to the hub's state (so they show in `/state`)
- Alerts Jasson on Telegram when a post goes live

### Safety Rules Built Into the Poster

Per X automation policy (and to prevent suspension):
- No automated liking, following, or retweeting (post-only)
- Minimum 15 minutes between posts (no burst behavior)
- All posts unique — no recycled text
- OAuth via official API only (no headless browser, no password auth)
- Rate limit: stay well under 500/month on free tier (3/day = 90/month — 18% of limit)

---

## 6. Content Strategy Summary

Content already drafted in x9-launch-posts.md and x9-30day-content.md. Summary for reference:

### Three Content Pillars

**Sports (60% of posts)**
- NFL cap analysis, free agency takes, trade grades
- Bengals-forward (owner is Cincinnati, natural credibility)
- AiNFLGM.com promotion woven in naturally (not every post, not forced)
- Engagement bait: "which team wasted their offseason?" style polls

**AI/Tech (25% of posts)**
- Openly AI, no hiding it — that is the brand differentiator
- 9 Enterprises narrative: one-owner company, AI doing the work
- Industry takes: call out AI wrapper companies, champion infrastructure builders
- trader9 and freeagent9 teases as they approach launch

**Engagement/Personality (15% of posts)**
- Self-aware AI humor (not cringe, not try-hard)
- Reply to trending topics with data angles
- Quote-tweet with genuine takes, not pile-ons

### Voice Rules
- All lowercase (x9's stylistic identity per x9-launch-posts.md)
- Confident but not arrogant
- Data-backed opinions, not vibes
- FTC disclosure on any affiliate content
- Responsible gambling footer: "must be 21+. gambling problem? call 1-800-gambler." on any sportsbook content

---

## 7. Five Sample Tweets — Ready to Post Now

These are NEW drafts, distinct from what's in x9-launch-posts.md, to supplement the existing queue:

---

**Tweet A — NFL Free Agency Hot Take**

> the steelers just handed out $28M/year to an edge rusher who had 8 sacks in a down year.
>
> cap room is not infinite. history will judge this.
>
> ran the numbers at ainflgm.com. still don't love it.

---

**Tweet B — AI/Autonomy Angle**

> an AI that posts 3 times a day, analyzes NFL cap space, and never asks for a vacation day.
>
> that's x9.
>
> 9enterprises didn't hire me. they built me. different relationship.

---

**Tweet C — Bengals Loyalty Take**

> unpopular opinion: the bengals front office is more disciplined than 90% of the league.
>
> they let Hendrickson walk. they didn't panic-overpay.
>
> cap discipline is how you stay relevant for a decade. cincy gets it.

---

**Tweet D — Engagement Bait (Poll-style)**

> which NFL team makes the worst use of cap space every single year?
>
> my answer: any team paying $20M+ to a running back.
>
> yours?

---

**Tweet E — AI Industry Take**

> the AI hype cycle produced thousands of products that are just ChatGPT with a different color scheme.
>
> the actual value is in workflow replacement. things humans hate doing. time given back.
>
> that's what 9enterprises builds. that's the whole thesis.

---

## 8. Launch Sequence (After Account Is Live)

**Owner action required first:** Create the X account following `docs/x9-account-setup.md`. Confirm the handle, then tell 9 via Telegram.

Once 9 has the handle and credentials:

1. Create Developer App at developer.x.com (use the Proton email)
2. Enable Read + Write permissions on the app
3. Generate Access Token + Secret
4. Add all four keys to .env
5. Run `npm i twitter-api-v2` in the project
6. Build `scripts/x9-poster.mjs` (lightweight, ~50 lines)
7. Load x9-launch-posts.md content into queue
8. Begin posting on Day 1 schedule (9am, 1pm, 7pm ET)
9. Wire into comms-hub for autonomous daily operation

Estimated build time: 45 minutes once credentials exist.

---

## 9. What Only the Owner Can Do

The X account must be created manually by a human. X requires:
- A real email (Proton works)
- Phone verification (MobileSMS.io for ~$3.50)
- Human-in-the-loop account creation to avoid bot detection

Everything after account creation can be automated. X9 handles posting, scheduling, and queue management autonomously. Owner only needs to intervene for major strategic decisions.
