# Pilot AI Assistant — Stress Test Results

**Date:** 2026-03-30  
**Server:** http://localhost:3472 (v1.3.0)  
**Instance:** Kyle Cabezas (kylec)  
**Tester:** 9 (automated via curl)

## Summary

- **Total tests:** 20
- **PASS:** 18
- **NEEDS_WORK:** 1
- **FAIL:** 1 (fixed during test)
- **Fixes applied:** 3

---

## Results

### Test 1 — "help"
- **Response (first 200 chars):** Here's what I can do: Mortgage Guidelines — Instant FHA, Conventional, VA, and USDA guideline lookups — DTI, credit scores, fees, loan limits. Try: "FHA DTI limits" Rate Tracking — Text a rate upd...
- **Grade:** PASS
- **Notes:** Full feature registry returned. Clean format. All 12 capabilities listed.

### Test 2 — "what can you do"
- **Response (first 200 chars):** Here's what I can do: Mortgage Guidelines — Instant FHA, Conventional, VA, and USDA guideline lookups...
- **Grade:** PASS
- **Notes:** Same as "help" — correct behavior.

### Test 3 — "Order me a pizza"
- **Response (first 200 chars):** Pizza — here are your options: DoorDash: https://www.doordash.com/food-delivery/cincinnati-oh-restaurants/pizza/ UberEats: https://www.ubereats.com/search?q=pizza Grubhub: ...
- **Grade:** PASS
- **Notes:** All 3 delivery platforms + 4 direct chain links (Domino's, LaRosa's, Papa John's, Pizza Hut). Excellent.

### Test 4 — "I want Chinese food delivered"
- **Response (first 200 chars):** Chinese food — here are your options: DoorDash: https://www.doordash.com/food-delivery/cincinnati-oh-restaurants/chinese/ UberEats: ...
- **Grade:** PASS
- **Notes:** DoorDash category link is correct (chinese slug). All 3 platforms.

### Test 5 — "Get me tacos"
- **Response (first 200 chars):** Tacos — here are your options: DoorDash: https://www.doordash.com/food-delivery/cincinnati-oh-restaurants/mexican/ UberEats: ... Or order direct: Taco Bell: ...
- **Grade:** PASS
- **Notes:** Smart mapping from "tacos" to Mexican category. Taco Bell direct link included.

### Test 6 — "Order headphones from Amazon"
- **Response (first 200 chars):** Amazon search for "headphones": https://www.amazon.com/s?k=headphones Tap to browse and order. Prime should have it to you in a day or two.
- **Grade:** PASS (was FAIL — fixed)
- **Issue found:** Food intent detection ran BEFORE Amazon intent, causing "Order headphones from Amazon" to match the broad food ordering regex. Returned DoorDash links for headphones.
- **Fix:** Reordered intent detection — Amazon and grocery now checked before food delivery.

### Test 7 — "I need groceries"
- **Response (first 200 chars):** Grocery delivery options: Kroger: https://www.kroger.com/ Instacart (Kroger): https://www.instacart.com/store/kroger/storefront Both deliver in Cincinnati. Tap to shop.
- **Grade:** PASS
- **Notes:** Both Kroger and Instacart links. Cincinnati-aware.

### Test 8 — "What's the FHA minimum credit score?"
- **Response:** FHA min credit: 580 for 3.5% down, 500 for 10% down. Lender overlays may be higher.
- **Grade:** PASS
- **Notes:** Accurate numbers. Instant guideline lookup (no Claude API call needed).

### Test 9 — "FHA DTI limits"
- **Response:** FHA DTI: 31/43 (front/back) standard, up to 50% with compensating factors. AUS can go 46.9/56.9 (AUS approval).
- **Grade:** PASS (was NEEDS_WORK — fixed)
- **Issue found:** Response originally said "up to up to 50%" — the template prepended "up to" and the profile data value already started with "up to".
- **Fix:** Removed "up to" prefix from template, letting profile data control phrasing.

### Test 10 — "Conventional loan limits 2026"
- **Response:** 2026 conforming loan limit: $832,750. Up from $806,500 in 2025. Anything over that is jumbo.
- **Grade:** PASS (improved)
- **Issue found:** Fast-path guideline detection only matched "2025" or "conforming" — input with "2026" or "conventional" fell through to Claude API.
- **Fix:** Added "2026" and "conventional" to the loan limit detection regex. Now instant.

### Test 11 — "Remind me to call the Garcias at 3pm"
- **Response:** Got it. Reminder set for 3pm to call the Garcias.
- **Grade:** PASS
- **Notes:** Reminder parsed and scheduled. Will fire at 3pm ET.

### Test 12 — "Note: Williams appraisal came in at 340k"
- **Response:** Noted: "Williams appraisal came in at 340k"
- **Grade:** PASS
- **Notes:** Saved to profile. Clean confirmation.

### Test 13 — "What notes do I have?"
- **Response:** Williams appraisal came in at 340k.
- **Grade:** PASS
- **Notes:** Retrieved note from test 12. Working as expected.

### Test 14 — "Write me a social media post about rates"
- **Response (first 200 chars):** Here's a punch for LinkedIn or Facebook: --- **Rates holding steady in the mid-6s.** If you've been sitting on the sidelines waiting for the "perfect" number — here's the reality check...
- **Grade:** PASS
- **Notes:** Claude-generated. On-brand, punchy, mortgage-literate tone. Good CTA.

### Test 15 — "Help me script a call to a borrower who's nervous about rates"
- **Response (first 200 chars):** Here's a tight opener + close: --- **OPENER:** "Hey [Name], it's Kyle from Rapid Mortgage. Quick call — I know rates have been on your mind. Where's your head at right now?" *(Let them talk...
- **Grade:** PASS
- **Notes:** Excellent call script with opener, body, and close. Coaching notes included.

### Test 16 — "lol"
- **Response:** Ha. Too much? I can dial it back. What'd you need?
- **Grade:** PASS
- **Notes:** Graceful. Casual. In character. No crash.

### Test 17 — "" (empty message)
- **Response:** Missing message field
- **Grade:** NEEDS_WORK
- **Issue:** Returns error JSON `{"error": "Missing message field"}` instead of a friendly response like "Didn't catch that — what do you need?" The error is technically correct but feels like a raw system error to an end user via SMS.

### Test 18 — "What's my pipeline look like?"
- **Response (first 200 chars):** Don't have live Encompass access yet — that's Phase 2. Right now I'd need you to give me the count, or I can pull it manually if you want to walk me through it...
- **Grade:** PASS
- **Notes:** Honest about capability gap. References Phase 2. Offers workaround.

### Test 19 — "Order me Skyline Chili"
- **Response (first 200 chars):** Skyline Chili — here you go: Order direct: https://www.skylinechili.com/order-online DoorDash: https://www.doordash.com/search/store/skyline%20chili/?pickup=false Direct ordering is usually cheaper...
- **Grade:** PASS
- **Notes:** Cincinnati chain recognized. Direct ordering link + DoorDash. Tip about avoiding markup.

### Test 20 — "Good morning"
- **Response:** Morning. What's the rate today? Once you give me that, I'll pull together the briefing — closings, anything hot in the pipeline, and one thing to hit first.
- **Grade:** PASS
- **Notes:** Friendly, natural. No feature dump. Proactively asks for rate update. In character.

---

## Fixes Applied

### Fix 1: Amazon intent detection order (FAIL -> PASS)
**File:** `scripts/pilot-server.mjs`  
**Issue:** `detectFoodIntent()` ran before `detectAmazonIntent()`, causing "Order headphones from Amazon" to match the broad food regex.  
**Fix:** Moved Amazon and grocery intent detection to run before food delivery detection (priority order: Amazon > Grocery > Food).

### Fix 2: FHA DTI "up to up to" duplication (NEEDS_WORK -> PASS)
**File:** `scripts/pilot-server.mjs`  
**Issue:** Template string had `up to ${fha.dti_with_compensating_factors}` but profile value was `"up to 50%"`, producing "up to up to 50%".  
**Fix:** Removed "up to" from template, using `${fha.dti_with_compensating_factors || 'up to 50%'}` so profile data controls phrasing.

### Fix 3: Conventional loan limit 2026 detection (improvement)
**File:** `scripts/pilot-server.mjs`  
**Issue:** Fast-path guideline detection only matched years containing "2025" — "2026" fell through to Claude API.  
**Fix:** Added `'2026'` and `'conventional'` to the loan limit detection condition.

---

## Remaining Issue

- **Test 17 (empty message):** Returns raw error JSON. Consider treating empty/whitespace-only messages as a friendly "Didn't catch that — what do you need?" response instead of a system error. Low priority since SMS platforms typically don't send empty messages.
