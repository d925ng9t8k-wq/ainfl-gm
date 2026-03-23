#!/bin/bash
# ─── 9 Cloud Standin — Deploy Script ───────────────────────────────────────
# Run this after `wrangler login` to deploy everything in one shot.
#
# What it does:
# 1. Creates KV namespace for state
# 2. Deploys the Worker
# 3. Sets secrets (API keys, Telegram token)
# 4. Sets Telegram webhook to point at the Worker
# 5. Sets Twilio voice fallback to point at the Worker
# 6. Updates Mac hub .env with the Worker URL
# ──────────────────────────────────────────────────────────────────────────

set -e
cd "$(dirname "$0")"

# Load .env from parent directory
source ../.env 2>/dev/null

echo "═══════════════════════════════════════════════════"
echo "  9 — Cloud Standin Deployment"
echo "═══════════════════════════════════════════════════"

# Step 1: Create KV namespace
echo ""
echo "Step 1: Creating KV namespace..."
KV_OUTPUT=$(npx wrangler kv namespace create STATE 2>&1)
KV_ID=$(echo "$KV_OUTPUT" | grep -o 'id = "[^"]*"' | head -1 | cut -d'"' -f2)

if [ -z "$KV_ID" ]; then
  # Might already exist — try to list
  KV_ID=$(npx wrangler kv namespace list 2>&1 | python3 -c "import sys,json; ns=json.load(sys.stdin); print(next((n['id'] for n in ns if 'STATE' in n['title']), ''))" 2>/dev/null)
fi

if [ -z "$KV_ID" ]; then
  echo "ERROR: Could not create or find KV namespace. Run manually:"
  echo "  npx wrangler kv namespace create STATE"
  exit 1
fi

echo "  KV namespace ID: $KV_ID"

# Update wrangler.toml with the KV ID
sed -i '' "s/^id = .*/id = \"$KV_ID\"/" wrangler.toml
echo "  Updated wrangler.toml"

# Step 2: Deploy Worker
echo ""
echo "Step 2: Deploying Worker..."
DEPLOY_OUTPUT=$(npx wrangler deploy 2>&1)
WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9-]+\..*workers\.dev' | head -1)

if [ -z "$WORKER_URL" ]; then
  echo "ERROR: Deployment failed. Output:"
  echo "$DEPLOY_OUTPUT"
  exit 1
fi

echo "  Worker URL: $WORKER_URL"

# Step 3: Set secrets
echo ""
echo "Step 3: Setting secrets..."
echo "$TELEGRAM_BOT_TOKEN" | npx wrangler secret put TELEGRAM_BOT_TOKEN 2>&1 | tail -1
echo "$ANTHROPIC_API_KEY_TC" | npx wrangler secret put ANTHROPIC_API_KEY 2>&1 | tail -1

# Get current tunnel URL for MAC_HUB_URL
CURRENT_TUNNEL=$(grep TUNNEL_URL ../.env | cut -d= -f2)
echo "$CURRENT_TUNNEL" | npx wrangler secret put MAC_HUB_URL 2>&1 | tail -1
echo "  Secrets configured"

# Step 4: Set Telegram webhook
echo ""
echo "Step 4: Setting Telegram webhook..."
WEBHOOK_RESULT=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${WORKER_URL}/webhook")
echo "  $WEBHOOK_RESULT"

# Step 5: Set Twilio voice fallback
echo ""
echo "Step 5: Setting Twilio voice failover..."
TWILIO_RESULT=$(curl -s -X POST \
  "https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers/PN932fd32e2f16a0ac2e38b92b6fc29469.json" \
  -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" \
  --data-urlencode "VoiceFallbackUrl=${WORKER_URL}/voice-fallback" \
  --data-urlencode "VoiceFallbackMethod=POST" \
  --data-urlencode "SmsFallbackUrl=${WORKER_URL}/sms" \
  --data-urlencode "SmsFallbackMethod=POST" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  Voice fallback: {d.get(\"voice_fallback_url\")}'); print(f'  SMS fallback: {d.get(\"sms_fallback_url\")}')")
echo "$TWILIO_RESULT"

# Step 6: Update Mac hub .env
echo ""
echo "Step 6: Updating Mac hub .env..."
if grep -q "CLOUD_WORKER_URL" ../.env; then
  sed -i '' "s|CLOUD_WORKER_URL=.*|CLOUD_WORKER_URL=${WORKER_URL}|" ../.env
else
  echo "CLOUD_WORKER_URL=${WORKER_URL}" >> ../.env
fi
echo "  CLOUD_WORKER_URL=${WORKER_URL}"

# Step 7: Test
echo ""
echo "Step 7: Testing..."
HEALTH=$(curl -s "${WORKER_URL}/health")
echo "  Health: $HEALTH"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  DEPLOYMENT COMPLETE"
echo ""
echo "  Worker URL:  $WORKER_URL"
echo "  Telegram:    webhook active"
echo "  Voice:       fallback configured"
echo "  SMS:         fallback configured"
echo ""
echo "  Next: Restart Mac hub to enable cloud sync"
echo "  Run: pkill -f comms-hub && nohup node scripts/comms-hub.mjs &"
echo "═══════════════════════════════════════════════════"
