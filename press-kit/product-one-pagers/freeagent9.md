# freeagent9 — Product Brief

**Status:** Private Pilot | **Category:** B2B SaaS / AI Personal Agents

---

## What It Is

freeagent9 is a personal AI agent platform for professionals. Each user gets their own fully autonomous AI assistant — trained on their context, operating around the clock, accessible via SMS. The agent proactively handles tasks, research, briefings, and communication without being asked.

## Target User

Professionals who need leverage without hiring staff. Initial focus: mortgage loan officers, branch managers, and real estate professionals. Expansion targets: financial advisors, insurance agents, solo founders.

## The Pilot

The current pilot runs with a single user: Kyle Cabezas, Branch Manager at Rapid Mortgage, Cincinnati, OH. The agent — built on the 9 infrastructure — provides:

- Daily morning briefings (mortgage rates, market conditions)
- FHA/VA/USDA guideline Q&A on demand
- Research and document summarization via SMS
- Calendar awareness and follow-up reminders

## Why SMS

Mortgage professionals are on the phone all day. They do not have time to open another app or log into another dashboard. SMS is the only channel that reaches them without adding friction. freeagent9 works where the user already is.

## Technology

- Node.js backend on Twilio SMS infrastructure
- Claude (Haiku for routine, Sonnet for complex) via Anthropic API
- User profiles in JSON (migrating to database-backed multi-tenant)
- LaunchAgent for process management on Mac host
- Runs 24/7 on 9enterprises infrastructure

## Business Model

- SaaS subscription: target $99/month per professional
- Pilot to paid conversion: 30-day pilot period with defined end date
- Stripe checkout for billing (in plan)
- Channel: direct to mortgage branch managers via Rapid Mortgage relationship

## Competitive Moat

Every freeagent9 agent is trained on the user's specific context — their clients, their market, their workflow. The agents are not generic chatbots; they are personalized to each professional's professional identity. This creates retention and switching cost that generic AI assistants cannot replicate.

## Key Gaps (honest assessment)

1. Single-tenant architecture: currently hardcoded to one user. Multi-tenant refactor required before scaling.
2. No Twilio webhook validation: security fix in backlog.
3. No billing infrastructure: needs Stripe before converting pilot to paid.

## Contact

captain@9enterprises.ai | Pilot inquiries accepted
