# Architecture Decision Records (ADRs) — 9 Enterprises

## What this directory is

Every architecturally-significant decision made in the 9 Enterprises universe
lives here as a numbered, date-stamped, version-controlled markdown file.
This is the Kyle-readable paper trail that Kyle asked for in K-12 (*"AI speed
doesn't replace SDLC"*) and K-17 (*"don't let speed to code fool you"*).

ADRs are the durable, auditable answer to the question: *"Why is the system
this way?"*

## When an ADR is required

An ADR is required before merging any change that:

1. Introduces, removes, or swaps a persistent dependency (database, queue,
   framework, cloud provider, external API).
2. Changes an authentication, authorization, or secret-handling boundary.
3. Defines or modifies a public or internal contract (API, webhook, schema).
4. Establishes a new architectural pattern the rest of the universe will inherit.
5. Touches a Kyle K-item (K-01 through K-20) in the Kyle enterprise benchmark.
6. Is non-trivially reversible — i.e., backing it out would cost more than an hour.
7. Is a formally declared policy (e.g., "Sonnet minimum for quality roles").

If you're not sure, assume an ADR is required. Writing one takes ~20 minutes.
Not writing one and then having Kyle ask why something is the way it is will
cost an order of magnitude more.

## What an ADR is NOT

- Not a runbook. Runbooks live in `docs/runbooks/`.
- Not a design doc. Design docs can be linked from an ADR's References section.
- Not a retrospective. Incident post-mortems live in `docs/incidents/`.
- Not a feature spec.

An ADR is the **decision**, the **context** that produced it, and the
**consequences** — terse, one page where possible, never ceremonial.

## How to author an ADR

1. Copy `template.md` to `NNNN-kebab-case-title.md` using the next sequential
   number.
2. Fill in every section. Empty sections must be explicitly marked `None` or
   `N/A` with a reason, never left blank.
3. Reference concrete files, commits, and prior ADRs.
4. Submit to JUDGE for review before merge.
5. JUDGE either accepts (status → Accepted) or returns with required edits.
6. Accepted ADRs are immutable — changing a decision creates a new ADR that
   supersedes the old one (update the old one's status to
   `Superseded by ADR-NNNN`).

## Numbering

- `0001` is the meta-ADR: "We use ADRs."
- Numbers are allocated sequentially by JUDGE when an ADR is accepted.
- Draft ADRs can use placeholder `NNNN` until accepted.
- Never reuse a number. Even deprecated/superseded ADRs keep theirs.

## Status lifecycle

```
Proposed → Accepted → Superseded (by a newer ADR)
                    ↘ Deprecated  (no replacement; policy retired)
```

- **Proposed** — authored, awaiting JUDGE review.
- **Accepted** — in force. This is the current answer.
- **Superseded** — replaced by a specific newer ADR, which must link back.
- **Deprecated** — no longer applies, no direct replacement. Include the
  retirement reason.

## Quality bar

JUDGE rejects ADRs that:
- Do not identify at least two alternatives.
- Lack concrete file/commit references.
- Hide negative consequences or trade-offs.
- Read as marketing copy instead of engineering prose.
- Skip the Kyle Impact section when a K-item applies.

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| 0001 | We use ADRs | Accepted | 2026-04-05 |
| 0002 | Sonnet minimum for quality roles | Accepted | 2026-04-05 |
| 0003 | Relay-mode OC lockdown | Accepted | 2026-04-05 |
| 0004 | SQLCipher for 9-memory.db | Accepted | 2026-04-05 |
| 0005 | Kyle as benchmark authority | Accepted | 2026-04-05 |
| 0006 | Foundation-first Phase 1 | Accepted | 2026-04-05 |

---

*Maintained by JUDGE, Quality Gate, 9 Enterprises.*
