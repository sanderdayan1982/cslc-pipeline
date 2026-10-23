# RadarNews — Terminal macro FX

Terminal personal de noticias financieras para Mac. Agrega breaking, bancos centrales y análisis; clasifica la **fuerza narrativa** de USD, EUR, GBP, JPY, CHF, CAD, AUD y NZD (−100…+100) con dos motores (Agente por reglas + Gemini); sigue el **calendario económico de la semana** y avisa de lo importante por notificación. Nunca por email.

La especificación completa está en [`SPEC.md`](SPEC.md) y dentro de la app (**⚙︎ Ajustes → Acerca de**).

## Qué incluye

- **Cinta**: FinancialJuice, Fed, BCE, BoE, BoJ, BoC, RBA, InvestingLive y Financial Times. Filtros por tipo y por divisa; Act/Est/Prev coloreado según la sorpresa.
- **Ranking de divisas**: Consenso / Gemini / Agente, cambio de puesto, catalizadores y gráfico de 24 h al pulsar una divisa, y aviso de **divergencia** cuando los motores discrepan. Debajo, los cruces con mayor diferencial y la matriz completa (plegable).
- **Agenda de la semana**: solo la semana en curso, tarjeta del **próximo dato** con cuenta atrás y el dato real enlazado cuando sale en la cinta.
- **Alertas**: datos de alto impacto 15 min antes, breaking, cambios de **ranking** y de **régimen** de cada motor. Una publicación de datos genera una sola alerta.
- **Ajustes** (icono ⚙︎): clave de Gemini, notificaciones, estado de cada fuente y la especificación. No hace falta editar archivos.

## Instalación en el Mac (un solo comando)

Abre **Terminal** y pega:

```bash
curl -fsSL https://raw.githubusercontent.com/sanderdayan1982/cslc-pipeline/cursor/radarnews-terminal-9d11/radarnews/macos/install.sh | RADARNEWS_BRANCH=cursor/radarnews-terminal-9d11 bash
```

Cuando esta rama se fusione en `main`, el comando queda en:

```bash
curl -fsSL https://raw.githubusercontent.com/sanderdayan1982/cslc-pipeline/main/radarnews/macos/install.sh | bash
```

El instalador:

1. Descarga Node.js 22 en una carpeta propia si tu Mac no lo tiene (verifica su firma SHA-256; no toca el sistema).
2. Instala RadarNews en `~/Library/Application Support/RadarNews`.
3. Lo deja como servicio en segundo plano: arranca al iniciar sesión, se reinicia si se cae y sincroniza aunque la ventana esté cerrada.
4. Crea **`~/Applications/RadarNews.app`** con su icono y la abre. Arrástrala al Dock.

La app abre el terminal en una ventana propia de Chrome si lo tienes; si no, en Safari (entonces usa **Archivo → Añadir al Dock** para tenerla como app). Dirección: `http://localhost:4700`.

Para **actualizar**, vuelve a ejecutar el mismo comando: conserva titulares, alertas y la clave. Para **desinstalar**:

```bash
bash ~/Library/Application\ Support/RadarNews/uninstall.sh          # conserva tus datos
bash ~/Library/Application\ Support/RadarNews/uninstall.sh --todo   # lo borra todo
```

Logs: `~/Library/Logs/RadarNews/radarnews.log`. El servidor es tu propio Mac: coste cero. Mientras el Mac está en reposo no sincroniza; al despertar se pone al día.

### Activar Gemini (gratis)

La suscripción Gemini Pro/Ultra **no** incluye la API. La clave es aparte y gratuita:

1. Entra en <https://aistudio.google.com/apikey> con tu cuenta de Google y pulsa **Create API key**.
2. En RadarNews: **⚙︎ Ajustes → Inteligencia artificial**, pega la clave y pulsa **Probar y guardar**.

La app comprueba la clave con Google antes de guardarla (en `data/settings.json`, permisos 600) y Gemini puntúa al momento. Sin clave, el terminal funciona igual con el Agente.

### Notificaciones

**⚙︎ Ajustes → Notificaciones → Activar**, y luego **Enviar notificación de prueba**. En **Ajustes del Sistema → Notificaciones** elige el estilo *Alertas* si quieres que se queden en pantalla, y si usas un modo de concentración (p. ej. Descanso) añade el navegador o la app de RadarNews a las permitidas.

### Modo desarrollo

```bash
cd radarnews && npm install && npm start      # http://localhost:3000
./macos/install-launchagent.sh                 # servicio launchd desde la copia clonada
```

### iPhone y iPad

RadarNews se adapta a cada pantalla: tres columnas en el Mac y en el iPad horizontal, dos en el iPad vertical y, en el iPhone, una sección a la vez con barra inferior (Ranking, Cinta, Agenda, Alertas).

Para abrirlo desde el iPhone o el iPad, con push, hace falta HTTPS entre tus dispositivos. La forma gratuita y privada es [Tailscale](https://tailscale.com) (plan personal gratis; solo tus dispositivos pueden entrar):

1. Instala Tailscale en el Mac (App Store) e inicia sesión.
2. Vuelve a ejecutar el instalador de RadarNews: activa el acceso seguro solo (`tailscale serve --bg 4700`).
3. En el Mac: **⚙︎ Ajustes → iPhone y iPad** muestra la dirección `https://…ts.net` y un código QR.
4. En el iPhone o el iPad: instala Tailscale con la misma cuenta, escanea el QR, y en Safari pulsa **Compartir → Añadir a pantalla de inicio**.
5. Abre RadarNews desde su icono → **⚙︎ Ajustes → Notificaciones → Activar** (iOS/iPadOS 16.4 o posterior).

Al volver a la app desde segundo plano se pone al día sola.

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
