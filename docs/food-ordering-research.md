# Food Ordering API Research for 9 Enterprises Pilot

**Date:** 2026-03-26
**Use Case:** User texts "Pilot, order me a pepperoni pizza from the closest Dominos" and the pilot places the order.

---

## Executive Summary

There is **no single, publicly available API** that lets a third-party app place consumer food orders on DoorDash, UberEats, or Grubhub with full autonomy today. However, there are viable paths forward, ranked below by feasibility.

**Recommended approach (immediate):** Domino's unofficial API via `node-dominos-pizza-api` for pizza-specific orders, combined with applying for Uber's Consumer Delivery API early access for broader restaurant coverage.

---

## 1. Platform-by-Platform Analysis

### 1A. DoorDash

| Factor | Details |
|--------|---------|
| **API Name** | DoorDash Drive API / Marketplace API / Checkout API |
| **Can we place consumer orders?** | **No.** Drive API is for merchants requesting Dasher delivery of their own orders. Marketplace API is for merchants receiving orders. Checkout API creates an order session but redirects the user to a DoorDash-hosted checkout page -- not fully programmatic. |
| **Authentication** | JWT-based, requires developer account + NDA |
| **Access Status** | Marketplace integration pipeline is **at capacity** -- not accepting new partners. Production access to Drive API is also restricted with no timeline. |
| **Cost** | Per-delivery fees for Drive; no public pricing for Marketplace |
| **Verdict** | **Not viable for our use case.** All DoorDash APIs are merchant-facing. The only consumer-side integration exists via their ChatGPT/OpenAI partnership (launched Dec 2025), which is a closed, first-party arrangement. |

**Sources:**
- [DoorDash Developer Portal](https://developer.doordash.com/en-US/)
- [DoorDash Drive API](https://developer.doordash.com/en-US/api/drive/)
- [DoorDash Checkout API](https://developer.doordash.com/en-US/api/external_checkout/)
- [DoorDash x OpenAI Announcement](https://about.doordash.com/en-us/news/openai)

---

### 1B. Uber Eats / Uber Direct

| Factor | Details |
|--------|---------|
| **API Name** | **Uber Consumer Delivery APIs** (distinct from Uber Direct and Eats Marketplace) |
| **Can we place consumer orders?** | **YES -- this is exactly our use case.** The Consumer Delivery APIs are explicitly designed for "AI-powered Platforms to enable intelligent assistants or chatbots to handle food ordering on behalf of users." |
| **Key Capabilities** | Merchant discovery by location, menu/item retrieval, cart creation, order submission, status tracking, order history/reordering |
| **Authentication** | OAuth2 -- user must link their Uber account to our app |
| **Access Status** | **Early access phase.** Access granted on a case-by-case basis. Must apply via [intake form](https://uber.surveymonkey.com/r/consumerdeliveryintake). |
| **Cost** | Not publicly disclosed (early access) |
| **Speed to implement** | Medium -- need to get approved first, then integrate OAuth + ordering flow |
| **Verdict** | **Best official API option.** Apply immediately. This is purpose-built for what we need. |

**Sources:**
- [Uber Consumer Delivery APIs Introduction](https://developer.uber.com/docs/consumer-delivery/introduction)
- [Uber Eats Marketplace APIs](https://developer.uber.com/docs/eats/introduction)
- [Uber Direct API](https://developer.uber.com/docs/deliveries/overview)

---

### 1C. Grubhub

| Factor | Details |
|--------|---------|
| **API Name** | Grubhub Order-Taking API |
| **Can we place consumer orders?** | **Potentially yes.** The API supports the full consumer ordering workflow: authenticate diner, find restaurants, browse menus, create cart, add items, attach payment, checkout. |
| **Authentication** | Bearer token with three auth flows (one simplified, two OAuth-compliant) |
| **Access Status** | Requires filling out a form, team review, contract signing, and NDA before getting pre-production server access. Not self-serve. |
| **Cost** | Not publicly disclosed; requires contract |
| **Verdict** | **Possible but slow.** Worth applying as a backup to Uber. The API docs describe a full consumer ordering flow, which is promising. |

**Sources:**
- [Grubhub Developer Portal](https://developer.grubhub.com/)
- [Grubhub Order-Taking API Introduction](https://grubhub-developers.zendesk.com/hc/en-us/articles/115004787843-Introduction-to-the-Order-Taking-API)
- [Grubhub Getting Started](https://grubhub-developers.zendesk.com/hc/en-us/articles/115004601686-Getting-Started)

---

### 1D. Domino's Pizza (Unofficial API)

| Factor | Details |
|--------|---------|
| **API Name** | Unofficial Domino's API via `node-dominos-pizza-api` (npm: `dominos`) |
| **Can we place consumer orders?** | **YES.** Full ordering flow: find nearby stores, browse menu, build order with customizations, validate, price, and place with credit card payment. |
| **Authentication** | None required (uses Domino's public-facing mobile/web API endpoints) |
| **Access Status** | **Immediately available.** `npm i dominos` |
| **Cost** | Free (just pay for the pizza) |
| **Reliability** | Medium -- unofficial API, could break if Domino's changes their endpoints. 576 GitHub stars, actively maintained. |
| **Speed to implement** | **Fast -- hours, not days.** |
| **Limitations** | Domino's only (no other restaurants). Cannot cancel orders programmatically. Rate-limited. |
| **Verdict** | **Best immediate option for pizza.** Perfect for the "order me a pepperoni pizza from Dominos" use case. Ship today, iterate tomorrow. |

**Sources:**
- [node-dominos-pizza-api on GitHub](https://github.com/RIAEvangelist/node-dominos-pizza-api)
- [dominos on npm](https://www.npmjs.com/package/dominos)
- [pizzapi Python wrapper](https://github.com/ggrammar/pizzapi)

---

## 2. Alternative Approaches

### 2A. Browser Automation (Playwright/Selenium)

| Factor | Details |
|--------|---------|
| **Approach** | Use Playwright to automate the DoorDash/UberEats web app -- log in, search, add to cart, checkout |
| **Can it work?** | Technically yes, but fragile and risky |
| **ToS Risk** | **High.** DoorDash and Uber Eats ToS prohibit automated access. Account bans are likely. Anti-bot detection (Cloudflare, reCAPTCHA) is aggressive. |
| **Reliability** | Low -- UI changes break automation, bot detection causes failures |
| **Maintenance** | High -- constant updates needed as UIs change |
| **Verdict** | **Not recommended.** ToS violations risk banning Jasson's accounts. Unreliable in production. |

### 2B. Third-Party Aggregators (Olo, KitchenHub, Bringg)

| Factor | Details |
|--------|---------|
| **Olo** | Restaurant-focused platform. Olo Rails aggregates marketplace orders for restaurants. Not a consumer-facing ordering API. Olo App (launching late 2026) will be consumer-facing but is not an API. |
| **KitchenHub** | Unified API for restaurants to receive orders from DoorDash/UberEats/Grubhub. **Merchant-side only** -- cannot place consumer orders. |
| **Bringg** | Last-mile delivery logistics platform. Not a food ordering API. |
| **Verdict** | **None of these solve our use case.** All are merchant/restaurant tools, not consumer ordering APIs. |

### 2C. Direct Restaurant APIs

Several restaurant chains expose ordering APIs (officially or unofficially):

| Chain | API Status | Viability |
|-------|-----------|-----------|
| **Domino's** | Unofficial but well-documented Node.js/Python wrappers | High -- immediate |
| **Pizza Hut** | No known public API or wrappers | Low |
| **Chipotle** | No known public API | Low |
| **McDonald's** | No known public API | Low |

---

## 3. Recommended Implementation Plan

### Phase 1: Ship Today (Domino's)
- Use `node-dominos-pizza-api` to enable pizza ordering
- Integrate with pilot's command processing
- Requires: Jasson's delivery address, payment card on file
- POC script: `scripts/food-order-poc.mjs`

### Phase 2: Apply for Uber Consumer Delivery API (This Week)
- Fill out the [Uber intake form](https://uber.surveymonkey.com/r/consumerdeliveryintake)
- Pitch: "9 Enterprises / freeagent9 -- AI pilot assistant that orders food on behalf of users via natural language"
- If approved, this unlocks the full Uber Eats restaurant catalog

### Phase 3: Apply for Grubhub API Access (This Week)
- Fill out the [Grubhub developer form](https://developer.grubhub.com/)
- Backup option to Uber

### Phase 4: Expand Direct Restaurant Integrations
- Research/reverse-engineer additional chain APIs as needed
- Consider Instacart Developer Platform for grocery ordering

### Not Recommended
- Browser automation (ToS risk, unreliable)
- Building a DoorDash integration (merchant-only APIs, pipeline closed)
- Third-party aggregators (wrong side of the marketplace)

---

## 4. Architecture for Pilot Integration

```
User: "Pilot, order me a pepperoni pizza from the closest Dominos"
  |
  v
Pilot NLU --> Extract: {food: "pepperoni pizza", restaurant: "Dominos", modifier: "closest"}
  |
  v
Router: Which ordering service?
  |-- "Dominos" --> Domino's API (Phase 1, available now)
  |-- Other restaurant --> Uber Consumer Delivery API (Phase 2, pending approval)
  |-- Fallback --> "I can order from Dominos now. For other restaurants, I'll need UberEats access."
  |
  v
Order Flow:
  1. Find nearest store (by saved address or GPS)
  2. Search menu for matching item
  3. Build cart with item + customizations
  4. Confirm with user: "Large pepperoni pizza from Dominos on Main St, $14.99. Place order?"
  5. On confirmation --> Submit order with saved payment
  6. Track delivery status, notify user of ETA
```

---

## 5. Security Considerations

- Payment credentials must be stored encrypted, never logged
- User confirmation required before placing any order (money is involved)
- Order history should be logged for dispute resolution
- Rate limiting to prevent accidental duplicate orders
