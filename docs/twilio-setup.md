# Twilio Setup for Jules

**Purpose:** Give Jules (Jamie's personal assistant) the ability to send and receive SMS.

**Time required:** 10 minutes on your phone.

**Script ready:** `scripts/jules-server.mjs` is built and waiting.

---

## Step 1: Create Twilio Account

1. Go to **twilio.com** on your phone
2. Click **Sign up for free**
3. Use emailfishback@gmail.com
4. Verify your phone number (use your real cell — just for account verification)
5. Answer the onboarding questions:
   - "What do you want to build?" → SMS
   - "What language?" → Node.js
6. You land on the Console dashboard

---

## Step 2: Get a Phone Number

1. In the Console, click **Get a Trial Number**
2. Twilio assigns you a free US number (e.g., +1 513-XXX-XXXX)
3. Note this number — it becomes `TWILIO_PHONE_NUMBER`

---

## Step 3: Grab Your Credentials

From the Console dashboard (twilio.com/console):

- **Account SID** — shown at top (starts with AC...)
- **Auth Token** — click the eye icon to reveal

---

## Step 4: Tell 9 Your Credentials

Send 9 in Telegram:

> "Twilio is set up. SID: [AC...], Auth Token: [xxx], Phone: [+1...]"

9 will add these to the Locker and start Jules.

---

## Env Vars Jules Needs

| Variable | Where to Get It |
|----------|----------------|
| `TWILIO_ACCOUNT_SID` | Console dashboard |
| `TWILIO_AUTH_TOKEN` | Console dashboard |
| `TWILIO_PHONE_NUMBER` | Trial number assigned |
| `JULES_RECIPIENT_PHONE` | Jamie's cell number (+1XXXXXXXXXX format) |
| `ANTHROPIC_API_KEY` | Already in Locker |
| `OPENWEATHER_API_KEY` | Free at openweathermap.org |

---

## Trial Account Limits

Free trial gives you ~$15 credit. One limitation: you can only send SMS to **verified numbers**.

To verify Jamie's number:
1. Go to Console > Phone Numbers > Verified Caller IDs
2. Add her number and verify via text code

Once you upgrade ($20 min deposit), that restriction lifts.

---

## After Setup

Jules listens on port 3470. 9 will configure a Cloudflare tunnel so Twilio can reach it for inbound SMS.
