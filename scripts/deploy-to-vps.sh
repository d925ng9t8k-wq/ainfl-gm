#!/usr/bin/env bash
#
# 9 Enterprises — VPS Deployment Script
# Automates DigitalOcean droplet setup from scratch.
#
# Usage:
#   ./scripts/deploy-to-vps.sh <DROPLET_IP>
#
# Prerequisites:
#   - SSH key already added to DigitalOcean (root can accept key-based login)
#   - Run from the Mac (BengalOracle project root)
#
# What this does:
#   1. Hardens the server (firewall, fail2ban, SSH lockdown)
#   2. Creates a non-root deploy user
#   3. Installs Node.js 22 LTS + PM2
#   4. Deploys telegram-relay.mjs
#   5. Sets up cron jobs
#   6. Verifies everything works

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────

DROPLET_IP="${1:-}"
DEPLOY_USER="deploy"
APP_DIR="/home/$DEPLOY_USER/bengal-oracle"
LOG_DIR="/home/$DEPLOY_USER/logs"
RELAY_PORT=3460

if [ -z "$DROPLET_IP" ]; then
  echo "Usage: $0 <DROPLET_IP>"
  echo "Example: $0 142.93.123.45"
  exit 1
fi

# Check .env exists locally (we need credentials)
if [ ! -f .env ]; then
  echo "ERROR: .env not found in project root. Need credentials from The Locker."
  exit 1
fi

echo "=========================================="
echo "  9 Enterprises — VPS Deployment"
echo "  Target: $DROPLET_IP"
echo "=========================================="
echo ""

# ─── Phase 1: Server Hardening ──────────────────────────────────────────────

echo "[Phase 1] Hardening server..."

ssh -o StrictHostKeyChecking=accept-new root@"$DROPLET_IP" bash <<'HARDEN'
set -euo pipefail

echo "  [1/6] Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

echo "  [2/6] Creating deploy user..."
if ! id deploy &>/dev/null; then
  adduser deploy --disabled-password --gecos "" --quiet
  usermod -aG sudo deploy
  echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy
  chmod 440 /etc/sudoers.d/deploy
  mkdir -p /home/deploy/.ssh
  cp /root/.ssh/authorized_keys /home/deploy/.ssh/
  chown -R deploy:deploy /home/deploy/.ssh
  chmod 700 /home/deploy/.ssh
  chmod 600 /home/deploy/.ssh/authorized_keys
  echo "  deploy user created."
else
  echo "  deploy user already exists."
fi

echo "  [3/6] Hardening SSH..."
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?MaxAuthTries.*/MaxAuthTries 3/' /etc/ssh/sshd_config
sed -i 's/^#\?LoginGraceTime.*/LoginGraceTime 30/' /etc/ssh/sshd_config
systemctl restart sshd

echo "  [4/6] Configuring firewall (ufw)..."
ufw default deny incoming > /dev/null
ufw default allow outgoing > /dev/null
ufw allow 22/tcp comment 'SSH' > /dev/null 2>&1 || true
ufw allow 3460/tcp comment 'Telegram relay' > /dev/null 2>&1 || true
echo "y" | ufw enable > /dev/null 2>&1

echo "  [5/6] Installing fail2ban..."
apt-get install -y -qq fail2ban
cat > /etc/fail2ban/jail.local << 'JAIL'
[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
JAIL
systemctl enable fail2ban > /dev/null 2>&1
systemctl restart fail2ban

echo "  [6/6] Installing unattended-upgrades..."
apt-get install -y -qq unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "  Server hardened."
HARDEN

echo "[Phase 1] Complete."
echo ""

# ─── Phase 2: Application Setup ─────────────────────────────────────────────

echo "[Phase 2] Installing Node.js + PM2..."

ssh deploy@"$DROPLET_IP" bash <<'NODESETUP'
set -euo pipefail

# Install Node.js 22 LTS if not present
if ! command -v node &>/dev/null; then
  echo "  Installing Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - > /dev/null 2>&1
  sudo apt-get install -y -qq nodejs
fi
echo "  Node.js $(node --version) installed."

# Install PM2
if ! command -v pm2 &>/dev/null; then
  echo "  Installing PM2..."
  sudo npm install -g pm2 > /dev/null 2>&1
fi
echo "  PM2 $(pm2 --version) installed."

# Create log directory
mkdir -p ~/logs
NODESETUP

echo "[Phase 2] Complete."
echo ""

# ─── Phase 3: Deploy Application ────────────────────────────────────────────

echo "[Phase 3] Deploying application..."

# Copy the relay script and supporting files
echo "  Copying telegram-relay.mjs..."
scp scripts/telegram-relay.mjs deploy@"$DROPLET_IP":"$APP_DIR"/scripts/ 2>/dev/null || {
  # App dir doesn't exist yet, create it
  ssh deploy@"$DROPLET_IP" "mkdir -p $APP_DIR/scripts"
  scp scripts/telegram-relay.mjs deploy@"$DROPLET_IP":"$APP_DIR"/scripts/
}

# Build VPS .env from The Locker (extract only what the VPS needs)
echo "  Building VPS .env (minimal credential set)..."
{
  grep '^TELEGRAM_BOT_TOKEN=' .env
  grep '^TELEGRAM_CHAT_ID=' .env
  grep '^ANTHROPIC_API_KEY=' .env  # Main key for Haiku fallback
  echo "PORT=$RELAY_PORT"
  # MAC_TUNNEL_URL needs to be set after tunnel is configured
  echo "MAC_TUNNEL_URL=https://your-tunnel.trycloudflare.com"
} > /tmp/vps-env-temp

scp /tmp/vps-env-temp deploy@"$DROPLET_IP":"$APP_DIR"/.env
rm /tmp/vps-env-temp

echo "  IMPORTANT: Update MAC_TUNNEL_URL in $APP_DIR/.env with the actual tunnel URL."

# Start with PM2
echo "  Starting telegram-relay via PM2..."
ssh deploy@"$DROPLET_IP" bash <<PMSTART
set -euo pipefail
cd $APP_DIR

# Stop existing if running
pm2 delete telegram-relay 2>/dev/null || true

# Start the relay
pm2 start scripts/telegram-relay.mjs --name telegram-relay --env production
pm2 save

# Configure PM2 to start on boot
sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy > /dev/null 2>&1 || true
pm2 save
PMSTART

echo "[Phase 3] Complete."
echo ""

# ─── Phase 4: Cron Jobs ─────────────────────────────────────────────────────

echo "[Phase 4] Setting up cron jobs..."

ssh deploy@"$DROPLET_IP" bash <<'CRON'
set -euo pipefail

# Create monitoring scripts directory
mkdir -p ~/bengal-oracle/scripts
mkdir -p ~/logs

# Health monitor script
cat > ~/bengal-oracle/scripts/vps-health-monitor.sh << 'HEALTH'
#!/usr/bin/env bash
# Checks relay health, Mac reachability, disk/memory usage
# Alerts via Telegram API directly (no Mac needed)

APP_DIR="/home/deploy/bengal-oracle"
source "$APP_DIR/.env"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

send_alert() {
  local msg="$1"
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=[VPS Alert] $msg" > /dev/null 2>&1
}

# Check relay process
if ! pm2 pid telegram-relay > /dev/null 2>&1 || [ "$(pm2 pid telegram-relay)" = "" ]; then
  send_alert "telegram-relay is DOWN. Attempting restart..."
  pm2 restart telegram-relay 2>/dev/null || pm2 start ~/bengal-oracle/scripts/telegram-relay.mjs --name telegram-relay
fi

# Check Mac reachability
MAC_URL=$(grep MAC_TUNNEL_URL "$APP_DIR/.env" | cut -d= -f2)
if [ -n "$MAC_URL" ] && [ "$MAC_URL" != "https://your-tunnel.trycloudflare.com" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$MAC_URL/health" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "000" ]; then
    # Only alert if this is the 3rd consecutive failure
    FAIL_COUNT_FILE="/tmp/mac-fail-count"
    FAIL_COUNT=$(cat "$FAIL_COUNT_FILE" 2>/dev/null || echo "0")
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "$FAIL_COUNT" > "$FAIL_COUNT_FILE"
    if [ "$FAIL_COUNT" -ge 3 ]; then
      send_alert "Mac hub unreachable for 6+ minutes. Relay running in autonomous mode."
      echo "0" > "$FAIL_COUNT_FILE"
    fi
  else
    echo "0" > /tmp/mac-fail-count
  fi
fi

# Check disk usage
DISK_PCT=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK_PCT" -gt 80 ]; then
  send_alert "Disk usage at ${DISK_PCT}%. Clean up needed."
fi

# Check memory usage
MEM_PCT=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100}')
if [ "$MEM_PCT" -gt 85 ]; then
  send_alert "Memory usage at ${MEM_PCT}%. Possible leak."
fi

echo "$TIMESTAMP health check OK (disk: ${DISK_PCT}%, mem: ${MEM_PCT}%)"
HEALTH
chmod +x ~/bengal-oracle/scripts/vps-health-monitor.sh

# Log rotation script
cat > ~/bengal-oracle/scripts/log-rotate.sh << 'LOGROTATE'
#!/usr/bin/env bash
# Rotate PM2 and app logs daily
pm2 flush > /dev/null 2>&1
find ~/logs -name "*.log" -mtime +7 -delete 2>/dev/null
echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") logs rotated"
LOGROTATE
chmod +x ~/bengal-oracle/scripts/log-rotate.sh

# State sync script
cat > ~/bengal-oracle/scripts/state-sync.sh << 'STATESYNC'
#!/usr/bin/env bash
# Pull shared-state.json from Mac hub for autonomous mode context
APP_DIR="/home/deploy/bengal-oracle"
source "$APP_DIR/.env"
MAC_URL=$(grep MAC_TUNNEL_URL "$APP_DIR/.env" | cut -d= -f2)
if [ -n "$MAC_URL" ] && [ "$MAC_URL" != "https://your-tunnel.trycloudflare.com" ]; then
  curl -s --max-time 5 "$MAC_URL/state" -o "$APP_DIR/shared-state.json" 2>/dev/null || true
fi
STATESYNC
chmod +x ~/bengal-oracle/scripts/state-sync.sh

# Install cron jobs
(crontab -l 2>/dev/null | grep -v 'vps-health-monitor\|log-rotate\|state-sync'; cat << 'CRONTAB'
# 9 Enterprises VPS Cron Jobs
# Health monitor — every 2 minutes
*/2 * * * * /home/deploy/bengal-oracle/scripts/vps-health-monitor.sh >> /home/deploy/logs/health.log 2>&1
# State sync — every minute
* * * * * /home/deploy/bengal-oracle/scripts/state-sync.sh >> /home/deploy/logs/sync.log 2>&1
# Log rotation — daily at midnight UTC
0 0 * * * /home/deploy/bengal-oracle/scripts/log-rotate.sh >> /home/deploy/logs/rotate.log 2>&1
CRONTAB
) | crontab -

echo "  Cron jobs installed."
CRON

echo "[Phase 4] Complete."
echo ""

# ─── Phase 5: Verification ──────────────────────────────────────────────────

echo "[Phase 5] Verifying deployment..."

ssh deploy@"$DROPLET_IP" bash <<'VERIFY'
set -euo pipefail

echo "  PM2 status:"
pm2 list

echo ""
echo "  Relay health check:"
HEALTH=$(curl -s --max-time 5 http://localhost:3460/health 2>/dev/null || echo "FAILED")
echo "  $HEALTH"

echo ""
echo "  Firewall status:"
sudo ufw status | head -10

echo ""
echo "  fail2ban status:"
sudo fail2ban-client status sshd 2>/dev/null | head -5

echo ""
echo "  Cron jobs:"
crontab -l 2>/dev/null | grep -v '^#' | grep -v '^$'

echo ""
echo "  Disk usage:"
df -h / | tail -1

echo ""
echo "  Memory usage:"
free -h | grep Mem
VERIFY

echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
echo "NEXT STEPS:"
echo "  1. Update MAC_TUNNEL_URL in $APP_DIR/.env on the VPS"
echo "     ssh deploy@$DROPLET_IP"
echo "     nano $APP_DIR/.env"
echo ""
echo "  2. Update comms-hub.mjs on the Mac:"
echo "     - Remove Telegram polling"
echo "     - Add /relay-message endpoint"
echo "     - Restart the hub"
echo ""
echo "  3. Test end-to-end:"
echo "     - Send a Telegram message"
echo "     - Check: ssh deploy@$DROPLET_IP 'pm2 logs telegram-relay --lines 5'"
echo ""
echo "  4. Monitor for 24 hours before removing old Telegram polling code"
echo ""
echo "VPS IP: $DROPLET_IP"
echo "SSH:    ssh deploy@$DROPLET_IP"
echo "Health: curl http://$DROPLET_IP:3460/health"
echo ""
