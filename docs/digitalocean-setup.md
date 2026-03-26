# DigitalOcean VPS Setup

**Purpose:** Host telegram-relay.mjs on a $4/mo VPS for always-on Telegram relay when the Mac is down.

**Time required:** 5-10 minutes on your phone.

**Script ready:** `scripts/telegram-relay.mjs` is built and waiting.

---

## Step 1: Create DigitalOcean Account

1. Go to **digitalocean.com** on your phone
2. Sign up with emailfishback@gmail.com
3. Add a payment method (credit card or PayPal)
4. You get $200 free credit for 60 days as a new user

---

## Step 2: Create a Droplet

1. Click **Create > Droplets**
2. Choose **Region:** New York 1 (or closest to Cincinnati)
3. Choose **Image:** Ubuntu 24.04 LTS
4. Choose **Size:** Basic > Regular > $4/mo (512 MB RAM, 10 GB SSD)
5. **Authentication:** Password (simpler for now)
   - Create a strong root password and save it somewhere
6. **Hostname:** `9-relay` or `bengal-oracle`
7. Click **Create Droplet**
8. Wait ~60 seconds — you'll get an IP address

---

## Step 3: Deploy the Relay

Once you have the droplet IP, tell 9 in Telegram:

> "DigitalOcean droplet is up. IP is [X.X.X.X]. Root password is [password]."

9 will SSH in and deploy `telegram-relay.mjs` automatically.

---

## What Gets Deployed

- `scripts/telegram-relay.mjs` — Node.js Telegram relay server
- Runs on port 3000 behind PM2 (auto-restart on crash)
- Connects to Anthropic API for autonomous responses
- Syncs state with the Mac hub when Mac is online

---

## Env Vars Needed on the VPS

9 will configure these during deployment (from the Locker):

- `TELEGRAM_BOT_TOKEN`
- `ANTHROPIC_API_KEY`
- `HUB_SYNC_URL` (points back to Mac tunnel URL)

---

## Cost

$4/month. Under the $100/mo autonomy threshold — 9 will handle billing going forward.
