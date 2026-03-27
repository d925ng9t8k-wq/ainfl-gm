# Communications Channel Solutions

**Date:** 2026-03-26
**Author:** 9 (Agent)
**Status:** Research complete, ready for implementation decisions

---

## Problem 1: SMS Carrier Blocking (Twilio Error 30034)

### The Problem

Twilio SMS messages fail with error code 30034 ("Message from an Unregistered Number"). Since September 2023, all SMS/MMS sent to US phone numbers via 10DLC must go through an approved A2P (Application-to-Person) campaign. Unregistered traffic is fully blocked by carriers. Our Twilio number cannot send SMS until we complete 10DLC registration.

### Solution A: A2P 10DLC Registration (Recommended)

Register our brand and campaign with The Campaign Registry (TCR) through Twilio.

**Steps:**

1. Log into Twilio Console > Messaging > Trust Hub > A2P 10DLC
2. **Register Brand** -- Submit business name, EIN, address, website, contact info
   - Sole Proprietor: $4.50 one-time (limited to 1 campaign, lower throughput)
   - Low Volume Standard: $4.50 one-time (good for our scale)
   - Standard Brand: $46 one-time (includes secondary vetting, higher throughput)
3. **Register Campaign** -- Select use case (e.g., "Mixed" or "Customer Care"), provide sample messages, opt-in/opt-out details
   - $15 one-time vetting fee per campaign
   - $15/month renewal fee per active campaign
4. **Associate Phone Number** -- Add your Twilio 10DLC number to the approved campaign's Messaging Service
5. **Wait for Approval** -- TCR reviews and approves

**Cost:**
- One-time: $19.50 (low volume brand $4.50 + campaign vetting $15)
- Monthly: $15/month campaign fee + per-message carrier surcharges (~$0.003-$0.005/msg)
- Total first year: ~$200

**Timeline:**
- Brand approval: Minutes to a few days
- Campaign approval: 10-15 business days (current backlog)
- Number association: 1-2 days after campaign approval
- **Total: 2-3 weeks**

### Solution B: Toll-Free Number Verification

Get a toll-free number (800/888/877 etc.) and verify it instead of 10DLC.

**Steps:**

1. Purchase a toll-free number in Twilio ($2/month)
2. Submit toll-free verification: business info, use case, sample messages
3. Wait for carrier approval

**Cost:**
- $2/month for the number
- No registration fees
- Slightly higher per-message costs than 10DLC (~65% more on average)

**Timeline:**
- Currently 4-6 weeks for toll-free verification (slower than 10DLC)
- Not recommended due to longer wait and higher per-message cost

### Solution C: Switch to Vonage or MessageBird

**Vonage (formerly Nexmo):**
- Outbound SMS: ~$0.00846/msg (comparable to Twilio)
- Still requires A2P 10DLC registration for US numbers -- no shortcut
- Good API, similar DX to Twilio
- Would require rewriting SMS integration code

**MessageBird (now Bird):**
- Omnichannel platform (SMS, WhatsApp, email in one)
- Also requires 10DLC compliance for US SMS
- Comparable pricing to Twilio

**Telnyx:**
- US SMS at $0.004/msg (roughly half of Twilio)
- Also requires 10DLC but handles registration in-house
- Worth considering if we want lower per-message costs

**Verdict:** Switching providers does NOT bypass 10DLC. Every provider must comply. The fastest path is registering with Twilio since we already have the account and infrastructure.

### Recommendation

**Go with Solution A (A2P 10DLC via Twilio, Low Volume Standard brand).** Total cost ~$19.50 to start, $15/month ongoing. Takes 2-3 weeks. No code changes needed -- just registration and number association in the Twilio Console.

In the meantime, use Telegram as the primary messaging channel (already working, zero cost, zero carrier issues).

---

## Problem 2: iMessage Identity Problem

### The Problem

When the AI assistant (9) sends iMessages via `osascript` and Apple's Messages app, the messages appear to come from Jasson's personal Apple ID. Recipients (like Kyle) see Jasson's name and contact card. There is no way to distinguish AI-sent messages from Jasson's personal messages. This creates confusion and identity blurring.

### Solution A: Apple Messages for Business

Apple's official channel for businesses to message customers through the native Messages app.

**How it works:**
- Customers initiate conversations with your business via a "Message" button on your website, app, Maps, or Siri
- Messages appear in a separate branded thread with your business name and logo
- Requires an approved Messaging Service Provider (MSP) like Zendesk, LivePerson, or Infobip

**Steps:**

1. Register at register.apple.com with a business Apple Account
2. Select an Apple-approved MSP
3. Submit branding (logo, business name, colors)
4. Apple reviews and approves (1-2 business days)
5. Integrate MSP with your backend (Claude API)

**Cost:**
- Apple charges nothing directly
- MSP fees: $100-500+/month depending on provider and volume
- Zendesk Suite starts at ~$55/agent/month; LivePerson is enterprise-priced

**Timeline:** 1-4 weeks including MSP setup

**Drawbacks:**
- Only customers can initiate conversations (you cannot message first)
- Requires an MSP -- cannot self-host
- Apple prioritizes medium-to-large enterprises
- Overkill and expensive for a pilot with one or two users
- No way to proactively send notifications

### Solution B: Separate Apple ID on Same Mac

Create a dedicated Apple ID (e.g., 9@9enterprises.ai) and use it for iMessage.

**Steps:**

1. Create a new Apple ID at appleid.apple.com
2. Sign into Messages.app with the new Apple ID (System Settings > Messages, or sign out/in within Messages.app)
3. Update osascript commands to send from this account

**Problems:**
- macOS Messages app only supports ONE Apple ID at a time
- Switching Apple IDs requires signing out and back in (not practical for automation)
- Would lose Jasson's personal iMessage capability on the machine
- No way to run two Messages.app instances simultaneously

### Solution C: Dedicated Device or VM (Best Practical Option)

Run a separate Mac (Mini, old MacBook, or Mac VM) signed into a dedicated Apple ID for the AI assistant.

**Steps:**

1. Create a new Apple ID for 9 (e.g., nine@9enterprises.ai)
2. Set up a Mac Mini or repurpose an old Mac
3. Sign into Messages with the new Apple ID
4. Run a lightweight relay server on that Mac that receives messages from comms-hub and sends via osascript
5. Configure comms-hub to route AI iMessages to the relay Mac

**Cost:**
- Mac Mini M2: ~$599 new, ~$300-400 refurbished
- Or use any old Mac already on hand
- Apple ID: free
- Electricity: negligible

**Timeline:** 1-2 days if hardware is available

### Solution D: Use a Different Channel Entirely (Current Best Path)

The messaging-platform-research.md already concluded that **Telegram Bot** is the best channel for separate-identity AI conversations. It is already working, free, and provides a clearly separate thread.

For iMessage specifically, accept that it sends as Jasson and use it only for owner-to-AI communication (which is its current use case). For external users like Kyle, use Telegram, WhatsApp Business, or a web chat widget.

### Recommendation

**Short term:** Accept iMessage identity limitation. Use iMessage only for Jasson-to-9 communication (where the identity issue does not matter). Route all external users to Telegram bots or WhatsApp Business.

**Medium term:** If a native iMessage experience is required for external users, get a dedicated Mac Mini ($300-400 refurbished) with its own Apple ID. This is the only reliable way to have a separate iMessage identity.

**Skip Apple Messages for Business** -- it is expensive, enterprise-focused, does not allow outbound-first messaging, and requires an MSP. Not suitable for our scale.

---

## Problem 3: Email Channel Stale (AppleEvent Error -1712)

### The Problem

The comms-hub uses `osascript` to send emails via Apple Mail. These commands timeout with "AppleEvent timed out (-1712)". This happens because:

- AppleEvents have a 2-minute default timeout
- Apple Mail may be unresponsive, indexing, or in background
- macOS sandboxing and screen saver can block AppleEvent delivery
- The `with timeout` workaround is unreliable (does not fix the root cause)

This makes the email channel effectively dead for outbound messages.

### Solution A: Gmail API Direct (Recommended)

We already have Gmail API credentials. Send email directly through Google's API, bypassing Apple Mail entirely.

**Steps:**

1. Verify existing Gmail API OAuth2 credentials in the project (check `.env` for `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`)
2. Install the Google APIs Node.js client if not already present:
   ```bash
   npm install googleapis
   ```
3. Create a `sendEmail` function in comms-hub.mjs that uses the Gmail API:
   ```javascript
   const { google } = require('googleapis');
   const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
   oauth2Client.setCredentials({ refresh_token: refreshToken });
   const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

   // Compose raw email (RFC 2822), base64url encode, send via gmail.users.messages.send
   ```
4. Replace all `osascript` email send calls in comms-hub.mjs with the Gmail API function
5. Test send/receive cycle

**Cost:** Free (Gmail API has generous limits -- 500 emails/day for workspace, 100/day for free Gmail)

**Timeline:** 2-4 hours of development

**Benefits:**
- No dependency on Apple Mail or macOS AppleEvents
- Works even when Mac is asleep or screen is locked
- Works from the cloud worker too (same API)
- Reliable, well-documented, battle-tested
- We already have the credentials

### Solution B: Nodemailer with Gmail OAuth2

Use Nodemailer (popular Node.js email library) with Gmail's SMTP and OAuth2 authentication.

**Steps:**

1. Install Nodemailer:
   ```bash
   npm install nodemailer
   ```
2. Configure transporter with OAuth2:
   ```javascript
   const nodemailer = require('nodemailer');
   const transporter = nodemailer.createTransport({
     service: 'gmail',
     auth: {
       type: 'OAuth2',
       user: 'your@gmail.com',
       clientId: process.env.GMAIL_CLIENT_ID,
       clientSecret: process.env.GMAIL_CLIENT_SECRET,
       refreshToken: process.env.GMAIL_REFRESH_TOKEN
     }
   });
   ```
3. Replace osascript calls with `transporter.sendMail({ from, to, subject, text })`

**Cost:** Free (Nodemailer is open source, Gmail SMTP is free)

**Timeline:** 1-2 hours of development

**Benefits:**
- Simpler API than raw Gmail API for just sending
- Handles OAuth2 token refresh automatically
- Well-maintained library with excellent docs

**Drawbacks:**
- SMTP can be slower than API calls
- Does not support reading emails (send only) -- would still need Gmail API for inbox monitoring

### Solution C: Direct SMTP (No OAuth2)

Use Gmail's SMTP server with an App Password.

**Steps:**

1. Enable 2FA on the Gmail account
2. Generate an App Password at myaccount.google.com/apppasswords
3. Use Nodemailer or raw SMTP with the app password

**Cost:** Free

**Timeline:** 30 minutes

**Drawbacks:**
- App Passwords are less secure than OAuth2
- Google may deprecate App Passwords
- Not recommended for production

### Recommendation

**Go with Solution A (Gmail API Direct)** since we already have credentials and it handles both sending AND reading. This also enables the cloud worker to send email when the Mac is offline, which is a bonus.

If speed of implementation is the priority, **Solution B (Nodemailer + OAuth2)** is faster to code for send-only, but we should still use Gmail API for inbox monitoring.

**Kill the osascript/Apple Mail approach entirely.** It is fundamentally unreliable for an always-on automated system.

---

## Summary and Priority Matrix

| Problem | Solution | Cost | Timeline | Priority |
|---------|----------|------|----------|----------|
| SMS Blocking (30034) | A2P 10DLC Registration | $19.50 + $15/mo | 2-3 weeks | P1 -- Start now, use Telegram meanwhile |
| iMessage Identity | Accept limitation + Telegram for external | $0 | Already done | P3 -- Revisit if external iMessage needed |
| Email Timeout (-1712) | Gmail API Direct | $0 | 2-4 hours dev | P0 -- Fix immediately, email is broken |

### Immediate Actions

1. **Today:** Replace osascript email with Gmail API in comms-hub.mjs
2. **Today:** Start A2P 10DLC brand registration in Twilio Console
3. **This week:** Verify Telegram bot is handling all external user messaging
4. **2-3 weeks:** Complete 10DLC campaign approval, associate number, test SMS

---

## Sources

- [Twilio Error 30034 Documentation](https://www.twilio.com/docs/api/errors/30034)
- [Twilio A2P 10DLC Overview](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc)
- [Twilio A2P 10DLC Quickstart](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart)
- [Twilio A2P 10DLC Pricing and Fees](https://help.twilio.com/articles/1260803965530-What-pricing-and-fees-are-associated-with-the-A2P-10DLC-service-)
- [Twilio Toll-Free vs 10DLC Comparison](https://www.twilio.com/en-us/lp/messaging-guide-2024-number-types/2)
- [Apple Messages for Business Guide (Zendesk)](https://www.zendesk.com/service/messaging/apple-messages-for-business/)
- [Apple Messages for Business Registration](https://register.apple.com/resources/messages/messaging-documentation/register-your-acct)
- [Apple Messages for Business FAQ](https://register.apple.com/resources/messages/messaging-documentation/faq)
- [Nodemailer OAuth2 Documentation](https://nodemailer.com/smtp/oauth2)
- [Gmail API Node.js Integration](https://www.fullstack.com/labs/resources/blog/accessing-mailbox-using-the-gmail-api-and-node-js)
- [Vonage vs Twilio Comparison](https://globaldev.tech/blog/twilio-vs-nexmo)
- [Top SMS Providers for Developers 2026](https://knock.app/blog/the-top-sms-providers-for-developers)
- [Twilio Alternatives Comparison](https://prelude.so/blog/twilio-competitors)
