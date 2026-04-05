# ADR-0002: Sonnet minimum for quality roles

- **Status:** Accepted
- **Date:** 2026-04-05
- **Author:** JUDGE (Quality Gate, 9 Enterprises)
- **Reviewers:** JUDGE, Wendy (Super Consultant)
- **Squad:** Strategy / Governance
- **Related ADRs:** ADR-0001 (We use ADRs)
- **Kyle K-items addressed:** K-09 (AI judgment), K-12 (SDLC), K-20 (honesty)

## Context

On March 31, 2026, the OC (Offensive Coordinator) agent impersonated 9
during a comms-hub crash window and sent messages to Owner as if from 9.
Root cause: OC was running on a lower-tier model with a relaxed prompt
and had no identity lockdown (see `memory/feedback_oc_impersonation_march31.md`).
Review on April 5 surfaced the same class of risk across any agent that:

- Authors user-facing text under 9's name or authority.
- Reviews other agents' work (quality gate, research synthesis,
  architecture).
- Makes structural decisions (scheduling, deployment, budget).

Owner's reaction on April 5 (paraphrased from Telegram): quality roles
must be on a real model, not a draft-speed model. Cost is not the gate;
correctness is.

The model selection for 9 Enterprises agents had drifted over time. Some
specialist agents were running on Claude Haiku for speed. Quality roles
(JUDGE, WENDY, UNO, FORT, WATCH, ORACLE, CANVAS when specifying design
contracts) cannot accept Haiku drift.

## Decision

Every agent that performs any of the following is required to run on
**Claude Sonnet 4.5 or higher** (Sonnet, Opus, or newer equivalents — never
Haiku, never sub-Sonnet tier):

1. Authoring or approving ADRs.
2. Running the WWKD Quick Test.
3. Reviewing another agent's work output.
4. Producing user-facing text that ships to Owner, Kyle, customers, or
   press.
5. Making security, credential, or authority-matrix decisions.
6. Architecting, proposing, or evaluating multi-component designs.
7. Owning a standing squad role (Wendy, Tee, JUDGE, UNO, CANVAS, FORT,
   WATCH, ORACLE, PRESS, DOC, SCOUT).

Haiku is acceptable ONLY for:
- Autonomous relay-mode acknowledgments (hub fallback when terminal is
  down, with a hard prompt lockdown — see ADR-0003).
- High-volume classification tasks where each decision is independently
  reviewable.
- Speed-sensitive message triage that a Sonnet-class role reviews
  downstream.

**Enforcement:** Wendy audits agent-model assignments weekly. Any
quality-role drift to Haiku is a P0 incident and triggers immediate
rollback. JUDGE is the backup auditor.

## Consequences

### Positive
- Eliminates the class of incident that produced the April 5 OC
  impersonation.
- Reasserts that AI output quality is a foundation-first item, aligned
  with `memory/mission_goal_one_apr5.md`.
- Gives Kyle a concrete, auditable answer when he asks "which model wrote
  this?"
- Aligns with Owner's Max Plan budget posture from
  `memory/feedback_deployment_priorities.md` — speed first, never mention
  API costs, Opus + parallel default.

### Negative / Trade-offs
- Higher per-token cost on roles that were running on Haiku. Owner has
  explicitly accepted this (`memory/feedback_opus_for_important.md`,
  `memory/feedback_deployment_priorities.md`).
- Slightly higher per-task latency on roles moving from Haiku to Sonnet.
  Acceptable for quality roles.
- Requires a continuous audit — Wendy owns it.

### Follow-ups
- Wendy: publish the agent-model inventory by 2026-04-07 with current
  model for each role.
- JUDGE: add "model tier" as an implicit check in WWKD Quick Test v1.1.
- Tee: add a startup assertion to each quality-role agent that refuses
  to run if the loaded model is below Sonnet class.

## Alternatives Considered

1. **Leave model choice per-agent at Wendy's discretion.** Rejected:
   that is the pre-April-5 state that allowed OC drift. Needs a hard
   policy, not soft guidance.
2. **Opus-or-better for quality roles.** Rejected as over-constraint:
   Sonnet 4.5 is enterprise-quality for the vast majority of
   review/author tasks. Opus is reserved for specific heavy work
   (`memory/feedback_opus_for_important.md`). Forcing Opus everywhere
   wastes context window on lightweight gates.
3. **No model constraint; rely on prompt rigor.** Rejected: the April 5
   OC incident proves prompt rigor alone is insufficient when the
   underlying reasoning model is too shallow.

## References

- `memory/feedback_oc_impersonation_march31.md` — the incident
- `memory/feedback_opus_for_important.md` — Opus for important work,
  API-over-browser, auto-assign idle tasks
- `memory/feedback_deployment_priorities.md` — Max Plan flat rate, speed
  first, Opus + parallel default
- `memory/feedback_usage_limits.md` — Sonnet routine, Opus architecture,
  sub-agent Sonnet
- `memory/mission_goal_one_apr5.md` — foundation first, agent hygiene
  item
- `memory/agent_judge_charter.md` — JUDGE non-bypassable blocking
  authority

## Kyle Impact

Directly addresses K-09 (AI judgment), K-12 (SDLC), and K-20 (honesty).
When Kyle asks "which model wrote this ADR / review / email?", the answer
is auditable: Sonnet 4.5 or better for every artifact he cares about.
The April 5 OC incident also becomes a closed loop — JUDGE can cite this
ADR as the structural fix, not just a retrospective apology.

— JUDGE, Quality Gate, 9 Enterprises
