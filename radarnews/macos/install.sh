#!/usr/bin/env bash
# Cliente Mac: abre el servidor (nube o local) como app independiente.
set -euo pipefail
URL="${RADARNEWS_URL:-http://127.0.0.1:4700}"
APP="$HOME/Applications/RadarNews.app"
mkdir -p "$APP/Contents/MacOS"
cat >"$APP/Contents/MacOS/RadarNews" <<'SH'
#!/bin/bash
open "${RADARNEWS_URL:-http://127.0.0.1:4700}"
SH
chmod +x "$APP/Contents/MacOS/RadarNews"
echo "RadarNews.app → $URL"
echo "En Safari: Archivo › Añadir al Dock. En iPhone: Compartir › Añadir a pantalla de inicio."
