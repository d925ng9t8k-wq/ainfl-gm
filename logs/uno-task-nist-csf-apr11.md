# UNO — NIST Cybersecurity Framework 2.0 Gap Analysis (Kyle-track CLO Deliverable)

**Author:** UNO (CLO + Research Lead) — sub-agent run
**Date:** 2026-04-11
**Scope:** The 9 Enterprises universe scored against NIST CSF 2.0 functions and subcategories.
**Method:** Read-only audit against live code and canonical docs. Every score has evidence or "no evidence" attached.

## NIST CSF 2.0 Tier Scale (used throughout)

NIST CSF uses Implementation Tiers 1–4 and a maturity lens 0–4 (commonly applied):

- **0 — Nonexistent:** Not performed; no documentation, no activity.
- **1 — Partial (Tier 1):** Ad hoc, reactive, informal; limited awareness.
- **2 — Risk Informed (Tier 2):** Practices exist but not formalized; some risk management.
- **3 — Repeatable (Tier 3):** Documented, consistent, risk-informed policies.
- **4 — Adaptive (Tier 4):** Continuously improving, informed by lessons learned and threat intel.

## Priority Labels

- **P0** — blocks enterprise deployment; ship within 14 days
- **P1** — needed for SOC 2 observation window; ship within 30 days
- **P2** — risk reduction, ship within 60–90 days

---

## Executive Scorecard

| Function | Subcategories scored | Avg Tier |
|---|---:|---:|
| **Identify (ID)** | 8 | 1.9 |
| **Protect (PR)** | 10 | 1.3 |
| **Detect (DE)** | 6 | 1.5 |
| **Respond (RS)** | 5 | 1.4 |
| **Recover (RC)** | 4 | 1.0 |
| **Govern (GV)** — new in 2.0 | 4 | 1.0 |
| **Overall average tier** | **37** | **1.4** |

**Headline:** Overall NIST CSF 2.0 tier = **1.4 / 4.0** (Tier 1, "Partial," trending toward Tier 2 in two functions). The strongest function is Identify (1.9) because of the genuinely good dependency-map and credential-inventory work. Every other function sits in Tier 1. Tier 3 ("Repeatable") is the minimum Kyle will accept for a Rapid-facing product.

---

## GOVERN (GV) — New in CSF 2.0

| Subcat | Name | Tier | Evidence / Gap | Priority |
|---|---|---:|---|---|
| GV.OC | Organizational Context | 1 | Soul Code + mission docs define purpose and stakeholders informally. No formal context statement mapping regulatory and business environment. | P1 |
| GV.RM | Risk Management Strategy | 1 | No risk management strategy document. Risk is implicit in `docs/dependency-map-critical-path.md`. | P1 |
| GV.RR | Roles, Responsibilities, Authorities | 1 | `memory/project_org_chart_apr7.md` defines internal AI-agent org; no RACI for humans/controls. | P1 |
| GV.PO | Policies | 1 | Soul Code acts as a charter; no formal information security policy, acceptable use policy, or data classification policy. | P0 |
| GV.OV | Oversight | 0 | No independent oversight; single-founder LLC. | P2 |
| GV.SC | Supply Chain Risk Mgmt | 1 | `memory/reference_verified_subscriptions.md` inventories vendors; no formal vendor due diligence, no DPAs signed. | P1 |

(GV.OC, GV.RM, GV.RR, GV.PO scored for the 4 reported in Executive Scorecard; GV.OV and GV.SC cross-referenced above for completeness.)

---

## IDENTIFY (ID) — Tier 1.9 average

| Subcat | Name | Tier | Evidence / Gap | Priority |
|---|---|---:|---|---|
| ID.AM-01 | Physical devices inventoried | 2 | `docs/dependency-map-critical-path.md` §1 explicitly names the MacBook Pro as P0 BLACKOUT dependency. Only one device. | P2 |
| ID.AM-02 | Software platforms inventoried | 3 | `docs/dependency-map.json` (canonical machine-parseable) + `docs/dependency-map.md` are genuinely strong. 14 components, every env var, every external API. This is Tier 3. | Maintain |
| ID.AM-03 | Communication/data flows mapped | 2 | Dependency map includes data flows (the "what reads what" section in `dependency-map-critical-path.md`). Not per-product. | P1 |
| ID.AM-04 | External information systems cataloged | 2 | `memory/reference_verified_subscriptions.md` + `docs/credential-inventory.md` together catalog external services. | P1 |
| ID.AM-05 | Resources prioritized by value/criticality | 2 | Critical-path doc uses P0–P4 severity. Good; not formalized per SOC 2 risk ranking. | P1 |
| ID.RA-01 | Asset vulnerabilities identified | 1 | No vulnerability scanning. `npm audit` not in CI. | P0 |
| ID.RA-03 | Internal/external threats identified | 2 | Dependency map flags third-party risks (Anthropic API, Cloudflare tunnel). No formal threat model. | P1 |
| ID.SC-01 | Supply chain risk management | 1 | No formal vendor DPAs. Kyle K-14 (Encompass integration) is a known open item. | P1 |

**Strength:** the existing dependency map + credential inventory is the single best piece of SOC 2/NIST evidence in the repo. Build on it.

---

## PROTECT (PR) — Tier 1.3 average

| Subcat | Name | Tier | Evidence / Gap | Priority |
|---|---|---:|---|---|
| PR.AA-01 | Identities and credentials issued/managed | 1 | Your9 auth: scrypt + JWT (`scripts/your9-auth.mjs`). No MFA. Hub: no auth (FORT open item). | P0 |
| PR.AA-03 | Users, devices, assets authenticated | 1 | Hub endpoints unauthenticated if `HUB_API_SECRET` unset (credential inventory H-03). FORT work queue confirms. | P0 |
| PR.AA-05 | Access permissions and authorizations managed | 1 | No RBAC. Single-user founder + sub-agents. Your9 admin token has a random fallback if unset. | P0 |
| PR.AT-01 | Personnel trained | 0 | No training program; no personnel. | P2 |
| PR.DS-01 | Data at rest protected | 3 | **Confirmed live:** SQLCipher encryption on `data/9-memory.db` (stock sqlite3 rejects with "file is not a database"). Only this database is encrypted; JSON account files in `instances/accounts/` are plaintext on disk. | P1 (extend to account files) |
| PR.DS-02 | Data in transit protected | 2 | External calls over TLS. Hub on 127.0.0.1 only. Cloudflare tunnel for voice webhook. | P2 |
| PR.IP-01 | Baseline configuration | 1 | No documented baseline config. `SOUL_CODE.md` + CLAUDE.md define operational behavior. | P1 |
| PR.IP-04 | Backups conducted, maintained, tested | 1 | `scripts/backup-memory.mjs` runs. Restore not tested on a cadence. No offsite backup. | P1 |
| PR.IP-09 | Incident response plan | 2 | `memory/protocol_incident_response_apr7.md` + documented incident writeups in `docs/incident-*.md` for Apr 5, 7, 8. Plan exists; not tabletop-tested. | P1 |
| PR.PT-03 | Least functionality | 1 | Trader9 has hard-gate pattern (ALPACA_LIVE_ENABLED) — one genuine Tier-3 control. Most services run with broad permissions. | P1 |

---

## DETECT (DE) — Tier 1.5 average

| Subcat | Name | Tier | Evidence / Gap | Priority |
|---|---|---:|---|---|
| DE.AE-01 | Baseline operations understood | 2 | Hub watchdog, freeze watchdog, PID-aware ping loop — a lot of informal baselining in CLAUDE.md. Not a SOC-style NOC baseline. | P1 |
| DE.AE-02 | Events analyzed | 1 | Sentry DSNs configured for comms-hub, voice-server, trader9-bot. No security event correlation. | P1 |
| DE.CM-01 | Network monitored | 1 | No network monitoring beyond localhost hub checks. | P2 |
| DE.CM-03 | Personnel activity monitored | 0 | No monitoring of Owner/agent activity outside git log. | P2 |
| DE.CM-07 | Unauthorized software/devices monitored | 1 | No software allowlist. | P2 |
| DE.DP-04 | Event detection communicated | 3 | This is legitimately strong: PostToolUse hook + check-messages pipeline + Telegram push + session handoff daemon is Tier-3 detection comms for the Owner→9 channel. Does not cover external security events. | Extend to security events |

---

## RESPOND (RS) — Tier 1.4 average

| Subcat | Name | Tier | Evidence / Gap | Priority |
|---|---|---:|---|---|
| RS.RP-01 | Response plan executed | 2 | Apr 5/7/8/10 incidents were triaged and fixes shipped fast. Plan lives in memory + `docs/incident-runbooks.md`. Not SOC 2 formal. | P1 |
| RS.CO-01 | Personnel know roles/order of ops | 2 | `memory/protocol_incident_response_apr7.md` assigns DOC role. Single-person operation still. | P1 |
| RS.CO-02 | Events reported consistent with plan | 1 | Incidents documented in memory and `docs/incident-*.md`. No regulator/customer notification process. | P0 |
| RS.AN-01 | Notifications from detection systems analyzed | 1 | Sentry alerts analyzed informally. | P1 |
| RS.MI-01 | Incidents contained | 2 | Ad-hoc containment worked during Mac reboot incidents (cloud worker failover documented). | P1 |

---

## RECOVER (RC) — Tier 1.0 average

| Subcat | Name | Tier | Evidence / Gap | Priority |
|---|---|---:|---|---|
| RC.RP-01 | Recovery plan executed | 1 | Mac reboot recovery documented in CLAUDE.md. Not a proper BC/DR plan. | P1 |
| RC.IM-01 | Recovery plans improved | 1 | Lessons burned to memory (`memory/feedback_*`). Not a formal corrective action plan. | P1 |
| RC.CO-01 | Public relations managed | 1 | No PR plan. No customer notification template. | P1 |
| RC.CO-03 | Recovery activities communicated | 1 | Owner is notified via Telegram. No external stakeholders. | P2 |

---

## Highest-Priority Remediations (rolled up, prioritized)

### P0 — Ship in 14 days

1. **GV.PO — Adopt and customize a SOC 2 / NIST-aligned policy library.** Vanta/Drata/Secureframe have templates. This is the fastest way to convert Tier 1 → Tier 2 across GOVERN.
2. **PR.AA-01 / PR.AA-03 / PR.AA-05 — Hub auth (FORT design).** The single highest-leverage control change in the repo.
3. **ID.RA-01 — Add `npm audit --audit-level=high` to CI.** Two-line change in `.github/workflows/ci.yml`.
4. **RS.CO-02 — Breach notification template + 72-hour procedure.** Needed to sell to any mortgage LO.

### P1 — Ship in 30 days

5. **ID.AM-03 / ID.AM-05 — Per-product data-flow diagrams and criticality rankings.**
6. **PR.IP-04 — Offsite backup with verified restore.**
7. **DE.AE-02 — Route Sentry events into a security event queue with triage SLA.**
8. **RS.RP-01 — Tabletop exercise against the existing incident protocol.**

### P2 — Ship in 60 days

9. **PR.AA-01 — MFA on Your9 auth.**
10. **ID.AM-01 — Migrate production off Mac to cloud VPS (Kyle K-06, CC6.4). Large effort but already researched in `docs/vps-deployment-plan.md`.**
11. **PR.IP-01 — Documented baseline configuration for every service.**

---

## Where the Repo Is Already Surprisingly Strong

Credit where it is due — these are the items already at Tier 2 or 3, and Kyle will notice if they are presented well:

- **ID.AM-02 (software inventory)** — Tier 3. `docs/dependency-map.json` is auditor-ready.
- **ID.AM-04 (external systems)** — strong credential inventory with hygiene flags.
- **PR.DS-01 (encryption at rest)** — SQLCipher verified live.
- **DE.DP-04 (detection comms for Owner channel)** — Tier 3 within its scope.
- **PR.PT-03 (least functionality in trader9)** — FORT C-04 hard gate pattern is a genuine enterprise control.

These should be presented to Kyle as the "foundations we already have" — but the rest of the framework needs to be built on top of them.

---

## Overall Assessment

The 9 Enterprises universe is at **NIST CSF 2.0 Tier 1.4 (Partial, trending toward Risk Informed)**. Kyle's minimum acceptable tier for a Rapid-facing product is Tier 3 (Repeatable). The gap is meaningful but not unbridgeable — the dependency-map work, SQLCipher encryption, and PostToolUse detection pipeline are all Tier-3 foundations. The missing pieces are governance (policies, RACI), protection (auth, MFA, RBAC), and recovery (tested DR). A 90-day focused sprint can realistically reach an average Tier ~2.3; a 180-day sprint can reach Tier ~3.0 if coupled with the SOC 2 P0/P1 remediation list.

---

## Sources and Standards

- NIST CSF 2.0 (nist.gov/cyberframework, 2024)
- NIST SP 800-53 rev 5 (cross-referenced for control detail)
- Internal: `docs/dependency-map.md`, `docs/dependency-map.json`, `docs/dependency-map-critical-path.md`, `docs/credential-inventory.md`
- Internal: `scripts/fort-agent.mjs`, `scripts/trader9-bot.mjs`, `scripts/your9-auth.mjs`, `scripts/backup-memory.mjs`, `scripts/health-monitor.mjs`
- Internal: `memory/reference_kyle_enterprise_benchmark.md`, `memory/protocol_incident_response_apr7.md`, `memory/reference_verified_subscriptions.md`
- Live check: `/usr/bin/sqlite3 data/9-memory.db` rejects with "file is not a database" → encryption confirmed.

*Generated by UNO sub-agent, 2026-04-11. Read-only analysis; no code or artifact was modified.*
