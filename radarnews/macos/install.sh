#!/bin/bash
# Instalador de RadarNews para Mac en un solo comando:
#   curl -fsSL https://raw.githubusercontent.com/sanderdayan1982/cslc-pipeline/main/radarnews/macos/install.sh | bash
# Vuelve a ejecutarlo para actualizar: conserva tus datos, alertas y la clave de Gemini.
set -euo pipefail

REPO="${RADARNEWS_REPO:-sanderdayan1982/cslc-pipeline}"
BRANCH="${RADARNEWS_BRANCH:-main}"
PORT="${RADARNEWS_PORT:-4700}"
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=12
LABEL="com.radarnews.terminal"
OS="$(uname -s)"

if [[ "$OS" == "Darwin" ]]; then
  APP_HOME="${RADARNEWS_HOME:-$HOME/Library/Application Support/RadarNews}"
  LOG_DIR="$HOME/Library/Logs/RadarNews"
else
  APP_HOME="${RADARNEWS_HOME:-$HOME/.local/share/radarnews}"
  LOG_DIR="$APP_HOME/logs"
fi
CODE_DIR="$APP_HOME/app"
DATA_DIR="$APP_HOME/data"
NODE_DIR="$APP_HOME/node"
URL="http://localhost:$PORT"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\033[32m›\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

bold "Instalando RadarNews"
mkdir -p "$APP_HOME" "$DATA_DIR" "$LOG_DIR"
chmod 700 "$DATA_DIR"

# ------------------------------------------------------------------ Node.js

node_ok() {
  local v
  v="$("$1" -v 2>/dev/null)" || return 1
  v="${v#v}"
  local major="${v%%.*}" rest="${v#*.}"
  local minor="${rest%%.*}"
  (( major > NODE_MIN_MAJOR || (major == NODE_MIN_MAJOR && minor >= NODE_MIN_MINOR) ))
}

NODE_BIN=""
if [[ -x "$NODE_DIR/bin/node" ]] && node_ok "$NODE_DIR/bin/node"; then
  NODE_BIN="$NODE_DIR/bin/node"
elif command -v node >/dev/null && node_ok "$(command -v node)"; then
  NODE_BIN="$(command -v node)"
else
  step "Descargando Node.js 22 (solo para RadarNews, no toca tu sistema)"
  case "$(uname -m)" in
    arm64|aarch64) ARCH=arm64 ;;
    x86_64) ARCH=x64 ;;
    *) fail "Arquitectura no soportada: $(uname -m)" ;;
  esac
  PLATFORM="$([[ "$OS" == "Darwin" ]] && echo darwin || echo linux)"
  DIST="https://nodejs.org/dist/latest-v22.x"
  curl -fsSL "$DIST/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  FILE="$(grep -oE "node-v22\.[0-9]+\.[0-9]+-$PLATFORM-$ARCH\.tar\.gz" "$TMP/SHASUMS256.txt" | head -1)"
  [[ -n "$FILE" ]] || fail "No encuentro Node.js para $PLATFORM-$ARCH"
  curl -fsSL "$DIST/$FILE" -o "$TMP/$FILE"
  EXPECTED="$(grep " $FILE\$" "$TMP/SHASUMS256.txt" | cut -d' ' -f1)"
  if command -v shasum >/dev/null; then ACTUAL="$(shasum -a 256 "$TMP/$FILE" | cut -d' ' -f1)"; else ACTUAL="$(sha256sum "$TMP/$FILE" | cut -d' ' -f1)"; fi
  [[ "$EXPECTED" == "$ACTUAL" ]] || fail "La firma de Node.js no coincide; descarga abortada"
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xzf "$TMP/$FILE" -C "$NODE_DIR" --strip-components 1
  NODE_BIN="$NODE_DIR/bin/node"
fi
NODE_BIN_DIR="$(dirname "$NODE_BIN")"
export PATH="$NODE_BIN_DIR:$PATH"
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
rm -rf "$CODE_DIR.new"
mv "$SRC" "$CODE_DIR.new"
rm -rf "$CODE_DIR.old"
[[ -d "$CODE_DIR" ]] && mv "$CODE_DIR" "$CODE_DIR.old"
mv "$CODE_DIR.new" "$CODE_DIR"
rm -rf "$CODE_DIR.old"
cp "$CODE_DIR/macos/uninstall.sh" "$APP_HOME/uninstall.sh"
chmod +x "$APP_HOME/uninstall.sh"

if [[ "$OS" != "Darwin" ]]; then
  bold "Instalado en $APP_HOME (fuera de macOS no se crea servicio ni app)."
  echo "Arranca con: RADARNEWS_DATA=\"$DATA_DIR\" PORT=$PORT \"$NODE_BIN\" --no-warnings=ExperimentalWarning \"$CODE_DIR/src/server.js\""
  exit 0
fi

# ------------------------------------------------------------------ launchd service

step "Configurando el servicio en segundo plano (arranca al iniciar sesión)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$CODE_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>--env-file-if-exists=$DATA_DIR/.env</string>
    <string>--no-warnings=ExperimentalWarning</string>
    <string>src/server.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>RADARNEWS_DATA</key><string>$DATA_DIR</string>
    <key>PORT</key><string>$PORT</string>
    <key>HOST</key><string>127.0.0.1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG_DIR/radarnews.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/radarnews.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

# ------------------------------------------------------------------ RadarNews.app

step "Creando RadarNews.app con su icono"
APP="$HOME/Applications/RadarNews.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

ICONSET="$TMP/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" "$CODE_DIR/public/icon-1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z "$d" "$d" "$CODE_DIR/public/icon-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>RadarNews</string>
  <key>CFBundleDisplayName</key><string>RadarNews</string>
  <key>CFBundleIdentifier</key><string>com.radarnews.launcher</string>
  <key>CFBundleExecutable</key><string>RadarNews</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

cat > "$APP/Contents/MacOS/RadarNews" <<LAUNCHER
#!/bin/bash
# Abre el terminal; si el servicio no responde, lo reinicia y espera.
URL="$URL"
if ! curl -fs -o /dev/null "\$URL/api/settings"; then
  launchctl kickstart -k "gui/\$(id -u)/$LABEL" 2>/dev/null || launchctl bootstrap "gui/\$(id -u)" "$PLIST"
  for _ in \$(seq 1 40); do curl -fs -o /dev/null "\$URL/api/settings" && break; sleep 0.5; done
fi
if [[ -d "/Applications/Google Chrome.app" || -d "\$HOME/Applications/Google Chrome.app" ]]; then
  open -na "Google Chrome" --args --app="\$URL" --window-size=1600,1000
else
  open -a Safari "\$URL"
fi
LAUNCHER
chmod +x "$APP/Contents/MacOS/RadarNews"
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" 2>/dev/null || true

step "Esperando al servidor"
for _ in $(seq 1 60); do curl -fs -o /dev/null "$URL/api/settings" && break; sleep 0.5; done

echo
bold "RadarNews está listo."
echo "  · App:          ~/Applications/RadarNews.app (arrástrala al Dock)"
echo "  · Dirección:    $URL"
echo "  · Gemini:       Ajustes (icono ⚙︎) › Inteligencia artificial › pega tu clave"
echo "  · Logs:         $LOG_DIR/radarnews.log"
echo "  · Desinstalar:  bash \"$APP_HOME/uninstall.sh\""
open "$APP"
