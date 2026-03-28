# freeagent9 Concierge Features Plan

**Date:** March 28, 2026
**Status:** GREENLIT (SOTU Part 3, Items 3-4)
**Owner Decision:** Move forward as feature additions to base 9enterprises solution and freeagent9

---

## 1. Food Delivery / Ordering (Uber Eats, DoorDash)

**Concept:** freeagent9 can order food on behalf of the user. "Hey Pilot, order me the usual from Chipotle."

**Implementation Path:**
- Uber Eats API (via Uber Direct): B2B delivery API, requires merchant partnership
- DoorDash DoorDash Drive API: White-label delivery, B2B focused
- **Recommended first:** Instacart Connect API — grocery ordering, more accessible API, broader use case

**Phase 1 (MVP):** Deep-link integration. Pilot generates an order link with pre-filled items → user taps to confirm in the native app. Zero API cost.
**Phase 2:** Full API integration for hands-free ordering with saved preferences and payment.

---

## 2. Appointments / Reservations

**Concept:** freeagent9 books appointments and reservations. "Pilot, book me a table at Jeff Ruby's for Saturday at 7."

**Implementation Path:**
- **OpenTable API** — Restaurant reservations. Affiliate program available (commission per booking).
- **Resy API** — Premium restaurant bookings.
- **Calendly API** — Business scheduling. Free tier available.
- **Google Calendar API** — Free, universal calendar management.

**Phase 1 (MVP):** Google Calendar integration for scheduling + deep-links to OpenTable for restaurant bookings.
**Phase 2:** Direct OpenTable API booking (affiliate revenue opportunity).
**Phase 3:** Calendly integration for business meetings.

---

## 3. Additional Concierge Vendors (Expanded Horizons)

### Tier 1 — High Feasibility, High User Value
| Vendor | Use Case | API Status | Cost |
|--------|----------|------------|------|
| **Google Calendar** | Schedule management | Free API | Free |
| **OpenTable** | Restaurant reservations | Affiliate API | Commission per booking |
| **Uber/Lyft** | Ride requests | Deep-link only (no direct API for consumer) | Free |
| **Ticketmaster** | Event tickets | Discovery API (free) | Affiliate commission |
| **Google Maps/Places** | Location search, directions | Free tier (28K calls/mo) | Free |

### Tier 2 — Medium Feasibility
| Vendor | Use Case | API Status | Cost |
|--------|----------|------------|------|
| **Instacart** | Grocery delivery | Connect API (B2B) | Requires partnership |
| **Amazon** | Shopping | Product Advertising API | Affiliate commission |
| **Zillow** | Home search (ties to agent9) | API available | Free tier |
| **Yelp** | Business reviews/search | Fusion API (free) | Free |
| **Weather.com** | Weather (already built) | OpenWeather API | Free tier |

### Tier 3 — Longer-Term
| Vendor | Use Case | API Status | Cost |
|--------|----------|------------|------|
| **Stripe** | Bill pay, subscriptions | Full API | Transaction fees |
| **Plaid** | Financial aggregation | API available | Per-connection pricing |
| **Airbnb** | Travel booking | No public API | Deep-link only |
| **HomeAdvisor** | Home services | Lead gen API | Per-lead pricing |

---

## 4. Revenue Model

Concierge features create THREE revenue streams:
1. **Affiliate commissions** — OpenTable, Amazon, Ticketmaster bookings
2. **Subscription upsell** — Concierge features as premium add-on to base freeagent9
3. **Data insights** — Aggregated preference data (anonymized) for market intelligence

---

## 5. Implementation Priority

1. Google Calendar integration (free, universal, immediate value)
2. OpenTable deep-links (restaurant bookings, affiliate revenue)
3. Uber/Lyft deep-links (ride requests)
4. Ticketmaster discovery (event recommendations)
5. Amazon product links (shopping, affiliate revenue)

**Total build time estimate:** 2-3 days for Phase 1 (deep-links + Calendar).
**Cost:** $0 for Phase 1 (all free APIs/deep-links).
