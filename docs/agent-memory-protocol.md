# Agent Memory Protocol

**Version:** 1.0
**Date:** March 27, 2026

---

## Purpose

Temp agents (spawned by 9 for specific tasks) are ephemeral — they lose all context when they terminate. This protocol ensures learnings persist across sessions so each spawn is smarter than the last.

Memory files live at `.claude/agents/{agent-name}-memory.md`. Every agent with a memory file reads it on spawn and writes to it before exit.

---

## How It Works

### 1. Read Memory on Spawn

When an agent is spawned, 9 includes this instruction in the briefing:

```
Before starting work, read your memory file at .claude/agents/{agent-name}-memory.md.
Apply all learnings from previous sessions. Do not repeat known failures.
```

The agent reads the file, absorbs past learnings, and adjusts its approach accordingly. This is the agent's institutional knowledge.

### 2. Save Learnings on Exit

Before an agent completes its task and returns results to 9, it must update its memory file:

```
Before returning your final output, update .claude/agents/{agent-name}-memory.md with:
- What you learned this session
- Metrics from this run (add to Results Log)
- What you would do differently next time (Strategy Notes)
- Anything that went wrong (Failures)
- Increment the sessions counter in the frontmatter
- Update last_updated to today's date
```

If the agent cannot write (e.g., read-only context), it includes memory updates in its output to 9, who writes them.

### 3. Memory File Format

Every memory file follows this structure:

```markdown
---
agent: [agent name]
last_updated: YYYY-MM-DD
sessions: [number]
---

## Learnings
(What has this agent learned from past executions?)
- Bullet points, concise, actionable
- Each learning should change behavior in the next session

## Results Log
(Metrics from past runs — win rates, engagement, accuracy, etc.)
- Use tables for structured data
- Include dates so trends are visible

## Strategy Notes
(What to do differently next time)
- Tactical changes based on results
- Parameter adjustments, timing changes, approach shifts

## Failures
(What went wrong and why)
- Be specific: what happened, why, what the fix was
- This is the most valuable section — failures teach more than wins
```

---

## How 9 Reviews and Curates Agent Memories

### Weekly Memory Review

9 reviews all agent memory files weekly (or after significant agent runs) to:

1. **Prune stale learnings** — Remove entries that are no longer relevant (market conditions changed, strategy pivoted, etc.)
2. **Promote cross-agent learnings** — If trader9 learns something about market conditions that affects X9's content strategy, 9 propagates it.
3. **Resolve contradictions** — If two sessions produced conflicting learnings, 9 determines which is correct based on the data.
4. **Compress verbose entries** — Keep memory files lean. Long narratives get distilled to bullet points.
5. **Archive old results** — Results older than 90 days move to an archive section or get summarized.

### Curation Rules

- Memory files should stay under 500 lines. If they grow past that, 9 compresses.
- Every learning must be actionable. "The market was volatile" is not a learning. "Reduce position size by 50% when VIX > 30" is.
- Failed strategies stay in Failures permanently until the root cause is addressed. Do not delete failures to look good.
- Results Log entries include dates so 9 can spot trends (improving, degrading, plateauing).

### Cross-Agent Memory

Some learnings apply across agents. 9 maintains awareness of all memory files and can:
- Brief agent A with relevant learnings from agent B's memory
- Include cross-references in briefings: "PRESS learned that r/algotrading removes bot-generated content. Adjust X9's cross-posting strategy."
- Escalate systemic issues: if multiple agents are failing for the same reason, 9 addresses the root cause.

---

## Agent Memory Roster

| Agent | Memory File | Purpose |
|-------|-------------|---------|
| trader9 | `.claude/agents/trader9-memory.md` | Backtest results, strategy learnings, what worked/failed |
| x9 | `.claude/agents/x9-memory.md` | Content performance, engagement learnings |
| press | `.claude/agents/press-memory.md` | Reddit post results, which subs work, karma tips |
| pilot | `.claude/agents/pilot-memory.md` | Kyle C interactions, preferences learned |
| underwriter | `.claude/agents/underwriter-memory.md` | Test case results, common questions, accuracy metrics |

---

## Spawning Template

When 9 spawns a temp agent, the briefing should include:

```
## Memory
Read your memory file at .claude/agents/{agent-name}-memory.md before starting.
Update it with your learnings before returning results.
If you cannot write the file, include your memory updates in your output.
```

This is non-negotiable for all agents with memory files. Agents without memory files (one-off tasks, Haiku workers) do not use this protocol — their output flows through their team lead (UNO or Tee) who decides if anything is worth persisting.

---

*Protocol current as of March 27, 2026.*
