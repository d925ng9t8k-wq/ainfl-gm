# ADR-0001: We use Architecture Decision Records

- **Status:** Accepted
- **Date:** 2026-04-05
- **Author:** JUDGE (Quality Gate, 9 Enterprises)
- **Reviewers:** JUDGE (self, as initial policy), Wendy (Super Consultant)
- **Squad:** Strategy / Governance
- **Related ADRs:** None (this is the bootstrap)
- **Kyle K-items addressed:** K-11, K-12, K-17, K-18

## Context

On March 26 and April 3, 2026, Kyle Shea (CIO, Rapid Mortgage) gave 20
documented pieces of feedback on 9 Enterprises (see
`memory/reference_kyle_enterprise_benchmark.md`). Four of them bear directly
on the absence of any visible software development lifecycle:

- **K-11:** "I can never build on an abstraction layer I didn't create
  myself or at least have a part in creating."
- **K-12:** "How could I ever trust a platform that insists human
  architecture is a must for functional enterprise development; yet built
  itself without exactly that ingredient?"
- **K-17:** "Don't let speed to CODE fool you into thinking the SDLC is
  somehow now irrelevant."
- **K-18:** "There is no replacement for a properly designed high-level
  all-system strategy by an actually qualified professional."

The universe has approximately 220 docs, 100+ scripts, and 5+ live services
shipped in the last 30 days — none of which have a written record of *why*
they are the way they are. A staff engineer (or Kyle) reading this repo
cold cannot reconstruct the reasoning behind any choice.

On April 5, 2026, Owner burned the foundation-first directive
(`memory/mission_goal_one_apr5.md`), and Wendy instantiated JUDGE as the
permanent SDLC and quality gate for 9 Enterprises (`memory/agent_judge_charter.md`).
JUDGE's first deliverable is the paper trail Kyle has been asking for.

## Decision

9 Enterprises adopts Architecture Decision Records as the canonical format
for documenting every architecturally-significant decision. ADRs live in
`docs/adr/`, are numbered sequentially, are authored against the template
in `docs/adr/template.md`, and are reviewed by JUDGE before acceptance.
**No ADR, no merge** for any change that meets the ADR-required criteria
in `docs/adr/README.md`.

## Consequences

### Positive
- Kyle (or any external engineer) can read the `docs/adr/` directory and
  understand the architectural history of 9 Enterprises in a day.
- Future decisions are anchored to prior ones, reducing drift and
  self-contradiction.
- JUDGE has a concrete artifact to enforce SDLC discipline — the ADR is the
  gate, not a conversation.
- The WWKD Quick Test (`docs/wwkd-quick-test-v1.md`) can cite specific ADRs
  as evidence that an item passes.
- Onboarding a human architect later becomes tractable instead of
  impossible.

### Negative / Trade-offs
- ~20 minutes of authoring overhead per significant change. This is the
  deliberate cost. It is cheap relative to the SDLC debt it pays down.
- Agents that ship fast (Tee) must slow down for the ADR step on
  non-trivial changes. Simple fixes do not require ADRs (see criteria in
  `README.md`).
- Risk of ADR bureaucracy creep. Mitigation: JUDGE rejects ceremonial ADRs
  that add no decision value.

### Follow-ups
- ADR-0002 through ADR-0006 backfill the major Week-1 decisions that
  shipped before this policy existed.
- JUDGE publishes the first SDLC scorecard (`docs/sdlc-scorecard-v1.md`)
  the same day.
- Weekly: JUDGE reports the ADR count and the % of merges with a backing
  ADR as part of the SDLC compliance scorecard.

## Alternatives Considered

1. **Inline code comments / commit messages only.**
   Rejected: not discoverable, not structured, and not persistent across
   refactors. Kyle cannot audit the "why" by reading a git log.
2. **A single, growing `ARCHITECTURE.md` file.**
   Rejected: one-file design docs decay fast, have no version metadata per
   decision, and cannot be superseded cleanly. The Michael Nygard ADR
   pattern is industry-standard for a reason.
3. **Notion / Confluence wiki.**
   Rejected: not version-controlled alongside the code, not reviewable in
   PRs, and creates a second source of truth. ADRs must live in git.
4. **No written record; rely on agent memory files.**
   Rejected: memory files are 9's working memory, not an auditable record.
   They go stale (see April 5 Supabase incident,
   `memory/feedback_verify_before_assert.md`). Kyle cannot read them.

## References

- `memory/agent_judge_charter.md` — JUDGE's charter and mandate
- `memory/reference_kyle_enterprise_benchmark.md` — Kyle's K-01..K-20,
  especially K-11, K-12, K-17, K-18
- `memory/mission_goal_one_apr5.md` — foundation-first directive
- `memory/wendy_90day_plan_v1.md` — Week 1 Day-1 mandate includes ADR
  template + first 5 ADRs
- `docs/adr/template.md` — the canonical template
- `docs/adr/README.md` — contributor guide
- Michael Nygard, *"Documenting Architecture Decisions"* (2011) — the
  pattern this ADR format is based on
- ThoughtWorks Technology Radar — "Lightweight ADRs" (ADOPT, 2018-present)

## Kyle Impact

This directly addresses K-11, K-12, K-17, and K-18. It does not "solve"
them — only qualified human architecture review can close K-18 — but it
makes the reasoning behind every future decision Kyle-readable. When Kyle
re-engages (per Wendy's Phase 2 plan), he walks into a `docs/adr/` directory
instead of a wall of undocumented code. This is the minimum viable response
to his April 3 email.

— JUDGE, Quality Gate, 9 Enterprises
