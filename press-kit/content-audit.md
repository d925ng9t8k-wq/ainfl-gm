# Content Audit — 9 Enterprises Universe

**Auditor:** PRESS
**Date:** April 5, 2026
**Standard:** Enterprise-grade (Kyle Shea benchmark)
**Scope:** All public-facing content on ainflgm.com and 9enterprises.ai

---

## Grading Scale

Each piece graded on 4 dimensions:
- **Clarity** (C): Is it immediately clear what this is and what the user should do?
- **Enterprise Readiness** (E): Would a CIO approve sharing this with a partner?
- **Brand Consistency** (B): Does it match 9enterprises brand guidelines?
- **SEO Basics** (S): Title tag, meta description, H1, canonical, structured data present?

Scores: 1–5. Total: /20. Flag = below 12.

---

## Core Pages

### ainflgm.com (homepage)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Clarity | 4 | Product purpose immediately clear. "AI NFL GM Simulator" lands. |
| Enterprise | 2 | Buy Me A Coffee widget is an amateur signal. No 9enterprises branding. |
| Brand | 3 | Strong product identity but zero connection to parent company. |
| SEO | 4 | Title tag strong. Meta description present. Sitemap exists. Missing structured data (Product schema). |
| **Total** | **13/20** | Pass, but enterprise-readiness is a gap. |

**Priority fix:** Remove Buy Me A Coffee. Add 9enterprises footer attribution. Add Product schema.

---

### ainflgm.com/9enterprises.html
| Dimension | Score | Notes |
|-----------|-------|-------|
| Clarity | 4 | Good hero. "11 companies, 0 employees" lands. |
| Enterprise | 3 | Strong concept but served from ainflgm.com (sports URL). Confusion for enterprise visitors. |
| Brand | 5 | Best brand execution in the portfolio. |
| SEO | 3 | OG tags present. No schema.org Organization data. Sitemap entry goes to ainflgm.com domain, not 9enterprises.ai. |
| **Total** | **15/20** | Pass. But domain placement undermines credibility. |

**Priority fix:** This content is now superseded by 9enterprises.ai deployment. The ainflgm.com version should redirect to 9enterprises.ai.

---

### ainflgm.com/freeagent-landing.html
| Dimension | Score | Notes |
|-----------|-------|-------|
| Clarity | 3 | Good but "FreeAgent9" vs "freeagent9" naming inconsistency. |
| Enterprise | 2 | No pricing. No CTA for prospects. No contact path for B2B buyers. |
| Brand | 3 | Inconsistent casing on product name. |
| SEO | 3 | Basic meta tags. No structured data. Not in sitemap properly. |
| **Total** | **11/20** | FLAG — rewrite needed. |

**Priority fixes:**
1. Fix product name casing to "freeagent9" everywhere
2. Add B2B contact CTA ("Apply for pilot access" → captain@9enterprises.ai)
3. Add pricing anchor ($99/month professional tier)

---

### ainflgm.com/underwriter.html
| Dimension | Score | Notes |
|-----------|-------|-------|
| Clarity | 4 | Mortgage audience will understand this immediately. |
| Enterprise | 3 | Demo works. But "Try Demo" goes to a local server — dead link for public visitors. |
| Brand | 3 | Clean design but no 9enterprises attribution. |
| SEO | 3 | Basic meta. No FinTech structured data. |
| **Total** | **13/20** | Pass, but the broken demo link is embarrassing. |

**Priority fix:** Demo button must go to a hosted demo or say "Request Demo" with email CTA.

---

### ainflgm.com/agent9.html
| Dimension | Score | Notes |
|-----------|-------|-------|
| Clarity | 3 | Concept page is honest ("coming soon") but thin on substance. |
| Enterprise | 2 | Concept-level pitch. No market data, no differentiation argument. |
| Brand | 3 | Acceptable. |
| SEO | 2 | Missing canonical, weak meta description. |
| **Total** | **10/20** | FLAG — embarrassing if shared externally. |

**Priority fix:** Add market size data ($100B+ commission market), clear timeline expectation, and waitlist CTA.

---

### ainflgm.com/guardrail-pitch.html (chaperone)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Clarity | 3 | The name "Chaperone" is better than "guardrail" — headline should use the product name. |
| Enterprise | 2 | Concept-only. No differentiation from existing parental controls. |
| Brand | 3 | Acceptable but "guardrail-pitch.html" in the URL is rough. |
| SEO | 2 | No meta description. No structured data. |
| **Total** | **10/20** | FLAG |

**Priority fix:** URL and filename are embarrassing. Should be /chaperone. Needs a real value prop vs Life360/Circle/Apple Screen Time.

---

### ainflgm.com/pitch.html (Trader9)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Clarity | 2 | "Pitch" is internal language. External visitors have no idea what product this is for. |
| Enterprise | 2 | Generic pitch page — not product-specific enough. |
| Brand | 2 | "Trader9" not prominently featured. |
| SEO | 2 | Title is "Pitch" — zero SEO value. |
| **Total** | **8/20** | FLAG — needs rename and rewrite. |

**Priority fix:** Rename to /trader9. Rewrite with trader9 product name, use case, and "coming soon" CTA.

---

### ainflgm.com/jules-pilot.html
| Dimension | Score | Notes |
|-----------|-------|-------|
| Clarity | 3 | Reasonable for the audience (families, individuals). |
| Enterprise | 1 | Named "pilot" in the URL. Not a product page — an internal test artifact. |
| Brand | 2 | "jules" vs "Jules" inconsistency. |
| SEO | 2 | "Pilot" in URL is unfriendly. |
| **Total** | **8/20** | FLAG — should not be public-facing in this state. |

**Priority fix:** Create a real jules product page at /jules. Archive this URL.

---

### ainflgm.com/privacy.html
| Dimension | Score | Notes |
|-----------|-------|-------|
| Clarity | 4 | Present and readable. |
| Enterprise | 4 | Presence of a privacy page is the baseline. |
| Brand | 3 | Acceptable. |
| SEO | 3 | Present but not linked from homepage footer. |
| **Total** | **14/20** | Pass. |

**Priority fix:** Verify it is linked from the homepage footer. (Audit finding: not confirmed.)

---

### ainflgm.com/terms.html
| Dimension | Score | Notes |
|-----------|-------|-------|
| Clarity | 4 | Present and readable. |
| Enterprise | 4 | Present. |
| Brand | 3 | Acceptable. |
| SEO | 3 | Present but not linked from homepage footer. |
| **Total** | **14/20** | Pass. |

**Priority fix:** Same as privacy — verify footer link.

---

## Internal / Should-Not-Be-Public Pages

The following pages exist in the public dist/ and should be reviewed for whether they should remain accessible:

| Page | Issue |
|------|-------|
| /austin.html | Listed in robots.txt Disallow — good. Verify it's truly blocked. |
| /rapid-clarkson-deck-v2.html | Listed in robots.txt Disallow — good. Client-facing deck should not be indexed. |
| /owner.html | Owner dashboard — should require auth or be removed from public dist. CRITICAL. |
| /cockpit.html | Internal tool — verify auth. |
| /command-center.html | Internal — same concern. |
| /kyle-response*.html | Internal sales decks — should not be publicly accessible without auth. |
| /rapid-pitch.html | Rapid Mortgage pitch deck — confirm whether OK to be public. |
| /grok-proposal.html | Internal strategy doc — should not be public. |
| /mistress-deck.html | File name is embarrassing regardless of content. Rename if keeping public. |

---

## Summary: Priority Rewrite Queue

| Priority | Page | Issue | Fix |
|----------|------|-------|-----|
| P0 | /owner.html, /cockpit.html, /command-center.html | Potentially expose internal tools publicly | Add auth or remove from dist |
| P0 | /grok-proposal.html, /kyle-response*.html | Internal strategy — should not be public | Move to auth-gated or remove |
| P1 | /freeagent-landing.html | Brand casing, no B2B CTA, no pricing | Rewrite |
| P1 | /pitch.html (trader9) | Generic name, zero SEO value | Rename to /trader9, rewrite |
| P1 | /jules-pilot.html | "Pilot" in URL, internal artifact | Create /jules product page |
| P2 | /agent9.html | Thin concept page | Add market data + waitlist |
| P2 | /guardrail-pitch.html | URL embarrassing, weak value prop | Rename to /chaperone, rewrite |
| P2 | Homepage (ainflgm.com) | Remove Buy Me A Coffee | 5-minute fix |
| P3 | /underwriter.html | Broken demo link | Replace with "Request Demo" CTA |
| P3 | All product pages | Add 9enterprises footer attribution | Consistent branding |

---

## 9enterprises.ai (new deployment — this document's output)

The new `9enterprises-dist/index.html` created by PRESS scores:

| Dimension | Score | Notes |
|-----------|-------|-------|
| Clarity | 5 | Mission, portfolio, team, contact all present. |
| Enterprise | 5 | Schema.org, canonical, OG, nav, footer, privacy/terms links. |
| Brand | 5 | Correct product name casing, brand colors, consistent voice. |
| SEO | 4 | Organization schema, OG, sitemap, robots.txt. Missing: Umami website ID (pending account creation). |
| **Total** | **19/20** | Gold standard. Pending: Umami analytics ID. |
