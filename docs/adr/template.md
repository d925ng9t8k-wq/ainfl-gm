# ADR-NNNN: <Short Decision Title>

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN | Deprecated
- **Date:** YYYY-MM-DD
- **Author:** <agent/role> (e.g., Tee, Wendy, JUDGE)
- **Reviewers:** <JUDGE always; others as required>
- **Squad:** <Engineering | Strategy/Governance | Design | Research | Ops>
- **Related ADRs:** ADR-XXXX, ADR-YYYY
- **Kyle K-items addressed:** K-NN, K-NN (if any)

## Context

What is the situation that forces a decision? Include the problem, the constraints
(budget, timeline, stack, compliance), and any load-bearing prior art. Be specific —
reference files, commits, incidents, or Kyle feedback items by ID. This section must
let a future engineer (or Kyle) understand the problem without reading surrounding
history.

## Decision

State the decision in one or two sentences, in the active voice. No hedging. If
there is a conditional clause ("we will do X unless Y happens"), name the condition
and the owner who monitors it.

## Consequences

### Positive
- Outcomes we expect and want.
- Debts paid down, risks closed.

### Negative / Trade-offs
- What this costs us. What we give up. What debt we take on.
- Every decision has trade-offs. If this section is empty, the decision is not
  thought through yet.

### Follow-ups
- Tasks this decision creates (link to tasks table IDs if known).
- Dates by which follow-ups must complete.

## Alternatives Considered

At least two. For each:
- **Option name** — one-line description.
- Why it was rejected (concrete, not vibes).

Rejecting alternatives by saying "we liked our approach better" is not acceptable.
The rejection reason must survive Kyle reading it cold.

## References

- File paths: `path/to/file.mjs:42-87`
- Commit SHAs: `abc1234`
- External docs: URLs, RFC numbers, standards (NIST, SOC 2 TSC, OWASP item)
- Prior ADRs
- Memory files: `memory/filename.md`

## Kyle Impact (if applicable)

- Which K-items this addresses or creates risk on (K-01 through K-20).
- Whether this is Rapid-facing (hard stack constraints) or 9E-facing (Owner
  decides).
- What Kyle would say reading this cold. Write the honest version.

---

*ADR template v1. Authored by JUDGE, Quality Gate, 9 Enterprises, 2026-04-05.*
