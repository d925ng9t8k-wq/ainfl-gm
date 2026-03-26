# AdSense Gap Analysis — ainflgm.com
**Date:** March 26, 2026
**Status:** NOT READY TO APPLY

---

## What Exists (Good to Go)

| Requirement | Status | Notes |
|------------|--------|-------|
| Live website with original content | PASS | 32 team pages + feature pages = 40+ pages of original content |
| No prohibited content | PASS | Sports simulation — fully compliant with AdSense policies |
| Navigable, user-friendly site | PASS | Clean UI, responsive design |
| About page | PASS | public/about.html exists with company info and contact |
| Contact info | PASS | captain@ainflgm.com on about page |
| US-based site | PASS | Cincinnati, OH |
| Responsible gambling footer | PASS | Added March 25 |
| Ad slot code scaffolding | PASS | Footer leaderboard already coded, just needs AdSense snippet |
| Buy Me A Coffee account | PASS | buymeacoffee.com/ainflgm active |

---

## What is MISSING (Must Fix Before Applying)

| Gap | Priority | Est. Time | Details |
|-----|----------|-----------|---------|
| **Privacy Policy page** | CRITICAL | 30 min | AdSense requires a dedicated privacy policy disclosing cookies, analytics, and ad serving. No privacy.html exists. about.html has no privacy policy link. |
| **FTC disclosure footer** | CRITICAL | 1 hr | Required on ALL pages that will show ads or affiliate links. Must state "This site uses advertising and affiliate links." |
| **Google Analytics verification** | HIGH | 30 min | G-PLW4H1NNF6 tag exists but needs verification that it's actually firing. AdSense reviewers want to see traffic data. |
| **30 days of traffic data** | HIGH | 30 days | AdSense prefers sites with established traffic history. Clock starts when GA is verified. |
| **AdSense meta tag in index.html** | HIGH | 5 min | The AdSense verification snippet needs to go in the `<head>` of the main page. Can't do this until account is created, but prepare the slot. |
| **Privacy policy link in footer** | MEDIUM | 15 min | Every page footer should link to privacy.html. Currently no footer links to any policy page. |
| **Cookie consent banner** | MEDIUM | 1 hr | Not strictly required for US-only audiences but strongly recommended. Shows Google you take compliance seriously. |

---

## What Needs to Be Fixed

### Immediate (Do Tonight)
1. **Create privacy.html** — Full privacy policy covering analytics, ads, cookies, affiliate links. (~30 min) **DONE — see public/privacy.html**
2. **Add privacy policy link to about.html footer** — One line change. (~5 min)
3. **Add FTC disclosure to all page footers** — "This site contains ads and affiliate links." (~1 hr across all pages)
4. **Verify Google Analytics is firing** — Check real-time GA dashboard. (~15 min)

### Before Applying (This Week)
5. **Add privacy/terms links to every page footer** — Consistent footer across the site. (~2 hrs)
6. **Prepare AdSense `<head>` snippet slot** — Comment placeholder in index.html. (~5 min)
7. **Document current traffic baseline** — Screenshot GA data for reference. (~15 min)

### After Applying (During Review Period)
8. **Wait for 30 days of traffic data** if not already there
9. **Add cookie consent banner** if Google requests it
10. **Configure ad placements** once approved

---

## Timeline to AdSense-Ready

| Task | Time |
|------|------|
| Privacy policy page | 30 min (DONE) |
| FTC disclosures on all pages | 1 hr |
| GA verification | 30 min |
| Footer links across site | 2 hrs |
| **Total hands-on work** | **~4 hours** |
| Traffic history requirement | 30 days (clock may already be running) |

**Earliest application date:** As soon as FTC disclosures and footer links are added (1-2 days of work). Google may approve with less than 30 days of traffic data if content quality is high enough.

---

## Risk Assessment

**Likely to pass on first application:** 70% — if all gaps above are closed. The site has strong original content, clear purpose, and professional design. The main risk is low traffic volume, but Google has been more lenient on this for niche sports sites.

**If rejected:** Google provides specific reasons. Most common: "not enough content" (we're fine) or "site under construction" (we're fine). Fix whatever they flag and reapply after 30 days.
