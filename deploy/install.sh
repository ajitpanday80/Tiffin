#!/usr/bin/env bash
# Installs / updates Tiffin Manager in /root/tiffin and runs it as a systemd service.
# Run as root from a checkout of the repo:   sudo bash deploy/install.sh
# Re-run it any time to deploy an update (your data and .env are never overwritten).
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/root/tiffin}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ "$(id -u)" -eq 0 ] || [ -n "${SKIP_SYSTEMD:-}" ] || { echo "Please run as root (sudo bash deploy/install.sh)"; exit 1; }

NODE="$(command -v node || true)"
if [ -z "$NODE" ] || [ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Node.js 20 or newer is required. Install it first (see https://nodejs.org/en/download or your distro's NodeSource instructions), then re-run."
  exit 1
fi

echo "Copying app to $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR/data"
if [ "$SRC" != "$INSTALL_DIR" ]; then
  # keep data/ and .env on the server; everything else comes from the checkout
  tar -C "$SRC" --exclude=./.git --exclude=./data --exclude=./.env --exclude=./node_modules -cf - . | tar -C "$INSTALL_DIR" -xf -
fi

if [ ! -f "$INSTALL_DIR/.env" ]; then
  cp "$SRC/deploy/env.example" "$INSTALL_DIR/.env"
  chmod 600 "$INSTALL_DIR/.env"
  echo "Created $INSTALL_DIR/.env : edit it (GEOCODER_CONTACT, TELEGRAM_BOT_TOKEN) and re-run to apply."
fi
chmod 700 "$INSTALL_DIR/data"

if [ -n "${SKIP_SYSTEMD:-}" ]; then echo "SKIP_SYSTEMD set: files copied only."; exit 0; fi

sed -e "s#__DIR__#$INSTALL_DIR#g" -e "s#__NODE__#$NODE#g" "$SRC/deploy/tiffin.service" > /etc/systemd/system/tiffin.service
systemctl daemon-reload
systemctl enable tiffin >/dev/null
systemctl restart tiffin
sleep 1
systemctl --no-pager --lines=5 status tiffin || true

cat <<MSG

Done. The app is listening on 127.0.0.1:3000 (not reachable from outside until you add HTTPS).
Next:
  1. Install Caddy (https://caddyserver.com/docs/install), then copy deploy/Caddyfile to /etc/caddy/Caddyfile
     and run: systemctl reload caddy
  2. Check:  curl -I https://mytiffin.online
  3. Create your admin login:  cd $INSTALL_DIR && node scripts/make-admin.js <phone> '<long password>' && systemctl restart tiffin
Logs:     journalctl -u tiffin -f
Backup:   $INSTALL_DIR/data/db.json
MSG
