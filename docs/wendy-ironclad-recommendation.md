# Ironclad Continuity Stack: v1 vs v2 Evaluation & Implementation Recommendation

**Author:** Wendy, Super Consultant & Platform Orchestrator, 9 Enterprises
**Date:** April 6, 2026
**For:** 9 (CEO) and Owner
**Status:** RECOMMENDATION -- ready for immediate execution on approval

---

## Executive Summary

v1 is buildable. v2 is aspirational. The right answer is v1's architecture with three surgical upgrades from v2, executed by us (AI agents, no human devs) on our actual budget and foundation.

---

## Honest Comparison

### What v1 Gets Right

v1 is a clean, layered defense stack that directly maps to our failure history. Every layer solves a real problem we have actually experienced: session amnesia (L1/L3), false completions (L4), Mac SPOF (L6), silent failures (L7). The tools it picks -- Supabase, pgvector, Airtable/Notion -- are things we can actually set up and maintain. The build order is sane.

### What v2 Adds

| v2 Addition | Genuinely Needed? | Verdict |
|---|---|---|
| L0 Temporal.io durable execution | No | Over-engineering for our scale |
| Mem0 memory abstraction | No | Adds a layer we must maintain for marginal benefit |
| Graph database (Weaviate/Neo4j) | No | 12-15 companies do not need graph traversal |
| Multi-agent eval harness | Partially | Good concept, wrong implementation |
| Terraform IaC + multi-region | No | We have one VPS. IaC is overhead we cannot justify |
| OpenTelemetry + Grafana + LangSmith | Partially | Full observability stack is right, but the specific tools are wrong for our team |
| Layered cognitive memory (procedural/semantic/episodic/strategic) | Yes | This is the one genuinely valuable conceptual upgrade |

### What v2 Gets Wrong

**1. Temporal.io is the wrong tool for us.** Temporal is designed for distributed microservice orchestration at scale -- ride-hailing dispatch, payment pipelines, multi-step order fulfillment across dozens of services. We have 4 background agents on a single Mac with a DigitalOcean VPS coming. Our "workflows" are: read memory, do task, write result. A durable execution backbone for this is like buying an aircraft carrier to cross a river. More critically, Temporal requires a self-hosted server (or Temporal Cloud at $200+/mo), a worker fleet, and SDK integration into every agent. That is weeks of setup work that 9 and sub-agents must maintain forever. Our session-handoff daemon already checkpoints every 60 seconds. Making that daemon write to Supabase instead of local files gives us 90% of Temporal's value at 5% of the complexity.

**2. Graph databases solve a problem we do not have yet.** At 12-15 companies, the relationship graph is small enough to fit in a single PostgreSQL query with joins. Neo4j or Weaviate add: a new database to host, a new query language to maintain (Cypher/GraphQL), a new failure mode to monitor, and a new cost center. Supabase pgvector handles semantic search over memories. PostgreSQL foreign keys handle entity relationships. If we hit 50+ companies with deep cross-entity dependencies, we revisit. Not before.

**3. Terraform + multi-region is premature infrastructure.** We are migrating FROM a single Mac TO a single VPS. Terraform codifies infrastructure that changes frequently across multiple environments. We have one environment. A simple Docker Compose file or even a shell provisioning script on the VPS gives us reproducibility without the Terraform learning curve and state management overhead.

**4. The observability stack is right in concept, wrong in execution.** OpenTelemetry + Grafana + LangSmith is three new systems to deploy, configure, and maintain. Sentry (free tier) for errors + UptimeRobot/Betterstack for uptime + our existing Telegram alerting covers 80% of the value. We add structured logging to a central destination (Supabase table or Betterstack) and we are covered for Phase 1-2.

---

## What We Should Take From v2

Three ideas from v2 are worth adopting:

### 1. Layered Memory Model (adapted)

v2's cognitive memory taxonomy -- procedural, semantic, episodic, strategic -- is the right mental model. We implement it inside our existing stack:

| Memory Type | What It Stores | Implementation |
|---|---|---|
| Procedural | Active tasks, agent assignments, workflows in progress | Notion task boards (already planned) |
| Semantic | Company knowledge, decisions, product specs, contacts | Supabase PostgreSQL + pgvector for search |
| Episodic | Session summaries, conversation history, crash recovery | Supabase table with auto-write (v1 L1 + L3) |
| Strategic | Cross-company patterns, Owner preferences, lessons learned | Pinecone namespace with curated embeddings |

No new databases. No Mem0 abstraction layer. Just a naming convention and schema design applied to tools we are already deploying.

### 2. Automated Eval Over Single Audit Agent

v1's L4 is a single audit agent checking work. v2's multi-agent eval harness is better in principle but over-specified. Our adaptation: every squad gets a QC agent as part of its charter (already in the Unified Execution Plan org chart). The QC agent runs predefined checks -- not a generic eval framework, but task-specific verification scripts. "Did the deploy return 200?" "Does the new page pass Lighthouse > 80?" "Did the database write succeed?" This is v2's eval concept implemented as simple bash checks, not a harness.

### 3. Structured Agent Observability

Not OpenTelemetry. But every agent writes structured logs to a single Supabase table: timestamp, agent_id, action, result, duration, error. One table. One query interface. Wendy runs a daily health query against it. This gives us 80% of LangSmith's agent-tracing value at zero additional infrastructure.

---

## Recommended Implementation Path

This integrates into the Unified Execution Plan timeline already approved:

### Week 1 (April 7-12) -- Foundation + Memory Schema

1. Deploy Cloud Worker to Cloudflare (Mac SPOF, already planned)
2. Design and deploy Supabase memory schema with the 4-type model above
3. Set up Pinecone project, create `strategic` namespace
4. Wire comms-hub and session-handoff daemon to write episodic memory to Supabase (replaces local file writes -- this is our "poor man's Temporal")
5. Stand up Notion workspace with squad boards (procedural memory)
6. Deploy Sentry free tier on AiNFLGM + comms-hub

### Week 2 (April 13-19) -- Verification + Observability

7. Build agent activity log table in Supabase (structured observability)
8. Wire QC checks into squad workflow (task-specific, not generic harness)
9. Implement 3-state task verification: Pending / In Progress / Verified
10. First 20 automated tests in CI
11. Begin pgvector semantic search on episodic + semantic memory
12. DR drill #1

### Week 3 (April 20-26) -- Integration + Hardening

13. Pinecone strategic memory populated with curated Owner directives, cross-company lessons
14. Wendy daily health query operational against agent activity log
15. Intake Pipeline v1 live
16. 14-day health monitor run begins
17. Phase 1 gate check: target 70/100

### Month 2 -- Scale

18. Full pgvector search across all memory types
19. Expand QC agents to all active squads
20. If observability gaps remain, evaluate Betterstack paid tier (not Grafana)
21. Second DR drill with improved RTO targets

---

## Tools We Are Using

| Tool | Purpose | Cost | Already Approved |
|---|---|---|---|
| Supabase (PostgreSQL + pgvector) | Episodic + semantic memory, structured logs, auth | Free tier initially | Yes |
| Pinecone | Strategic memory, vector search at scale | ~$70/mo | Yes |
| Notion | Procedural memory, task boards, dashboard | ~$10/mo | Yes |
| Sentry | Error monitoring | Free tier | Yes (Unified Plan) |
| Cloudflare Workers | Failover, squad provisioning | ~$5/mo | Yes (existing) |
| DigitalOcean VPS | Off-Mac compute | ~$6/mo | Yes (existing) |

**Total new spend: ~$86/month.** Reserve stays intact for scaling.

## Tools We Are NOT Using

| Tool | Why Not |
|---|---|
| Temporal.io | Over-engineering. Session-handoff daemon + Supabase writes = sufficient durability. |
| Neo4j / Weaviate | 12-15 companies do not need graph traversal. pgvector + foreign keys cover it. |
| Mem0 | Abstraction layer we must maintain. Direct Supabase/Pinecone writes are simpler. |
| Terraform | One VPS does not need IaC. Docker Compose or shell script suffices. |
| OpenTelemetry | Too much infrastructure for our team size. Structured Supabase logs instead. |
| Grafana | Requires hosting. Notion dashboard + Supabase queries cover our needs. |
| LangSmith | Agent tracing is useful but adds another SaaS dependency. Supabase activity log first. |

---

## The Bottom Line

v2 was built for a team with human DevOps engineers who can babysit Temporal clusters and Grafana dashboards. We do not have that team. Every tool we add is a tool 9 and sub-agents must configure, monitor, and debug when it breaks at 3 AM.

v1's architecture is sound. We enhance it with v2's memory taxonomy, squad-level QC, and structured agent logging -- all implemented on tools we are already deploying. No new infrastructure. No new databases. No new orchestration layers.

The memory problem gets solved by writing to Supabase in real-time (not at session end), searching with pgvector (not loading everything), and curating strategic knowledge in Pinecone. That is three layers of defense using two databases we already need.

Build it this way. Revisit in 90 days when we have real usage data to justify heavier tooling.

-- Wendy

