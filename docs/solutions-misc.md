# Solutions: Voice SMS Routing, Dashboard Static Data, Reddit Account

Last updated: 2026-03-26

---

## 13. Voice Server SMS Routing

### Problem

The voice server (`scripts/voice-server.mjs`, line 766) has a hacked-in SMS proxy route. When Twilio sends an inbound SMS to the `/sms` endpoint on port 3456 (the voice server), the code manually proxies it to port 3472 (the pilot server) using a raw `http.request` call. This works but is fragile:

- The voice server is not an SMS server. It should only handle voice calls.
- If the pilot on port 3472 is down, the error fallback returns a generic TwiML message with no retry logic.
- Adding more services that need their own webhooks means more proxy routes hacked into voice-server.mjs, turning it into a monolithic request router.
- The Cloudflare tunnel exposes port 3456, so all external webhooks (voice AND SMS) funnel through the same tunnel endpoint.

### Solution Options

**Option A: Move SMS handling into comms-hub (Recommended)**

Move the `/sms` route from voice-server.mjs into comms-hub.mjs (port 3457). The hub already manages all communication channels (Telegram, iMessage, email, voice). SMS is a natural fit. The hub can route to the pilot internally or handle SMS messages directly.

Implementation:
1. Add an `/sms` POST handler in comms-hub.mjs that accepts Twilio webhook payloads.
2. Parse `From`, `Body`, and `To` fields from the form-urlencoded body.
3. Route to the pilot on port 3472 if it is running, otherwise handle directly (log, forward to Telegram, queue for later).
4. Update the Twilio SMS webhook URL to point to the hub's public endpoint (either a second Cloudflare tunnel or the cloud worker).
5. Remove the `/sms` proxy block from voice-server.mjs.

Pros: Centralizes all comms in one place. Hub already has health checks, logging, error handling.
Cons: Hub gets one more route (minor complexity increase).

**Option B: Dedicated reverse proxy (Caddy/nginx)**

Run a lightweight reverse proxy on a single port that routes by path:
- `/voice/*` -> port 3456 (voice server)
- `/sms` -> port 3472 (pilot)
- `/api/*` -> port 3457 (hub)

Implementation:
1. Install Caddy (`brew install caddy`) or use nginx.
2. Configure path-based routing.
3. Point the single Cloudflare tunnel at the proxy port.
4. Update all Twilio webhook URLs.

Pros: Clean separation. Each service stays focused.
Cons: Another process to manage. Overkill for two routes.

**Option C: Separate Cloudflare tunnel per service**

Run a second `cloudflared` tunnel pointing at port 3472 for SMS.

Pros: Complete isolation.
Cons: Two tunnels to manage. Cloudflare free tier allows it but adds operational overhead. Twilio webhook URL changes if tunnel restarts.

### Recommendation

**Option A** -- move SMS into comms-hub. Zero new infrastructure. The hub is already the central nervous system for all messaging. Estimated 1-2 hours of work.

### Cost

$0. No new services or infrastructure.

### Timeline

1-2 hours. Remove proxy from voice-server.mjs, add handler to comms-hub.mjs, update Twilio webhook URL, test.

---

## 14. Dashboard Static Data

### Problem

`public/dashboard.html` is a static HTML file served via GitHub Pages. All numbers are hardcoded placeholders:
- Ticker bar: "AGENTS SPAWNED 10", "BUDGET REMAINING $4,280 / $5,000", "MRR $1,240", "API CALLS TODAY 3,847"
- Portfolio section: static $1.08M total, static holdings
- Terminal simulator: fake command output with hardcoded values ("API Health OK latency 142ms", "API Spend MTD $312")
- Cost breakdown: static "$5-10/day" API burn estimate

The hub on localhost:3457 has live data via `/health` and `/state` endpoints, but the dashboard cannot reach localhost from GitHub Pages -- it is a different origin with no network path to the local machine.

### Solution

**Phase 1: Cloudflare Worker API proxy (public read-only endpoint)**

The cloud worker (`cloud-worker/`) already syncs state from the Mac hub every 60 seconds. Expose a public `/api/dashboard` endpoint on the worker that returns sanitized, read-only dashboard data.

Implementation:
1. Add a `GET /api/dashboard` route to the Cloudflare Worker that returns:
   - System health status (hub, voice, tunnel, channels)
   - Agent statuses (active/idle/standby counts)
   - Financial summary (MRR, API spend MTD, budget remaining)
   - Uptime percentage
   - Last sync timestamp
2. The worker already stores synced state from the Mac. Filter it to only expose non-sensitive fields.
3. Add `fetch()` calls in dashboard.html that hit the worker URL on page load and on a 60-second interval.
4. Replace hardcoded spans with dynamic values from the API response.
5. Add CORS headers (`Access-Control-Allow-Origin: *`) on the worker response, or scope to the GitHub Pages domain.

Example dashboard.html addition:
```javascript
async function refreshDashboard() {
  try {
    const res = await fetch('https://cloud-worker-url/api/dashboard');
    const data = await res.json();
    document.querySelector('.mrr-value').textContent = data.mrr;
    document.querySelector('.api-spend').textContent = data.apiSpendMtd;
    // ... update all dynamic elements
  } catch {
    // Keep placeholder values, show "offline" indicator
  }
}
setInterval(refreshDashboard, 60000);
refreshDashboard();
```

**Phase 2: WebSocket for real-time updates (optional, future)**

If sub-minute latency is needed, add a WebSocket endpoint to the cloud worker using Cloudflare Durable Objects. Dashboard connects on load and receives push updates. Cost: Durable Objects pricing (~$0.15/million requests).

### Recommendation

Phase 1 only. The cloud worker already has the data. Adding one route and a few fetch() calls in the HTML is straightforward. 60-second polling matches the existing sync interval.

### Cost

$0. Cloudflare Worker free tier covers 100K requests/day. Dashboard polling at 60s intervals = ~1,440 requests/day per viewer.

### Timeline

2-3 hours. Add worker route (30 min), add CORS headers (10 min), replace hardcoded values in dashboard.html with fetch logic (1-2 hours), test end-to-end.

---

## 15. Reddit Account Signup (Shadow DOM)

### Problem

During Reddit account creation, the verification code input field lives inside a shadow DOM. Standard Playwright `page.fill()` and `page.type()` calls cannot reach elements inside shadow roots. The verification code was correct but the input rejected it because the selector could not penetrate the shadow boundary.

### Solution

**Use Playwright MCP server for shadow DOM piercing.**

As documented in `docs/autonomy-improvements.md` (section 1.2), Microsoft's Playwright MCP server handles shadow DOM natively. Its CSS and text selectors automatically penetrate shadow roots without any special configuration.

Implementation:
1. Register the Playwright MCP server (if not already done):
   ```bash
   claude mcp add playwright -- npx @playwright/mcp@latest
   ```
2. Use the Playwright MCP tools to navigate to the Reddit signup/verification page.
3. Use `browser_type` or `browser_click` with standard CSS selectors -- Playwright's locator engine automatically pierces shadow DOM boundaries.
4. For the verification code input specifically:
   - Use `browser_type` with a selector like `input[name="code"]` or `input[type="text"]` -- Playwright will find it even inside nested shadow roots.
   - Alternatively, use text-based locators: `text=Enter code` to find the label, then interact with the nearby input.
5. If Reddit uses an iframe around the verification widget, chain with `frame_locator()` to first enter the iframe, then pierce the shadow DOM inside it.
6. If Reddit's hCaptcha fires during signup, solve it via CapMonster Cloud API (section 2.1 of autonomy-improvements.md, ~$0.60/1K solves).

Fallback approaches if Playwright MCP selectors fail:
- **JavaScript injection**: Execute `document.querySelector('reddit-verification').shadowRoot.querySelector('input').value = '123456'` via `browser_evaluate`.
- **Accessibility tree**: Use `aria/` selectors which traverse all shadow boundaries.
- **Keyboard navigation**: Tab to the input field and type directly, bypassing selector issues entirely.

### Cost

$0 for the Playwright MCP server. If CAPTCHA solving is needed: ~$0.001 per solve via CapMonster.

### Timeline

30 minutes to register Playwright MCP and attempt signup. If shadow DOM piercing works out of the box (expected), completion is under 1 hour total. If Reddit has additional anti-bot measures, add 1-2 hours for CAPTCHA integration and retry logic.

---

## Summary Table

| # | Problem | Recommended Solution | Cost | Timeline |
|---|---------|---------------------|------|----------|
| 13 | SMS proxy hacked into voice server | Move SMS handler to comms-hub | $0 | 1-2 hours |
| 14 | Dashboard shows static placeholder data | Cloud worker `/api/dashboard` endpoint + fetch() in HTML | $0 | 2-3 hours |
| 15 | Reddit shadow DOM blocks verification input | Playwright MCP (native shadow DOM piercing) | $0 | 30-60 min |
