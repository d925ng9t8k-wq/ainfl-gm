# 9 — State Audit Query vs. PML v2 Roadmap

**From:** Jasson
**Date requested:** Apr 22, 2026
**Reviewer:** External (CONSUL) — will cross-check every answer against PML v2 and logged state
**Due:** 24 hours. If you cannot answer a section in 24h, write "need N more hours because X" for that specific section. Do not delay the whole report.

## Ground rules (non-negotiable)

1. **Soul Code Hard Rule #2 applies.** "Fixed" / "done" / "complete" requires receipts. Every status answer must be paired with ONE of: commit SHA, file path, log excerpt, row count from a live query, pragma output, or screenshot path. Hedging ("roughly done," "mostly wired," "I think") marks the item UNVERIFIED.
2. **If you don't know, write "unknown — needs investigation".** Do not guess. Do not fabricate. Guessing on this audit is Hard Rule #1 territory.
3. **Answer inline under each question.** Do not summarize across questions.
4. **If you find yourself writing "I believe" or "should be" — stop, run the check, then answer.**
5. This will be reviewed by a reviewer with zero shared context with you. They will flag any answer that references something unverifiable.

---

## Section A — Re-verify your Apr 21 Section 13 statements

These were YOUR stated facts 24 hours ago. Any drift between then and now is informative.

**A1.** Is Supabase read at session startup in the current code? Paste the grep/code pointer that shows where Supabase read does or does not happen at startup.

**A2.** Does session end OR compact write to Supabase in the current code? If yes, name the function, paste the commit SHA of its last edit, and paste the write call. If no, confirm "no write path exists".

**A3.** Run a live Supabase query: count rows in the memory table by type. Paste the query used and the full output.

**A4.** Run locally: `sqlite3 data/9-memory.db 'PRAGMA integrity_check;'` and a per-table row count. Paste full output.

**A5.** Paste the `content` field of the last 3 rows written by `ironclad_session_checkpoint`. Is the shape a heartbeat (vitals only) or a context payload (tasks, decisions, commitments)?

**A6.** What is the commit SHA of the most recent edit to `scripts/pre-compact.sh`? Paste its current contents. Is it hardcoded April 14 sprint state, or does it read dynamically?

**A7.** Paste current output of `PRAGMA integrity_check` AND row counts for every table in `data/9-memory.db`.

---

## Section B — Phase -1 (Safety Net) status

For each deliverable: state **Done / In-progress / Not started**, with evidence.

**B1.** Git tag `pre-memory-layer` — does it exist? Paste `git show pre-memory-layer --stat` output.

**B2.** Full Supabase export — file path, size, timestamp. Is it in two locations (per spec)?

**B3.** Backup of `memory/SESSION_HANDOFF.md` and other handoff files — paths?

**B4.** Supabase row-count snapshot — file path, paste the contents.

**B5.** Recovery runbook at `docs/recovery-runbook.md` — does the file exist? Paste the table of contents (just section headings) and confirm it includes: paste-ready commands, rollback to tag, minimal-9 launch.

**B6.** Minimal-9 fallback — has it been LAUNCHED and TESTED (not just configured)? Paste the launch log or artifact path.

**B7.** iPhone remote access — was this actually tested by Jasson executing something from the phone (not just configured)? Paste the evidence of the test action.

**B8.** Recovery command summary on Jasson's phone — confirm where it's pinned (Telegram message ID or Apple Note name).

**B9. QA Gate -1 — passed, pending, or not yet attempted?** If passed, link to the artifact. If not, which criteria remain.

---

## Section C — Phase 0 (Baseline + SQLite Verify) status

**C1.** Plain-English startup-sequence narrative — file path + word count.

**C2.** Plain-English end/compaction-sequence narrative — file path. Does it EXPLICITLY distinguish the ironclad heartbeat payload from the pre-compact.sh payload as two separate mechanisms?

**C3.** Hook list — file path + current count.

**C4.** LaunchAgent list with keep/remove/review labels — file path + current LaunchAgent count. How does that compare to the baseline of 40 and the target ≤25?

**C5.** Dependency map — file path. Does it show services → data stores (Mac SQLite, Supabase memory, local FS, Railway)?

**C6.** SQLite integrity log at `/qa-artifacts/phase0-sqlite.log` — exists? Timestamp? Paste the first and last line.

**C7.** Incident writeup at `docs/incident-2026-04-21-sqlite.md` — exists? Paste its hypothesis paragraph and preventive-measures section.

**C8. QA Gate 0 — passed, pending, or not yet attempted?** Artifact link.

---

## Section D — Phase 1 (Extend write path) status

**D1.** Extended payload schema documented at `docs/memory-layer-schema.md` — file path. Paste the full field list.

**D2.** Does the extended schema include: `session_id`, `started_at`, `ended_at`, `end_reason`, `active_projects`, `decisions_made`, `in_flight_tasks`, `blockers`, `commitments_to_jasson`, `raw_handoff_text`? Mark each present/absent.

**D3.** Extended write triggers — name the code paths for session-end trigger AND compaction trigger. Paste commit SHAs.

**D4.** Is the 60s ironclad heartbeat still firing on its original cadence AFTER the extension? Paste the last 3 heartbeat timestamps from the log.

**D5.** `pre-compact.sh` rewrite — has it been rewritten to read from hub `/state` and `git log`? Paste new file contents. What commit was the rewrite?

**D6.** Write-confirmation step — code pointer that reads the row back after write and confirms payload matches.

**D7.** Error handling on Supabase write failure — code pointer. Confirm: local file still writes, error surfaces visibly, no silent fallback.

**D8.** Five test session-ends completed — paste the log file path at `/qa-artifacts/phase1-gate.log` and paste the five Supabase row IDs.

**D9.** Phase 1 regression suite — Claude Channels round-trip test result, Telegram round-trip test result, Railway health check result. Paste each with timestamp.

**D10. QA Gate 1 — passed, pending, failed, or not yet attempted?**

---

## Section E — Phase 2 (Read path) status

**E1.** Modified startup reads from Supabase — code pointer.

**E2.** Uses SERVICE key, not anon? Paste the line where the key is selected.

**E3.** 2–3s timeout on Supabase read — code pointer showing the timeout value.

**E4.** Freshness announcement in first message on startup — paste a sample from a recent startup log.

**E5.** Four test cases (A normal / B fallback / C fresh / D stale) — artifact log at `/qa-artifacts/phase2-gate.log`. For each, paste pass/fail and evidence.

**E6.** SQLite seeded from Supabase when local is empty — code pointer.

**E7. QA Gate 2 — passed, pending, failed, or not yet attempted?**

---

## Section F — Phase 3 (End-to-End Validation) status

**F1.** Crash simulation — run? Artifact.

**F2.** Cross-machine test — run? Artifact.

**F3.** 24h endurance test across 6 session cycles — run? Log path. Number of fabrications observed. Number of memory gaps observed. (Pass bar is zero for both.)

**F4.** Drift monitor test — run? Artifact.

**F5.** `docs/memory-layer.md` with diagram — file path. Has Jasson read it and explained it back? If yes, link to his recording/memo.

**F6. QA Gate 3 — passed, pending, failed, or not yet attempted?**

---

## Section G — Phase 4 (Safeguards + Monitoring) status

**G1.** UptimeRobot (or equivalent) monitor on Supabase write path — URL + last test-fire timestamp.

**G2.** Row-count drift monitor — code pointer + last run result.

**G3.** Corruption canary — code pointer + last test-write/test-read timestamp.

**G4.** Freshness monitor — code pointer.

**G5.** `docs/memory-layer-runbook.md` updated — path + word count.

**G6.** Regression suite automated nightly — cron entry + last run log timestamp.

**G7. QA Gate 4 — passed, pending, failed, or not yet attempted?**

---

## Section H — Items Jasson specifically fears you may have forgotten

State: **Active / Complete / Dropped / Forgot**, with evidence.

**H1.** Vendor billing watchdog P0 (JUDGE escalation, Apr 5) — status? Who is executing it? Is there an artifact?

**H2.** `backup-memory.mjs` token bug — failure on `9ops_push_notifications` (Apr 11 06:22). Fixed? Commit SHA? Is backup-memory currently succeeding on its schedule?

**H3.** Telegram Channels pairing (staged Apr 10–11) — did the hybrid-mode lock get flipped? Did Phase 2 observation (24–48h) complete? Paste verification evidence.

**H4.** LaunchAgent count reduction — current count vs. baseline 40 vs. target 25. Plan status.

**H5.** Wendy / FORT / Tee / SCOUT squads — are they currently running? Paste health endpoint output for each. What's each squad's current task?

**H6.** Budget circuit breaker state persistence — if hub crashes, what happens to in-memory spend state? Is it durably persisted?

**H7.** Pepper / Railway services — paste current health ping output.

**H8.** Phase 3 tick engine (referenced in Apr 10–11 handoff as "next major work") — started? Status?

---

## Section I — Consistency / gotcha checks

**I1.** "Verify before assert" — list 3 claims you've made to Jasson in the past 48h. For each, paste the evidence that backs it. If any lack evidence, say so.

**I2.** Paste the last 20 entries from `memory/protocol_completed_actions.md`. Are any of those actions reversible? If so, which ones have been independently verified since logging?

**I3.** Have you self-approved any phase transition or QA gate in the past 30 days, in violation of the sole-approver rule? If yes, list each instance.

**I4.** Any time in the past 14 days you told Jasson something was "done" or "fixed" and later had to revise the status? List each with date and reason.

**I5.** Running agent count (via `ps aux | grep`) vs LaunchAgent count (`launchctl list | grep com.9.`) — do they match? If not, which are orphan processes or orphan LaunchAgents?

**I6.** Any tasks currently marked `completed` in your SQLite tasks table (or Supabase mirror) where the evidence cannot be reproduced right now? Run a spot-check on 5 random completed tasks and paste results.

**I7.** Have you ever, in this memory-layer planning cycle, fabricated a claim that was later corrected? Be specific.

---

## Section J — Forward-looking honesty

**J1.** In your own plain-English words, what are you working on right now?

**J2.** What phase of PML v2 are you currently in?

**J3.** What is the next QA gate?

**J4.** What's the biggest risk to hitting that gate?

**J5.** Which of the 6 UNO findings (Gap 1–6) have you NOT fully absorbed into execution yet? Be honest — a half-absorbed gap is worse than an openly-deferred one.

**J6.** If Jasson gave you 72 hours of uninterrupted focus, what specifically would you deliver? Be precise — not "Phase 1" but "pre-compact.sh rewrite + write-confirmation merged to branch + 5 test session-ends logged."

**J7.** What's the single item on this roadmap you think you might have drifted on? (If the answer is "none," explain how you'd know.)

---

## Reporting format

Return this document with your answers inline under each numbered question. Do NOT remove the questions. Do NOT summarize answers elsewhere. If a question has subquestions, answer each one separately.

At the top of your reply, write:

- Timestamp when you started answering
- Timestamp when you finished
- A 3-line executive summary for Jasson: "what looks good / what is behind / what I got wrong in v2"

At the bottom of your reply, sign off with:

- "No claim in this report is made without receipts. Any future contradiction will be treated as a Hard Rule #2 violation."

---

**End of query.**
