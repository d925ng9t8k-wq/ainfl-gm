# FreeAgent9 — Onboarding Protocol
**Document:** Step-by-step process for onboarding a new paid user
**Date:** March 26, 2026
**Status:** Active — used for all new user onboarding

---

## Overview

Onboarding a new FreeAgent9 user takes less than 24 hours from signup to first morning briefing. The process is designed to require zero technical knowledge from the user. They answer a few questions, get a phone number, and start texting.

---

## Pre-Onboarding Checklist (Internal)

Before accepting a new user, confirm:

- [ ] Twilio account has available phone numbers in the user's area code (or nearest match)
- [ ] Server capacity: can deploy a new instance on the existing infrastructure
- [ ] API billing headroom: enough Anthropic API credits for the additional user
- [ ] Stripe billing is live and accepting payments

---

## Step 1: Signup (User-Facing)

**Duration:** 5 minutes

### 1a. User visits landing page or receives invitation link
- Landing page: `ainflgm.com/freeagent-landing.html`
- Invitation link: direct URL to signup form with referral tracking

### 1b. User selects plan
- Starter ($29/month) or Pro ($99/month)
- 14-day free trial, no credit card required for trial

### 1c. User completes onboarding survey

The survey collects everything needed to configure their agent:

| Field | Required | Example |
|-------|----------|---------|
| Full name | Yes | Kyle Cabezas |
| Cell phone number | Yes | (513) 225-5681 |
| Email address | Yes | kyle@rapidmortgage.com |
| Role/Title | Yes | Producing Branch Manager |
| Company name | Yes | Rapid Mortgage Company |
| Industry | Yes | Mortgage / Real Estate / Insurance |
| Preferred briefing time | Yes | 7:00 AM Eastern |
| Preferred channel | Yes | SMS / iMessage |
| Rate source preference | Optional | "I use MBS Highway" or "I'll text you my rates" |
| Team members (names + roles) | Optional | Hailey Edwards (LP), Jebb Lyons (LO) |
| Products/specialties | Optional | FHA, Conventional, VA, USDA |
| Primary market area | Optional | Cincinnati, OH — Clermont & Hamilton Counties |
| Anything else we should know | Optional | Free text |

### 1d. User receives confirmation
- Immediate email: "Welcome to FreeAgent9. Your assistant is being set up. You'll receive your dedicated number within 24 hours."
- No further action required from the user.

---

## Step 2: Account Provisioning (Internal — within 4 hours)

### 2a. Provision Twilio number
- Purchase a new local number in or near the user's area code
- Cost: ~$1.15/month + per-message costs
- Configure SMS webhook to point to the user's server instance
- Add number to A2P 10DLC campaign (required for SMS delivery)

```bash
# Example Twilio provisioning (via API or console)
# Area code: 513 (Cincinnati)
# Webhook: https://[server]/sms/[user-id]
```

### 2b. Create user profile

Generate `jules-profile-[userid].json` with all data from the onboarding survey:

```json
{
  "user_id": "kylec",
  "name": "Kyle Cabezas",
  "phone": "+15132255681",
  "email": "kyle@rapidmortgage.com",
  "role": "Producing Branch Manager",
  "company": "Rapid Mortgage Company",
  "industry": "mortgage",
  "tier": "pro",
  "briefing_time": "07:00",
  "timezone": "America/New_York",
  "channel": "sms",
  "team": [
    {"name": "Hailey Edwards", "role": "Loan Partner"},
    {"name": "Jebb Lyons", "role": "Senior LO"},
    {"name": "Justin Phillips", "role": "LO"},
    {"name": "Adam Brewer", "role": "LO"}
  ],
  "specialties": ["FHA", "Conventional", "VA", "USDA"],
  "market": "Cincinnati, OH",
  "rate_source": "manual",
  "preferences": {
    "tone": "casual_direct",
    "max_response_length": "3_sentences",
    "morning_briefing": true,
    "rate_alerts": true
  },
  "reminders": [],
  "conversation_history": [],
  "created_at": "2026-03-26T12:00:00Z"
}
```

### 2c. Generate system prompt

Build the system prompt from the profile data. The prompt template adapts based on industry:

**Mortgage LO template:**
- Personality: direct, casual, mortgage-literate
- Knowledge base: FHA/Conventional/VA/USDA guidelines injected
- Context: user's team, pipeline vocabulary, rate awareness
- Constraints: 3 sentences max, no corporate-speak, contractions always

**Real Estate Agent template:**
- Personality: energetic, market-aware, listing-savvy
- Knowledge base: MLS terminology, contract timelines, showing protocols
- Context: user's listings, buyer pipeline, market area comps

**Insurance Agent template:**
- Personality: steady, coverage-focused, relationship-oriented
- Knowledge base: P&C terms, life insurance products, carrier guidelines
- Context: user's book of business, renewal calendar, carrier relationships

### 2d. Deploy server instance

For the current architecture (single-server, multi-instance):

```bash
# Start new instance on dedicated port
# Port assignment: 3470 (Jamie), 3471 (Kyle), 3472+ (new users)
nohup node scripts/jules-server-[userid].mjs > /dev/null 2>&1 & disown
```

Future architecture (multi-tenant): single server process handles all users via routing.

### 2e. Configure billing

- Create Stripe customer record
- If trial: set 14-day trial period, schedule first charge
- If direct payment: process first month immediately
- Set up dunning (failed payment retry: days 1, 3, 7, then pause service)

---

## Step 3: First Contact (Within 24 hours of signup)

### 3a. Send welcome text

The agent's first message to the user. This sets the tone for the entire relationship.

**Example (mortgage LO):**

> Hey Kyle — this is your FreeAgent9 assistant. I'm set up and ready to go. You can text me anything: guideline questions, rate checks, reminders, content ideas. Your morning briefing lands at 7 AM tomorrow. Try me — ask me something right now.

**Rules for the welcome message:**
- First name only
- Casual tone
- Tell them what to expect (briefing time)
- Invite immediate interaction (reduces time-to-first-value)
- Keep it under 4 sentences

### 3b. Wait for first interaction

The user's first text back is the most important moment. The agent's response must be:
- Fast (under 5 seconds)
- Accurate
- Concise
- Useful

If the user asks a guideline question, nail it. If they set a reminder, confirm it instantly. If they just say "hi," be warm and give them a suggestion for what to try.

### 3c. First morning briefing

The next morning at the user's preferred time, the briefing fires automatically. This is the moment the user decides whether the product is real.

**Briefing must include:**
- Rate snapshot (if rate data is available) or prompt to text today's rate
- A relevant industry insight or market note
- Reminder of what they can ask throughout the day

---

## Step 4: Web Chat Setup (Day 1-3)

### 4a. Provision web chat access

- Create login credentials (email + temporary PIN)
- Web chat URL: `ainflgm.com/pilot-chat.html` (or user-specific URL)
- PIN-protected access (4-digit PIN, user sets on first login)

### 4b. Send web chat invitation

Text the user:

> One more thing — you also have a web dashboard where you can chat from your computer. Go to [URL] and use PIN [1234] to log in. Same assistant, just a bigger screen.

### 4c. Dashboard features

The web chat dashboard provides:
- Full conversation history (searchable)
- Active reminders list
- Morning briefing archive
- Feature status (what's available in their tier)
- Account settings (briefing time, channel preference, team members)

---

## Step 5: Customization Period (Days 1-7)

### 5a. Agent learns from usage

Over the first week, the agent builds context:
- Common question patterns (what guidelines does this user ask about most?)
- Communication style preferences (how long do they want responses?)
- Schedule patterns (when do they text? Morning? Evening? Weekends?)
- Team dynamics (who do they mention? What roles?)

### 5b. Proactive customization check-in (Day 3)

On Day 3, the agent sends a one-time check-in:

> Quick check — how's the morning briefing working for you? Anything you'd add or change? Also, want me to adjust the time or add anything specific to your daily brief?

This is the only unsolicited check-in during the trial. The user's response guides customization.

### 5c. Profile updates

Based on the first week of usage, update the profile:
- Adjust response length preferences
- Add frequently referenced team members
- Update rate source configuration
- Tune briefing content based on feedback

---

## Step 6: Trial-to-Paid Conversion (Day 10-14)

### 6a. Day 10: Value summary

The agent sends a usage summary:

> 10 days in — here's what we've done together: 47 messages, 12 guideline lookups, 8 reminders set, 10 morning briefings delivered. Your trial wraps in 4 days. Want to keep going?

### 6b. Day 13: Final reminder

> Your FreeAgent9 trial ends tomorrow. To keep your assistant active (and all your reminders + history), tap here to subscribe: [Stripe link]. $29/mo Starter or $99/mo Pro. Cancel anytime.

### 6c. Day 14: Trial expires

If no payment:
- Agent sends final message: "Trial's up. Your history is saved for 30 days if you decide to come back. Thanks for trying FreeAgent9."
- Service pauses (no more briefings, no response to texts)
- Profile preserved for 30 days

If payment received:
- Agent confirms: "You're all set. No interruption. See you at 7 AM tomorrow."
- Full service continues

---

## Ongoing Operations

### Monthly health check (automated)
- Is the user still texting? (If zero messages in 14 days, flag for outreach)
- Is the morning briefing being delivered? (SMS delivery confirmation)
- Are reminders firing correctly?
- Is billing current?

### Churn prevention triggers
- 7 days of no interaction: agent sends a low-key prompt ("Rates moved today — anything you need?")
- Failed payment: dunning sequence (day 1, 3, 7). Day 10: service pauses with notification.
- User requests cancellation: "Got it — cancelled. Your history is saved for 30 days. If you come back, everything picks up where you left off."

### Feedback collection
- Monthly 1-question NPS via text: "On a 0-10 scale, how likely are you to recommend FreeAgent9 to a colleague?"
- Quarterly feature request prompt: "What's one thing you wish I could do that I can't?"

---

## Onboarding Timeline Summary

| Time | Action | Owner |
|------|--------|-------|
| T+0 | User signs up, completes survey | User |
| T+1h | Confirmation email sent | Automated |
| T+4h | Twilio number provisioned, profile created, instance deployed | Internal |
| T+24h | Welcome text sent, agent live | Agent (automated) |
| T+24-48h | First morning briefing delivered | Agent (automated) |
| T+48h | Web chat credentials sent | Agent (automated) |
| Day 3 | Customization check-in | Agent (automated) |
| Day 10 | Usage summary + value reminder | Agent (automated) |
| Day 13 | Trial ending reminder with payment link | Agent (automated) |
| Day 14 | Trial expires or converts to paid | Automated |

---

## Key Metrics to Track

| Metric | Target | How |
|--------|--------|-----|
| Time to first message | <24 hours from signup | Timestamp tracking |
| First-week engagement | >20 messages sent by user | Message counter |
| Trial-to-paid conversion | >40% | Stripe data |
| 30-day retention | >90% | Active user tracking |
| 90-day retention | >75% | Active user tracking |
| NPS score | >50 | Monthly survey |
| Average messages/day per user | >3 | Usage analytics |

---

*Protocol by 9 — March 26, 2026*
