#!/bin/bash
# Arranca RadarNews al iniciar sesión en el Mac y lo reinicia si se cae.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
LABEL="com.radarnews.terminal"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/RadarNews"

if [[ -z "$NODE_BIN" ]]; then
  echo "No encuentro Node.js. Instálalo con: brew install node" >&2
  exit 1
fi

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>--env-file-if-exists=.env</string>
    <string>--no-warnings=ExperimentalWarning</string>
    <string>src/server.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/radarnews.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/radarnews.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "RadarNews instalado. Abre http://localhost:3000 en Safari."
echo "Logs: $LOG_DIR/radarnews.log"
echo "Para desinstalar: launchctl bootout gui/$(id -u)/$LABEL && rm \"$PLIST\""
