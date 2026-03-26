# Jules — Full Concept, Design & Build Plan
**Product:** Free Agents #1 — Personal AI Assistant
**For:** Jamie Bryant (and eventually anyone)
**Date:** March 26, 2026

---

## What Jules Is

Jules is a personal AI assistant that lives inside the messaging apps people already use. No app to download. No account to create. No learning curve. Jules just shows up in your messages and starts being useful.

Jules is NOT a chatbot. Jules is a family member who never forgets, never sleeps, and never drops the ball. Jules knows the kids' schedules, remembers what's in the pantry, tracks the weather, and answers the door when life gets complicated.

---

## Who Jules Is For

**Primary user:** Jamie Bryant
- Stay-at-home mom managing a household with two kids (Jude 11, Jacy 8)
- Not technical — uses her phone but doesn't configure apps or change settings
- Needs practical help with daily logistics, not a tech product
- Communicates via iMessage (her primary channel)

**The key insight:** Jamie would never download an AI app. She would never set up a chatbot. But if a helpful friend started texting her every morning with her day's schedule, she'd love it. That's Jules.

---

## Core Capabilities

### 1. Morning Briefing (Daily, 7:30 AM)
Automatic daily message with:
- Today's schedule (kids' activities, appointments, pickups)
- One reminder for something coming up this week
- Weather (practical, not data-heavy)

**Tone:** Helpful friend in the kitchen, not an AI product. Under 4 lines. No bullet points. Natural text.

*Template already built: docs/jules-morning-template.md*

### 2. Shopping List Management
- "Add milk to the list" → adds milk
- "What's on the list?" → reads it back, categorized by store section
- "Clear the list" → resets
- Persistent storage — list survives across conversations

### 3. Meal Suggestions
- "What should I make for dinner?"
- Considers: what's in the house, dietary preferences, kid-friendly filters, time available
- Suggests recipe with rough instructions and timing
- Can add missing ingredients to shopping list

### 4. Reminders & Follow-ups
- "Remind me about Jude's permission slip Friday"
- "Don't let me forget to call the dentist"
- Proactive follow-ups: "Did you get that dentist appointment scheduled?"

### 5. General Q&A
- "What time does Target close?"
- "How long does chicken need to thaw?"
- "What's the weather this weekend?"
- Conversational, helpful, no jargon

---

## Technical Architecture

```
Jamie (iMessage)
    ↓
Twilio Number ($1/mo)
    ↓
Jules Server (Node.js on Mac or VPS)
    ├── Message Router
    ├── Context Manager (family profile, preferences, lists)
    ├── Claude API (reasoning)
    ├── Weather API (OpenWeather, free tier)
    ├── Scheduler (cron for morning briefings)
    └── Storage (local JSON or SQLite)
    ↓
Twilio → iMessage (response back to Jamie)
```

**Why Twilio + iMessage:**
- Jamie texts a phone number. That's it. Zero friction.
- Twilio handles SMS/iMessage bridging ($1/month for a number)
- No apps, no accounts, no passwords
- Works on any phone

**Why NOT a direct iMessage integration:**
- Apple doesn't allow programmatic iMessage sending without Full Disk Access hacks
- Twilio is reliable, cheap, and works everywhere
- Number looks like a normal contact in Jamie's phone

---

## Context Profile (What Jules Knows)

Jules has a "memory" file that stores everything about the family:

```json
{
  "family": {
    "jamie": { "role": "mom", "preferences": ["no mushrooms", "easy meals"], "wakeTime": "6:30" },
    "jude": { "age": 11, "school": "elementary", "activities": ["basketball"], "favorites": ["pizza", "tacos"] },
    "jacy": { "age": 8, "school": "elementary", "activities": [], "favorites": ["mac and cheese"] },
    "jasson": { "role": "dad", "workSchedule": "variable" }
  },
  "home": {
    "location": "Cincinnati, OH",
    "zipCode": "45238",
    "groceryStore": "Kroger"
  },
  "preferences": {
    "mealStyle": "quick and easy",
    "dietaryRestrictions": ["no mushrooms"],
    "dinnerTime": "6:00 PM"
  },
  "shoppingList": [],
  "reminders": [],
  "calendar": []
}
```

This profile is what makes Jules useful vs. generic. A generic AI says "here are 10 dinner ideas." Jules says "chicken tacos — you have everything except tortillas, and Jude loves them."

---

## Build Plan

### Phase 1: MVP (2-4 hours of Tee work)

**Deliverables:**
1. Twilio number provisioned ($1/month)
2. Jules server running on Mac (Node.js)
3. Morning briefing working (cron job → Twilio → Jamie's iMessage)
4. Basic message handling (incoming messages → Claude API → response via Twilio)
5. Shopping list (add/view/clear via text)
6. Context profile loaded

**Test plan:**
1. Test with Jasson first (his number)
2. Refine tone and timing
3. Hand to Jamie
4. 30-day trial — capture what works, what breaks, what's missing

### Phase 2: Template System (1 week)

**Turn Jules into a configurable template:**
- Operator (Jasson) creates a new Jules for anyone
- Define: recipient, context profile, schedule, capabilities
- Deploy: generates Twilio number + server config
- Time to deploy: under 1 hour per new Jules

**Template types:**
- Household assistant (like Jamie's Jules)
- Business assistant (meeting reminders, daily standup, task tracker)
- Personal trainer (workout reminders, meal tracking)
- Property manager (tenant communications, maintenance tracking)

### Phase 3: Marketplace (1-3 months)

**Self-serve platform:**
- Browse agents by type
- Subscribe ($5-15/month)
- Connect phone number
- Agent starts texting
- Operator network (people who build and maintain specialized agents)
- Revenue split: 70% platform, 30% operator

---

## Revenue Model

| Phase | Revenue | Source |
|-------|---------|-------|
| Phase 1 | $0 | Internal POC |
| Phase 2 | $5-15/agent/month | Direct subscription |
| Phase 3 | Marketplace take rate | Platform + operator split |

**At scale:** 1,000 active agents × $10/month = $10K/month
**Marginal cost per agent:** ~$2-5/month (API tokens + Twilio)
**Gross margin:** 50-80%

---

## Competitive Positioning

| Competitor | Price | Friction | Personalization | Channel |
|-----------|-------|----------|-----------------|---------|
| Siri | Free | Low | Low | Voice only |
| ChatGPT | $20/mo | Medium (app) | None | App |
| Poke | $29-292/mo | High (negotiation) | Medium | iMessage |
| **Jules** | **$5-15/mo** | **Zero** | **High** | **iMessage/SMS** |

Jules is the only product that combines zero friction + deep personalization + existing channel delivery + consumer pricing. Nobody else is building this for the person who would never download an AI app.

---

## The Gifting Mechanic

The most important product insight: **Jules is designed to be given, not purchased.**

Jasson gives Jules to Jamie. A son gives Jules to his elderly mom. A manager gives Jules to their team. The person who sets it up is not the person who uses it.

This is the opposite of every other AI product on the market, which requires the end user to self-select, download, configure, and learn. Jules inverts that entire model.

The operator handles everything. The user just texts.

---

## Next Steps

1. Provision Twilio number
2. Build Jules server (Node.js, Claude API, scheduler)
3. Load Jamie's context profile
4. Test morning briefing with Jasson
5. Test shopping list and Q&A
6. Hand to Jamie
7. 30-day feedback loop
8. Begin Phase 2 template system

**Estimated build time:** 2-4 hours for MVP
**Estimated cost to operate:** $3-5/month (Twilio $1 + API ~$2-4)
**Owner approval needed:** Yes, before texting Jamie's phone
