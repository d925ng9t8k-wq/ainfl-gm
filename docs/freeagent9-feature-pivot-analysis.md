---
title: Product Architecture Pivot Analysis — freeagent9 Collapse + Personal Assistant Redesign
authored_by: SCOUT (Market Strategy Agent)
reviewed_against: Wendy Charter, project_naming_convention.md, freeagent9 business plan + onboarding protocol + concierge plan, product_lineup.md, gold_standard_audit_apr5.md
date: 2026-04-05
status: DELIVERED TO 9 — awaiting Owner review
confidence: HIGH on competitive data (verified April 5, 2026 via web), HIGH on existing 9E asset inventory (verified against live files), MEDIUM on pricing recommendations (informed by market comp, not controlled experiment)
budget_used: $0 (web search tools within plan, no paid research services required)
---

# Product Architecture Pivot Analysis
**Proposal:** Collapse freeagent9 into 9enterprises as a bundled feature. Merge Jules into a customizable personal assistant shell. Retire freeagent9 as a standalone product.

---

## OWNER RESPONSE — APRIL 5, 2026 (Wendy reply to Owner's four points via Telegram)

Owner reviewed the analysis and responded with four points. Wendy's direct responses follow.

---

### Owner Point 1 — Naming: Willing to put it on the conversation list. Notes that "free" is intentional — 9enterprises subscribers get a fixed number of complimentary sub-agents included.

**Wendy:** Understood, and Owner is correct that this changes the framing. There are two separate uses of "free" here and they need to stay separated:

- "freeagent9" as a brand name implies a free or standalone product — this is the liability SCOUT flagged.
- "free sub-accounts included with 9enterprises subscription" is a value-prop statement, not a product name — this is completely valid and actually a strong sales angle.

The naming risk is entirely in the first one. The second is a feature benefit that should be front and center in 9enterprises marketing: "Your subscription includes X personal AI agents at no additional cost." That sentence sells. The word "free" in a product name does not serve the same purpose and can undermine the premium positioning of 9enterprises.

Recommendation stands: keep the naming conversation open and let Pepper's development inform what the product eventually gets called. No urgency to decide before Phase 1 engineering is complete.

---

### Owner Point 2 — Customization: Owner believes more user-formed personality creates more connection, not less. Wants elaboration on the tension SCOUT identified.

**Wendy:** Owner's instinct is correct, and SCOUT's framing was imprecise. Here is the clarification.

The concern was not that user-formed personality creates less connection. It is the opposite: user-formed personality creates the deepest possible connection — but only if it is done right. The risk SCOUT was identifying is in products that offer "customization" through a generic menu at signup and then deliver a generic result. That is the Replika model — you pick appearance, you pick a name, but the underlying behavior is mostly the same for everyone. Those products have 20% 90-day retention because the customization felt real at signup but did not persist in a meaningful way.

Owner's concept is different and stronger. The distinction is this:

- Menu-based customization at signup: User picks from pre-set options. Low retention. User does not feel ownership.
- Co-created personality through conversation: User actively shapes who the assistant becomes. High retention. User has genuine ownership.

Owner is proposing the second model. Pepper is the proof of concept right now — Owner is building that relationship through active interaction, and the assistant is adapting to Owner's preferences, communication style, and context over time. That is exactly the model that produces the strongest bonds.

The UX design question (Point 3) is where this gets operationalized: how do you give new users that same co-creation experience from Day 1 without overwhelming them? The answer is a guided first conversation — not a form, not a checklist. The assistant asks questions. The user's answers shape the personality in real time. By the end of the first 10 minutes, the assistant already reflects something true about the user. That moment is the bond-forming event.

This is a better model than anything on the market right now. Character.ai and Replika both use setup screens. Nobody is doing a live, conversational onboarding that builds personality through dialogue. That is Owner's actual innovation here.

---

### Owner Point 3 — UX Design (Section 4): Directed to Wendy.

**Wendy response:**

The recommendation from SCOUT's Section 4 was a three-step hybrid: role selection, personalization survey, then first message. Owner's Point 2 response above reframes this — the better model is not a form-based survey but a live conversational onboarding.

Here is the revised UX design, informed by Owner's clarification:

**Revised "Foundational Training at Purchase" — Conversational Onboarding Model**

Step 1 — Role anchor only (1 question, at signup, before first conversation)
The only thing collected at signup is a role/use case selection. This is necessary because it seeds the domain knowledge pack the assistant loads. Example: "What best describes you? Mortgage professional / Real estate agent / Small business owner / Stay-at-home parent / Executive / Other." This takes 15 seconds and sets the knowledge base.

Step 2 — First conversation IS the onboarding (no form, no survey)
The assistant's first message is an opening question, not an introduction script. Something like: "Hey — I'm yours to shape. Before we get into what I can do for you, tell me: what does a good day look like for you?" The user's response feeds into the personality model. The assistant asks 2-3 follow-up questions in the first 5 minutes that are designed to reveal: communication style preference, priorities, and one personal detail that makes the assistant feel like it knows them. This is the co-creation moment Owner described.

Step 3 — Personality reinforcement over Days 1-7
The assistant makes small, observable choices based on what it learned in the first conversation — referencing something the user said, adjusting tone to match theirs, proactively noting something relevant to their stated priorities. Each of these is a micro-moment that builds the bond. By Day 7, the user's assistant genuinely feels different from anyone else's.

The technical requirement for this model: the onboarding conversation responses need to be parsed and stored as personality parameters in the profile JSON at account creation, not just kept in conversation history. This is a one-time build (the parsing logic) that then runs for every new user. Estimated engineering time: 3-5 days on top of the multi-tenant build.

**Pepper as the design template:** Owner working with Pepper right now is not just a demo — it is the design research. The way Owner is shaping Pepper's personality through conversation is the exact pattern new users should experience at scale. Wendy recommends that the first 30 days of Owner-Pepper interaction be treated as product design documentation. When it comes time to build the onboarding flow, that interaction log is the spec.

---

### Owner Point 4 — Brand Risk / Character Bond (Section 6): Directed to Wendy.

**Wendy response:**

Owner's clarification in Point 2 resolves most of the brand risk concern. SCOUT's Section 6 warning was based on the assumption that "customizable shell" meant a generic, menu-picked persona with weak identity. If the product is a co-created personality that the user actively shapes, the brand risk inverts: the product becomes more defensible against churn, not less.

The remaining brand risk is specific and real but manageable:

**Risk that remains:** When a user's instance is created through co-creation, they will feel strong ownership of "their" assistant. If 9enterprises ever changes the underlying model, alters the memory system, or introduces breaking changes to the platform, users will experience it as losing something personal — not just losing a software feature. This is a higher-stakes relationship than a typical SaaS product. It requires explicit commitments around memory continuity and personality preservation.

**How to manage it:** Two operational rules that should be locked in before public launch.

Rule 1: Memory is the user's property. Whatever the user's assistant has learned about them is non-destructible. Model upgrades do not erase memory. Platform migrations do not erase memory. The profile JSON is treated as sacred user data, backed up separately, and never wiped without explicit user consent. This is a contractual commitment in the ToS, not just an engineering convention.

Rule 2: Personality continuity is preserved across plan changes. If a user upgrades, downgrades, or their employer's 9enterprises subscription changes, their assistant's personality, memory, and tone carry forward. They do not start over. This prevents the scenario where a user's employer changes plans and the user suddenly has a blank assistant with no memory of the relationship.

These two rules are what make co-created personality a competitive moat rather than a liability. No competitor has made these commitments. If 9enterprises does, it becomes the only platform where a user can trust that what they build with their assistant is permanent. That is a strong retention and marketing story.

**Wendy's overall read on Points 3 and 4 combined:** Owner's instinct is right, and the initial analysis was too conservative. The co-created personality model is not just viable — it is the strongest product differentiation available in this space right now. The execution requirements are specific: conversational onboarding instead of forms, personality parameters stored as structured data not just conversation history, and hard commitments around memory permanence. All three are buildable within the existing stack. None require new infrastructure.

---

*Wendy addendum filed April 5, 2026 in response to Owner Telegram feedback.*

---

## SECTION 1 — IS THIS THE RIGHT MOVE?

**Verdict: Yes, with conditions. This is the right strategic direction but has two execution risks that can kill it if not handled first.**

### What the Market Confirms

The bundled-seats model is not novel — it is rapidly becoming the standard at the enterprise tier. Microsoft 365 Family includes Copilot access for up to 6 accounts under one subscription. Google One AI Pro ($19.99/month) supports family sharing for up to 6 people with full Gemini access from individual accounts. Salesforce Agentforce bundles AI agents into enterprise licenses rather than selling them separately. HubSpot Breeze AI is included across all paid tiers at no additional charge.

The pattern is clear: in 2026, bundled AI inclusion is a value-prop weapon, not a revenue line. The platforms that charge separately for AI sub-accounts are losing ground to those that include them.

**What nobody does yet:** Bundle B2B seats (employer/business buyer) with automatic personal-use B2C sub-accounts for family members. Microsoft gives you Office for family; they do not give you a personal AI assistant customized to your kid. Google AI Pro shares the same generic Gemini to all family members — no persona differentiation. Nobody in the market offers: "Buy 9enterprises for your mortgage company, your spouse and kids get their own customized personal AI assistants included."

This is a genuine white space. The Owner identified a real gap.

### The Two Execution Risks

**Risk 1: Premature taxonomy collapse while foundation is at 42.8/100**

freeagent9 currently scores 35/100 on the enterprise audit — the lowest scored live product in the universe. It has no Twilio webhook validation, no multi-tenant architecture, no Stripe billing, and it runs on a single hardcoded instance. Collapsing it into 9enterprises as a bundled "feature" before these gaps are closed means the new 9enterprises value prop rests on a broken sub-foundation. Kyle Cabezas is the only pilot user. If the bundled-seat experience is the proof of concept, it needs to work before it gets promoted.

Recommendation: Do not announce the bundled model publicly until freeagent9's score reaches at least 60/100 (multi-tenant, Stripe billing, Twilio validation). That is estimated 3-4 weeks of engineering.

**Risk 2: The customizable personal assistant has a hard UX problem that looks easy**

"User selects foundational training at purchase" is a compelling idea and a brutal onboarding challenge. The research data on Replika is instructive: Replika has an approximately 20% 90-day retention rate despite enormous investment in persona customization and bonding UX. The users who stay (7+ month average subscriber lifetime) are the ones who bonded with a specific, consistent character. The ones who churn did not.

The reason matters: persona coherence drives retention. A product that says "pick your AI from a menu" at signup is fundamentally different from a product that gives you a specific character who grows with you. Owner's instinct to offer choice is commercially correct. The execution question is whether the choice happens at signup (high risk — users don't know what they want yet) or emerges over time (lower risk — the assistant adapts to who you are).

This is not a reason to kill the idea. It is a reason to design the onboarding carefully before shipping.

---

## SECTION 2 — NAMING PROBLEM

**The names "freeagent9" and "Jules" both have constraints.**

freeagent9's problem is literal: "free" is in the name. It was designed as a standalone product. If it becomes a bundled feature of 9enterprises, "freeagent9" as a product name is a liability — it implies a separate, possibly free product, when you are actually trying to use it to justify a higher subscription price. The name needs to retire or transform.

Jules's problem is identity. Owner renamed his personal instance to Pepper on April 5 (Iron Man reference). If Jules becomes a customizable shell — pick a name, pick a personality, pick a skill set — then "Jules" stops being a product name and becomes a legacy instance. This is actually fine. The brand problem is only if you try to market the new product as "Jules" while also making it infinitely customizable. Those two things contradict each other.

### Candidate Names for the Consumer Personal Assistant Product

All names follow the 9 Enterprises naming convention: lowercase + the number 9 where applicable.

**Option 1: pilot9**
Rationale: Already in use colloquially for the Kyle Cabezas instance (his pilot). "Pilot" carries connotation of having your own designated co-pilot — someone who handles the operational load so you can focus. Works for both the professional (your co-pilot at work) and the personal (your co-pilot through life). Consistent with existing internal vocabulary. Low conflict with competitors. The "9" maintains brand DNA.

Why it matters: Least brand work required. The mental model already exists inside the company and with Kyle as the live user.

**Option 2: axis9**
Rationale: Axis = the center around which things rotate. The product premise is that your personal AI becomes the organizing center of your life — scheduling, information, concierge tasks, decisions. Strong B2C and B2B fit. No competitor is using "axis" in this space. Premium-feeling. The name allows for tier differentiation (axis9 Solo, axis9 Pro, axis9 Family).

Why it matters: Works at every market segment without the name constraining the product story.

**Option 3: anchor9**
Rationale: Anchor = the thing that holds everything steady. Emotional resonance with the stay-at-home parent use case (their life has no anchor — this is it), the LO use case (their pipeline has no anchor — this is it), the executive use case (their calendar has no anchor — this is it). Differentiated from the pilot/co-pilot metaphors competitors use.

Why it matters: Strongest emotional signal for the family/personal use case. May feel too soft for the B2B professional tier.

**Option 4: groundcrew9**
Rationale: Extends the 9enterprises football/sports metaphor. The groundcrew are the people who make everything possible before you take the field. Strong fit with the professional use case (your groundcrew before every client meeting). Works well with the 9enterprises master brand because it implies you are the athlete and 9enterprises gives you the team behind you.

Why it matters: Most coherent extension of the existing brand system. Risk: "groundcrew" is slightly wordy and may not shorten well in marketing copy.

**Option 5: Keep the sub-product unnamed — make it "9enterprises Personal"**
Rationale: If freeagent9 becomes a feature of 9enterprises, the cleanest architecture is: 9enterprises Business (SMB, B2B) and 9enterprises Personal (B2C, family). No new brand to build. The personal assistant product is just the personal tier of the parent brand. Additional sub-accounts are "9enterprises Personal seats." This mirrors how Microsoft sells 365 Personal vs. 365 Family vs. 365 Business.

Why it matters: Zero brand investment required. Fastest to market. Risk: less differentiated, harder to create viral word-of-mouth around.

**SCOUT's recommendation:** pilot9 if speed and continuity matter most. axis9 if you want a product that can stand on its own legs as a premium consumer brand. The Microsoft model (Option 5) is defensible but leaves value on the table in a market where character and identity are retention drivers.

---

## SECTION 3 — PRICING MODEL

### Competitive Landscape (verified April 5, 2026)

| Product | Price | What You Get | Seats |
|---|---|---|---|
| Character.ai c.ai+ | $9.99/month | Priority access, faster response, exclusive features | 1 |
| Replika Pro | $19.99/month | Relationship modes, advanced memory, persona depth | 1 |
| Pi (Inflection) | Free / undisclosed paid | Conversational companion, no published pricing for premium | 1 |
| ChatGPT Plus | $20/month | GPT-5.4, image gen, voice mode | 1 |
| ChatGPT Team | $25-30/user/month | Shared workspace, admin controls | Multi |
| Microsoft 365 + Copilot (Personal) | $9.99/month | Copilot across Office apps, 1TB storage | 1 |
| Microsoft 365 Family | $12.99/month | Copilot for account owner only, 6 accounts for Office | 6 (Copilot owner-only) |
| Google One AI Pro | $19.99/month | Gemini Advanced, family sharing for AI features | 6 |
| Lindy AI Plus | $19.99/month | 400 credits/month, email/calendar/meeting automation | 1 |
| Lindy AI Enterprise | Custom | Unlimited credits, dedicated success manager | Multi |
| freeagent9 Starter (current) | $29/month | Morning briefing, Q&A, 25 reminders, SMS | 1 |
| freeagent9 Pro (current) | $99/month | Full feature set, iMessage, unlimited reminders | 1 |

### Recommended Tier Structure (Post-Pivot)

The model has two product lines: 9enterprises (B2B, SMB, family anchor) and the personal assistant product (B2C, individual). These are not the same tier — do not try to merge them into one pricing table.

**9enterprises Plans**

| Plan | Price | Includes | Additional Seats |
|---|---|---|---|
| 9enterprises Solo | $49/month | 1 business-configured AI seat (the business user) + 0 personal sub-accounts | $12/seat/month |
| 9enterprises Family | $99/month | 1 business seat + 4 personal sub-accounts (household use, each individually configured) | $15/seat/month |
| 9enterprises SMB | $199/month | 1 business seat + 4 professional sub-accounts (team members, business-configured) + 2 personal sub-accounts (for SMB owner's household) | $15/seat/month |
| 9enterprises Enterprise | Custom | Negotiated volume, API, admin dashboard, SSO, audit log | Volume pricing |

Price rationale: The $99/month Family plan is the strategic weapon. Google AI Pro gives 6 generic Gemini accounts for $19.99. 9enterprises Family gives 5 fully customized AI assistants — each with distinct persona, foundational training, and memory — for $99/month. This is a 5x price premium for a fundamentally differentiated product. At $99/month, the family plan is below the $120/month a household would spend on 5 individual subscriptions to any competitor. The anchor comparison for the SMB buyer is: "You're already paying $99/month for your mortgage CRM add-on. This is the same price and it covers your whole team."

**Personal assistant sub-accounts (purchased standalone, outside 9enterprises)**

| Tier | Price | What's included | Target user |
|---|---|---|---|
| Personal Starter | $19/month | Foundational training (1 pack), text/iMessage, 30-day memory | Individual, basic use case |
| Personal Pro | $39/month | Foundational training (up to 3 packs), all channels, unlimited memory, concierge features (food ordering, reservations, calendar) | Power user, professional |
| Personal Elite | $79/month | Full concierge stack, custom persona depth, priority model access, proactive suggestions | Executive, early adopter |

Price rationale: Starter at $19 undercuts Replika ($19.99) and matches Lindy while being dramatically more useful for non-companion use cases. Pro at $39 is the real target — this is where the margin is and where the features justify the price. Elite at $79 creates an aspirational tier that makes $39 feel like the smart choice (pricing psychology: the middle tier always converts best).

**What the solo/standalone personal assistant product should not do:** charge per training pack. Do not let training packs become a nickel-and-dime mechanism. Include them in the tier or offer a fixed bundle. Complexity at signup kills conversion.

---

## SECTION 4 — "FOUNDATIONAL TRAINING AT PURCHASE" — REAL UX DESIGN

This is the most technically complex piece of the pivot. Here is the honest design breakdown.

### What "Foundational Training" Actually Means Technically

In the current architecture, the training is the system prompt plus a profile JSON. "Foundational training" means: a pre-built system prompt package tuned for a specific role, persona, and use case, loaded at account creation. It is not fine-tuning the model. It is structured context injection — which is already how Kyle Cabezas's instance works, just hardcoded. Making it configurable is an engineering problem, not an AI research problem.

### Recommended Approach: Hybrid (Pre-built Packs + Guided Onboarding Survey)

**Do not do:** Pure free-form profile ingest at signup. Users cannot articulate what they want from an AI before they have used one. Asking "what foundational training do you want?" to a first-time buyer will produce blank responses and high abandonment.

**Do not do:** Pure menu selection with no customization. "Pick from 8 types" is too rigid and produces generic results. The Replika retention data shows that users who feel their companion is truly theirs retain much longer.

**Do:** Three-step hybrid flow:

Step 1 — Role/Use Case Selection (1 screen, 30 seconds)
Present 6-8 foundational training pack options as cards with a plain-English description of what this persona does. Examples: "Mortgage Loan Officer," "Stay-at-Home Parent," "Executive Assistant," "Real Estate Agent," "Small Business Owner," "Student/Early Career," "General / I'll figure it out." User picks one.

Step 2 — Personalization Survey (3-5 questions, 2 minutes)
After role selection, ask 3-5 questions that inject personal context: What do you want help with most? What's your name? What time should your morning briefing arrive? One open-ended question: "Tell me one thing about your day I should always know."

Step 3 — The First Message (within 5 minutes of signup)
The assistant introduces itself — not with a script but with a message that demonstrates it already knows something true about them from the onboarding survey. This is the "oh, this thing actually works" moment. This single moment has more impact on retention than any feature.

**Training Pack Build Cost (rough estimate)**
Each training pack = one curated system prompt template + 15-30 curated Q&A pairs for the domain's most common questions. For mortgage, these already exist in the freeagent9 business plan (guideline Q&A, rate alerts, etc.). Build time for existing domains: 4-8 hours per pack. New domains (stay-at-home parent, student): 1-2 days each including research. Total for 8 packs: 2-3 weeks of part-time agent work. Zero external vendor cost.

**Recommended initial pack list (prioritized by Owner's product vision):**
1. Mortgage Loan Officer (exists — Kyle pilot)
2. Real Estate Agent (exists as template in onboarding protocol)
3. Small Business Owner (close to 9enterprises B2B use case — high leverage)
4. Stay-at-Home Parent (Jules's original design intent — high emotional value)
5. Executive / Professional (broadest addressable market)
6. Insurance Agent (mapped in business plan for Q3 launch)
7. Student / Early Career (high volume, lower ARPU — launch last)
8. General (catch-all — for users who do not fit a category)

---

## SECTION 5 — MIGRATION PLAN

### What to Keep (do not touch)

The Kyle Cabezas instance runs on scripts/jules-server-kylec.mjs. It is the only live proof-of-concept. Do not change anything about how his instance operates. His experience and feedback are the validation data for the entire product. Keep his onboarding protocol active. Keep his profile JSON intact.

The onboarding protocol document (docs/freeagent9-onboarding-protocol.md) is a strong foundation. The new customizable-persona flow is an extension of this protocol, not a replacement. Keep the trial-to-paid structure, the 14-day trial sequence, the Day 3 check-in, the Day 10 value summary. These are tested and logical.

The concierge features plan (docs/freeagent9-concierge-plan.md) maps directly to the "Personal Elite" tier in the new structure. Calendar integration, restaurant bookings, food ordering — these are the features that justify the $79/month price point. Keep the vendor priority list and the phased build approach.

### What to Rename

All external-facing references to "freeagent9" as a standalone product brand should transition to whichever name is chosen (Section 2 above). The internal profile JSON keys (user_id, file naming convention jules-profile-[userid].json) can stay as-is — these are internal and changing them breaks running instances.

The landing page at ainflgm.com/freeagent-landing.html should be updated to reflect the new product name and the bundled value story once the architecture decision is locked.

### What to Build Before Announcing Anything

In order of sequence — do not announce the new architecture until each of these is done:

1. Twilio webhook signature validation (freeagent9 currently 2/10 on security — this is the single most urgent fix, can be done in 1 day)
2. Multi-tenant routing (single server handling multiple users via routing, not separate processes per user — this enables the bundled-seat model technically)
3. Stripe billing integration (trial-to-paid is manual right now — must be automated before scaling)
4. Training pack builder (internal tool to generate system prompts from a role + survey input — this enables the customizable persona)
5. Web-based signup + training pack selector (the public-facing onboarding flow)

Estimated sequence: 4-6 weeks with focused engineering effort. This is parallel to the foundation work, not sequential — the same security and reliability fixes required for 9enterprises gold standard also fix freeagent9's 35/100 score.

### Kyle Cabezas — No disruption

Kyle's instance stays untouched through the migration. When the new architecture is live, offer him an upgrade path: "Your instance is moving to the new platform. Everything stays the same, and you get [new feature] as part of the transition." Do not ask him to re-onboard. Import his existing profile JSON into the new system.

---

## SECTION 6 — BRAND RISK ASSESSMENT

### The Character Bond Problem

Replika's data point is load-bearing here: 20% retention at 90 days, but 7+ month average subscriber lifetime for those who do stay. The users who stay are the ones who formed a character bond. The users who churn did not.

The Owner's pivot introduces an inherent tension: a product that is infinitely customizable at purchase is, by definition, not a specific character. The user picks a name, a personality, a skill set — and they get a functional assistant. Functional is good. But functional does not produce character bonds by itself. Character bonds form when the assistant demonstrates memory, continuity, and personality consistency over time.

The risk is not in offering customization. The risk is in marketing it as the primary value proposition. "Build your own AI" is a feature. "Meet your AI" is a relationship. The latter retains. The product needs to be the latter even if the mechanism is the former.

### Recommendation for Handling Existing Character Bonds (Jules/Pepper)

The Owner's personal instance ("Pepper" as of April 5, 2026) is a distinct use case — it is an ongoing Owner-9 relationship that happens to run on the same infrastructure. This is not a product decision; it is the Owner's personal configuration. It is unaffected by this pivot.

For the Owner's wife's instance (Jamie, running on the Jules infrastructure): her bond is with the character as configured, not with the brand name "Jules." As long as the underlying personality, memory, and behavior are preserved, the name on the product does not matter to her experience. Do not change her instance configuration without a specific conversation.

For future users: the customizable-shell model is actually lower risk than it appears, because new users have no pre-existing bond. They will form their bond with whatever character they configure. The brand risk is only material for existing users, of which there are currently two (Owner's personal instance + Jamie's instance).

**Mitigation for existing users:** Character continuity is guaranteed if the profile JSON (memory, personality parameters, system prompt) is preserved exactly through the migration. The user experiences no change. From their perspective, nothing happened. The rebrand is invisible.

---

## SECTION 7 — IMPACT ON IN-FLIGHT DECISIONS

### Defensive Domain Strategy (freeagent9.com, freeagent9.ai, playaigm.com, playaigm.ai)

**freeagent9.com / freeagent9.ai:** If freeagent9 is being retired as a product brand, the defensive value of these domains drops significantly. The risk of a competitor squatting on freeagent9.com and launching a competing product is real but is now a brand-protection concern rather than a core asset. Recommendation: Register freeagent9.com as a defensive hold only (redirect to 9enterprises.ai). Do not build on it. Cost is approximately $12-15/year — trivially cheap as defensive insurance. Do not register freeagent9.ai unless the chosen new product name also has .ai domain availability at a comparable price — that money is better spent on the new brand's domains.

**playaigm.com / playaigm.ai:** The pivot does not affect the AiGM/PlayAiGM product at all. That domain decision should be made on AiGM's own merits, not this one. The pivot analysis does not change the AiGM thesis.

**New domain priority:** Whatever name is chosen for the personal assistant product (Section 2) — secure both the .com and .ai immediately. If "pilot9" is chosen, register pilot9.com and pilot9.ai now, before this document leaves the building. These cost $12-60 total across both TLDs and the risk of delay is not worth the savings.

### Resend Email Infrastructure for freeagent9.com

**Recommendation: Pause, do not kill.** If freeagent9.com is being held defensively with a redirect, the Resend infrastructure tied to it (for sending FROM freeagent9.com) has limited forward value. Do not invest further in building it out. However, do not actively kill it either — the email send capability may be useful as a redirect/forwarding mechanism during the transition period. Redirect all incoming mail to the new product domain once that domain is chosen. Archive the setup docs for reference.

### Trader9 Retraining Plan

Completely unaffected. The trader9 retraining plan is infrastructure-level work on an independent subsystem. The personal assistant product pivot does not touch trader9's architecture, data sources, or operational logic. No reprioritization required.

---

## SECTION 8 — FINAL RECOMMENDATION

**Verdict: Ship with conditions. Not tomorrow — 4-6 weeks from now, after three non-negotiable prerequisites are met.**

### The Case For

The strategic logic is sound. The market has not done what Owner is proposing. Bundling AI seats into B2B plans with personal sub-accounts is a genuine white-space move. The customizable personal assistant is differentiated from every named competitor — Character.ai, Replika, Pi, and Google/Microsoft all offer generic access to one AI, not a configured assistant that is tailored to your role, life, and preferences from day one. The pricing model is defensible and competitive. The migration path is low-disruption.

### The Three Non-Negotiable Prerequisites

**Prerequisite 1: Fix freeagent9's security baseline before it becomes a bundled feature.**
Twilio webhook validation is the single biggest risk. Any actor who knows the inbound URL can spoof messages to the bot right now. This must be fixed before the product is sold as a feature of 9enterprises to paying SMB customers. Estimated fix time: 1 day.

**Prerequisite 2: Multi-tenant architecture must exist before bundled seats are sold.**
Right now, each user runs as a separate server process (ports 3470, 3471, 3472...). This does not scale to a bundled model with multiple sub-accounts per 9enterprises customer. Build the multi-tenant routing layer first. Estimated build time: 1-2 weeks.

**Prerequisite 3: Stripe billing integration must be live before the paid launch.**
The current conversion path from trial to paid is manual. This is fine for 1 pilot user. It is not acceptable when offering a bundled model with sub-account upgrades. Estimated build time: 1 week.

### The Phased Sequence

Phase 1 (now, 1-4 weeks): Fix security, build multi-tenant, wire Stripe. Finalize the product name. Register the new domains. Build the first 3 training packs (Mortgage LO, Small Business Owner, Stay-at-Home Parent).

Phase 2 (weeks 4-8): Launch the new onboarding flow with training pack selection to a closed beta (5-10 users from Owner's network, not public). Convert Kyle Cabezas to the new platform. Collect feedback. Iterate.

Phase 3 (weeks 8-12): Public launch of 9enterprises with bundled personal assistant sub-accounts. Announce the renamed personal assistant product. Retire freeagent9 branding in external-facing materials. Maintain the freeagent9.com domain as a defensive redirect.

### What This Does NOT Require

This pivot does not require new AI infrastructure. It does not require new model costs (the same Claude-based architecture powers everything). It does not require a marketing budget to launch. The entire Phase 1 and Phase 2 can be completed within existing infrastructure and the $5K/month operating budget.

### One Honest Caution

The universe is at 42.8/100 health. The gold-standard foundation work is the current priority. This pivot adds scope to an already full plate. The recommendation is to run Phase 1 in parallel with the foundation work — the security fix and multi-tenant architecture are foundation improvements, not new projects. But Phase 2 and Phase 3 should not begin until universe health clears 60/100. Starting the migration before the foundation is stable is how you end up with a broken bundled product that damages the 9enterprises brand instead of strengthening it.

Ship it. Just not yet. And do it in the right order.

---

## DECISION NEEDED FROM 9

1. **Product name selection:** Which of the five candidate names (pilot9, axis9, anchor9, groundcrew9, or "9enterprises Personal") does Owner want to proceed with? This gates domain registration and everything downstream.

2. **Domain registration authority:** Is 9 authorized to register the chosen product name's .com and .ai domains immediately (estimated $50-80 total) without waiting for Owner confirmation, under the <$100 blanket authority? Recommend yes — delay costs more than the registration.

3. **Phase sequencing confirmation:** Does Owner want the pivot to run in parallel with foundation work (SCOUT's recommendation) or sequentially (safer but slower)?

4. **Kyle Cabezas communication:** When does Owner want to tell Kyle that the product he is piloting is being restructured? This should happen before public announcement, not after. Owner's call on timing.

---

*— SCOUT, Market Strategy Agent, 9 Enterprises*
*Delivered to 9 for synthesis and Owner relay. April 5, 2026.*
