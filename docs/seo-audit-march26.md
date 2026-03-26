# SEO Audit — public/about.html
**Date:** March 26, 2026

---

## Findings

### 1. Meta Description — MISSING
No `<meta name="description">` tag exists. Google will auto-generate a snippet from page content, which is unpredictable and usually bad.

**Recommendation:** Add inside `<head>`:
```html
<meta name="description" content="AiNFL GM is a free AI-powered NFL offseason simulator. Manage any team's salary cap, sign free agents, trade, draft, and simulate the season.">
```
(155 characters — under the 160 limit)

### 2. OpenGraph Tags — MISSING
No `og:title`, `og:description`, `og:image`, or `og:type` tags. This means shared links on Twitter/X, Facebook, Discord, Reddit, and iMessage will render as plain URLs with no preview card.

**Recommendation:** Add inside `<head>`:
```html
<meta property="og:title" content="AiNFL GM — Free AI-Powered NFL Offseason Simulator">
<meta property="og:description" content="Pick any NFL team. Manage the cap, sign free agents, make trades, run the draft, simulate the season. Built by 9 Enterprises.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://ainflgm.com/about.html">
<meta property="og:image" content="https://ainflgm.com/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="AiNFL GM — Free AI-Powered NFL Offseason Simulator">
<meta name="twitter:description" content="Pick any NFL team. Manage the cap, sign free agents, make trades, run the draft, simulate the season.">
<meta name="twitter:image" content="https://ainflgm.com/og-image.png">
```
**Action needed:** Create an `og-image.png` (1200x630px recommended) — this is critical for Reddit/Twitter link previews.

### 3. H1 Tag — NOT KEYWORD-OPTIMIZED
Current H1: `About AiNFL GM`

This is brand-only. No one searches "About AiNFL GM." The H1 should target the primary search intent.

**Recommendation:** Change to:
```html
<h1>AiNFL GM — Free AI-Powered NFL GM Simulator</h1>
```
This targets: "NFL GM simulator," "AI NFL simulator," "NFL offseason simulator" — all high-intent queries with low competition.

### 4. Page Title — DECENT BUT IMPROVABLE
Current: `About — AiNFL GM | 9 Enterprises`

The brand name "9 Enterprises" means nothing to searchers yet. Front-load the keyword.

**Recommendation:**
```html
<title>About AiNFL GM — Free AI NFL GM Simulator | Offseason, Draft & Trade Sim</title>
```

### 5. Additional Issues

| Issue | Severity | Fix |
|-------|----------|-----|
| No canonical URL tag | Medium | Add `<link rel="canonical" href="https://ainflgm.com/about.html">` |
| No structured data (JSON-LD) | Low | Add WebApplication schema for rich results |
| No favicon meta tags | Low | Add `<link rel="icon">` for tab icon |
| No `lang` attribute issues | OK | `lang="en"` is present — good |
| No alt text needed | OK | No images on page currently |

---

## Priority Order

1. **Add meta description** — 2 minutes, biggest SEO impact
2. **Add OpenGraph + Twitter Card tags** — 10 minutes, critical for Reddit launch (links need preview cards)
3. **Create og-image.png** — 30 minutes (CANVAS task), required for #2 to work
4. **Fix H1 and title** — 2 minutes, improves search ranking
5. **Add canonical URL** — 1 minute, prevents duplicate content issues
