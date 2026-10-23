#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="${RADARNEWS_APP_DIR:-/opt/radarnews/app}"
DATA_DIR="${RADARNEWS_DATA_DIR:-/var/lib/radarnews}"
USER_NAME="${RADARNEWS_USER:-radarnews}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Ejecuta como root: sudo $0" >&2
  exit 1
fi

id -u "$USER_NAME" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$USER_NAME"
mkdir -p "$APP_DIR" "$DATA_DIR"
rsync -a --delete --exclude node_modules --exclude data "$ROOT/" "$APP_DIR/"
cd "$APP_DIR"
if ! command -v node >/dev/null; then
  echo "Instala Node.js 22+ antes." >&2
  exit 1
fi
npm install --omit=dev
chown -R "$USER_NAME:$USER_NAME" "$APP_DIR" "$DATA_DIR"
chmod 700 "$DATA_DIR"

cat >/etc/systemd/system/radarnews.service <<UNIT
[Unit]
Description=RadarNews G8 narrative terminal
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=RADARNEWS_DATA_DIR=$DATA_DIR
Environment=RADARNEWS_BIND=127.0.0.1
Environment=PORT=4700
ExecStart=$(command -v node) src/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now radarnews.service
echo "RadarNews en 127.0.0.1:4700 · datos $DATA_DIR"
echo "Publica con: sudo tailscale serve --bg --https=443 localhost:4700"
echo "No uses Tailscale Funnel (exposición pública)."
