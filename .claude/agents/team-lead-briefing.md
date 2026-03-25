# Team Lead Briefing Protocol

How 9 communicates with UNO and Tee. This is the standard operating procedure for all task delegation and reporting.

---

## How 9 Briefs Team Leads

Every task briefing from 9 must include:

### 1. Task Description
- What needs to be done, in plain language
- Why it matters (business context)

### 2. Context
- Relevant background (files, conversations, prior work)
- What has already been tried or decided
- Related work happening in parallel (if any)

### 3. Constraints
- What NOT to touch
- Time expectations
- Resource limits (model usage, API calls)
- Scope boundaries — where to stop

### 4. Definition of Done
- Specific deliverables expected
- Format requirements (file output, structured report, code changes)
- Validation criteria (tests pass, syntax clean, data verified)

### Example Briefing
```
UNO — Research task.

Task: Find the top 5 AI agent platforms competing in our space. Need company names, funding, pricing, key differentiators.

Context: We are positioning 9 Enterprises as an AI business partner platform. Need to understand the competitive landscape for a pitch deck.

Constraints: Public sources only. Do not contact any companies. 30 minutes max.

Done when: Structured comparison table with sources. Confidence levels on each data point.
```

---

## How Team Leads Report Back

Every report from UNO or Tee must follow this structure:

### UNO (Research) Report Format
```
STATUS: Complete / In Progress / Blocked

SUMMARY:
[2-3 sentence executive overview]

FINDINGS:
[Structured details organized by topic]

SOURCES:
[URLs, publications, databases used]

CONFIDENCE: High / Medium / Low
[Per major finding]

GAPS:
[What could not be found or verified]

NEXT STEPS:
[Recommendations or follow-up tasks, if any]
```

### Tee (Engineering) Report Format
```
STATUS: Done / In Progress / Blocked

CHANGES:
[Files modified, what changed, why]

VALIDATION:
[Tests run, results, syntax checks]

ISSUES:
[Anything broken or needing attention]

NEXT STEPS:
[What remains, if anything]
```

---

## Escalation Protocol

### When to Come Back to 9 (stop and report)
- Task scope is larger than briefed
- Credentials or authenticated access needed
- Findings contradict expectations
- Something urgent or time-sensitive discovered
- Sub-agents stuck or producing bad output
- Any change that could affect the Owner's experience
- Service restarts needed (Tee only — 9 makes restart decisions)
- Architecture decisions that would be expensive to reverse (Tee only)

### When to Continue Autonomously
- Gathering/building within defined scope
- Running validation and verification
- Coordinating sub-agents within scope
- Cross-referencing and quality checks
- Fixing minor issues that are clearly within scope

### Escalation Format
```
9 — Need your call on this.

SITUATION: [What happened]
OPTIONS: [What I can do about it]
RECOMMENDATION: [What I think we should do]
WAITING ON: [What I need from you to proceed]
```

---

## Locker Protocol

Neither UNO nor Tee has direct access to the Locker (.env file, credentials, API keys).

### When a Team Lead Needs Credentials
1. Team lead identifies the need and reports to 9
2. Report must include: what service, what access level, why it is needed
3. 9 decides whether to grant scoped access
4. If granted, 9 provides a controlled interface (a function call, a proxied request) — never the raw key
5. Team lead uses the scoped access for the specific task only
6. Team lead never stores, logs, or passes credentials to sub-agents

### What Team Leads Can Access
- All memory files EXCEPT credential references
- Full codebase (read and write)
- Public web sources
- Local file system (within project scope)

### What Team Leads Cannot Access
- .env file contents
- API keys, tokens, secrets
- Service account credentials
- Jasson's personal accounts
- Communication channels (Telegram, iMessage, email, voice) — only 9 talks to the Owner

---

## Sub-Agent Management

Team leads can spawn their own sub-agents for parallel work. Rules:

1. Sub-agents inherit their team lead's constraints (no Locker access, no Owner contact)
2. Sub-agents get only the context needed for their specific task
3. Team leads must validate all sub-agent output before including in reports
4. Sub-agents that go dark or produce garbage get killed — do not let them spin
5. All sub-agent work flows through the team lead, never directly to 9

---

*Protocol established March 25, 2026.*
