# Messaging Platform Research for 9 Enterprises Pilot

**Date:** 2026-03-27
**Purpose:** Find the best way for Kyle C (mortgage LO, iPhone user) to text an AI assistant and get instant replies via a separate conversation thread.

**Problem:** SMS via Twilio blocked by carriers (A2P 10DLC takes days). iMessage sends from owner's Apple ID (confusing). Need a separate, branded thread.

---

## Platform Comparison Matrix

| Platform | Setup Time | Monthly Cost | Separate Thread? | iPhone? | Install Required? | Claude Integration | Verdict |
|----------|-----------|-------------|-------------------|---------|-------------------|-------------------|---------|
| **Telegram Bot** | 5 minutes | $0 | Yes | Yes | Yes (app) | Easy (webhook) | **RECOMMENDED** |
| **WhatsApp Business (Sandbox)** | 30 minutes | ~$0 (sandbox) | Yes | Yes | Has it already | Easy (Twilio) | **STRONG #2** |
| **Web Chat Widget** | 1-2 hours | $0 (Tawk.to) | Yes (webpage) | Yes | No (just a URL) | Easy (custom) | **STRONG #3** |
| WhatsApp Business (Production) | 1-3 weeks | ~$5-15/mo | Yes | Yes | Has it already | Easy (Twilio) | Good but slow setup |
| RCS Business Messaging | 1-2 weeks | ~$0.01/msg | Yes (Android only) | No* | No | Medium (Twilio) | iPhone gap |
| Facebook Messenger | 1-2 hours | $0 | Yes | Yes | Yes (app) | Easy (webhook) | Good option |
| Apple Messages for Business | 1-4 weeks | MSP fees ($100+/mo) | Yes | Yes (native) | No | Hard (MSP required) | Overkill for pilot |
| Signal Bot | 2-4 hours | $0 | Yes | Yes | Yes (app) | Medium (signal-cli) | Fragile, unofficial |
| Twilio Conversations (A2P) | 10-15 days | ~$1/mo + msgs | Yes | Yes | No | Easy (existing) | Too slow to start |
| Google Business Messages | N/A | N/A | N/A | N/A | N/A | N/A | **DEAD** (shut down July 2024) |
| Custom PWA | 1-2 weeks | $5-20/mo hosting | Yes | Partial** | Home screen install | Full control | Too much work for pilot |

\* RCS on iPhone (iOS 18.1+) supports person-to-person RCS but business messaging support for RCS on iPhone is still limited/rolling out.
\** PWA push notifications work on iOS 16.4+ but require Home Screen install, ~70-85% delivery rate, and no support in EU.

---

## Detailed Analysis

### 1. Telegram Bot -- RECOMMENDED FOR PILOT

**Why it wins:**
- We already have a Telegram bot and the full infrastructure (comms-hub.mjs)
- Creating a second bot takes 5 minutes via @BotFather
- Zero carrier issues, zero registration, zero approval process
- Completely free (Telegram Bot API has no per-message fees)
- Works on iPhone, Android, desktop, web
- Separate conversation thread (Kyle texts the bot, not Jasson)
- Claude API integration is trivial (webhook receives message, call Claude, send reply)

**Setup steps:**
1. Message @BotFather on Telegram, `/newbot`, name it something like "Jules AI" or "9 Mortgage Assistant"
2. Get the bot token
3. Set up webhook pointing to our server
4. Wire it to Claude API
5. Send Kyle the bot link (t.me/JulesAIBot)

**Downsides:**
- Kyle needs to install Telegram (if he doesn't have it)
- Less "professional" feel than SMS for a mortgage context
- Some people associate Telegram with crypto/spam

**Cost:** $0/month for the platform. Only cost is Claude API usage (~$0.01-0.05 per conversation).

---

### 2. WhatsApp Business API via Twilio

**Sandbox (immediate start):**
- Twilio offers a WhatsApp Sandbox that works in minutes
- Kyle sends a "join" message to the sandbox number, then can text the AI
- No approval needed, no business verification
- Limited: sandbox number is shared, 1 msg/3 seconds, testing only

**Production (1-3 weeks):**
- Requires WhatsApp Business Account + Meta verification
- Twilio charges $0.005/msg + Meta's per-conversation fees
- 24-hour customer service window: free-form replies are free after customer initiates
- Marketing/utility templates cost $0.01-0.06 depending on region
- Separate branded thread with business name and logo

**Why it's strong:**
- Kyle almost certainly already has WhatsApp on his iPhone
- Feels professional (business identity, verified badge possible)
- Twilio integration means we can reuse existing Twilio account
- Separate thread from any personal conversation

**Downsides:**
- Sandbox is limited and not production-ready
- Production setup takes 1-3 weeks for Meta approval
- Per-message costs add up (though low for a pilot)
- Complex pricing structure

**Cost:** Sandbox: $0. Production: ~$5-15/month at pilot scale (a few hundred messages).

---

### 3. Web Chat Widget

**How it works:**
- Embed a chat widget on a webpage (e.g., ainflgm.com/pilot or get9.ai/chat)
- Kyle opens the URL, types a message, gets instant AI reply
- No app install, no phone number, no carrier issues

**Best free options:**
- **Tawk.to** — 100% free, unlimited chats, unlimited agents, unlimited websites. $0/month. We would customize it to route messages to Claude API.
- **Crisp** — Free tier with 2 seats, unlimited conversations. Paid starts at $45/month.
- **Custom WebSocket** — Build our own chat UI. Full control, most work. A simple React/Next.js chat page could be built in a few hours.

**Why it's strong:**
- Zero friction: just send Kyle a link
- Works on any device with a browser
- Completely separate from any personal messaging
- No app install, no account creation needed
- Can be branded however we want

**Downsides:**
- No push notifications (unless Kyle keeps the tab open or we build a PWA)
- Less "conversational" feel than a messaging app
- Kyle has to remember to go to the URL (not in his natural messaging flow)

**Cost:** $0 with Tawk.to or custom build. Hosting is already covered.

---

### 4. RCS Business Messaging

**Current state (2026):**
- Twilio launched RCS GA in August 2025
- Branded, verified sender with business logo in native messaging app
- Pricing starts at $0.0083/msg (matches SMS) + carrier fees ($0.003-0.005/msg)
- Works on Android natively in the default Messages app

**iPhone support:**
- iOS 18.1+ added RCS support for person-to-person messaging
- Business RCS messaging on iPhone is still rolling out, estimated ~90% US reach by early 2026
- BUT: Apple's RCS implementation is basic and may not show full branding features

**Why it could be great:**
- Messages appear in the native SMS/Messages app with branded identity
- No app install needed
- Twilio integration exists (same API as SMS, auto-upgrades)

**Downsides:**
- iPhone business RCS support is incomplete/unreliable
- Still requires carrier onboarding (fees and time)
- Kyle is on iPhone -- the one platform where this is weakest
- Not ready for a quick pilot

**Cost:** ~$0.01-0.015/msg all-in. Carrier onboarding fees apply.

---

### 5. Facebook Messenger Bot

**How it works:**
- Create a Facebook Business Page for "9 Enterprises" or "Jules AI"
- Build a Messenger bot connected to that page
- Kyle messages the page on Messenger, gets AI replies
- Completely separate thread

**Setup:**
- Create Facebook page: 10 minutes
- Connect bot via Meta API or no-code platform (ManyChat, Chatfuel): 1-2 hours
- Wire webhook to Claude API

**Why it's decent:**
- Kyle likely already has Facebook/Messenger on his phone
- Free (Meta charges nothing for the API)
- Separate branded thread
- Rich messaging features (buttons, cards, quick replies)

**Downsides:**
- Requires a Facebook Business Page (we'd need to create one)
- Some people don't use Messenger or have it installed
- Meta's API review process can take days for advanced features
- Feels less "serious" for mortgage business context

**Cost:** $0/month for the platform.

---

### 6. Apple Messages for Business

**How it works:**
- Register with Apple, choose an approved MSP (Messaging Service Provider)
- Customers see your business in Maps, Safari, Siri, or via a direct link
- Messages appear in iMessage with your brand logo and verified identity
- Completely native iPhone experience -- the holy grail for iPhone users

**Why it's the dream:**
- Native iMessage with a SEPARATE business identity (not owner's Apple ID)
- Verified business badge, brand logo
- Kyle doesn't install anything -- it's just iMessage
- Rich features: Apple Pay, scheduling, list pickers

**Why it's not ready for this pilot:**
- Requires an approved MSP (Zendesk, Salesforce, LivePerson, etc.) -- adds cost and complexity
- MSP costs start around $100+/month minimum
- Apple review process takes 1-4 weeks (two separate reviews)
- Apple is not onboarding new MSP partners currently
- Only customers can initiate conversations (you can't message Kyle first)
- Overkill for a one-person pilot

**Cost:** MSP fees ($100-500+/month) + setup time. No per-message fees from Apple.

---

### 7. Signal Bot

**How it works:**
- Use signal-cli (unofficial command-line client) wrapped in a REST API
- Register a phone number with Signal
- Send/receive messages programmatically

**Reality check:**
- Signal has NO official bot API
- All solutions use signal-cli, an unofficial third-party tool
- Requires a dedicated phone number registered with Signal
- Fragile: can break with Signal updates, may violate ToS
- Docker container (signal-cli-rest-api) is the most common approach

**Downsides:**
- Unofficial and unsupported
- Kyle would need to install Signal
- Could break at any time
- Not suitable for business use

**Cost:** $0 but high maintenance cost.

---

### 8. Twilio Conversations API / A2P 10DLC

**This is the "do it right" path for SMS:**
- Register brand with The Campaign Registry (TCR)
- Register a campaign (use case)
- Get approved, then SMS works without carrier blocking
- Twilio Conversations API adds multi-channel support

**Timeline:**
- Brand registration: 1-2 days
- Campaign review: currently 10-15 days (backlog)
- Total: 2-3 weeks minimum

**Why we should still do this (in parallel):**
- SMS is the most natural channel for a mortgage LO
- Once approved, messages just work in the native Messages app
- No app install, no special setup for Kyle
- Professional and familiar

**Cost:** Registration fees (~$4/brand + $15/campaign one-time) + $0.0079/msg outbound.

---

### 9. Custom iOS/Android App (PWA)

**How it works:**
- Build a Progressive Web App with push notifications
- Kyle adds it to his Home Screen
- Chat interface with push notification alerts

**iPhone limitations (2026):**
- Push notifications work on iOS 16.4+ (Kyle's phone should support this)
- Must be installed to Home Screen first
- ~70-85% push delivery rate (vs 90-95% on Android)
- No background sync, no periodic fetch
- Broken in EU (Apple removed PWA support under DMA)

**Why it's not right for a pilot:**
- Too much development time (1-2 weeks minimum)
- Push notifications are unreliable on iPhone
- Kyle has to install it to Home Screen
- Overkill for testing an AI assistant concept

**Cost:** Development time + $5-20/month hosting.

---

## RECOMMENDATION: Phased Approach

### Phase 1: TODAY (get Kyle talking to the AI immediately)

**Primary: Telegram Bot**
- Create a new bot via @BotFather in 5 minutes
- Wire it to Claude API using our existing infrastructure
- Send Kyle the link: "Hey Kyle, tap this link to chat with Jules: t.me/JulesAIBot"
- He installs Telegram (free, 2 minutes) and starts chatting
- Completely separate thread, zero carrier issues, zero cost

**Backup: WhatsApp Sandbox**
- If Kyle pushes back on Telegram, use Twilio's WhatsApp Sandbox
- He sends a join message to the sandbox number
- Instant AI replies via WhatsApp (he already has the app)
- Limited but works for proving the concept

### Phase 2: THIS WEEK (if Kyle prefers something else)

**Web Chat Widget**
- Stand up a branded chat page at get9.ai/chat or ainflgm.com/pilot
- Use Tawk.to (free) or build a simple custom WebSocket chat
- Send Kyle the URL -- no install needed
- Less "push" (he has to visit the page) but zero friction to start

### Phase 3: NEXT 2-3 WEEKS (production-ready)

**WhatsApp Business (Production)**
- Register WhatsApp Business Account through Twilio
- Get Meta verification
- Branded business profile with logo
- Professional, scalable, Kyle already uses WhatsApp

**AND/OR A2P 10DLC SMS**
- Register brand and campaign with Twilio
- Once approved (2-3 weeks), SMS just works
- Native Messages app, no install, most natural for a mortgage LO

### Phase 4: LONG-TERM (if this becomes a product)

**Apple Messages for Business**
- The ultimate iPhone experience
- Separate business identity in iMessage
- Worth the investment once we have multiple users/LOs
- Budget $200+/month for MSP

---

## Key Decision Factors for Kyle C Specifically

1. **Kyle uses iPhone** -- eliminates RCS as a primary option
2. **Kyle is a mortgage LO** -- needs professional-feeling channel
3. **This is a pilot** -- speed matters more than polish
4. **Separate thread is critical** -- eliminates raw iMessage from owner's Apple ID
5. **Needs to work TODAY** -- eliminates anything with an approval process

**Bottom line:** Start with Telegram Bot today (5 min setup, $0, works perfectly). If Kyle won't install Telegram, fall back to WhatsApp Sandbox. Register for A2P 10DLC and WhatsApp Business in parallel so we have SMS and WhatsApp ready in 2-3 weeks.

---

## Sources

- [Twilio WhatsApp Pricing](https://www.twilio.com/en-us/whatsapp/pricing)
- [WhatsApp API Pricing 2026](https://respond.io/blog/whatsapp-business-api-pricing)
- [Twilio WhatsApp Sandbox](https://www.twilio.com/docs/whatsapp/sandbox)
- [Twilio RCS Business Messaging](https://www.twilio.com/en-us/messaging/channels/rcs)
- [Twilio RCS GA Announcement](https://www.twilio.com/en-us/press/releases/rcs-general-availability)
- [iOS 18.1 RCS Update](https://www.twilio.com/en-us/blog/insights/trends/rcs-business-messaging-apple-update)
- [Twilio A2P 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc)
- [Telegram Bot API Pricing](https://www.botract.com/blog/telegram-bot-cost-pricing-guide)
- [Create a Telegram Bot Guide 2026](https://anthemcreation.com/en/artificial-intelligence/create-bot-telegram-complete-guide/)
- [Apple Messages for Business Guide 2026](https://www.zendesk.com/service/messaging/apple-messages-for-business/)
- [Apple Business Register](https://register.apple.com/messages)
- [Signal Bot Python](https://pypi.org/project/signalbot/)
- [signal-cli REST API](https://github.com/bbernhard/signal-cli-rest-api)
- [Tawk.to](https://www.tawk.to/)
- [Crisp Live Chat](https://crisp.chat/en/livechat/)
- [Google Business Messages Deprecation](https://support.sproutsocial.com/hc/en-us/articles/28270975048845-Google-Business-Messages-Deprecation-July-2024)
- [Twilio Messaging Pricing](https://www.twilio.com/en-us/pricing/messaging)
- [PWA on iOS 2026](https://www.mobiloud.com/blog/progressive-web-apps-ios)
- [PWA Push Notifications iOS](https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en)
- [Facebook Messenger Developer Tools](https://developers.facebook.com/products/messenger)
