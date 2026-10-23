# RadarNews — Terminal macro FX

Terminal personal de noticias financieras para Mac. Agrega breaking, bancos centrales y análisis; clasifica la **fuerza narrativa** de USD, EUR, GBP, JPY, CHF, CAD, AUD y NZD (−100…+100) con dos motores (Agente por reglas + Gemini); sigue el **calendario económico de la semana** y avisa de lo importante por notificación. Nunca por email.

La especificación completa está en [`SPEC.md`](SPEC.md) y dentro de la app (botón **ESPECIFICACIÓN**).

## Qué incluye

- **Cinta de breaking**: FinancialJuice, Fed, BCE, BoE, BoJ, BoC, RBA, InvestingLive y Financial Times. Filtros por tipo y por divisa; ACT/EST/PREV coloreado según sorpresa.
- **Fuerza relativa**: pestañas Consenso / Gemini / Agente, flecha de cambio de puesto, mini-gráfico de 24 h, catalizadores y marca de **divergencia** cuando los motores discrepan.
- **Diferencial narrativo**: matriz 8×8 y los cruces con mayor diferencial.
- **Calendario semanal**: solo la semana en curso, próximo dato de alto impacto con cuenta atrás y el dato real enlazado cuando sale en la cinta.
- **Alertas**: datos de alto impacto 15 min antes, breaking, cambios de **ranking** y de **régimen** de cada motor. Una publicación de datos genera una sola alerta.
- **Barra de estado**: salud de cada fuente; atajos `R` (actualizar), `A` (alertas), `1–5` (filtros).

## Instalación en el Mac

Requisitos: macOS Sonoma o posterior y Node.js 22.12 o superior (`brew install node`).

```bash
cd radarnews
npm install
cp .env.example .env     # pega aquí tu GEMINI_API_KEY
npm start                # http://localhost:3000
```

### Clave gratuita de Gemini

La suscripción Gemini Pro/Ultra **no** incluye la API. La clave es aparte y gratuita:

1. Entra en <https://aistudio.google.com/apikey> con tu cuenta de Google.
2. Pulsa **Create API key** y copia la clave.
3. Pégala en `.env` como `GEMINI_API_KEY=...` y reinicia.

Sin clave, el terminal funciona igual con el Agente. Si Gemini falla o agota la cuota, el Agente sigue activo y la cabecera lo indica en rojo.

### Que arranque solo al iniciar sesión

```bash
./macos/install-launchagent.sh
```

Lo deja como servicio de usuario (launchd): arranca al iniciar sesión y se reinicia si se cae. Logs en `~/Library/Logs/RadarNews/radarnews.log`. El servidor es tu propio Mac: coste cero. Mientras el Mac está en reposo no sincroniza; al despertar se pone al día.

### Como app en el Dock

1. Abre `http://localhost:3000` en **Safari**.
2. Menú **Archivo → Añadir al Dock**.
3. Abre RadarNews desde el Dock, pulsa la campana y luego **Activar notificaciones**.
4. En **Ajustes del Sistema → Notificaciones → RadarNews**, elige el estilo *Alertas* si quieres que se queden en pantalla. Si usas un modo de concentración (p. ej. Descanso), añade RadarNews a las apps permitidas.

Con la app del Dock abierta, aunque esté minimizada, cada alerta llega como notificación de macOS.

### Opcional: notificaciones con la app cerrada y en el iPhone

Las notificaciones push con la app cerrada, y en el iPhone, exigen HTTPS. La forma gratuita es [Tailscale](https://tailscale.com) (plan personal gratis):

```bash
brew install tailscale
tailscale serve --bg 3000   # publica https://<tu-mac>.<tu-red>.ts.net solo dentro de tu red Tailscale
```

Abre esa URL en Safari (Mac) o en el iPhone (con Tailscale instalado) → **Compartir → Añadir a pantalla de inicio** → abre la app → campana → **Activar notificaciones**. El botón **Enviar prueba** confirma que llegan.

### Alternativa: servidor gratuito en la nube

Para que funcione con el Mac apagado, el `Dockerfile` sirve para cualquier máquina gratuita (p. ej. la capa *Always Free* de Oracle Cloud):

```bash
docker build -t radarnews .
docker run -d --restart=always -p 3000:3000 -v radarnews-data:/data -e GEMINI_API_KEY=... radarnews
```

Ponlo detrás de HTTPS (Tailscale o un proxy) antes de activar el push.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm start` | Servidor + sincronización cada 5 min + calendario cada hora |
| `npm run refresh` | Una sincronización en consola (tabla de salud y ranking) |
| `npm test` | Tests |

## Notas de diseño

- La clasificación es narrativa: los motores nunca ven precios. Los titulares de movimiento de precio ("Dollar/yen falls…") no puntúan.
- InvestingLive bloquea servidores en su web; se lee su espejo público de Telegram, que es un feed con retraso.
- El canal público de FinancialJuice puede ir algo por detrás de tu plan de pago; RadarNews complementa a su app, no la sustituye en velocidad pura.
- Las claves VAPID del push se generan solas en `data/vapid.json`. `data/` y `.env` no se suben al repositorio.
