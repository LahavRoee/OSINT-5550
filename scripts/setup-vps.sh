#!/bin/bash
# setup-vps.sh — VPS setup for OSINT-5550 daily automation
# Run once as root on the OpenClaw VPS (100.87.1.27)
# Usage: bash scripts/setup-vps.sh

set -e

INSTALL_DIR="/opt/OSINT-5550"
SERVICE_USER="osint"
NODE_VERSION="20"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  OSINT-5550 VPS Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. System timezone → Jerusalem ────────────────────────────────────────────
echo "→ Setting timezone to Asia/Jerusalem..."
timedatectl set-timezone Asia/Jerusalem

# ── 2. Node.js ────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "→ Installing Node.js ${NODE_VERSION}..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
else
  echo "→ Node.js $(node -v) already installed"
fi

# ── 3. Git ────────────────────────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  apt-get install -y git
fi

# ── 4. Chromium (for Puppeteer PDF generation) ────────────────────────────────
if ! command -v chromium-browser &>/dev/null && ! command -v chromium &>/dev/null; then
  echo "→ Installing Chromium for Puppeteer..."
  apt-get install -y chromium-browser || apt-get install -y chromium
fi

# ── 5. Create service user ────────────────────────────────────────────────────
if ! id "$SERVICE_USER" &>/dev/null; then
  echo "→ Creating user: $SERVICE_USER"
  useradd -r -m -s /bin/bash "$SERVICE_USER"
fi

# ── 6. Clone / update repo ────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "→ Updating existing repo..."
  cd "$INSTALL_DIR"
  git pull
else
  echo "→ Cloning OSINT-5550..."
  git clone https://github.com/LahavRoee/OSINT-5550.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

npm install --production

# ── 7. Create .env ────────────────────────────────────────────────────────────
if [ ! -f "$INSTALL_DIR/.env" ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Create $INSTALL_DIR/.env with:"
  echo ""
  echo "  ANTHROPIC_API_KEY=sk-ant-..."
  echo "  SHELDON_GATEWAY_URL=http://100.87.1.27:18789"
  echo "  SHELDON_GATEWAY_TOKEN=e1af2887794752ea46c5ae3f10eb6f6d68aa4680d7d5addc"
  echo "  ROEE_WHATSAPP=972523818575"
  echo "  GITHUB_USERNAME=LahavRoee"
  echo "  GITHUB_REPO=OSINT-5550"
  echo "  WEBHOOK_SECRET=choose-a-strong-secret"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  read -p "Press Enter after creating .env file..."
fi

# ── 8. Configure Git for auto-push ───────────────────────────────────────────
echo "→ Configuring Git..."
cd "$INSTALL_DIR"
git config user.email "osint-bot@yl5550.il"
git config user.name "OSINT Bot — יל\"ק 5550"

echo ""
echo "⚠️  Git push requires authentication. Options:"
echo "  A) GitHub Personal Access Token — add to git remote:"
echo "     git remote set-url origin https://<TOKEN>@github.com/LahavRoee/OSINT-5550.git"
echo "  B) SSH key — generate with ssh-keygen, add public key to GitHub"
echo ""
read -p "Enter GitHub token (or press Enter to configure manually later): " GH_TOKEN
if [ -n "$GH_TOKEN" ]; then
  git remote set-url origin "https://${GH_TOKEN}@github.com/LahavRoee/OSINT-5550.git"
  echo "→ Git remote configured with token"
fi

# ── 9. systemd service for ingest webhook ─────────────────────────────────────
echo "→ Creating systemd service for ingest webhook..."
cat > /etc/systemd/system/osint-webhook.service << EOF
[Unit]
Description=OSINT-5550 Ingest Webhook
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node src/server/ingest-webhook.js
Restart=always
RestartSec=5
EnvironmentFile=$INSTALL_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable osint-webhook
systemctl start osint-webhook
echo "→ Webhook service started on port 8099"

# ── 10. Cron job — daily digest at 14:00 Israel time ─────────────────────────
echo "→ Adding cron job for daily 14:00 digest..."
CRON_CMD="0 14 * * * cd $INSTALL_DIR && /usr/bin/node scripts/daily-check.js >> /var/log/osint-daily.log 2>&1"
# Install for root (cron uses server local time = Jerusalem after step 1)
(crontab -l 2>/dev/null | grep -v "daily-check"; echo "$CRON_CMD") | crontab -
echo "→ Cron installed: 0 14 * * * (14:00 Jerusalem time)"

# ── 11. Sheldon webhook configuration ────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SHELDON CONFIGURATION REQUIRED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "In your OpenClaw/Sheldon config, add a message handler"
echo "that forwards messages from group:"
echo ""
echo '  "דיווחי OSINT - דביר ורועי 🫡"'
echo ""
echo "To this endpoint:"
echo "  POST http://localhost:8099/ingest"
echo ""
echo "Payload format:"
echo '  {'
echo '    "group":   "דיווחי OSINT - דביר ורועי 🫡",'
echo '    "sender":  "<phone number>",'
echo '    "name":    "<sender name>",'
echo '    "message": "<message text>"'
echo '  }'
echo ""
echo "Add WEBHOOK_SECRET from .env as header: x-webhook-secret"
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Setup complete!"
echo ""
echo "  Webhook:  systemctl status osint-webhook"
echo "  Logs:     journalctl -u osint-webhook -f"
echo "  Daily:    tail -f /var/log/osint-daily.log"
echo "  Test run: node $INSTALL_DIR/scripts/daily-check.js"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
