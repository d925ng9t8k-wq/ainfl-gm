# AdSense Application Readiness — ainflgm.com
**Date:** April 5, 2026
**Author:** MONEY (9 Enterprises Revenue Agent)
**Draft window:** April 23–25 — 18 days away. Approval takes 2–4 weeks. Apply today.

---

## OWNER ACTION REQUIRED

Go to: https://adsense.google.com/start
Sign in with the Google account that owns `ca-pub-8928127451532131`.

If no AdSense account exists yet: create one at the above URL, enter ainflgm.com as the site URL.
The pub ID `ca-pub-8928127451532131` must match the account you create/log into.

---

## Pre-Application Checklist

| Requirement | Status | Notes |
|-------------|--------|-------|
| Live website, original content | PASS | 40+ pages, all NFL simulation content |
| Not prohibited content (no gambling as primary purpose) | PASS | Sports simulation, clearly labeled |
| Privacy Policy page | PASS | ainflgm.com/privacy.html |
| Terms of Service page | PASS | ainflgm.com/terms.html |
| About page | PASS | ainflgm.com/about.html |
| Contact info | PASS | captain@ainflgm.com |
| Footer links to Privacy + About | PASS | React Layout footer has both |
| Affiliate/ad disclosure in footer | PASS | FTC language present in Layout footer |
| Responsible gambling notice | PASS | 1-800-GAMBLER in footer |
| ads.txt file | PASS | ainflgm.com/ads.txt — contains pub ID |
| AdSense script tag in index.html | PASS | ca-pub-8928127451532131 |
| Google Analytics firing | PASS | G-PLW4H1NNF6 |
| Mobile responsive | PASS | PWA, mobile-first design |
| No broken pages / 404 errors on core nav | VERIFY | Run a quick manual check before submitting |
| Pub ID consistency across site | FIXED | All files now use ca-pub-8928127451532131 |

---

## Critical: Verify Your Pub ID

**Two pub IDs were found in the codebase. This has been fixed — all files now use `ca-pub-8928127451532131`.**

Before applying, confirm: log in to adsense.google.com and verify your publisher ID matches exactly `ca-pub-8928127451532131`. If your real account uses a different ID, update:
- `/public/ads.txt` (line 1)
- `/index.html` (meta tag + script src)
- All Layout.jsx / MLBLayout.jsx / NbaLayout.jsx ad slot `data-ad-client` attributes

---

## Application Steps

1. Go to https://adsense.google.com/start
2. Sign in with Google account that owns ainflgm.com (or can verify via DNS/HTML file)
3. Add ainflgm.com as the site
4. Google generates a snippet — it should match what's already in index.html
5. Google verifies the site (usually same day for already-tagged sites)
6. Review period: 2–4 weeks
7. During review: do NOT make major structural changes to the site

---

## What Happens During Review

- Google crawls the site and checks all pages
- They verify: original content, policy compliance, no prohibited content
- They check that analytics/traffic data exists (GA is live — good)
- Approval = email notification; you can then create real ad units with specific slot IDs

---

## After Approval

1. Log into AdSense dashboard
2. Create ad units: recommend 3 units
   - `728x90` leaderboard (footer)
   - `160x600` skyscraper (sidebar, desktop only)
   - `300x250` medium rectangle (mobile between content sections)
3. Copy the real `data-ad-slot` values from each unit
4. Update Layout.jsx ad slots: replace `data-ad-slot="auto"` with real slot IDs
5. The `(adsbygoogle = window.adsbygoogle || []).push({})` call is already in Layout — verify it fires

---

## Revenue Projection

| Traffic | Est. RPM | Monthly AdSense |
|---------|---------|-----------------|
| 500 PV/day | $4 | ~$60 |
| 5K PV/day | $5 | ~$750 |
| 50K PV/day (draft peak) | $8 | ~$12,000 |

NFL Draft window (April 23–25) commands a premium RPM due to high advertiser demand for sports content during the draft.

---

## Affiliate Revenue (Separate from AdSense)

AdSense and affiliate links CAN coexist on the same site, with one rule:
**Sportsbook affiliate links (BetMGM, FanDuel) should not appear on the same page view as AdSense auto ads.** Keep them on separate components/pages or in non-AdSense zones.

The current implementation places affiliate banners in specific div containers away from `<ins class="adsbygoogle">` elements. This separation is maintained.

---

## Contacts for Affiliate Signups

| Partner | Signup URL | Program Type | Cookie | CPA |
|---------|-----------|-------------|--------|-----|
| FanDuel | affiliates.fanduel.com | Direct affiliate | 730 days | $100–400 per depositing customer |
| BetMGM | betmgm.com/affiliates or via CJ Affiliate (signup.cj.com) | CJ Affiliate | 30 days | $50–200 per new customer |
| DraftKings | draftkings.com/affiliates | Direct affiliate | 30 days | $100–300 per new depositing customer |

Note: Sportsbook affiliates require personal information verification (SSN/EIN, bank account for payouts). Owner must complete these signups personally — they cannot be automated.
