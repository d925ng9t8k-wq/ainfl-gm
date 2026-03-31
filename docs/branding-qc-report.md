# Branding & Quality Control Audit Report

**Date:** 2026-03-30  
**Scope:** All 86 HTML files in `/public/`  
**Auditor:** 9

---

## Summary

- **86 HTML files** audited
- **5 critical issues fixed** (naming inconsistencies in visible text)
- **0 broken internal links** found
- **0 broken asset references** found
- **0 invalid HeyGen video IDs** found
- **Cosmetic issues** cataloged below for future cleanup

---

## CRITICAL ISSUES FIXED

### 1. Company naming: "9enterprises" displayed without space (FIXED)

The correct public-facing name is **"9 Enterprises"** (with a space). The following files displayed it without the space in visible text:

| File | Line | Was | Fixed To |
|------|------|-----|----------|
| `aigm.html` | 948 | `9enterprises LLC` | `9 Enterprises LLC` |
| `aimlb.html` | 966 | `9enterprises LLC` | `9 Enterprises LLC` |
| `ainba.html` | 823 | `9enterprises LLC` | `9 Enterprises LLC` |
| `agent9.html` | 1166 | `A 9enterprises product` | `A 9 Enterprises product` |
| `agent9.html` | 1168 | link text `9enterprises` | `9 Enterprises` |
| `dashboard-share.html` | 13 | `<title>9enterprises` | `<title>9 Enterprises` |

---

## AUDIT RESULTS BY CATEGORY

### 1. Internal Links

**Status: PASS** -- All internal links resolve to existing files.

- All `href="/something.html"` paths verified against filesystem
- All relative `href="something.html"` paths verified
- No orphaned pages detected

### 2. External Domains

**Status: PASS** -- No suspicious external domains found.

Verified external links are limited to:
- HeyGen (app.heygen.com) -- video embeds
- Google Fonts, CDNs
- Social platforms (X, Instagram, TikTok, YouTube, Reddit, LinkedIn, Discord)
- Business partners (DraftKings, FanDuel, BetMGM, Alpaca)
- Supporting services (buymeacoffee.com, optout.aboutads.info)

**Note:** `architecture.html`, `cockpit.html`, and `command-center.html` reference `localhost:3457` -- this is expected for internal admin/dashboard pages, not public-facing.

### 3. HeyGen Videos

**Status: PASS** -- All 11 unique video IDs are valid 32-character hex strings.

| Video ID | Used In |
|----------|---------|
| `533b4f12...` | 9enterprises.html, pitch.html |
| `b990c21a...` | 9enterprises.html, aigm.html |
| `67fe0f6d...` | 9enterprises.html, pitch.html |
| `db0c68e1...` | 9enterprises.html, pitch.html |
| `fd7f74ed...` | 9enterprises.html, jules-pilot.html |
| `cc2f2c51...` | 9enterprises.html, underwriter.html, underwriter-demo.html |
| `c97d2535...` | 9enterprises.html, agent9.html |
| `6ce98089...` | 9enterprises.html, freeagent-landing.html |
| `cc1368ee...` | 9enterprises.html, dropshipping.html |
| `51f712db...` | 9enterprises.html, ai-education.html |
| `59fec472...` | rapid-pitch.html |

Both `/embed/` and `/embeds/` URL patterns are used -- both are valid HeyGen paths.

### 4. Mobile Responsive (Viewport Meta)

**Status: PASS (84/86)**

Missing viewport in 2 non-user-facing files (not fixed -- intentional):
- `og-image.html` -- OG image generation template (fixed 1200x630 canvas)
- `google-site-verification.html` -- SEO verification page only

All 84 user-facing pages have proper viewport meta tags.

### 5. Favicon

**Status: PASS (84/86)**

Same 2 non-user-facing files missing favicon (see above). All user-facing pages reference `/favicon.svg` and/or `/9-brand.jpg`.

### 6. Company Naming

**Status: FIXED (see above)**

Remaining cosmetic naming observations (NOT fixed -- these are meta tags or internal dashboards, low priority):

| File | Line | Issue |
|------|------|-------|
| `about.html` | 13 | `apple-mobile-web-app-title` says `9enterprises` |
| `agent9.html` | 13 | `apple-mobile-web-app-title` says `9enterprises` |
| `ai-education.html` | 10 | `apple-mobile-web-app-title` says `9enterprises` |
| `aigm.html` | 23 | `apple-mobile-web-app-title` says `9enterprises` |
| `aimlb.html` | 23 | `apple-mobile-web-app-title` says `9enterprises` |
| `ainba.html` | 23 | `apple-mobile-web-app-title` says `9enterprises` |
| `command-center.html` | 9 | `apple-mobile-web-app-title` says `9enterprises` |
| `dashboard-share.html` | 10 | `apple-mobile-web-app-title` says `9enterprises` |
| `docs-index.html` | 13 | `apple-mobile-web-app-title` says `9enterprises` |
| `dropshipping.html` | 10 | `apple-mobile-web-app-title` says `9enterprises` |
| `freeagent-landing.html` | 14 | `apple-mobile-web-app-title` says `9enterprises` |
| `freeagent.html` | 8 | `apple-mobile-web-app-title` says `9enterprises` |
| `jules-pilot.html` | 8 | `apple-mobile-web-app-title` says `9enterprises` |
| `owner.html` | 8 | `apple-mobile-web-app-title` says `9enterprises` |
| `pilot-chat.html` | 11 | `apple-mobile-web-app-title` says `9enterprises` |
| `pitch.html` | 13 | `apple-mobile-web-app-title` says `9enterprises` |
| `privacy.html` | 13 | `apple-mobile-web-app-title` says `9enterprises` |
| `underwriter-demo.html` | 8 | `apple-mobile-web-app-title` says `9enterprises` |
| `underwriter.html` | 8 | `apple-mobile-web-app-title` says `9enterprises` |

**Note:** `apple-mobile-web-app-title` is the iOS home-screen shortcut name. Keeping it as `9enterprises` (no space) may be intentional for brevity. Flagged for Owner decision.

"Trader9" vs "Trader 9" naming:
- `architecture.html` line 1274: uses `Trader9` in a code/reference table (acceptable -- code identifiers)
- `cockpit.html` lines 1003/1481/1579/1649: uses `Trader9` in dashboard UI
- `command-center.html` lines 420/516/666: uses `Trader9` in project cards

These are internal dashboards. The public pitch pages correctly use "Trader 9" with a space.

Internal dashboard pages (`dashboard.html`, `dashboard-share.html`) use `9enterprises` without space in body text on lines 436/438/882/1590/2036. These are admin-facing, not public.

### 7. Copyright Year

**Status: PASS** -- All copyright notices show 2026.

No instances of 2024 or 2025 in copyright lines.

### 8. Contact Emails

**Status: PASS** -- No instances of `emailfishback@gmail.com` found in any HTML file.

### 9. Title Tags

**Status: PASS (85/86)**

Only `og-image.html` lacks a `<title>` tag -- it is a rendering template, not a page.

### 10. OG Meta Tags

**Status: PARTIAL** -- 23 pages missing `og:title` / `og:description`.

Pages missing OG tags (cosmetic -- not fixed):

| File | Type | Priority |
|------|------|----------|
| `404.html` | Error page | Low |
| `architecture.html` | Internal doc | Low |
| `avatar-selection.html` | Internal tool | Low |
| `cockpit.html` | Admin dashboard | Low |
| `command-center.html` | Admin dashboard | Low |
| `cost-model.html` | Internal doc | Low |
| `dashboard-share.html` | Admin dashboard | Low |
| `dashboard.html` | Admin dashboard | Low |
| `docs-index.html` | Internal doc | Low |
| `freeagent.html` | App interface | Medium |
| `google-site-verification.html` | SEO utility | Low |
| `jules-family.html` | Product page | Medium |
| `kyle-response.html` | Internal pitch | Low |
| `kyle-response-v2.html` | Internal pitch | Low |
| `kyle-response-v3.html` | Internal pitch | Low |
| `kyle-response-v4.html` | Internal pitch | Low |
| `kyle-response-v5.html` | Internal pitch | Low |
| `kyle-response-v5b.html` | Internal pitch | Low |
| `og-image.html` | Rendering template | None |
| `owner.html` | Internal doc | Low |
| `pilot-chat.html` | App interface | Medium |
| `privacy.html` | Legal | Medium |
| `underwriter.html` | Product page | Medium |

**Recommendation:** Add OG tags to `freeagent.html`, `jules-family.html`, `pilot-chat.html`, `privacy.html`, and `underwriter.html` as these may be shared on social media.

---

## ITEMS NOT FIXED (Owner Decision Needed)

1. **apple-mobile-web-app-title**: 19 files use `9enterprises` (no space). Change to `9 Enterprises`?
2. **Internal dashboard naming**: `cockpit.html`, `command-center.html`, `dashboard.html` use `Trader9` (no space). These are admin-only pages. Standardize?
3. **OG tags on 5 medium-priority pages**: Add og:title and og:description?

---

*Report generated 2026-03-30 by 9.*
