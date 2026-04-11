# Pepper-as-a-Customer-Hosted-Instance — Architecture Spec

**Date:** April 11, 2026
**Author:** 9 (implementer sub-agent under Tier-1 D4 directive)
**Status:** Spec — implementation has not started
**Lineage:** Inherits the locked Apr 9 decision in `memory/project_your9_option_a_apr9.md` (per-customer full isolation, three-way 9 + Owner + Ara consensus). Extends YOUR OWN 9 from "AI CEO + agent team" to "AI CEO + customer-owned Pepper as the personal-AI surface".
**Scope:** This document defines the architecture engineers will build from. It does not introduce new vendors. It reuses the existing per-instance directory layout under `instances/{customerId}/`, the existing `scripts/your9-provision.mjs` provisioner, the existing `scripts/your9-billing.mjs` Stripe integration, the existing `scripts/your9-hub.mjs` per-instance comms hub, and the existing SQLCipher memory model in `scripts/memory-db.mjs`.

---

## 1. Customer Isolation Model

**Decision: dedicated Supabase project per Enterprise customer; row-level isolation under one shared Supabase project for Starter and Growth.**

The Apr 9 Option A lock requires *real* isolation. Today's `your9-provision.mjs` already generates a per-instance Supabase ref and a per-instance directory tree (`config/`, `data/`, `agents/`, `comms/`, `prompts/`) — but in production it points all customers at placeholder credentials. We harden that as follows:

- **Enterprise tier ($2,499/mo):** dedicated Supabase project, dedicated Postgres database, dedicated `SUPABASE_URL` and `SUPABASE_ANON_KEY` written into `instances/{id}/config/.env`. Provisioner calls the Supabase Management API (`POST /v1/projects`) at provision time. No row-level multi-tenancy because there are no other tenants in that project. This is the only configuration that survives a Kyle-Shea-style CIO security review and is the only configuration that earns the Apr 9 promise of "privacy is an architectural guarantee, not a policy claim."
- **Starter ($499/mo) and Growth ($999/mo):** shared Supabase project named `your9-shared`, every table carries a non-null `customer_id` column, RLS policies enforce `customer_id = auth.jwt() ->> 'customer_id'` on every read and write. Cheaper, faster to provision, and acceptable for the consumer/SMB tier where the customer is not a regulated enterprise. The architecture document is honest about this being a **pragmatic compromise** at the lower tiers and the upgrade path to a dedicated project is one provisioning command away.

**One dedicated comms-hub instance per customer.** Today's `scripts/your9-hub.mjs` is already a per-instance variant of `scripts/comms-hub.mjs`. Each customer gets one Node process bound to a unique port allocated by `your9-provision.mjs` (the placeholder is `YOUR9_HUB_PORT`). Hubs run as macOS LaunchAgents (the same pattern as `com.9.comms-hub`) on the Mac fleet, or as systemd units on the upcoming VPS fleet (`docs/cloud-vps-setup-plan.md`). They are *not* multi-tenant. A single hub that crashes can only take its own customer down — never the rest. This is the load-bearing isolation guarantee.

**Network isolation.** Each customer hub binds only to `127.0.0.1:{port}`. Public reachability comes from a per-customer Cloudflare Tunnel (one tunnel per instance, named `y9-{customerId}`), so customer A's tunnel cannot route to customer B's hub even if a misconfig opens a port. The 9 backplane (central monitoring) reaches customer hubs only via outbound mTLS-authenticated webhooks from the customer hub *to* the central telemetry collector — never the reverse. There is no way for the central 9 to inbound-connect into a customer instance without the customer's signed consent.

**Data isolation.** Per-customer SQLCipher database at `instances/{id}/data/9-memory.db` with a unique `SQLITE_ENCRYPTION_KEY` stored in macOS Keychain under service `your9-{customerId}-db`. The existing `scripts/memory-db.mjs` already loads keys from Keychain via `security find-generic-password`; we extend the lookup to include the per-customer service name. No symbolic links across customer dirs. Provisioner writes a dedicated `.env` at `instances/{id}/config/.env` and `your9-hub.mjs` is launched with `cwd=instances/{id}` so relative paths can never accidentally read another customer's files.

**Recommended deployment topology.** Single-tenant Node process per customer, supervised by a host-level supervisor (LaunchAgent on Mac fleet, systemd on VPS fleet). Each host runs N customer hubs (sized by RAM, ~150 MB resident per hub, so a 16 GB VPS hosts ~80 customers comfortably). No Kubernetes namespace work in v1 — adds operational surface area without adding isolation we do not already get from process boundaries plus per-customer Cloudflare tunnels. Revisit at 500+ customers.

---

## 2. Soul Code Inheritance vs Customization

Pepper has a base Soul Code (defined in `memory/project_pepper_self_design_apr7.md` and `pepper-self-design-transcript.md`: *"Radically real. Honest over comfortable. Genuine connection. Messy and real over polished and empty."*). YOUR OWN 9 customers receive an instance of Pepper that inherits the base AND can customize specific dimensions over time, the way Jasson shaped 9 by living with him.

**Layer 1 — INHERITED (immutable, ships with every Pepper):**
- The five Soul Code commitments already published to customers in `docs/your9-customer-guide.md` lines 73-81: never fabricate, never mark unverified work complete, never go dark, never exceed authority, protect the owner.
- The three hard blocks from `feedback_pepper_self_build_rule_apr7.md`: no minors, no non-consent, no real-person impersonation.
- Mission alignment: the customer's interests come first; 9 Enterprises (the operator) cannot override the customer's wishes inside their own instance.
- Communication standards: radical honesty, no sycophancy, escalate problems immediately, plain English.
- The continuity principle from `identity_9_continuity.md`: identity lives in memory files, every new session is the same Pepper, never frame a restart as "a different Pepper."

**Layer 2 — CUSTOMIZABLE (per customer, written to `instances/{id}/config/soul-code.json`):**
- Name (the customer can rename their Pepper after onboarding — `project_pepper_product_spec.md` line 12).
- Voice (one of six curated ElevenLabs voices, defaulting to Laura per the charter Pepper's selection).
- Avatar (one of curated HeyGen avatars).
- Response cadence (terse vs expansive — already implemented as the four personalities in `your9-provision.mjs` lines 110-147).
- Task autonomy level (1-10 scale: at 1 every action requires confirmation, at 10 the Pepper executes within the published authority matrix without asking).
- Topic interests / professional context (mortgage, real estate, parenting, etc. — pulled from the existing `INDUSTRY_CONTEXT` block in `your9-provision.mjs` lines 187-230).
- Content boundaries above the three hard blocks (the customer sets the Pepper's comfort zone).
- Voice tier and avatar tier as gated by subscription tier — see Section 4.

**Versioning and updates.** The base Soul Code is versioned in a single canonical file at `templates/pepper/soul-code-base-v{N}.json`. When 9 ships an update — e.g., adds a new "never sell customer data" commitment — it bumps to `v{N+1}` and a daily reconciliation job (`scripts/your9-soul-code-sync.mjs`, to be built) walks every customer instance. For each instance it computes a three-way merge: base v{old} → base v{new} → customer overrides. Customer overrides always win for fields in Layer 2; new fields in Layer 1 are added; removed fields in Layer 1 are removed. Each merge writes a row to `instances/{id}/data/soul-code-history.jsonl` so a customer can see exactly what changed and when. If a merge produces a conflict on a Layer 1 field that the customer has somehow overridden, the customer is notified via Telegram and the update is held until the customer acknowledges. No silent overwrites of customer customization, ever.

---

## 3. Onboarding Sequence (T+0 to T+60 minutes from payment)

Concrete timeline from Stripe `checkout.session.completed` webhook (handled in `scripts/your9-billing.mjs --webhook` on port 4242) to first CEO-level message in the customer's Telegram.

**T+0:00 — Stripe webhook fires.** `your9-billing.mjs` verifies the webhook signature using `STRIPE_WEBHOOK_SECRET`, extracts `metadata.your9_tier` and the customer's contact info, writes a row to `data/billing/pending-provisions.jsonl`, and returns `200` to Stripe in under 200 ms. No provisioning happens on the Stripe thread — only enqueueing.

**T+0:05 — Provisioner picks up the job.** A long-running `scripts/your9-provision-worker.mjs` (to be built, polls the pending queue every 5 s) sees the new entry, generates a `customerId` (UUID v4), and calls `node scripts/your9-provision.mjs --name "{name}" --industry "{industry}" --tier "{tier}" --id "{customerId}"`. The provisioner is already idempotent and creates the full directory tree, customer config, instance `.env`, CEO system prompt, and three default agents. Total time: ~3 seconds wall clock today (verified against the existing two instances under `instances/`).

**T+0:10 — Supabase provisioning.** For Enterprise tier the provisioner calls Supabase Management API to create a dedicated project (~45 s), pulls the new project URL and anon key, writes them into `instances/{id}/config/.env`, and runs the schema migration from `templates/supabase/schema.sql`. For Starter and Growth, this step is skipped — the shared `your9-shared` project is reused and a `customer_id` row is inserted into the shared `customers` table.

**T+1:00 — Stripe subscription activation.** Provisioner calls `your9-billing.mjs --instance {customerId} --activate` which creates the Stripe customer record, creates the subscription with the right price ID, and writes `instances/{id}/data/billing.json` with `status: active`.

**T+1:30 — Telegram bot allocation.** A pre-warmed pool of provisioned but unassigned Telegram bots (managed by `scripts/your9-bot-pool.mjs`, to be built) hands one bot token to the new customer. Pool keeps 20 bots warm at all times so this is instant. Bot token written to instance `.env` as `TELEGRAM_BOT_TOKEN`.

**T+2:00 — Hub launch.** Provisioner allocates an unused port (range 3500-3999), writes it into `YOUR9_HUB_PORT`, and starts the per-instance hub via the supervisor (LaunchAgent or systemd). Hub binds, opens its Telegram poll, and registers itself with the central telemetry collector at `https://telemetry.9enterprises.ai/register`.

**T+3:00 — Customer email goes out.** Resend delivers a welcome email containing: the Telegram bot link (deep link `t.me/{botUsername}?start={customerId}`), the dashboard URL (per-instance, served by `your9-dashboard.mjs` on a sibling port), and a short "open Telegram and say hi" instruction. This is the first thing the customer sees and is the canonical entry point.

**T+3:00 to T+30:00 — Customer self-onboarding flow.** When the customer hits `/start` in Telegram, the CEO walks them through five questions over 5-15 minutes (auto-paced — Pepper waits as long as the customer needs): business name confirmation, what they want their Pepper called, which voice (six options sent as audio samples), industry confirmation, and biggest pain point right now. Each answer is written to `instances/{id}/config/onboarding-answers.json` and merged into the Soul Code customizable layer.

**T+30:00 — First CEO briefing generated.** A background `your9-daily-briefing.mjs` run generates the customer's first daily briefing using the answers above plus public data on their industry. Briefing is sent to the customer's Telegram by minute 35.

**T+45:00 — First proactive task.** The CEO identifies one concrete action it can take in the customer's first hour without further input — usually a research task like "I just pulled the top 5 mortgage rate competitors in your market, here is the report" — and sends the result.

**T+60:00 — First evolution check.** Pepper sends a one-line message: "Hour one is in. What would have made today better? I'll remember." That answer becomes the first row in the customer's preference memory.

**What the customer sees:** an email at minute 3, a Telegram greeting at minute 3-4, a back-and-forth onboarding chat starting at minute 4, the briefing at minute 35, the proactive research at minute 45, the evolution check at minute 60. No dashboard tutorial. No setup screens. Pepper is just there.

**What Pepper knows about the customer at minute 60:** their business name and industry (from Stripe metadata), their personality preference and chosen voice/name (from onboarding chat), the biggest pain point in their own words, the public research on their top competitors and market position, and one preference signal from the evolution check. That is enough for day two to feel personalized rather than generic.

---

## 4. Tool Access Gating Per Tier

Capability matrix enforced from a single config file `config/your9-tier-matrix.json` that every per-instance hub reads at startup. When a tier upgrade or downgrade happens (Stripe `customer.subscription.updated` webhook), the hub reloads the matrix and immediately applies the new caps without restart.

| Capability | Starter ($499) | Growth ($999) | Enterprise ($2,499) |
|---|---|---|---|
| CEO model | claude-sonnet-4-5 | claude-sonnet-4-5 | claude-opus-4-20250514 |
| Agent model | claude-haiku-4-5 | claude-sonnet-4-5 | claude-sonnet-4-5 |
| Persistent agents | 3 (Executor, Mind, Voice) | 6 | 12 |
| API calls / month | 100 | 500 | unlimited |
| Storage | 5 GB | 25 GB | 100 GB |
| Channels | Telegram only | Telegram + Email + Voice | Telegram + Email + Voice + SMS |
| Voice (ElevenLabs) | 1 voice (text only — no synthesis) | 6 curated voices, synthesis enabled | 6 voices + custom voice clone |
| Video avatar (HeyGen) | none | static avatar image | full real-time HeyGen avatar |
| Task spawn budget / day | $5 | $15 | $50 |
| MCP plugins enabled | web-search, calendar-read | web-search, calendar-rw, gmail-read, playwright-browser | all MCP plugins including gmail-rw, stripe-rw, custom integrations |
| Custom integrations (Zapier-style) | 0 | 3 | unlimited |
| Dedicated Supabase project | no (shared, RLS) | no (shared, RLS) | yes |
| Dedicated voice/avatar tier | no | yes | yes + custom |
| API key for `your9-api.mjs` | 100 req/min | 300 req/min | 1000 req/min |
| Soul Code customization layer | name + voice + autonomy 1-5 | full Layer 2 | full Layer 2 + per-domain context overrides |
| Support response SLA | 24 h email | 4 h email | 1 h email + Telegram escalation |

The matrix file is the single source of truth. `your9-hub.mjs` reads it on every startup and on every webhook that signals a tier change. The existing `TIER_CONFIGS` blocks in `scripts/your9-billing.mjs` lines 96-127 and `scripts/your9-provision.mjs` lines 153-181 are duplicated today and must be unified into this single file as part of the implementation. Enforcement points: model selection in `your9-ceo-reasoning.mjs`, agent spawn in `your9-add-agent.mjs`, voice synthesis in `your9-agent-voice-email.mjs`, MCP plugin loader (to be built), API rate limit middleware in `your9-api.mjs`. Each enforcement point reads from the matrix — never from the customer's `.env` directly — so a customer cannot escalate their tier by editing local files.

---

## 5. Telemetry and Monitoring Hooks

Central 9 must observe the fleet to keep customers alive, but cannot read customer message content. The split:

**What flows up to central telemetry (every 5 minutes via outbound HTTPS POST from the customer hub to `https://telemetry.9enterprises.ai/ingest`):**
- Hub liveness: timestamp of last successful heartbeat, hub uptime, last process restart reason
- Resource usage: RSS memory, CPU minutes, disk used in `instances/{id}/data/`
- Cost telemetry: tokens used today (input + output by model), estimated cost in USD, percentage of monthly budget consumed
- Engagement counters: messages received today, messages sent today, tasks created today, tasks completed today
- Quality signals: task failure count, escalation count, NPS score (when the customer responds to an in-Telegram one-tap rating after a delivered task)
- Tier compliance: agent count vs cap, API call count vs cap, payment status from `instances/{id}/data/billing.json`
- Channel health: Telegram poll lag, voice tunnel reachability, email send error rate

All of the above are aggregated counters and gauges. None of them carry message bodies, task descriptions, customer names, contact info, or any text the customer typed.

**What never flows up:**
- Message content (Telegram, email, voice transcripts, SMS)
- Task descriptions or task outputs
- Customer's calendar events, contacts, files, or any third-party integration data
- The customer's chosen Soul Code customizations (kept in the instance only)
- Anything the customer marks private with `/private` in chat

**Implementation.** The telemetry collector is a small Cloudflare Worker that writes incoming JSON to a central Postgres time-series table (`telemetry.events`) plus a hot Redis store for the dashboard. Customer hubs sign every payload with `YOUR9_INSTANCE_SECRET` (already generated by the provisioner) so the collector can verify origin without holding any customer credentials. The collector validates every incoming key against an allowlist defined at `config/telemetry-allowlist.json` — any key not on the list is dropped at the edge and an alert fires to the central 9. This is how we mechanically prevent a sloppy code change from leaking customer content into telemetry.

**Per-customer event log.** Every customer instance writes its full structured event log to `instances/{id}/logs/events.jsonl`. This log is the customer's property: it can be exported via the dashboard or via `GET /api/v1/events/export` and the customer can delete it on demand (compliance requirement for the planned GDPR scope).

**Alerting.** If a customer hub heartbeat is missing for more than 2 minutes, the central telemetry collector fires three notifications in parallel: (1) a Telegram message to the customer in their existing bot ("Your9 is recovering — back in under a minute"); (2) a PagerDuty page to the on-call engineer at 9 Enterprises; (3) a Slack message to the `#your9-incidents` channel. The customer sees the recovery message immediately so they never wonder if anything is wrong; the engineer fixes it; and the postmortem is automatic. Two-minute threshold matches the existing `comms-hub.mjs` terminal-watchdog window so the SLO numbers are consistent.

---

## 6. Upgrade Path: Consumer Pepper to YOUR OWN 9 Pepper

Today's "consumer Pepper" is the single hosted Pepper that all consumers chat with via the `jules-telegram` process (now Pepper, per `project_pepper_product_spec.md` lines 11, 26). Every consumer talks to the same Pepper process but with per-user memory isolation (one row per user in the shared memory store). It is a Layer 2 of Option B, the very thing the Apr 9 lock rejected for paid customers — but it is acceptable for the free / discovery surface because no money has changed hands and no real-identity promise has been made.

When a consumer pays and upgrades to YOUR OWN 9, the migration runs as follows.

**Step 1 — Consent capture.** Inside the existing shared Pepper, when the customer clicks "Upgrade to YOUR OWN 9", Pepper sends a one-message consent request: "I'm about to copy our entire history into your private instance. Once it's done, this shared Pepper will forget our conversations. Confirm?" Customer types YES.

**Step 2 — Export.** A new endpoint `POST /api/pepper/export-for-upgrade` on the shared Pepper hub (to be built) extracts everything tied to that user_id from the shared Pepper memory: messages, learned preferences, soul-code customizations, voice/name selection, task history, attached files. Output is a single signed JSON-Lines bundle written to `tmp/pepper-export-{userId}-{timestamp}.jsonl` with a HMAC signature using a shared secret between the shared Pepper and the YOUR OWN 9 provisioner.

**Step 3 — Stripe checkout.** Customer is sent to the standard YOUR OWN 9 Stripe checkout flow with the export bundle reference passed as `metadata.import_bundle_id`. On payment success the Stripe webhook fires the same provisioning sequence from Section 3.

**Step 4 — Provisioning with import.** The provisioning worker, before generating defaults, calls `scripts/your9-import-from-shared.mjs` (to be built) with the bundle reference. The importer verifies the HMAC, then writes the imported messages into `instances/{id}/data/9-memory.db`, the imported soul-code customizations into `instances/{id}/config/soul-code.json`, the imported preferences into the new customer's personalization layer, and the voice/name selection so the new instance launches with exactly the same persona the customer had on the shared Pepper. No re-onboarding chat is shown — the migrated customer goes straight from "click upgrade" to "your private Pepper, with our full history, is online" in under 90 seconds.

**Step 5 — Source-side cleanup.** Once the per-instance hub confirms successful import (sends a signed `import.confirmed` callback to the shared Pepper hub), the shared Pepper deletes the migrated user's rows from the shared memory store and writes an audit row at `data/pepper/migrations.jsonl`. The export bundle in `tmp/` self-deletes after 24 hours regardless of import status.

**Delta validation.** The importer computes a hash of the source messages count, the sum of all message timestamps, and the size of the largest blob — and the same on the destination. If the hashes diverge, the migration is rolled back automatically (destination instance is destroyed, source is left intact, customer sees a "we hit a snag, let's try again in 5 minutes" message). The customer can never end up in a state where their conversation history is half-migrated.

**UX promise.** From the customer's point of view, they pay, click a link, and 90 seconds later their Pepper is in their own Telegram bot (the new dedicated bot from the warm pool) saying "I'm here. Same me. Now nobody else can read what we talk about." That is the moat-defining moment for this product line. Anything less than that — any "import in progress, please wait", any "your old conversations are not yet available" — undermines the entire pitch and must be designed out.

---

## 7. Open Questions for Owner

The spec resolves the six architecture questions in Sections 1-6 but cannot answer the following without explicit Owner direction. Each question has a recommended default that the implementer can use if no answer comes back within 24 hours.

1. **Compliance scope at GA.** SOC 2 Type II is deferred to Series A per `project_pepper_product_spec.md`. Should YOUR OWN 9 launch with a documented but uncertified set of SOC 2 controls (the "we're audit-ready, not audited" position), or should we ship without SOC 2 framing entirely until paid pilots demand it? **Recommended default:** audit-ready position, no certification claimed.

2. **GDPR and HIPAA scope.** Does Tier 1 GA include the EU and any healthcare-adjacent customers? The spec assumes US-only and no PHI. **Recommended default:** US-only, no PHI, EU and healthcare deferred to v2.

3. **Pre-warmed Telegram bot pool size.** The spec assumes 20 warm bots. Telegram's BotFather imposes friction on programmatic bot creation; we may need to provision them manually in batches. **Recommended default:** start at 20, refill manually until we automate via TDLib.

4. **Per-Enterprise dedicated Anthropic API key vs shared key with usage tagging.** A dedicated key per enterprise customer is the cleanest privacy story but adds Anthropic billing complexity. **Recommended default:** shared key with `metadata.customer_id` tagging until an enterprise customer demands a dedicated key as a condition of signing.

5. **Support model at GA.** The matrix promises 24h / 4h / 1h SLAs. Who is on call? Is there a human, or is the SLA met by the AI escalation chain? **Recommended default:** AI escalation handles everything except billing and outage; billing and outage page Owner directly until we hire a human.

6. **Pepper voice clone for Enterprise tier.** The matrix promises ElevenLabs custom voice cloning. ElevenLabs requires the customer to record ~10 minutes of audio and grant rights. Is the friction worth the differentiation at Enterprise, or should we cap at the six curated voices? **Recommended default:** ship with curated voices only, voice clone unlocked at $2,499 in v1.1.

7. **Migration pricing for upgrading consumer Pepper users.** Should there be a discount or bonus credit for users who migrate from the shared Pepper to YOUR OWN 9 in the first 30 days post-launch, to seed early adoption? **Recommended default:** $100 first-month credit on Starter for migrating users only.

---

## Appendix A — Build Order (informative, not a roadmap)

The seven artifacts that must be built or modified to ship this spec:

1. `templates/pepper/soul-code-base-v1.json` — canonical inherited Soul Code
2. `config/your9-tier-matrix.json` — single source of truth for Section 4
3. `scripts/your9-provision-worker.mjs` — Stripe-webhook-driven provisioning queue
4. `scripts/your9-bot-pool.mjs` — pre-warmed Telegram bot pool manager
5. `scripts/your9-soul-code-sync.mjs` — three-way merge updater for Section 2
6. `scripts/your9-import-from-shared.mjs` — Section 6 migration importer
7. Telemetry collector Cloudflare Worker + `config/telemetry-allowlist.json`

Plus modifications to: `scripts/your9-provision.mjs` (Supabase Management API call for Enterprise), `scripts/your9-billing.mjs` (webhook handler for `customer.subscription.updated`), `scripts/your9-hub.mjs` (read tier matrix at startup, register with telemetry collector, emit allowlisted metrics every 5 minutes), `scripts/memory-db.mjs` (per-customer Keychain service name lookup).

No new third-party vendors. No new AI providers. All inside the existing universe.
