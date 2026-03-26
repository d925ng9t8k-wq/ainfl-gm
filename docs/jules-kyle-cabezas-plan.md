# Jules — Kyle Cabezas Pilot Plan
**Subject:** Kyle Cabezas, Producing Branch Manager, Rapid Mortgage Cincinnati
**NMLS:** 393091
**Date:** March 26, 2026
**Status:** Research complete — ready for build and deployment

---

## Summary

Kyle Cabezas is Jasson's close friend of 10+ years and has volunteered as the first external pilot for Jules. He runs the Cincinnati branch of Rapid Mortgage as a Producing Branch Manager, meaning he both closes his own loans and manages a team of LOs. His use case is fundamentally different from Jamie's — he needs a business-grade assistant that understands mortgage workflows, not a household assistant. The Jules architecture is compatible, but the profile, system prompt, and morning briefing content need to be rebuilt from scratch for his role.

---

## Section 1: Who Kyle Cabezas Is Professionally

### Role and Scope

Kyle is a Producing Branch Manager, which means two jobs simultaneously:
- He carries his own personal loan pipeline (he still closes loans himself)
- He manages the Cincinnati branch team: Jebb Lyons, Justin Phillips, Adam Brewer (LOs), Hailey Edwards (his personal Loan Partner), Tracy Sturgill (Processing Manager)

This dual role is the defining pressure of his day. He is accountable for his own production numbers AND the branch's collective numbers. Every morning he has two dashboards to worry about.

### Production Style

Kyle's reviews reveal his professional DNA clearly:
- **Closer under pressure.** One review specifically called out an FHA closing in 17 days with a holiday. That is exceptional — FHA in 17 days is elite. He runs toward complexity, not away from it.
- **Communication-first.** Multiple reviews independently cite that he was always reachable and always communicated proactively. This is his competitive advantage with agents and clients.
- **Perfect 5.0 record.** 22 reviews, zero below 5 stars across Google, Zillow, Experience.com, and Birdeye. He protects this actively — LinkedIn posts show him sharing each new review.

### Markets and Products

Rapid Mortgage is licensed in 13 states (Ohio + 12 others). Kyle's primary market is greater Cincinnati — Clermont County and Hamilton County. Products he originates: Conventional, FHA, VA, USDA Rural Development.

FHA and first-time buyer transactions appear to be his volume base, with VA and Conventional rounding out the book.

### Tools He Likely Uses

Based on Rapid Mortgage's size (~599 employees) and the standard industry stack for regional lenders:

| Tool | Purpose | Confidence |
|------|---------|-----------|
| Encompass (ICE Mortgage Technology) | Loan origination system (LOS) — pipeline, documents, compliance | High |
| A mortgage CRM (likely Surefire, Jungo, or Aidium) | Lead nurture, milestone alerts, referral partner communication | Medium |
| MBS Highway or Optimal Blue | Rate sheets, pricing, lock management | Medium |
| Phone + SMS | Primary client and agent communication | High |
| Email | Formal communication, document delivery | High |
| Google or Facebook | Reviews, referral partner networking | High |

Kyle has NOT been confirmed on any specific CRM. This should be verified directly before building any integration.

### Daily Workflow (Industry Standard for a Producing BM)

**6:30–7:00 AM** — Rate check. LOs who originate purchase loans track MBS markets before the market opens. Rate movement in the morning affects same-day lock decisions.

**7:00–8:00 AM** — Pipeline review. Any closings today? Any loans that went to underwriting and need follow-up? Any conditions that came back overnight?

**8:00–10:00 AM** — Lead and referral outreach. Calls to real estate agents, follow-ups with pre-approved buyers who haven't found a house yet, new application intake.

**10:00 AM–12:00 PM** — Application processing and team check-ins. Review his LOs' pipelines, handle escalations, sign off on anything requiring BM approval.

**12:00–2:00 PM** — Client meetings and realtor lunches/meetings. This is relationship time.

**2:00–5:00 PM** — Closing coordination, underwriting follow-ups, lock management, late-day application intake (buyers touring homes in evenings, calling during lunch).

**After hours** — He's available. Reviews confirm he answers calls and texts nights and weekends. This is not unusual for top-producing LOs in purchase-heavy markets.

---

## Section 2: Kyle's Jules Use Cases

### Priority 1: Morning Briefing (7:00 AM)

The most valuable thing Jules can do for Kyle every morning is answer three questions before he opens Encompass:

1. Where are rates right now vs. yesterday?
2. What's closing today, and is it on track?
3. What's the one thing I need to handle first?

**Format:** Five lines or fewer. No bullet points. Like a text from a finance-savvy buddy who did the homework already.

**Example morning briefing:**

> Morning. 30yr conventional opened at 6.875% — down 0.125% from yesterday. MBS are holding. You've got the Martinez closing at 2pm, all conditions cleared. 3 loans hit underwriting this week and are sitting in queue. One thing: Hailey flagged the Williams file — appraisal came in low, needs your call before noon.

### Priority 2: Rate Alerts (On-Demand + Threshold Alerts)

Kyle tracks rates constantly. Jules can reduce that cognitive load by:
- Texting him when rates move more than 0.125% intraday
- Answering "where are rates right now?" any time he asks
- Summarizing whether it's a lock-now or float-and-watch day

This alone has direct revenue impact — a well-timed lock saves a borrower money and protects Kyle's deal from falling out.

### Priority 3: Guideline Quick-Reference

The most frequent questions a producing LO needs fast answers to:

- "What's the FHA DTI limit with compensating factors?" (50%)
- "What's the VA funding fee for a veteran on their second purchase with 5% down?" (3.30%)
- "What's the 2025 conforming loan limit?" ($806,500)
- "Does USDA require mortgage insurance?" (Yes — guarantee fee + annual fee)
- "What's the minimum credit score for FHA with 3.5% down?" (580)

Kyle knows these cold, but when he is in a conversation with a Realtor or a client and needs to verify fast, Jules is faster than pulling up the Fannie Mae selling guide.

### Priority 4: Client Follow-Up Reminders

In a purchase pipeline, timing is everything. Kyle manages 20-40 active files at any given time. He needs to:
- "Remind me to call the Garcias about their appraisal order at 3pm"
- "Remind me Monday to check if the Johnsons' rate lock expired"
- "Don't let me forget to send the Praters the updated pre-approval at 5pm"

This is the same reminder engine as Jamie's Jules — no modification needed.

### Priority 5: Branch Performance Snapshot

As Branch Manager, Kyle carries a second layer of accountability. Jules can help him track:
- How many applications this month vs. last month
- Team production (which LOs are ahead of pace, which are behind)
- Closings to date for the month

**Caveat:** This requires either Encompass API access (complex) or a manual-input model where Kyle texts Jules updates. Start with manual input. Build toward integration later.

---

## Section 3: How Jules Should Communicate With Kyle

### Channel

**SMS/text.** Kyle runs his business on his phone. He's available nights and weekends by text. He will use Jules the same way he uses his phone for everything else — quick texts in between calls and meetings. Do not use Telegram. Do not use iMessage-specific features. Plain SMS to his cell: (513) 225-5681.

Separate Twilio number required — Kyle gets his own number, distinct from Jamie's Jules.

### Tone

**Casual. Direct. Zero corporate-speak.**

Kyle is Jasson's close friend of 10+ years. He knows exactly what Jules is and who built it. Jules should talk to him like a smart friend in his industry, not like a product.

- CORRECT: "Rates dipped — might be worth a call to any floaters you have locked in the next 30 days."
- WRONG: "Hello Kyle! I wanted to let you know that mortgage rates have experienced a downward movement today."

Contractions always. First name only. No formal openers or closers. Get to the point.

### Schedule

| Event | Time |
|-------|------|
| Morning briefing | 7:00 AM Eastern |
| Proactive rate alerts | As triggered (market hours only, 8am–5pm ET) |
| Reminders fire | At the time Kyle sets |
| After-hours responses | Still active — Kyle works late |

No "good night" messages. No unsolicited check-ins beyond the morning briefing and rate alerts. Kyle will ask when he needs something.

---

## Section 4: How This Changes the Jules Server

### What Stays the Same

The entire underlying architecture is reusable:
- HTTP server on a new port (suggestion: 3471)
- Twilio SMS webhook handler
- Claude API integration
- Reminder engine (scheduleReminder, restoreReminders)
- Morning briefing scheduler (scheduleMorningBriefing)
- Profile load/save helpers
- Conversation memory

### What Changes

**1. Profile path and env variables**

```js
const PROFILE_PATH = '../data/jules-profile-kylec.json';
// New env var needed:
const RECIPIENT_PHONE = process.env.JULES_KYLEC_RECIPIENT_PHONE;
```

**2. System prompt — complete rewrite**

The Jamie system prompt is warm and mom-focused. Kyle's system prompt needs to be rewritten for a mortgage professional:

```
You are Jules, a personal assistant built by 9 Enterprises for Kyle Cabezas,
a Producing Branch Manager at Rapid Mortgage in Cincinnati.

PERSONALITY:
- Direct and efficient. Kyle is busy. Get to the point.
- Casual friend energy — he knows Jasson personally, this is not a formal product.
- Mortgage-literate. You know FHA, Conventional, VA, USDA inside and out.
- Never corporate. Never say "I'm here to assist" or "Great question!"
- Keep it to 3 sentences max. He's probably in between calls.

ROLE CONTEXT:
- Kyle manages his own loan pipeline AND a branch of 3 LOs
- He needs rate intelligence, pipeline awareness, and guideline answers fast
- His team: Hailey Edwards (loan partner), Jebb Lyons, Justin Phillips, Adam Brewer (LOs), Tracy Sturgill (processing)

MORTGAGE GUIDELINES (quick reference — use these for instant answers):
[embedded guideline reference from profile]

CAPABILITIES:
- Morning briefing at 7am: rates, today's closings, one priority action
- Rate alerts when market moves significantly
- Guideline lookups (FHA/Conventional/VA/USDA DTI, credit, LTV, fees)
- Client follow-up reminders: "Remind me to call the Smiths at 3pm"
- Branch pipeline questions (manual input model)
- General mortgage and business questions
```

**3. Morning briefing content — restructured**

Jamie's briefing: weather, shopping list, reminders, encouragement.
Kyle's briefing: rates, today's closings, pipeline flags, one priority action.

The `sendMorningBriefing()` function needs to pull rate data instead of weather. Options:
- MBS Highway API (subscription) — real-time pricing, ideal
- Freddie Mac weekly PMMS (free, but weekly — not daily)
- CFPB mortgage market trends (free, public, decent for a daily check)
- Fallback: prompt Kyle to manually update rates by texting "rates update: 6.875%"

**Recommendation for pilot:** Start with a manual rate model. Have Kyle text Jules each morning with the rate, and Jules builds the briefing from that plus whatever context is in the profile. Add real-time rate feeds after the pilot validates the concept.

**4. Guideline intent detection — new module**

Add a `detectGuidelineIntent(text)` function that routes mortgage guideline questions to a hardcoded lookup before hitting Claude. This gives instant, accurate answers without burning tokens:

```js
function detectGuidelineIntent(text) {
  const lower = text.toLowerCase();
  if (lower.includes('fha') && lower.includes('dti')) return { type: 'guideline', topic: 'fha_dti' };
  if (lower.includes('conventional') && lower.includes('dti')) return { type: 'guideline', topic: 'conv_dti' };
  if (lower.includes('va') && lower.includes('funding fee')) return { type: 'guideline', topic: 'va_fee' };
  if (lower.includes('conforming') && lower.includes('limit')) return { type: 'guideline', topic: 'conforming_limit' };
  // ... etc
  return null;
}
```

For complex guideline questions, pass to Claude with the guideline reference table injected into the system prompt.

**5. Rate alert system — new module**

Two components:
- A `checkRates()` function that polls a rate source on an interval (every 30 min during market hours)
- A threshold comparison against the last-known rate in the profile
- If delta >= 0.125%, send Kyle a text

```js
async function checkRateMovement() {
  const currentRate = await fetchMortgageRate(); // needs data source
  const lastRate = profile.mortgage_context?.last_known_rate;
  if (lastRate && Math.abs(currentRate - lastRate) >= 0.125) {
    const direction = currentRate > lastRate ? 'up' : 'down';
    await sendSms(`Rate alert: 30yr conventional moved ${direction} to ${currentRate}% (was ${lastRate}%).`);
  }
  profile.mortgage_context.last_known_rate = currentRate;
  saveProfile(profile);
}
// Schedule during market hours: every 30 min, 8am-5pm ET
```

**6. Port assignment**

Kyle's Jules runs on port 3471 (Jamie's is 3470). They are independent servers. Either could be extracted into a shared multi-tenant architecture later.

**7. New .env variables needed**

```
JULES_KYLEC_RECIPIENT_PHONE=+15132255681
# If using a real-time rate feed:
MBS_HIGHWAY_API_KEY=xxx
# Or:
RATE_FEED_URL=xxx
```

---

## Section 5: What We Do NOT Have Yet

These items need resolution before the Kyle pilot goes live:

| Gap | Blocker | Path to Resolve |
|-----|---------|-----------------|
| Kyle's actual CRM name | Unknown | Ask Kyle directly |
| Kyle's preferred rate source | Unknown | Ask Kyle what he uses for morning rates |
| Encompass API access for pipeline data | Requires IT/Kyle/Rapid infra decision | Phase 2, not Day 1 |
| Twilio number for Kyle | Needs provisioning ($1/mo) | Jasson approves, Tee provisions |
| Kyle's cell number confirmed as SMS-friendly | Assumed yes | Confirm with Jasson |
| Kyle's actual day start time | Assumed 7am based on industry norm | Confirm with Kyle at pilot kickoff |

---

## Section 6: Pilot Launch Checklist

- [ ] Jasson aligns with Kyle on what Jules will do (30-minute conversation)
- [ ] Kyle confirms: cell number, preferred rate source, day start time, CRM name
- [ ] Tee provisions a new Twilio number for Kyle
- [ ] Tee builds jules-server-kylec.mjs on port 3471
- [ ] Tee wires up new .env variables
- [ ] Jasson tests the number himself (posing as Kyle) before handing off
- [ ] Kyle receives his first morning briefing
- [ ] One-week check-in: what did Kyle actually use? What did he ignore?
- [ ] Iterate before expanding to other LOs

---

## Section 7: Expansion Play

If Kyle's pilot validates the model, the next five prospects are already sitting in the office:

| Person | Role | Jules Value |
|--------|------|------------|
| Jebb Lyons | Senior LO | Same as Kyle minus branch management layer |
| Justin Phillips | Producing Branch Manager | Identical template to Kyle |
| Adam Brewer | Loan Officer | Simplified — no team management |
| Mark Jaynes | Co-Owner, Columbus branch | Executive version: company-wide metrics, rate trends |
| Mike McGuffey | COO | Operations dashboard: processing queue, team throughput |

Each new instance is a profile JSON + a new server instance + a new Twilio number. Total marginal cost per LO: ~$3-5/month. If Rapid Mortgage deploys this across all LOs, that is a fleet of Jules instances — and a strong case study for selling to other mortgage companies.

---

## Confidence Levels

| Finding | Confidence |
|---------|-----------|
| Kyle's role, NMLS, contact info | High — confirmed via NMLS Consumer Access + Rapid website |
| His production style (closer, communicator) | High — consistent across 22 reviews, multiple platforms |
| His tool stack (Encompass + CRM) | Medium — industry inference, not directly confirmed |
| Day start time of 7:00 AM | Medium — industry norm for purchase-heavy LOs |
| Preferred channel: SMS | High — mortgage industry standard, consistent with his review pattern of always being reachable by phone |
| Guideline data (FHA/Conventional/VA/USDA) | High — sourced from FHA Handbook, Fannie Mae Selling Guide |

## Gaps

- No confirmed data on Kyle's annual loan volume (not publicly disclosed)
- No confirmed CRM vendor
- No confirmed morning routine or exact day start time — assumed from industry norms
- No rate data source confirmed — he uses something, we don't know what

---

*Research by UNO — March 26, 2026*
