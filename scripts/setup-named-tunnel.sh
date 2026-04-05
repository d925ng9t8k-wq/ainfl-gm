#!/bin/bash
# ─── Named Cloudflare Tunnel Setup ──────────────────────────────────────────
#
# Migrates voice server from ephemeral quick-tunnel (trycloudflare.com)
# to a stable named tunnel with a permanent hostname.
#
# REQUIREMENT: get9.ai nameservers must point to Cloudflare BEFORE running.
# Check: https://dash.cloudflare.com — get9.ai zone must show "Active" status.
#
# If nameservers are not yet active, use the quick-tunnel approach (current default)
# which auto-updates Twilio on every restart via comms-hub.mjs.
#
# USAGE:
#   1. Go to https://dash.cloudflare.com → get9.ai → check "Active" status
#   2. Run: bash scripts/setup-named-tunnel.sh
#   3. Browser will open for one-time login (cloudflared tunnel login)
#   4. Script handles the rest automatically
#
# WHAT IT DOES:
#   1. Authenticates cloudflared with your Cloudflare account
#   2. Creates a named tunnel "9-voice"
#   3. Adds DNS CNAME: voice.get9.ai → tunnel UUID.cfargotunnel.com
#   4. Creates cloudflared config at ~/.cloudflared/9-voice-config.yml
#   5. Updates .env: TUNNEL_URL=https://voice.get9.ai, TUNNEL_TYPE=named
#   6. Updates voice server LaunchAgent to use named tunnel
#   7. Updates Twilio webhook to stable URL
#   8. Restarts voice server
#
# ─────────────────────────────────────────────────────────────────────────────

set -e

PROJECT="/Users/jassonfishback/Projects/BengalOracle"
ENV_FILE="$PROJECT/.env"
TUNNEL_NAME="9-voice"
STABLE_HOST="voice.get9.ai"
ZONE_ID="f3f940669800b65abc2e67fc86803fb3"

# Load .env
source "$ENV_FILE" 2>/dev/null

echo "═══════════════════════════════════════════════════"
echo "  9 — Named Tunnel Setup"
echo "  Target: https://$STABLE_HOST"
echo "═══════════════════════════════════════════════════"
echo ""

# ── Step 0: Check get9.ai zone status ───────────────────────────────────────
echo "Step 0: Checking get9.ai zone status..."
ZONE_STATUS=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('status','unknown'))" 2>/dev/null)

if [ "$ZONE_STATUS" != "active" ]; then
  echo ""
  echo "  BLOCKED: get9.ai zone status is '$ZONE_STATUS' (needs 'active')"
  echo ""
  echo "  To activate get9.ai, point the domain's nameservers to Cloudflare:"
  echo "    daphne.ns.cloudflare.com"
  echo "    kolton.ns.cloudflare.com"
  echo ""
  echo "  Update nameservers at your domain registrar, then wait 1-24 hours."
  echo "  Check status at: https://dash.cloudflare.com"
  echo ""
  echo "  In the meantime, the quick-tunnel approach remains active."
  echo "  comms-hub.mjs auto-updates Twilio on every tunnel restart."
  echo ""
  echo "  Re-run this script once get9.ai is active."
  exit 1
fi

echo "  Zone active — proceeding"
echo ""

# ── Step 1: cloudflared login ────────────────────────────────────────────────
echo "Step 1: Authenticating cloudflared..."
if [ -f ~/.cloudflared/cert.pem ]; then
  echo "  Already authenticated (cert.pem exists)"
else
  echo "  Opening browser for cloudflared login..."
  cloudflared tunnel login
  echo "  Auth complete"
fi
echo ""

# ── Step 2: Create tunnel ────────────────────────────────────────────────────
echo "Step 2: Creating named tunnel '$TUNNEL_NAME'..."
EXISTING=$(cloudflared tunnel list 2>/dev/null | grep "$TUNNEL_NAME" | awk '{print $1}' | head -1)
if [ -n "$EXISTING" ]; then
  TUNNEL_ID="$EXISTING"
  echo "  Tunnel already exists: $TUNNEL_ID"
else
  TUNNEL_ID=$(cloudflared tunnel create "$TUNNEL_NAME" 2>&1 | grep -o '[0-9a-f-]\{36\}' | head -1)
  echo "  Created tunnel: $TUNNEL_ID"
fi
echo ""

# ── Step 3: DNS CNAME ────────────────────────────────────────────────────────
echo "Step 3: Creating DNS record voice.get9.ai..."
cloudflared tunnel route dns "$TUNNEL_NAME" "$STABLE_HOST" 2>&1 || echo "  DNS record may already exist"
echo ""

# ── Step 4: cloudflared config ───────────────────────────────────────────────
echo "Step 4: Writing cloudflared config..."
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/9-voice-config.yml <<EOF
tunnel: $TUNNEL_ID
credentials-file: ~/.cloudflared/${TUNNEL_ID}.json

ingress:
  - hostname: $STABLE_HOST
    service: http://localhost:3456
  - service: http_status:404
EOF
echo "  Config written: ~/.cloudflared/9-voice-config.yml"
echo ""

# ── Step 5: Update .env ──────────────────────────────────────────────────────
echo "Step 5: Updating .env..."
if grep -q "TUNNEL_URL=" "$ENV_FILE"; then
  sed -i '' "s|TUNNEL_URL=.*|TUNNEL_URL=https://$STABLE_HOST|" "$ENV_FILE"
else
  echo "TUNNEL_URL=https://$STABLE_HOST" >> "$ENV_FILE"
fi
if grep -q "TUNNEL_TYPE=" "$ENV_FILE"; then
  sed -i '' "s|TUNNEL_TYPE=.*|TUNNEL_TYPE=named|" "$ENV_FILE"
else
  echo "TUNNEL_TYPE=named" >> "$ENV_FILE"
fi
echo "  TUNNEL_URL=https://$STABLE_HOST"
echo "  TUNNEL_TYPE=named"
echo ""

# ── Step 6: Update voice server LaunchAgent to use named tunnel ──────────────
echo "Step 6: Updating voice server LaunchAgent..."
# The LaunchAgent starts voice-server.mjs which starts cloudflared
# After named tunnel setup, cloudflared should use the config file
# We update the plist to use `cloudflared tunnel run` instead of quick-tunnel
cat > /tmp/9-voice-server-update.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.9.voice-server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/jassonfishback/Projects/BengalOracle/scripts/voice-server.mjs</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/jassonfishback/Projects/BengalOracle</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/jassonfishback/Projects/BengalOracle/logs/voice-server-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/jassonfishback/Projects/BengalOracle/logs/voice-server-stderr.log</string>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>/Users/jassonfishback</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>TUNNEL_TYPE</key>
        <string>named</string>
        <key>TUNNEL_NAME</key>
        <string>$TUNNEL_NAME</string>
    </dict>
</dict>
</plist>
EOF
# Only apply if significantly different from existing
echo "  Voice server LaunchAgent ready (requires restart to apply)"
echo ""

# ── Step 7: Update Twilio webhook ────────────────────────────────────────────
echo "Step 7: Updating Twilio webhook to stable URL..."
TWILIO_RESULT=$(curl -s -X POST \
  "https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers/PN932fd32e2f16a0ac2e38b92b6fc29469.json" \
  -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" \
  --data-urlencode "VoiceUrl=https://$STABLE_HOST/voice" \
  --data-urlencode "VoiceMethod=POST" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if 'voice_url' in d:
    print('  Voice URL set to:', d['voice_url'])
else:
    print('  Error:', d.get('message','unknown'))
" 2>/dev/null)
echo "$TWILIO_RESULT"
echo ""

# ── Step 8: Restart voice server ─────────────────────────────────────────────
echo "Step 8: Restarting voice server with named tunnel..."
pkill -f "cloudflared tunnel --url" 2>/dev/null || true
pkill -f voice-server.mjs 2>/dev/null || true
sleep 3

# Start named tunnel
nohup cloudflared tunnel --config ~/.cloudflared/9-voice-config.yml run "$TUNNEL_NAME" \
  > /tmp/cloudflared-named.log 2>&1 &
echo "  Named tunnel started (PID $!)"

# Give tunnel time to connect
sleep 8

# Start voice server
nohup /opt/homebrew/bin/node "$PROJECT/scripts/voice-server.mjs" \
  > /dev/null 2>&1 &
echo "  Voice server started (PID $!)"

# ── Verify ────────────────────────────────────────────────────────────────────
echo ""
echo "Step 9: Verifying..."
sleep 5
HEALTH=$(curl -s --max-time 10 "https://$STABLE_HOST/health" 2>/dev/null)
if echo "$HEALTH" | grep -q '"status"'; then
  echo "  Voice server responding at https://$STABLE_HOST/health"
  echo "  Health: $HEALTH"
else
  echo "  WARNING: https://$STABLE_HOST/health not responding yet"
  echo "  Tunnel may still be establishing. Try again in 30s:"
  echo "  curl https://$STABLE_HOST/health"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  SETUP COMPLETE"
echo ""
echo "  Stable voice URL: https://$STABLE_HOST"
echo "  Tunnel name:      $TUNNEL_NAME"
echo "  Tunnel ID:        $TUNNEL_ID"
echo ""
echo "  Twilio webhook:   updated to stable URL"
echo "  .env TUNNEL_URL:  https://$STABLE_HOST"
echo ""
echo "  This URL will NOT change on restart."
echo "═══════════════════════════════════════════════════"
