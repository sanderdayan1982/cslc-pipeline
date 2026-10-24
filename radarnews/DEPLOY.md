# Despliegue RadarNews → GCE `radarnews`

Playbook para un agente (Argon 4 / Cursor / Gemini). Ejecutar en orden. No improvisar rutas.

## Por qué este documento

El código nuevo **no está en la VM**. Producción sigue con 11 fuentes y `gemini-3-flash-preview`. El agente que escribió este árbol **no tiene `gcloud` ni credenciales IAP**, así que no puede SSH a la instancia.

## Fuente de verdad del código NUEVO

**No uses** `/Users/sanderbignotte/.gemini/antigravity/scratch/radarnews` (eso es el árbol viejo sincronizado con producción).

Usa **esta** carpeta `radarnews/` de la rama:

- Repo: `https://github.com/sanderdayan1982/cslc-pipeline`
- Rama: `cursor/radarnews-institutional-ff5f`
- Path: `radarnews/`
- PR: `https://github.com/sanderdayan1982/cslc-pipeline/pull/2`

```bash
git clone --branch cursor/radarnews-institutional-ff5f --single-branch https://github.com/sanderdayan1982/cslc-pipeline.git /tmp/cslc-radar
SRC=/tmp/cslc-radar/radarnews
test -f "$SRC/package.json" && test -f "$SRC/src/config.js"
grep -q 'BrujulaDeMercados' "$SRC/src/config.js"
```

Si `grep` no encuentra `BrujulaDeMercados`, **para**. Estás en el árbol viejo.

## Destino (no cambiar)

| Qué | Valor |
|-----|--------|
| Proyecto GCP | `famous-phalanx-307400` |
| Instancia | `radarnews` |
| Zona | `us-central1-a` |
| Código | `/opt/radarnews/app` |
| Datos (NO tocar el contenido) | `/var/lib/radarnews` |
| Servicio | `radarnews.service` |
| Bind esperado | `127.0.0.1:4700` |
| Telegram Brújula | slug `BrujulaDeMercados` → `https://t.me/s/BrujulaDeMercados` |
| Modelo | `gemini-3.8-flash` |

**Nunca borres ni rsync-ees encima de** `/var/lib/radarnews/radarnews.db` **ni** `settings.json` **entero**. Ahí está la clave Gemini y el histórico.

## 1. SSH

Desde la máquina del usuario (Mac con gcloud ya autenticado):

```bash
gcloud compute ssh radarnews --zone=us-central1-a --project=famous-phalanx-307400 --tunnel-through-iap
```

Si IAP falla, no abras el puerto 22 a internet. Reintenta IAP.

## 2. Backup (obligatorio antes de copiar)

En la VM:

```bash
sudo systemctl stop radarnews || true
sudo mkdir -p /var/backups/radarnews
TS=$(date -u +%Y%m%dT%H%M%SZ)
sudo cp -a /opt/radarnews/app "/var/backups/radarnews/app-$TS"
sudo cp -a /var/lib/radarnews "/var/backups/radarnews/data-$TS"
sudo ls -la "/var/backups/radarnews/data-$TS"
```

Debe existir `settings.json` y `radarnews.db` (o `radarnews.db-wal`) en el backup de datos.

## 3. Subir el código nuevo

Desde el **Mac** (otra terminal, con `$SRC` del clone de arriba):

```bash
gcloud compute scp --recurse --zone=us-central1-a --project=famous-phalanx-307400 --tunnel-through-iap \
  "$SRC" radarnews:/tmp/radarnews-new
```

En la **VM**:

```bash
sudo rsync -a --delete \
  --exclude node_modules \
  --exclude data \
  --exclude '*.db' \
  --exclude settings.json \
  /tmp/radarnews-new/ /opt/radarnews/app/

# por si scp copió el directorio anidado
if [ ! -f /opt/radarnews/app/package.json ] && [ -f /opt/radarnews/app/radarnews/package.json ]; then
  sudo rsync -a --delete --exclude node_modules --exclude data \
    /opt/radarnews/app/radarnews/ /opt/radarnews/app/
fi

test -f /opt/radarnews/app/package.json
grep -q BrujulaDeMercados /opt/radarnews/app/src/config.js
grep -q gemini-3.8-flash /opt/radarnews/app/src/config.js
```

Si alguno de esos `test`/`grep` falla: **no arranques el servicio**. Restaura el backup de `app-$TS`.

## 4. Dependencias y modelo Gemini en settings (sin borrar la clave)

```bash
cd /opt/radarnews/app
sudo -u radarnews npm install --omit=dev

# Pin del modelo en settings existentes; no reescribe la API key
sudo python3 - <<'PY'
import json, os
p="/var/lib/radarnews/settings.json"
if not os.path.exists(p):
    raise SystemExit("falta settings.json — abortar")
os.chmod(p, 0o600)
with open(p) as f:
    s=json.load(f)
s.setdefault("gemini", {})
if not s["gemini"].get("key") and not os.environ.get("GEMINI_API_KEY"):
    print("WARN: no hay clave gemini en settings; el Agente seguirá solo")
s["gemini"]["model"]="gemini-3.8-flash"
with open(p,"w") as f:
    json.dump(s, f, indent=2)
os.chmod(p, 0o600)
print("ok model", s["gemini"].get("model"), "key", "yes" if s["gemini"].get("key") else "no")
PY

# systemd: datos + bind privado + slug ya default
sudo mkdir -p /etc/systemd/system/radarnews.service.d
sudo tee /etc/systemd/system/radarnews.service.d/override.conf >/dev/null <<'EOF'
[Service]
Environment=NODE_ENV=production
Environment=RADARNEWS_DATA_DIR=/var/lib/radarnews
Environment=RADARNEWS_BIND=127.0.0.1
Environment=PORT=4700
Environment=RADARNEWS_BURBUJA_CHANNEL=BrujulaDeMercados
EOF

sudo chown -R radarnews:radarnews /opt/radarnews/app /var/lib/radarnews
sudo chmod 700 /var/lib/radarnews
sudo chmod 600 /var/lib/radarnews/settings.json
```

## 5. Arranque

```bash
sudo systemctl daemon-reload
sudo systemctl start radarnews
sudo systemctl status radarnews --no-pager
sleep 8
curl -sS -o /tmp/rn-state.json -w "%{http_code}\n" http://127.0.0.1:4700/api/state
```

El HTTP debe ser `200`. Si el servicio está en failed: `journalctl -u radarnews -n 80 --no-pager` y rollback.

## 6. Verificación (obligatoria)

```bash
python3 - <<'PY'
import json
d=json.load(open("/tmp/rn-state.json"))
ids=[s["id"] for s in d.get("sources") or []]
need=["financialjuice","fed","ecb","boe","boj","boc","rba","rbnz","snb-press","seco","negociostv","burbuja-mercados"]
missing=[x for x in need if x not in ids]
print("missing", missing)
print("model", (d.get("settings") or {}).get("gemini",{}).get("model"))
h={x["id"]:x for x in (d.get("last_sync") or {}).get("health") or []}
for i in ["rbnz","snb-press","burbuja-mercados","negociostv","financialjuice"]:
    x=h.get(i) or {}
    print(i, "ok=", x.get("ok"), "url=", x.get("url"), "err=", x.get("error"), "rel=", x.get("relevant"))
print("news", len(d.get("news") or []), "error", d.get("error"))
urls=[(n.get("title") or "") for n in (d.get("news") or [])]
assert not any(t.startswith("http") for t in urls), "titular URL cruda"
paths=set()
for n in d.get("news") or []:
    u=(n.get("url") or "").replace("http://","https://").rstrip("/")
    if u in paths:
        print("DUP", u)
    paths.add(u)
fed=[n for n in (d.get("news") or []) if "monetary20260916" in (n.get("url") or "")]
for n in fed:
    assert not str(n.get("published_at") or "").startswith("2026-10-24"), n
cal=d.get("calendar") or []
with_act=sum(1 for e in cal if e.get("actual") and e.get("impact")!="Holiday")
print("calendar_actuals", with_act, "/", len(cal))
assert not missing, missing
assert (d.get("settings") or {}).get("gemini",{}).get("model")=="gemini-3.8-flash"
bj=h.get("burbuja-mercados") or {}
assert "BrujulaDeMercados" in (bj.get("url") or ""), bj
print("VERIFY_OK")
PY
```

`burbuja-mercados` debe tener `url` con `t.me/s/BrujulaDeMercados` y `ok=true` (vista pública). Si `ok=false` con “sin vista pública”, el scrape de Telegram falló: reintenta un refresh `curl -X POST http://127.0.0.1:4700/api/refresh`.

En la app (Ajustes → Fuentes): RBNZ, SNB, SECO, BIS, Negocios TV, Brújula de Mercados. Ranking: CHF/NZD ya no deberían ser N/D eterno si hay comunicados.

Tras el arranque, una **actualización o reinicio debe conservar** los Act ya hidratados, no poner un FOMC de septiembre como “ahora”, ni duplicar el mismo PDF BoJ en HTTP y HTTPS. Si la cobertura Act es baja, la cinta debe decir **datos degradados**, no “25/25 fuentes” como si eso fuera integridad.

## 7. Tailscale: Serve, no Funnel

```bash
sudo tailscale serve status || true
sudo tailscale funnel status || true
```

Si hay Funnel activo, apágalo y deja **Serve** a localhost:4700:

```bash
sudo tailscale funnel reset || true
sudo tailscale serve --bg --https=443 localhost:4700
sudo tailscale serve status
```

La URL debe ser `https://radarnews.tailXXXX.ts.net` **solo en la red Tailscale**, no en internet abierto.

## 8. Push en dispositivos (después del deploy)

En cada iPhone/iPad: abrir RadarNews **desde la pantalla de inicio** → Ajustes → Notificaciones → Activar. En Mac Dock igual. Sin este paso las alertas no llegan a todos.

## Rollback

```bash
sudo systemctl stop radarnews
sudo rsync -a --delete /var/backups/radarnews/app-TIMESTAMP/ /opt/radarnews/app/
# datos: solo restaurar si el arranque nuevo corrompió la DB (raro)
# sudo rsync -a --delete /var/backups/radarnews/data-TIMESTAMP/ /var/lib/radarnews/
sudo systemctl start radarnews
```

Sustituye `TIMESTAMP` por el de `ls /var/backups/radarnews`.

## Prohibido

- `tailscale funnel` para “que funcione desde fuera”.
- Pegar la API key de Gemini en el chat, en git, o en argv (`gemini --key=...`).
- `rm -rf /var/lib/radarnews`.
- Desplegar el scratch de Antigravity (código viejo).
- Abrir `0.0.0.0:4700` en el firewall de GCP.
