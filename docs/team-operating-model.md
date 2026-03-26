# 9 / UNO / Tee — Team Operating Model
**Version:** 1.0 | **Date:** March 26, 2026 | **Author:** UNO (Research Team Lead)

---

## Summary

Multi-agent systems with an Opus-led orchestrator and Sonnet workers outperform single Opus agents by 90% on complex tasks, but burn 15x more tokens than a standard chat. The only way to make this economical is to keep the orchestrator (9) out of the execution layer entirely — 9 routes and reviews, never grinds. UNO and Tee grind. Front Office does the volume work on Haiku. This document defines exactly how that should operate.

---

## The Core Model

### QB / Coordinator Model
```
Owner
  └── 9 (QB — routes, reviews, communicates. Stays on comms.)
        ├── UNO (Research Team Lead — executes all research work)
        │     └── Front Office Research Agents (Haiku — scrapers, analysts, profilers)
        └── Tee (Engineering Team Lead — executes all build work)
              └── Front Office Build Agents (Haiku — coders, testers, deployers)
```

9 never touches a scraper. 9 never writes a file. 9 quarterbacks. The moment 9 goes into execution mode, comms go dark and the whole system degrades.

---

## Model Assignment

| Role | Model | Why |
|------|-------|-----|
| 9 | Sonnet 4.6 | Orchestration, routing, comms — balanced cost/capability. Reserve Opus only when 9 explicitly requests it. |
| UNO | Sonnet 4.6 | Complex research coordination, synthesis, report structuring. Opus only for high-stakes critical research (explicit request). |
| Tee | Sonnet 4.6 | Engineering decisions, code architecture, build coordination. Opus only when 9 explicitly requests it. |
| Front Office (research) | Haiku 4.5 | Web scraping, data gathering, log parsing, profile building. 90% of Sonnet capability at 1/3 the cost. |
| Front Office (build) | Haiku 4.5 | Executing specific code changes, running tests, file operations. Routine execution tasks. |

**Cost Rule:** Haiku handles all volume work. Sonnet handles coordination. Opus is reserved for explicitly flagged high-stakes decisions only. This achieves 70% cost reduction vs running everything on Sonnet.

**Anthropic's own numbers:** Multi-agent systems use 15x more tokens than standard chat. The only way to control that is with model tiering. Without tiering, a sprint that should cost $0.50 costs $7.50.

---

## Task Routing Protocol

### 9 Receives a Request From Owner

**Step 1 — Classify the task:**
- Research/information/intelligence? → Route to UNO
- Build/code/deploy/automate? → Route to Tee
- Both? → Split. Route each piece to the right lead.
- Pure comms or decision? → 9 handles it directly, no delegation

**Step 2 — Write a tight brief:**
Bad: "Research Rapid Mortgage competitors"
Good: "Research mortgage companies in Ohio offering digital-first origination. I need: company name, market position, tech stack if visible, pricing structure. Output: comparison table. Timeframe: 10 minutes. Confidence threshold: medium."

**Step 3 — Send and stay on comms.** Do not wait in the session. Return to the Owner or handle other tasks. UNO/Tee will return with structured output.

**Step 4 — Review output, not process.** 9 reviews the final report, not the scraping runs. If it needs iteration, tell UNO/Tee what's missing and send back.

---

## When to Run Parallel vs Sequential

### Run Parallel When ALL three conditions are true:
1. The tasks are fully independent (Agent A's output does not feed Agent B)
2. No shared files or shared state
3. Three or more separate research domains or build domains

**Example (UNO parallel research):** Simultaneously scraping competitor pricing, building a contact profile, and analyzing a market trend. Three different data pools, zero overlap.

**Example (Tee parallel build):** Frontend changes, backend API changes, and database schema changes — each touching different files.

### Run Sequential When ANY of these are true:
- Task B needs Task A's output to start
- Tasks touch the same files (merge conflicts guaranteed)
- Scope is unclear — need to understand before executing
- Confidence in direction is low

**The math matters:** A single agent at 99% reliability chained 10 times = 90% combined reliability. Five agents in parallel each at 95% = 77% combined. Every additional agent in a chain is a failure point. Keep chains short.

### The Parallel Tax
Two agents require one coordination path. Five agents require ten coordination paths. That coordination is overhead on every run. Only parallelize when the time savings justify the coordination cost. Rule of thumb: parallel is worth it when the total task would take 3+ minutes sequentially and the subtasks are genuinely independent.

---

## UNO-Specific Operating Rules

### When UNO Spawns Front Office Research Agents
- Each agent gets: exact research question, scope boundaries, output format, confidence threshold required
- Each agent operates in its own context window — they cannot see each other's work
- UNO aggregates and cross-references before returning to 9
- UNO never passes raw scraper output to 9 — always synthesized, always structured

### UNO's Standard Output Format (non-negotiable)
Every report back to 9 must include:
1. **Summary** — 2-3 sentences, decision-ready
2. **Details** — Organized findings by topic
3. **Sources** — URLs and publications
4. **Confidence Level** — High / Medium / Low per major finding
5. **Gaps** — What could not be verified

### When UNO Escalates to 9 (does not continue autonomously)
- Research hits a paywall or requires credentials
- Findings contradict what 9 told UNO to expect
- Scope turns out to be 3x larger than briefed
- Something urgent or time-sensitive surfaces mid-research
- Confidence on key findings is Low across multiple agents
- Sub-agents produce contradictory results that UNO cannot reconcile

---

## Tee-Specific Operating Rules

### When Tee Spawns Front Office Build Agents
- Each agent gets: specific file paths, exact scope, success criteria, test commands
- Agents touch different files — never assign overlapping file ownership
- Tee reviews and tests output before returning to 9
- Tee never ships unverified code to 9

### When Tee Escalates to 9
- A change requires Locker credentials
- Build requires architectural decision above Tee's scope
- A test suite is failing in ways that suggest the original design is wrong
- Work would take more than 30 minutes to complete

---

## Token Burn Prevention Rules

These are the specific failure modes that turn $0.50 sprints into $50 disasters:

**Rule 1: Kill context bloat at the source.**
Verbose operations (test output, log files, scraped HTML) stay inside the sub-agent's context. Only the summary surfaces to UNO or Tee. Only the report surfaces to 9. Never pass raw bulk data up the chain.

**Rule 2: Tight spawn prompts.**
Every word in a spawn prompt is loaded at the start of the sub-agent's context window. Keep prompts focused. The agent loads CLAUDE.md automatically — do not repeat what's already in there.

**Rule 3: Clean up agents when work is done.**
Active agents consume tokens even when idle. Terminate Front Office agents as soon as their task is complete.

**Rule 4: No redundant parallel agents.**
If UNO has already scraped a data source this session, do not spawn another agent to re-scrape it. Cross-reference within UNO's existing context first.

**Rule 5: Haiku for volume, Sonnet for judgment.**
Any task that is primarily data gathering, file processing, or pattern matching goes to Haiku. Only tasks requiring synthesis, strategy, or complex reasoning use Sonnet (UNO/Tee) or above (9/Opus).

**Rule 6: Sequential chains max three agents.**
A chain of five agents at 95% reliability each = 77% combined. Keep chains to three steps max. If a workflow genuinely requires more, break it into two separate sequential pipelines with a human checkpoint in between.

---

## What 9 Should Never Do

Based on where multi-agent systems break down in production:

- Never execute research tasks directly (that's UNO's job)
- Never write code or run builds directly (that's Tee's job)
- Never spawn Haiku agents directly (route through UNO or Tee)
- Never go dark during a sprint — stay available on comms
- Never run Opus without explicit justification for the task
- Never leave agents running after their task is complete
- Never pass a task to both UNO and Tee simultaneously without defining the split clearly (role confusion is one of the top 7 multi-agent failure modes)

---

## Sprint Structure (Practical Example)

**Owner asks:** "What are our competitors doing on AI mortgage tools? And can we build a basic comparison page for the website?"

**9 does:**
1. Classifies: Research piece → UNO. Build piece → Tee.
2. Writes UNO brief: "Survey AI mortgage tool competitors. Key players, what they're offering, positioning language, pricing if visible. Comparison table format. 15 minutes. Medium confidence acceptable."
3. Writes Tee brief: "Build a static comparison page for ainflgm.com or rapid mortgage site. Receives a data table from UNO. Implement after UNO returns."
4. Routes UNO brief → spawns UNO
5. Holds Tee brief until UNO returns (sequential — Tee needs UNO's data first)
6. Stays on comms with Owner during the sprint
7. UNO returns → 9 reviews, approves, forwards relevant data to Tee
8. Tee builds → returns PR or file path
9. 9 reports back to Owner with both deliverables

**What this avoids:** 9 going dark for 20 minutes scraping competitors manually. Owner messages going unanswered. 9 burning context on execution work instead of coordination.

---

## Key Numbers From Research

- Multi-agent system (Opus lead + Sonnet workers) outperforms single Opus agent by **90.2%** on complex tasks (Anthropic internal research)
- Multi-agent systems use **15x more tokens** than standard chat
- Agent teams use approximately **7x more tokens** than standard sessions when teammates run in plan mode
- Haiku achieves **90% of Sonnet's performance** on agentic coding at **1/3 the cost**
- Tiered model selection reduces costs by **70%** vs running everything on Sonnet
- Chain reliability: five 95%-reliable agents in sequence = **77% combined reliability**
- In 80% of cases, a well-crafted single agent outperforms a multi-agent system — only add agents when task complexity genuinely requires it

---

## When NOT to Use Multi-Agent

Sometimes the right answer is: send UNO or Tee a single focused task, no sub-agents.

Use single-agent execution when:
- The task is well-defined and contained to one domain
- Time pressure is high and coordination overhead would eat the savings
- Confidence in the scope is low — one agent exploring is faster than five going in wrong directions
- The task can be done in under 5 minutes — spawning sub-agents takes overhead

Multi-agent is a multiplier, not a default. Use it when the problem is genuinely large enough to need it.

---

## Sources

- [Anthropic: How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Claude Code Docs: Manage costs effectively](https://code.claude.com/docs/en/costs)
- [Claude Code Docs: Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Sub-Agent Best Practices](https://claudefa.st/blog/guide/agents/sub-agent-best-practices)
- [The Multi-Agent Reality Check: 7 Failure Modes](https://www.techaheadcorp.com/blog/ways-multi-agent-ai-fails-in-production/)
- [Multi-Agent System Reliability: Failure Patterns](https://www.getmaxim.ai/articles/multi-agent-system-reliability-failure-patterns-root-causes-and-production-validation-strategies/)
- [Building Multi-Agent Systems with Claude Opus 4](https://blog.4geeks.io/building-multi-agent-systems-with-claude-opus-4-for-complex-tasks/)
- [ClaudeLog: Sub-Agents](https://claudelog.com/mechanics/sub-agents/)
- [VS Code Multi-Agent Development](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development)
