#!/usr/bin/env bash
# Installs / updates Tiffin Manager in /root/tiffin and runs it as a systemd service.
# Run as root from a checkout of the repo:   sudo bash deploy/install.sh
# Re-run it any time to deploy an update (your data and .env are never overwritten).
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/root/tiffin}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ "$(id -u)" -eq 0 ] || [ -n "${SKIP_SYSTEMD:-}" ] || { echo "Please run as root (sudo bash deploy/install.sh)"; exit 1; }

NODE="$(command -v node || true)"
if [ -z "$NODE" ] || [ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "Node.js 18 or newer is required (tested on 18.19 and 22). Install it first (see https://nodejs.org/en/download), then re-run."
  exit 1
fi

if [ "$SRC" = "$INSTALL_DIR" ]; then echo "Installing from $INSTALL_DIR (already in place) ..."; else echo "Copying app to $INSTALL_DIR ..."; fi
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

# This server may run other apps: make sure our port is free (unless it is already our own service).
# A plain connect probe works on any bash; ss/lsof are only used to name the program holding the port.
PORT="$(grep -E '^PORT=' "$INSTALL_DIR/.env" | tail -1 | cut -d= -f2 | cut -d'#' -f1 | tr -d ' ' || true)"; PORT="${PORT:-3000}"
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
if port_busy "$PORT" && ! systemctl is-active --quiet tiffin 2>/dev/null; then
  echo "Port $PORT is already used by another program on this server:"
  { ss -ltnp "sport = :$PORT" 2>/dev/null || lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null; } | head -3 || true
  echo "Choose a free port: edit PORT= in $INSTALL_DIR/.env (and use the same port in your proxy config), then run this script again."
  exit 1
fi

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
  1. HTTPS in front of it. If nothing else uses ports 80/443: install Caddy (https://caddyserver.com/docs/install),
     copy deploy/Caddyfile to /etc/caddy/Caddyfile, then: systemctl reload caddy
     If nginx/Apache already runs here: do NOT install Caddy. Use deploy/nginx.conf.example instead (see the README).
  2. Check:  curl -I https://mytiffin.online
  3. Create your admin login:  cd $INSTALL_DIR && node scripts/make-admin.js <phone> '<long password>' && systemctl restart tiffin
Logs:     journalctl -u tiffin -f
Backup:   $INSTALL_DIR/data/db.json
MSG
