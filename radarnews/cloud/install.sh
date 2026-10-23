#!/bin/bash
# RadarNews en un servidor en la nube (Debian/Ubuntu), funcionando 24/7 sin depender del Mac.
#   curl -fsSL https://raw.githubusercontent.com/sanderdayan1982/cslc-pipeline/main/radarnews/cloud/install.sh | bash
# Vuelve a ejecutarlo para actualizar: conserva datos, alertas, dispositivos y la clave de Gemini.
set -euo pipefail

REPO="${RADARNEWS_REPO:-sanderdayan1982/cslc-pipeline}"
BRANCH="${RADARNEWS_BRANCH:-main}"
PORT="${RADARNEWS_PORT:-4700}"
TS_HOSTNAME="${RADARNEWS_HOSTNAME:-radarnews}"
BASE=/opt/radarnews
DATA_DIR=/var/lib/radarnews
SVC_USER=radarnews

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\033[32m›\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || fail "Este instalador es para el servidor Linux. En el Mac usa macos/install.sh"
command -v systemctl >/dev/null || fail "Hace falta systemd (Debian o Ubuntu)"
SUDO=""; [[ "$(id -u)" -eq 0 ]] || SUDO="sudo"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

bold "Instalando RadarNews en el servidor"
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq curl ca-certificates tar >/dev/null

# e2-micro / E2.1.Micro tienen 1 GB de RAM: un poco de swap evita cortes al instalar dependencias.
if [[ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 1600000 ]] && ! swapon --show | grep -q .; then
  step "Añadiendo 1 GB de swap"
  $SUDO fallocate -l 1G /swapfile 2>/dev/null || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none
  $SUDO chmod 600 /swapfile
  $SUDO mkswap /swapfile >/dev/null
  $SUDO swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
fi

id "$SVC_USER" >/dev/null 2>&1 || $SUDO useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SVC_USER"
$SUDO mkdir -p "$BASE" "$DATA_DIR"
$SUDO chown "$SVC_USER:$SVC_USER" "$DATA_DIR"
$SUDO chmod 700 "$DATA_DIR"

# ------------------------------------------------------------------ Node.js

case "$(uname -m)" in
  aarch64|arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) fail "Arquitectura no soportada: $(uname -m)" ;;
esac
NODE_BIN="$BASE/node/bin/node"
if ! { [[ -x "$NODE_BIN" ]] && "$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'; }; then
  step "Descargando Node.js 22"
  DIST="https://nodejs.org/dist/latest-v22.x"
  curl -fsSL "$DIST/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  FILE="$(grep -oE "node-v22\.[0-9]+\.[0-9]+-linux-$ARCH\.tar\.gz" "$TMP/SHASUMS256.txt" | head -1)"
  [[ -n "$FILE" ]] || fail "No encuentro Node.js para linux-$ARCH"
  curl -fsSL "$DIST/$FILE" -o "$TMP/$FILE"
  EXPECTED="$(grep " $FILE\$" "$TMP/SHASUMS256.txt" | cut -d' ' -f1)"
  [[ "$EXPECTED" == "$(sha256sum "$TMP/$FILE" | cut -d' ' -f1)" ]] || fail "La firma de Node.js no coincide; descarga abortada"
  $SUDO rm -rf "$BASE/node"
  $SUDO mkdir -p "$BASE/node"
  $SUDO tar -xzf "$TMP/$FILE" -C "$BASE/node" --strip-components 1
fi
export PATH="$BASE/node/bin:$PATH"
step "Node.js $("$NODE_BIN" -v)"

# ------------------------------------------------------------------ code

step "Descargando RadarNews ($BRANCH)"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" -o "$TMP/src.tar.gz"
mkdir -p "$TMP/src"
tar -xzf "$TMP/src.tar.gz" -C "$TMP/src"
SRC="$(find "$TMP/src" -mindepth 2 -maxdepth 2 -type d -name radarnews | head -1)"
[[ -n "$SRC" && -f "$SRC/package.json" ]] || fail "El paquete descargado no contiene radarnews/"
step "Instalando dependencias"
(cd "$SRC" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
$SUDO rm -rf "$BASE/app.new"
$SUDO mv "$SRC" "$BASE/app.new"
$SUDO rm -rf "$BASE/app"
$SUDO mv "$BASE/app.new" "$BASE/app"
$SUDO chown -R root:root "$BASE/app"

# ------------------------------------------------------------------ service

step "Configurando el servicio (arranca solo y se reinicia si se cae)"
$SUDO tee /etc/systemd/system/radarnews.service >/dev/null <<UNIT
[Unit]
Description=RadarNews terminal macro FX
After=network-online.target
Wants=network-online.target

[Service]
User=$SVC_USER
WorkingDirectory=$BASE/app
Environment=RADARNEWS_DATA=$DATA_DIR
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
EnvironmentFile=-$DATA_DIR/.env
ExecStart=$NODE_BIN --no-warnings=ExperimentalWarning src/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
$SUDO systemctl daemon-reload
$SUDO systemctl enable radarnews >/dev/null 2>&1
$SUDO systemctl restart radarnews

# ------------------------------------------------------------------ Tailscale (acceso privado)

if [[ "${RADARNEWS_SKIP_TAILSCALE:-0}" != "1" ]]; then
  if ! command -v tailscale >/dev/null; then
    step "Instalando Tailscale"
    curl -fsSL https://tailscale.com/install.sh | $SUDO sh >/dev/null
  fi
  if ! $SUDO tailscale status >/dev/null 2>&1; then
    step "Conecta el servidor a tu cuenta de Tailscale"
    if [[ -n "${TS_AUTHKEY:-}" ]]; then
      $SUDO tailscale up --authkey "$TS_AUTHKEY" --hostname "$TS_HOSTNAME"
    else
      echo "  Abre el enlace que aparece a continuación e inicia sesión con la misma cuenta que en tu iPhone:"
      $SUDO tailscale up --hostname "$TS_HOSTNAME"
    fi
  fi
  # Lets the service read its own Tailscale address to show the QR in Settings.
  $SUDO tailscale set --operator="$SVC_USER" >/dev/null 2>&1 || true
  $SUDO tailscale serve --bg "$PORT" >/dev/null
  TS_DNS="$($SUDO tailscale status --json | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).Self.DNSName.replace(/\.$/,""))}catch{}})')"
fi

step "Esperando al servidor"
for _ in $(seq 1 60); do curl -fs -o /dev/null "http://127.0.0.1:$PORT/api/settings" && break; sleep 1; done
curl -fs -o /dev/null "http://127.0.0.1:$PORT/api/settings" || fail "El servicio no arranca. Revisa: sudo journalctl -u radarnews -n 50"

echo
bold "RadarNews funciona 24/7 en este servidor."
if [[ -n "${TS_DNS:-}" ]]; then
  echo "  · Dirección:    https://$TS_DNS"
  echo "  · iPhone/iPad:  Tailscale con la misma cuenta → abre la dirección en Safari → Compartir → Añadir a pantalla de inicio"
  echo "  · Mac:          curl -fsSL https://raw.githubusercontent.com/$REPO/$BRANCH/radarnews/macos/install.sh | RADARNEWS_URL=https://$TS_DNS RADARNEWS_BRANCH=$BRANCH bash"
fi
echo "  · Gemini:       en la app, Ajustes › Inteligencia artificial"
echo "  · Logs:         sudo journalctl -u radarnews -f"
echo "  · Actualizar:   vuelve a ejecutar este mismo comando"
