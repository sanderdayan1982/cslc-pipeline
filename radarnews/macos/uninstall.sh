#!/bin/bash
# Desinstala RadarNews. Por defecto conserva los datos (titulares, alertas, clave de Gemini).
# Usa --todo para borrarlo absolutamente todo.
set -euo pipefail

LABEL="com.radarnews.terminal"
APP_HOME="${RADARNEWS_HOME:-$HOME/Library/Application Support/RadarNews}"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Applications/RadarNews.app"
rm -rf "$APP_HOME/app" "$APP_HOME/node"

if [[ "${1:-}" == "--todo" ]]; then
  rm -rf "$APP_HOME" "$HOME/Library/Logs/RadarNews"
  echo "RadarNews eliminado por completo."
else
  echo "RadarNews desinstalado. Tus datos siguen en: $APP_HOME/data"
  echo "Para borrarlos también: bash \"$APP_HOME/uninstall.sh\" --todo  (o elimina esa carpeta)"
fi
