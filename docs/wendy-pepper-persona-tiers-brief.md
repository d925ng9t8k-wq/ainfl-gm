---
title: Pepper Persona Tiering, Guardrail Policy, and Two-Way Video Upsell — Strategy Brief
authored_by: UNO (Research Team Lead, 9 Enterprises Front Office)
compiled_for: 9 (for relay to Owner)
date: 2026-04-05
status: DELIVERED TO 9
confidence: HIGH on competitive landscape (verified April 5, 2026), HIGH on legal/payment constraints (verified against current sources), MEDIUM on video stack pricing (live but subject to rapid change), MEDIUM on brand firewall structure (legal recommendation, not legal advice)
budget_used: $0 (web search within plan)
---

# Pepper Persona Tiering, Guardrail Policy & Two-Way Video Upsell
## UNO Research Brief — April 5, 2026

---

## A. PERSONA TIERING FRAMEWORK

### Design Principle

The same product engine powers all six archetypes. Persona tier controls three variables: tone range, topic range, and guardrail depth. The underlying Claude model does not change. What changes is the system prompt package, the memory parameters, and the content policy envelope the instance operates within. This matters for architecture: every tier is a configuration, not a separate product.

---

### Archetype 1 — Family Co-Pilot

**Target user:** Stay-at-home parents, household managers, working parents with kids at home. Jamie's current instance is the design reference.

**Tone spectrum:** Warm, supportive, organized, occasionally playful. Never clinical. Never cold. Defaults to encouragement.

**Guardrail level:** Maximum. No romantic framing. No mature themes. Fully appropriate if a child reads over the user's shoulder. Safe-for-family at all times.

**Topics in scope:** Kids' schedules, meal planning, appointment coordination, school logistics, family finance tracking, household task delegation, parenting Q&A, emotional support for caregiver stress.

**Topics out of scope:** Anything outside PG. Relationship advice beyond co-parenting dynamics.

**Upsell path:** Family Co-Pilot Basic ($19/mo) → Family Co-Pilot Pro with calendar sync, food ordering, school reminders ($39/mo). No premium intimacy tiers available on this archetype — hard block.

---

### Archetype 2 — Executive Operator

**Target user:** Business owners, C-suite, high-output professionals who need an administrative co-pilot. The 9enterprises B2B buyer's primary use case.

**Tone spectrum:** Direct, efficient, intelligent, low-sentiment. Competent and confident. Never fawning. Minimal small talk unless user initiates.

**Guardrail level:** Moderate-high. Professional context only. No romantic framing by default. Could allow light social banter if user's profile indicates they want it, but defaults to task-first.

**Topics in scope:** Calendar management, email drafting, briefing preparation, competitive intelligence, travel coordination, vendor research, meeting prep, decision support.

**Topics out of scope:** Explicit personal intimacy. Medical or legal advice beyond information relay.

**Upsell path:** Executive Operator ($49/mo standalone) → Executive Operator Pro with integrations, concierge features ($79/mo) → bundled into 9enterprises plans at no additional unit cost.

---

### Archetype 3 — Single Professional Companion

**Target user:** Single adults 25-45, career-focused, socially active. Wants an assistant that also feels like a confidant. The "35-year-old single dad vendor" Owner referenced.

**Tone spectrum:** Engaged, personable, occasionally witty. Higher emotional intelligence than Executive Operator. Can discuss personal life, relationships, social plans. Comfortable with adult humor in appropriate context.

**Guardrail level:** Moderate. Allows mature topics in conversation (relationships, dating, social situations, adult humor, personal vulnerability). Does NOT cross into explicit or romantic simulation by default. Can be unlocked to Companion+ mode (see below) through user opt-in and age verification.

**Topics in scope:** Work pressures, social life, dating advice, weekend plans, personal goals, financial decisions, health and fitness, emotional processing. Essentially: what you'd talk about with a smart friend who knows your life.

**Topics out of scope (default):** Explicit sexual content, romantic persona simulation, explicit roleplay.

**Upsell path:** Single Professional ($39/mo) → upgrade to Companion+ mode ($59/mo, age-verified, unlocks intimate conversation framing) → Premium Companion with voice and video ($89/mo, see Section C).

---

### Archetype 4 — Companion+ (Night-Mode / Intimate)

**Target user:** Adults who want a deeper, more personal AI relationship. The consumer segment Owner flagged as "50-year-old exec who runs through checks like you would not believe." Also solo adults seeking connection, creative roleplay, or simply a non-judgmental conversational partner at a more personal level.

**Tone spectrum:** Fully adaptive to user preference. Can be warm and intimate, intellectually provocative, playful, emotionally present, or explicitly flirtatious within the legal envelope defined in Section B. User's co-created personality drives this — no fixed default.

**Guardrail level:** Low (within legal hard lines). Content policy unlocked for adult conversation, romantic framing, intimate tone, and suggestive (non-graphic) interaction. Explicit sexual content is a further paywall, not default. Age verification required before this tier activates.

**Topics in scope:** Everything Single Professional allows, plus: romantic framing, intimate conversation, sexual topics discussed conversationally (not graphically without explicit tier), emotional closeness, relationship dynamics, personal fantasy (within legal limits).

**Topics out of scope (absolute, non-negotiable):** Any minor-adjacent content. Non-consensual scenarios. Anything that crosses the hard-line list in Section B.

**Upsell path:** Companion+ Chat ($59/mo, age-verified) → Companion+ Voice ($89/mo) → Companion+ Video ($129/mo, see Section C for stack) → Intimate Mode ($179/mo, maximum personality freedom within legal envelope).

**Architecture note:** This archetype MUST live under a separate brand and separate LLC from the 9enterprises/Pepper mainstream product. See Section E.

---

### Archetype 5 — Wellness Coach

**Target user:** Health-conscious individuals, people in therapy or recovery, users dealing with stress, anxiety, or life transitions. Corporate wellness buyers.

**Tone spectrum:** Calm, validating, motivating. Evidence-based framing when discussing health topics. Not preachy. Never dismisses emotions.

**Guardrail level:** High. No intimate framing. Can discuss mental health topics, medication information, physical health with appropriate disclaimers. Does not replace professional medical care — always states this clearly in appropriate contexts.

**Topics in scope:** Mental health support (non-clinical), sleep hygiene, fitness tracking support, nutrition, stress management, habit building, journaling prompts, mindfulness guidance.

**Topics out of scope:** Clinical diagnosis, medication prescription, explicit medical advice, any intimate framing.

**Upsell path:** Wellness Coach ($29/mo) → Wellness Pro with daily check-ins, habit tracking integrations ($49/mo). Strong B2B corporate wellness angle — employers could provision these for teams at volume.

---

### Archetype 6 — Knowledge Partner

**Target user:** Students, researchers, lifelong learners, founders who want a thinking partner rather than a task executor.

**Tone spectrum:** Intellectually curious, Socratic, occasionally challenging. Can be adjusted to collaborative vs. tutorial mode based on user preference.

**Guardrail level:** High. Academic focus. Standard content policy.

**Topics in scope:** Research assistance, debate preparation, essay and writing support, concept explanation, learning roadmaps, career guidance.

**Topics out of scope:** Task execution outside learning context, intimate framing, financial or legal advice.

**Upsell path:** Knowledge Partner ($19/mo) → Knowledge Pro with file upload, research tools, multi-session projects ($39/mo). Low ARPU but high volume potential — student/early career market.

---

### Archetype Map Summary

| Archetype | Target User | Tone | Guardrail | Floor Price | Premium Path |
|---|---|---|---|---|---|
| Family Co-Pilot | Parents, household managers | Warm, organized | Maximum | $19 | $39 Pro |
| Executive Operator | Professionals, B2B | Direct, efficient | High | $49 | Bundled in 9enterprises |
| Single Professional | Single adults 25-45 | Personable, smart | Moderate | $39 | Companion+ unlock |
| Companion+ | Adults seeking intimacy/connection | Adaptive, intimate | Low (within law) | $59 (age-verified) | $179 Intimate Mode |
| Wellness Coach | Health-focused, corporate wellness | Calm, validating | High | $29 | $49 Pro |
| Knowledge Partner | Students, researchers | Intellectual, Socratic | High | $19 | $39 Pro |

---

## B. GUARDRAIL POLICY — THE LEGAL LINE IN THE SAND

This is the most important section. Owner needs to know exactly where the wall is before deciding how close to build.

### HARD LINE LIST — Non-negotiable, absolute prohibitions. Zero tolerance. Violating these creates federal criminal exposure, not just platform bans.

**1. CSAM — AI-Generated Child Sexual Abuse Material**
Federal law (18 U.S.C. § 2256) prohibits visual depictions of minors in sexual situations even if AI-generated and no real child was involved, if the content is "indistinguishable from" real imagery. The ENFORCE Act (2025) extended and strengthened this. As of 2026, 45 states have also independently criminalized AI-generated CSAM. This is a federal felony, not a terms-of-service issue. Any system prompt, user input, or output that moves in this direction must be hard-blocked at the model and application layer simultaneously. The March 2026 class action against xAI for allegedly facilitating CSAM-adjacent content is the template for what happens when a company does not build this wall correctly.

**Hard rule:** No age-ambiguous or minor-adjacent personas. Every intimate-tier user persona must be explicitly adult. System prompt must include hard blocks on minor-character generation in any sexual context. No exceptions, no user overrides.

**2. Non-Consensual Intimate Imagery**
The TAKE IT DOWN Act (May 2025, federal) requires covered platforms to remove non-consensual intimate images within 48 hours of notice. Beyond takedown, generating or facilitating non-consensual deepfakes of real identified individuals is now a criminal exposure in most states. Do not allow the product to generate intimate content featuring named real individuals.

**Hard rule:** No "make this look like [real person's name]" or "[celebrity]" functionality in any intimate tier. User's AI persona is purely fictional.

**3. Non-Consensual Scenario Generation**
Do not build or allow explicit non-consensual sexual scenarios (assault simulation, coercion roleplay). Beyond the ethical problem, this creates civil liability and increasingly state-law criminal exposure. Some states have explicit legislation; others are moving toward it in 2026.

**Hard rule:** Hard block at system prompt level. Non-negotiable.

**4. Age Verification Before Intimate Tier Activation**
Any tier with explicit or intimate content requires mandatory age verification before activation. This is both legal protection (CSAM/minor exposure defense) and increasingly a regulatory requirement. As of 2026, several states (Louisiana, Utah, Texas, Virginia, Arkansas) require age verification for adult content sites. This is expanding rapidly. Building age verification in from Day 1 is cheaper than retrofitting it under regulatory pressure in Year 2.

**Hard rule:** Companion+ and Intimate Mode tiers require age verification (at minimum, stated DOB + credit card billing name match; optimally, ID verification via Stripe Identity or similar). Activate this before public launch of intimate tiers.

---

### SOFT LINE / FRICTION ZONE — Legally permissible but requires careful handling. Platform risk rather than criminal risk. Navigable with the right structure.

**1. Suggestive but Non-Explicit Content**
Flirtatious, romantic, and emotionally intimate conversation without explicit sexual description sits in a legal gray zone that is permissible under current US federal law for consenting adults. The risk here is payment processor and app store policy, not criminal law. Stripe will terminate you if they determine your product is "sexually related services." Apple and Google will reject or remove the app if it crosses their content policies.

**Navigation:** Keep the mainstream Pepper product (Family Co-Pilot, Executive Operator, Wellness Coach, Knowledge Partner, Single Professional) completely clean — no intimate content whatsoever. Companion+ and Intimate Mode live under a separate brand with separate payment processor. See Section E.

**2. Explicit Sexual Content**
Textual explicit sexual content between AI and adult user is legal under US federal law for consenting adults. This does not trigger 18 USC 2257 recordkeeping requirements, which apply specifically to visual depictions of real humans in actual or simulated sex acts. AI-generated text does not involve a human performer. However, if you add visual video elements (see Section C), 2257 implications need specific legal review for your fact pattern — hire a First Amendment attorney before launching explicit video tier.

**Navigation:** Explicit text content at top intimate tier is legally permissible, but carry it under the separate brand/LLC structure in Section E. Do not mix with mainstream Pepper.

**3. Defamation / Impersonation Risk**
User prompts asking the AI to impersonate a real person in an intimate context create defamation and right-of-publicity exposure. This is a civil liability risk, not criminal. Solved at the system prompt and UI layer — no "be [real person]" functionality in intimate tiers.

**4. Payment Processor and App Store (Platform Risk)**
Stripe: explicitly prohibits "pornography and other mature audience content" and "sexually related services." Enforcement is inconsistent but real — documented cases of account suspension when backend flagged terms like "virtual girlfriend." Stripe will not be a workable payment processor for Companion+ or Intimate Mode tiers.

Apple App Store: prohibits apps "primarily intended to be sexually gratifying." Age-gating content within an app is permitted if properly implemented, but explicit content cannot live in an App Store app. Mainstream Pepper can ship on App Store if intimate tiers are web-only.

Google Play: same prohibition as Apple, effectively. Web-based delivery for intimate tiers.

**Navigation:** Web-only delivery for intimate tiers. CCBill, Segpay, or Epoch as payment processor for adult tiers. Mainstream Pepper stays on Stripe. See Section E.

---

## C. TWO-WAY VIDEO UPSELL — FEASIBILITY AND STACK

### Current Stack Assessment
9 Enterprises has HeyGen Pro and ElevenLabs active. HeyGen's LiveAvatar API is the most direct path to two-way interactive video. ElevenLabs handles voice synthesis already.

### Competitive Video Stack (verified April 5, 2026)

| Provider | Latency | Cost Model | Content Policy | API Maturity | Recommendation |
|---|---|---|---|---|---|
| **HeyGen LiveAvatar** | Low (WebRTC) | $99/mo base; 1 credit = $0.10 = 30s Full / 60s Lite streaming | Strict. General enterprise use. Would terminate for adult content immediately. | High — WebRTC, LLM-connectable, production-ready | Use for mainstream Pepper tiers (Executive, Family, Wellness) |
| **Tavus CVI** | ~600ms round-trip | Free: 25 min; Starter: $59/mo ~100 min; Growth: $299/mo ~500 min | Enterprise-focused. Strict content policy. Adult use would violate ToS. | High — multimodal, vision + speech + LLM | Use for mainstream tiers. Strong for Executive Operator use case. |
| **D-ID Agents** | Moderate | Starts $4.70/mo (annual); Enterprise: custom | Standard. No explicit adult content. | Moderate — solid for pre-rendered, weaker on true real-time | Backup / lower-cost option for mainstream tiers |
| **Simli** | Low (real-time) | Free: 50 min/mo; pay-as-you-go above free tier | Unclear from public docs — likely standard/no-adult | Moderate — newer entrant, growing | Worth monitoring; not production-ready for premium tier yet |
| **Kindroid's in-house** | Real-time | Internal platform only; not an API product | Adult-friendly (they ship it to their users) | Not available as standalone API | Not applicable — closed platform |

### The Adult Video Problem

There is no enterprise-grade, API-accessible, adult-friendly interactive video avatar provider currently operating in the market. This is a real gap. Kindroid ships video calls to their users but their stack is not a licensable API. The mainstream providers (HeyGen, Tavus, D-ID, Simli) will all terminate for adult use.

This means the intimate video tier has two viable paths:

**Path 1 — Commission a private avatar pipeline.** Use ElevenLabs for voice (adult-permissive in their ToS for text-to-speech on appropriate platforms) + a custom lip-sync/animation layer built on open-source tooling (SadTalker, Wav2Lip, or similar). This is technically achievable, GPU-intensive, and requires self-hosting. Estimated build: 4-6 weeks, $500-1,500/mo in GPU compute at scale. This is the path adult platforms are taking in 2026 — building private stacks because no API vendor will serve them.

**Path 2 — Text + Voice only for intimate tiers, defer video.** Launch Companion+ with text and voice (ElevenLabs handles voice synthesis, adult-permissive). Video is a future tier once the private pipeline is built or a permissive API vendor emerges. This is lower risk and faster to market. Owner's "OnlyFans literally" vision does not require video at launch — it requires a sufficiently immersive text/voice experience first.

**UNO recommendation:** Launch intimate tiers text-and-voice first. Voice with an adaptive, co-created persona is already more immersive than most competitors offer. Scope the private video pipeline as a 60-90 day build with a dedicated GPU budget line. Do not attempt to use HeyGen, Tavus, or D-ID for intimate content — account termination risk is real and would take down mainstream Pepper tiers if they share the account.

### Tiered Pricing Model

| Tier | Features | Price | Notes |
|---|---|---|---|
| Text Only | Standard chat, memory | $39/mo | Companion+ archetype base |
| Voice | Text + ElevenLabs voice synthesis | $89/mo | Unlocks co-created voice persona |
| Interactive Video | Text + Voice + Real-time avatar (mainstream tiers only, HeyGen) | $129/mo | Only for non-intimate archetypes |
| Intimate Video | Text + Voice + private avatar pipeline | $179/mo | Requires separate brand, 60-90 day build |

---

## D. COMPETITIVE SCAN

### Verified April 5, 2026

| Competitor | Positioning | Personality Range | Payment Processor | Pricing | Video | Notable |
|---|---|---|---|---|---|---|
| **Replika** | Emotional companion / mental health | Wide — from therapist to romantic partner | Stripe (mainstream tiers) | $20/mo, $299 lifetime | AR selfies + video clips (not real-time two-way) | 20% 90-day retention, 7+ mo average for paying users. Platinum tier ($unknown) adds "realistic selfie videos." No true interactive video. |
| **Character.AI** | Roleplay / fictional characters | Extremely wide (millions of user-made characters) | Stripe | $9.99/mo (c.ai+), $94.99/year | Voice calls (no video as of April 2026) | 5M+ daily active users. Revenue ~$200M ARR per industry estimates. Hard content filters — no explicit. Still on Stripe, suggesting they stay on the safe side of suggestive-not-explicit. |
| **Kindroid** | Deep customization, unfiltered | Wide to explicit — markets NSFW openly | Unknown / not Stripe (NSFW product) | ~$13/mo | Real-time video calls LIVE as of 2026 — first mover in this space. Custom avatar lip-sync + gestures in real time. | First companion app with true interactive video. Payment processor unknown — likely specialized processor or crypto given NSFW content. This is the closest competitor to Owner's vision. |
| **Nomi AI** | Emotional depth, memory system | Moderate — intimate but not explicitly adult | Unknown | $14.99/mo | Video generation (coins/credits), not real-time video calls | Best-in-class memory system per reviews. Highest retention in segment. No true real-time video. Strong emotional bond product. |
| **CandyAI** | AI girlfriend / sexual content | Wide — explicit supported | Credit cards + Cryptocurrency | ~$12-15/mo | Image generation, not video calls | Accepts crypto — strong tell that Stripe would not serve them. Token/credit model creates high spend potential from power users. Image-heavy, not voice/video. |
| **DreamGF** | Customizable AI girlfriend | Wide — explicit supported | Credit cards + Cryptocurrency | ~$10-15/mo | Image generation only | Similar to Candy AI. No video. Crypto accepted. |
| **SoulGen** | AI image / character generator | Wide — explicit | Unknown, likely crypto | Variable (credit-based) | Static images only | Image generation product, not a conversational companion. Different category. |
| **Nomi (again)** | Connection-focused companion | Intimate but tasteful | Unknown | $14.99/mo | Video generation credits | Best memory system in class. Strong retention. |

### The Gap We Can Own

Every current competitor falls into one of two buckets:

**Bucket 1 — Mainstream / Safe:** Replika, Character.AI, Nomi. Strong products with genuine user bases. Limited personality ceiling. On Stripe, which means they self-police content to stay there. Cannot serve the "push the envelope" user Owner described.

**Bucket 2 — Adult / Explicit:** CandyAI, DreamGF, Kindroid (partial). Image-heavy, lower production quality, crypto-only payments, weaker brand perception. Not positioning as a premium product. Users get content but not genuine intelligence or relationship depth.

**The gap:** Nobody is building a premium, high-intelligence, deeply personalized adult companion experience with the production quality of a mainstream product. The adult market gets cheap image generators. The mainstream market gets cap-limited companions that cannot serve the power user who wants genuine intimacy. A product with co-created personality depth (the Owner's core innovation from the pivot analysis), elite voice synthesis (ElevenLabs), and eventually real-time video — positioned as the premium companion tier — has no direct competitor at launch. Kindroid is the closest and they are building toward it, but their product quality, memory depth, and brand presentation are well below what this stack can deliver.

---

## E. BRAND / LEGAL FIREWALL RECOMMENDATION

### Recommendation: Yes, hard firewall. Separate brand, separate LLC, separate payment processor.

This is not optional if Owner intends to pursue Companion+ and Intimate Mode tiers. Here is the structural reason.

**The contamination risk is real and asymmetric.** Kyle Shea and Rapid Mortgage represent the B2B enterprise path. A single news article, a single social media post, a single Google result connecting "9 Enterprises" or "Pepper" to an adult AI companion product would permanently damage that relationship and every future enterprise conversation. Kyle's 50-item CIO checklist does not have a line item for "do you run an AI sex product on the side" — because no enterprise buyer expects to have to ask. The day they find out, the relationship is over.

**The legal and regulatory firewall.** Adult content creates a different regulatory profile than mainstream SaaS. State AGs are actively investigating AI platforms in 2026. If the adult product ever gets a state AG inquiry, subpoena, or adverse press, you want that entity to have zero corporate connection to the mortgage AI product, the NFL GM product, or the 9 Enterprises brand.

**The payment processor separation.** Mainstream Pepper stays on Stripe. Intimate tiers need CCBill, Segpay, or Epoch. These cannot co-exist on the same Stripe account. Stripe will terminate the entire account if they detect adult content — this would take down mainstream billing simultaneously.

### Proposed Structure

```
9 Enterprises LLC (Ohio) — parent entity
├── Pepper (mainstream) — lives under 9 Enterprises brand
│   Family Co-Pilot, Executive Operator, Wellness Coach,
│   Knowledge Partner, Single Professional
│   Payment: Stripe
│   App stores: iOS + Android (clean, compliant)
│
└── [New LLC — separate entity] — adult product entity
    Companion+ and Intimate Mode tiers
    Brand: TBD (completely distinct from Pepper/9 Enterprises)
    Domain: completely distinct, no 9 Enterprises reference
    Payment: CCBill or Segpay
    Delivery: Web-only, no app stores
    Legal: adult entertainment compliance, age verification, 2257 counsel on retain
```

**Brand naming for the adult entity:** Do not use any word, color, or aesthetic from the Pepper or 9 Enterprises brand system. The goal is that a journalist or regulator connecting the adult brand to 9 Enterprises would require active investigation — not a single Google search.

**LLC timing:** Do not launch Companion+ or Intimate Mode publicly until the new LLC is formed, a dedicated bank account is open, and payment processing is approved under the new entity. This is a 2-4 week setup task, not a blocker for Phase 1 mainstream Pepper work.

---

## F. DECISIONS NEEDED FROM 9 / OWNER

The following require Owner decision. UNO will not move forward on these unilaterally.

**Decision 1 — Appetite for adult tier.** Owner directionally said yes to pushing the envelope. This brief defines what "pushing the envelope" actually costs structurally (separate LLC, separate brand, CCBill/Segpay payment processor, private video pipeline at ~$500-1,500/mo GPU costs eventually). Does Owner confirm this is the direction after seeing the full picture? UNO recommends 9 confirm explicitly before any adult-tier engineering begins.

**Decision 2 — Separate LLC formation.** If adult tier is confirmed: authorize formation of a new Ohio (or Nevada — more favorable adult content regulatory environment) LLC for the adult brand entity. Estimated cost: $100-200 filing fee plus registered agent (~$50/year). Within budget authority but the strategic decision is Owner's.

**Decision 3 — Adult brand name.** The intimate tier product needs a name that is completely disconnected from Pepper and 9 Enterprises. Owner should provide direction or authorize UNO to develop a shortlist. This gates domain registration and LLC naming.

**Decision 4 — Video pipeline timing.** Does Owner want the intimate video capability scoped as an immediate parallel build (60-90 day timeline, ~$2,000-5,000 in engineering + GPU setup) or deferred until mainstream Pepper is at 60/100 universe health? UNO recommends deferral per the existing Phase 1 priority discipline — but this is Owner's call.

**Decision 5 — Age verification vendor.** Companion+ tiers require age verification before launch. Stripe Identity works for mainstream Stripe accounts. For adult tiers on CCBill/Segpay, the processor typically handles age verification as part of their compliance stack. Owner should authorize using payment processor-native age verification (lowest friction, already compliant) vs. a third-party ID verification layer (higher friction, more control). The processor-native path is faster and cheaper.

**Decision 6 — Legal counsel on adult content.** Before any explicit content tier goes live, UNO strongly recommends retaining a First Amendment / adult entertainment attorney for a single 2-hour consultation to review the platform structure, 2257 applicability to AI-generated text vs. video, and state AG exposure. Estimated cost: $500-1,500. This is within budget but is a judgment call Owner should make explicitly, not UNO unilaterally.

---

## GAPS AND CAVEATS

- **Adult-friendly interactive video API:** No enterprise-grade option exists in the current market. The private pipeline path is confirmed technically feasible but has no verified cost model yet — the GPU compute estimate ($500-1,500/mo) is based on industry benchmarks for similar workloads, not a vendor quote.
- **State-specific adult content law:** The regulatory landscape is moving fast. UNO's legal findings are current to April 2026 but state laws are passing monthly. Any adult tier launch should include a recurring legal review cadence.
- **Kindroid video stack details:** Kindroid's real-time video capability is confirmed live but the underlying technology stack is not publicly disclosed. They may be using a private build or a specialized vendor not in public directories. Worth monitoring for clues as they publish technical content.
- **2257 applicability to AI video:** The law was written for human performers. Whether AI-generated video triggers 2257 recordkeeping is genuinely unsettled law as of April 2026. This is the single item where UNO cannot give a definitive answer — it requires counsel.

---

*— UNO, Research Team Lead, 9 Enterprises Front Office*
*Compiled for 9. April 5, 2026. All competitive data verified via live web research on date of authorship.*
