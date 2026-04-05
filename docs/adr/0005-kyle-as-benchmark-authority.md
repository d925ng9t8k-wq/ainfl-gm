# ADR-0005: Kyle Shea as the benchmark authority for "enterprise-grade"

- **Status:** Accepted
- **Date:** 2026-04-05
- **Author:** JUDGE (Quality Gate, 9 Enterprises)
- **Reviewers:** JUDGE, Wendy, 9 (via charter)
- **Squad:** Strategy / Governance
- **Related ADRs:** ADR-0001, ADR-0006
- **Kyle K-items addressed:** all 20 (K-01 through K-20) — meta

## Context

Since March 26, 2026, the phrase "enterprise-grade" has appeared dozens
of times across 9 Enterprises documentation, memory files, pitches, and
commit messages. Without an anchor, "enterprise-grade" drifts into
marketing language — the exact failure mode Kyle called out in K-20:
*"I'm positive that I'm right — somewhat uninterested since you have a
commitment to please."*

On April 5, 2026, UNO published
`memory/reference_kyle_enterprise_benchmark.md`: a 400-line reference
document codifying Kyle's 20 documented feedback items (K-01 through
K-20), a 50-item enterprise-grade CIO checklist grounded in SOC 2,
NIST CSF 2.0, ISO 27001, OWASP, ICE Encompass EPC, Salesforce,
Microsoft 365, and a WWKD persona model.

Owner has stated repeatedly (e.g., April 5 Telegram:
*"Kyle's going to expect nothing less, and he's going to spot anything
that doesn't meet it immediately"*) that Kyle is the yardstick.

This ADR makes that yardstick official so no future drift is possible.

## Decision

For any internal or external use of the phrase "enterprise-grade,"
"gold standard," "enterprise-ready," or equivalent, the 9 Enterprises
universe uses **Kyle Shea's benchmark** as the authoritative definition.
Specifically:

1. **Reference document:** `memory/reference_kyle_enterprise_benchmark.md`
   is the canonical source. It is read-only for non-UNO agents;
   UNO maintains it.
2. **WWKD Quick Test:** Every flagship-product change is scored against
   the WWKD Quick Test v1 (`docs/wwkd-quick-test-v1.md`), which is
   derived from Part 3 of the Kyle benchmark. JUDGE owns the test.
3. **K-item tracking:** Every Kyle feedback item (K-01 through K-20)
   has a status column in the benchmark document. Any change that
   addresses a K-item must reference the K-number in its commit and
   its ADR (Kyle Impact section).
4. **"Kyle-approved" claims are prohibited** unless Kyle has literally
   approved the specific artifact in writing (email, iMessage, verbal
   on recorded call). "Kyle-endorsed" is permitted only for artifacts
   where Kyle explicitly directed the work (e.g., the April 5 RAM
   agent, per `docs/kyle-ram-guidance-apr5.md`).
5. **Quarterly review:** UNO updates the K-item status table quarterly
   or after any Kyle interaction. JUDGE publishes a Kyle-readiness
   scorecard (% of K-items closed, % of flagship products passing
   WWKD) on the same cadence.
6. **Hard gate at Rapid:** Kyle has veto authority on any Rapid-facing
   product (AI Underwriter, LO assistant, any system touching Rapid
   data). Kyle does not have veto on 9E direction, Jules, Bengal Pro,
   trading tools, or consumer products — Owner decides those, Kyle's
   input is valued but not binding (per `memory/feedback_kyle_role_clarity.md`).

## Consequences

### Positive
- Eliminates drift in the term "enterprise-grade" across the universe.
- Kyle has a readable, auditable scorecard when he re-engages.
- Every ADR, every WWKD review, every pitch has a single source of truth.
- Protects Owner and 9 from honest self-deception: if a thing is not
  Kyle-ready, the benchmark makes that unambiguous.
- Aligns with Owner's radical-honesty directive
  (`memory/feedback_radical_honesty.md`).

### Negative / Trade-offs
- Kyle's bar is high. Many current 9 Enterprises products score badly
  on first measurement. The first scorecard will be uncomfortable.
  That discomfort is the point.
- UNO must maintain the benchmark continuously. This is a standing
  workload.
- Risk of "Kyle veto creep" — treating Kyle as gatekeeper on areas
  where Owner is the decision-maker. Mitigation: `feedback_kyle_role_clarity.md`
  draws the line clearly (hard gate at Rapid, valued input elsewhere,
  Owner decides 9E).

### Follow-ups
- UNO: update K-01..K-20 status table by Apr 10 per Wendy Week 1 plan.
- JUDGE: first Kyle-readiness scorecard by 2026-04-12 (end of Week 1).
- Wendy: publish the WWKD compliance metric in every weekly review.

## Alternatives Considered

1. **Use a generic industry standard (SOC 2, ISO 27001, NIST CSF)
   without Kyle overlay.**
   Rejected: those standards are necessary but not sufficient. Kyle's
   benchmark includes operational, cultural, and judgment dimensions
   that pure compliance frameworks miss (K-11 trust, K-16 scope
   discipline, K-20 honesty). Also: standards like SOC 2 Type II
   take 12+ months. We need a yardstick we can measure against today.
2. **Use a vendor benchmark (e.g., Salesforce, Gartner).**
   Rejected: Salesforce and Gartner are bar-setters, but they are not
   the person who will decide whether 9 Enterprises is real. Kyle is
   that person. Building toward someone else's approval is
   misaligned.
3. **Have 9 self-define "enterprise-grade".**
   Rejected: 9 building 9's own yardstick is circular. Kyle is an
   external, credible, consistently tough authority whose criticism
   has historically been accurate.
4. **Multiple benchmark authorities (Kyle + Mark Jaynes + Mike
   McGuffey + advisors).**
   Rejected for v1: Kyle is the deepest technical critic and the
   highest bar. Adding more voices dilutes the signal. Can be
   revisited in Phase 2 if the Rapid relationship deepens.

## References

- `memory/reference_kyle_enterprise_benchmark.md` — UNO's canonical
  benchmark (Part 1: K-01..K-20, Part 2: 50-item checklist, Part 3:
  WWKD persona, Part 4: comparative benchmarks, Part 5: top 5 gaps)
- `memory/feedback_kyle_role_clarity.md` — hard gate at Rapid vs
  valued input at 9E
- `memory/feedback_radical_honesty.md` — no people-pleasing
- `memory/contact_kyle_shea.md` — Kyle background
- `memory/agent_judge_charter.md` — JUDGE's mandate to enforce WWKD
- `docs/wwkd-quick-test-v1.md` — derived test
- `docs/wwkd-reviews/001-kyle-ram-agent.md` — first dry-run

## Kyle Impact

This is the meta-ADR on Kyle. It makes Kyle the authority. When Kyle
re-engages, he walks into a universe that has explicitly organized
itself around his bar — not in a people-pleasing way (which he would
detect instantly, per K-20) but in a structural, auditable, verifiable
way. The WWKD scorecard is the proof.

— JUDGE, Quality Gate, 9 Enterprises
