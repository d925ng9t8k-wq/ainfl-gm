# Pilot Concierge — Food Ordering Compliance & Security

**Last Updated:** 2026-03-30
**Applies To:** pilot-server.mjs (Kyle Cabezas instance)

---

## 1. Current Architecture (v1.3.0)

Pilot does NOT process payments or store card data. The food ordering system generates deep links to DoorDash, UberEats, Grubhub, and direct restaurant ordering pages. The user completes checkout on the platform's own payment page.

**Data flow:**
```
Kyle texts "order me a pizza"
  → Pilot parses intent (cuisine, chain, preferences)
  → Generates platform-specific URLs (DoorDash/UberEats/Grubhub/direct)
  → Kyle taps link → completes payment on restaurant/platform site
```

**What Pilot stores (in jules-profile-kylec.json):**
- Favorite order description (text only, e.g., "large pepperoni from Domino's")
- Order history (cuisine type + timestamp — no payment data)

**What Pilot does NOT store:**
- Credit card numbers (PAN)
- CVV/CVC codes
- Billing addresses
- Payment tokens
- DoorDash/UberEats account credentials

---

## 2. PCI DSS Compliance Status

### Current: SAQ A-EP NOT Required

Since Pilot never touches, transmits, processes, or stores cardholder data, PCI DSS does not apply to the current architecture. The user is redirected to DoorDash/UberEats/restaurant checkout pages where those platforms (all PCI Level 1 compliant) handle payment processing.

**This is the safest and recommended approach.**

### If Future API Integration Adds Payment Processing

If Uber Consumer Delivery API or similar is approved and requires passing payment information, the following must be implemented:

#### Option A: Platform-Managed Payments (Recommended)
- User links their Uber/DoorDash account via OAuth
- Payment methods are stored on the platform side
- Pilot sends order requests via API; platform charges saved card
- **PCI impact: None** — Pilot is a pass-through

#### Option B: Tokenized Payments via Stripe
If direct payment handling becomes necessary:
1. **Use Stripe Elements or Checkout** — card data never touches Pilot's server
2. Stripe returns a token (tok_xxx) or PaymentMethod (pm_xxx)
3. Store only the Stripe token ID in profile — never the raw card
4. Charge via Stripe API server-side using the token
5. **PCI impact: SAQ A** — minimal compliance burden

### Tokenization Best Practices (PCI DSS 4.0, effective March 2026)
- Tokens must be irreversible without access to the token vault
- Token vault (Stripe's infrastructure) must be isolated from application data
- Never log tokens in plaintext in application logs
- Rotate API keys quarterly
- Monitor for anomalous token usage patterns
- Ensure tokenization provider maintains current PCI DSS attestation

---

## 3. Data Stored in Profile

### food_preferences object
```json
{
  "food_preferences": {
    "favorite_order": "large pepperoni from Domino's",
    "favorite_saved_at": "2026-03-30T15:00:00.000Z",
    "order_history": [
      { "restaurant": "Domino's", "cuisine": "pizza", "ts": "2026-03-30T15:00:00.000Z" }
    ]
  }
}
```

**Risk level: LOW** — Contains only food preference text and timestamps. No PII beyond what is already in the profile. No payment data.

---

## 4. API Access Status (as of March 2026)

| Platform | API Type | Can Place Orders? | Status |
|----------|----------|-------------------|--------|
| DoorDash | Drive/Marketplace/Checkout | No (merchant-only) | Pipeline at capacity |
| Uber Eats | Consumer Delivery API | Yes | Early access — apply via intake form |
| Grubhub | Order-Taking API | Potentially | Requires NDA + contract |
| Domino's | Unofficial (node-dominos-pizza-api) | Yes | Package unmaintained, may break |

**Recommended next step:** Apply for Uber Consumer Delivery API. This is explicitly designed for "AI-powered platforms to enable intelligent assistants or chatbots to handle food ordering on behalf of users." Apply at: https://uber.surveymonkey.com/r/consumerdeliveryintake

---

## 5. Security Controls

### Current Controls
- Profile JSON file is local-only (not exposed via API beyond read endpoints)
- No payment data stored anywhere
- Food order links are generated server-side, not user-injectable
- Input sanitization via existing MAX_BODY_SIZE (64KB) limit
- All external URLs are constructed from whitelisted patterns, not raw user input

### Recommendations for Future API Integration
1. Store API keys (DoorDash/Uber/Grubhub) in .env, never in code
2. If OAuth is required, store refresh tokens encrypted at rest
3. Implement order confirmation step before any payment-connected action
4. Rate limit food orders (max 5 per hour per user) to prevent abuse
5. Log all order attempts for audit trail
6. Never store delivery addresses in logs — only in encrypted profile

---

## 6. Compliance Checklist

- [x] No cardholder data stored, processed, or transmitted
- [x] Deep-link architecture keeps payment on platform side
- [x] Profile data contains only food preference text
- [x] Input validation and size limits in place
- [x] External URLs constructed from whitelisted patterns
- [ ] Future: Apply for Uber Consumer Delivery API
- [ ] Future: If API approved, implement OAuth flow (no password storage)
- [ ] Future: If direct payment needed, use Stripe tokenization (SAQ A)
- [ ] Future: Add order confirmation before payment-connected actions
- [ ] Future: Add rate limiting on food order endpoints
