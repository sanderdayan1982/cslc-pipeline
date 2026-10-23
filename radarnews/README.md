# RadarNews

Terminal institucional de **fuerza narrativa FX** para el G8 (USD, EUR, GBP, JPY, CHF, CAD, AUD, NZD). Dos motores (Agente Mosler + Gemini 3.8 Flash), cinta, ranking, agenda y push a todos los dispositivos.

Este árbol es el código desplegable (`src/`, `public/`, `test/`). En producción vive en `/opt/radarnews/app` con datos en `/var/lib/radarnews`.

## Requisitos

- Node.js 22+
- Red privada (Tailscale Serve). No exponer Funnel a internet.

## Arranque local

```bash
cd radarnews
npm install
npm test
npm start          # http://127.0.0.1:4700
```

Variables útiles:

| Variable | Default | Uso |
|----------|---------|-----|
| `PORT` / `RADARNEWS_PORT` | `4700` | puerto |
| `RADARNEWS_BIND` | `127.0.0.1` | bind |
| `RADARNEWS_DATA_DIR` | `./data` | SQLite + `settings.json` |
| `GEMINI_API_KEY` | — | alternativa a pegar la clave en Ajustes |
| `RADARNEWS_BURBUJA_CHANNEL` | `BurbujaDeMercados` | slug público de Telegram |
| `RADARNEWS_URL` | host de la petición | URL que se muestra en iPhone/iPad |

## Producción (GCE)

```bash
sudo RADARNEWS_DATA_DIR=/var/lib/radarnews ./cloud/install.sh
sudo systemctl restart radarnews
```

Luego **Tailscale Serve** (no Funnel):

```bash
sudo tailscale serve --bg --https=443 localhost:4700
```

Copiar este directorio sobre `/opt/radarnews/app` y reiniciar el servicio conserva `radarnews.db` y la clave de Gemini en `/var/lib/radarnews`.

## Pruebas

`npm test` — reglas Mosler (CPI+debilidad no es soporte), fuentes NZD/CHF, Telegram, UI sin sesgo de ejecución, parseo Gemini.
