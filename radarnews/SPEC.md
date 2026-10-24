# RadarNews — Especificación del producto

> Terminal de noticias financieras personal que monitoriza fuentes de bancos centrales, agencias y análisis para clasificar la fuerza narrativa de 8 divisas en tiempo real.

## 1. Visión

Un terminal privado (estilo Bloomberg simplificado, pensado para una mesa macro) que:

1. **Agrega** titulares de mercado desde canales de breaking, feeds oficiales de bancos centrales y fuentes de análisis.
2. **Filtra** el ruido: solo entra lo relevante para el macro/divisas.
3. **Clasifica** la fuerza narrativa de cada divisa de −100 a +100 con dos motores (Agente por reglas + Gemini), **según noticias, no precios**.
4. **Sigue el calendario económico de la semana** y avisa de los datos de alto impacto.
5. **Alerta** al usuario de lo importante, dentro de la app y por push — **nunca por email**.

El usuario no ve gráficos de precios. Ve la cinta, el ranking, el calendario y entiende *por qué* se mueve cada divisa.

## 2. Universo de divisas

8 divisas, sin excepciones:

| Divisa | Banco central | Keywords base |
|--------|---------------|---------------|
| USD | Fed | dollar, fed, fomc, powell, treasury, payrolls |
| EUR | BCE | euro, ecb, lagarde, eurozone, germany… |
| GBP | BoE | pound, sterling, boe, bailey, uk |
| JPY | BoJ | yen, boj, ueda, japan |
| CHF | SNB | franc, snb, swiss |
| CAD | BoC | loonie, boc, canada |
| AUD | RBA | aussie, rba, australia |
| NZD | RBNZ | kiwi, rbnz, new zealand |

## 3. Fuentes de noticias

### 3.1 Núcleo de breaking — activo

| Fuente | Tipo | Canal | Estado |
|--------|------|-------|--------|
| **FinancialJuice** | breaking | Telegram público `t.me/s/FinancialJuice` | ✅ Activo. Corazón del terminal: datos con formato ACTUAL (FORECAST, PREVIOUS), headlines de agencia y geopolítica (incluidos los mensajes de Trump en Truth Social). Ventana: 3 días. El canal público puede ir algo por detrás del plan de pago del usuario. |

### 3.2 Fuentes oficiales — activas

Feeds RSS públicos de bancos centrales. Ventana: 30 días.

| Fuente | URL | Estado |
|--------|-----|--------|
| **Fed** | federalreserve.gov/feeds/press_all.xml | ✅ Activa |
| **BCE** | ecb.europa.eu/rss/press.html | ✅ Activa |
| **BoE** | bankofengland.co.uk/rss/news | ✅ Activa |
| **BoJ** | boj.or.jp/en/rss/whatsnew.xml | ✅ Activa |
| **BoC** | bankofcanada.ca/content_type/press-releases/feed/ | ✅ Activa |
| **RBA** | rba.gov.au/rss/rss-cb-media-releases.xml | ✅ Conectada, publica muy poco. No es un fallo. |
| **RBNZ / SNB / BIS / FMI** | — | ⏳ Previstos para ampliar cobertura oficial. |

### 3.3 Agencias y análisis — activas

Ventana: 3 días. Solo el titular cuenta para detección y puntuación (las entradillas mencionan muchas divisas de pasada).

| Fuente | Canal | Estado |
|--------|-------|--------|
| **InvestingLive** (antes ForexLive) | Telegram público `t.me/s/InvestingLiveNews` (titular del enlace) | ✅ Activa. Su web bloquea servidores; el espejo de Telegram es un feed con retraso. |
| **Financial Times** | RSS públicos: global-economy, markets, currencies | ✅ Activa. Solo titulares; sin cuenta. |

### 3.4 Calendario económico — activo

| Fuente | Canal | Uso |
|--------|-------|-----|
| **ForexFactory** | `nfs.faireconomy.media/ff_calendar_thisweek.json` | Solo la semana en curso, 8 divisas. Se refresca cada hora. |

### 3.5 Fuentes descartadas (verificado, no reintentar)

| Fuente | Motivo |
|--------|--------|
| **DeItaone (Walter Bloomberg)** | Cuenta personal, sin feed público accesible. |
| **FirstSquawk** | Cuenta personal, sin feed público accesible. |
| **ZeroHedge (Telegram)** | Canal suplantador (FAKE). |
| **Reuters (vía Google News)** | Google News bloquea el acceso desde el servidor. |
| **WSJ** | Feed congelado en pruebas. |
| **Bloomberg.com** | Suscripción web sin API; automatizar el login incumpliría sus condiciones. |
| **Truth Social** | Sin credenciales; los mensajes de Trump llegan vía FinancialJuice. |
| **MarketWatch, FXStreet, Investing.com, Cinco Días** | Medios generales/populares: excluidos por decisión de diseño (ruido). |

## 4. Pipeline de ingesta (`refreshFeed`)

1. **Descarga en paralelo** todos los canales, timeout de 15 s por fuente.
2. **Parsea** cada canal a elementos crudos {texto, url, fecha}.
3. **Filtra por frescura**: 3 días breaking/agencias, 30 días oficiales.
4. **Filtra por relevancia**:
   - Oficiales: solo política monetaria/mercado; excluye ruido institucional (museos, billetes, premios, subcomités, nombramientos…).
   - Breaking/agencias: pasa si menciona una divisa del universo, contiene un dato macro o es un BREAKING real.
5. **Enriquece**: divisas, impacto 1–5, categoría (dato_macro, banco_central, geopolitica, mercado, analisis, otro), ACTUAL/FORECAST/PREVIOUS (formato FinancialJuice, "47.7 vs 51.3", "2.1% (expected 2.1%)"). Subastas = mercado; previews y resúmenes = análisis.
6. **Enlaza con el calendario**: un dato se asocia a su evento de la semana (misma divisa, ±30 min); hereda la previsión y el impacto (Alto ⇒ ≥4).
7. **Deduplica** por huella textual.
8. **Inserta** máx. 60 por ciclo, repartidos por turnos entre fuentes para que ninguna acapare el cupo.
9. **Genera alertas** de titulares nuevos (≤12 h) con impacto ≥4 (o breaking impacto ≥3 con divisa del universo). Una publicación de datos genera **una sola alerta por divisa y ventana de 15 min**, con el titular más completo.
10. Devuelve un **informe de salud por fuente**.

Frecuencia: cada 5 minutos + botón ACTUALIZAR.

## 5. Clasificación (`classifyCurrencies`) — doble motor

Dos motores puntúan en cada lote, cada uno con su propio historial:

- **Agente** (reglas, siempre activo, gratis): sorpresa de datos vs previsión, tono hawkish/dovish atribuido al banco nombrado (con negaciones: "doesn't hike" = dovish), riesgo político, intervención, flujos de refugio en riesgo geopolítico severo. Decaimiento temporal (vida media 36 h breaking, 10 días oficiales).
- **Gemini** (nivel gratuito de Google AI Studio, `GEMINI_API_KEY`): mismo prompt y reglas del documento. Si falla, el terminal sigue con el Agente.

Reglas comunes (aplicadas también a la salida del modelo):
1. Solo titulares; nada de precios.
2. Prohibido devolver 0 a todas o puntuaciones idénticas.
3. Evidencia débil ⇒ rango −40…+40.
4. Hawkish o dato fuerte = positivo; dovish o dato débil = negativo.
5. Máx. 3 catalizadores por divisa, < 60 caracteres, en español.
6. `bias`: alcista > 20, bajista < −20, si no neutral.
7. `regime_note`: frase corta si cambia algún régimen.

**Consenso**: media de ambos motores; se marca **DIVERGENCIA** cuando discrepan en el sesgo o en ≥ 40 puntos.

**Alertas del clasificador (por motor)**:
- `cambio_regimen` (alto): cambia el sesgo de una divisa.
- `cambio_ranking`: nuevo líder o nuevo farolillo con |score| ≥ 15 (alto), o una divisa que se mueve ≥ 2 puestos con ≥ 10 puntos de cambio (medio). Las recolocaciones dentro del bloque neutral no alertan.

## 6. Modelo de datos

- **NewsItem**: title, body, source, source_type (`breaking|oficial|agencia|local`), url, published_at, currencies[], impact, category, actual/forecast/previous, calendar_title, fingerprint, alert_created.
- **CurrencyScore**: currency, score, bias, drivers[], rationale, rank, batch_id, regime_note, engine (`agente|gemini`), snapshot_at.
- **Alert**: title, body, level (`critico|alto|medio`), alert_type (`breaking|dato_macro|cambio_regimen|cambio_ranking|calendario|titular`), currency, news_item_id, is_read, occurred_at.
- **CalendarEvent**: title, currency, event_at, impact (`High|Medium|Low|Holiday`), forecast, previous, actual (enlazado desde la cinta), prealerted.

## 7. Interfaz (Terminal)

Estética institucional y sobria: grafito oscuro, Inter para texto y JetBrains Mono para cifras; verde y rojo solo para dirección, ámbar para breaking y el próximo dato. Icono propio estilo macOS (radar). Pensada para pantalla de Mac y adaptable a iPhone.

- **Cabecera**: icono y nombre, relojes de sesión (Sídney, Tokio, Londres, Nueva York; abierta resaltada), estado "En vivo · hace X" (ámbar al sincronizar, rojo si falla), campana, actualizar y ⚙︎ Ajustes.
- **Cinta** (columna principal): hora, titular, y debajo Breaking/Crítico, fuente, categoría, divisas, Act/Est/Prev coloreado según sorpresa y evento de agenda enlazado. Separadores por día. Filtros: Todo / Breaking / Datos / Bancos / Geo, y selector de divisa.
- **Ranking de divisas**: Consenso / Gemini / Agente; puesto 1–8, barra bipolar −100/+100 (marcas de cada motor en Consenso), score y cambio de puesto; sesgo y primer catalizador. Al pulsar: catalizadores por motor y gráfico de 24 h. Nota de régimen y marca de divergencia.
- **Cruces**: los cuatro cruces con mayor diferencial y la matriz 8×8 (fila − columna) plegable.
- **Agenda de la semana**: tarjeta del próximo dato (alto o, si no queda, medio) con cuenta atrás; lista agrupada por día con impacto por color, Act/Est/Prev; se coloca sola en el próximo evento. Filtros Alto / Alto + Medio / Todo.
- **Barra de estado**: "N/11 fuentes operativas · Agenda X eventos" (abre el detalle) y motores activos.
- **Alertas**: badge (también en el icono del Dock), últimas 25, nivel por color, marcar todas leídas, invitación a activar push.
- **Ajustes**: Inteligencia artificial (pegar, probar y guardar la clave de Gemini; se guarda en `data/settings.json` con permisos 600 y se muestra enmascarada), Notificaciones (activar, probar, dispositivos suscritos), Fuentes (estado por fuente), Acerca de (especificación y atajos).
- **Atajos**: R actualizar, A alertas, 1–5 filtros, `,` ajustes, Esc cerrar.

### Dispositivos

- **Mac** (≥ 1100 px): tres columnas; con poca altura (MacBook Air) el ranking se compacta para mostrar las 8 divisas.
- **iPad**: horizontal, tres columnas; vertical, dos (Cinta | Ranking sobre Agenda). Objetivos táctiles más grandes y sin estados *hover* pegados.
- **iPhone** (≤ 760 px, también iPad en Split View): una sección a la vez con barra inferior Ranking / Cinta / Agenda / Alertas (con badge), cabecera compacta, áreas seguras (notch e indicador de inicio), ajustes a pantalla completa y campos de 16 px para que iOS no haga zoom.
- **Acceso remoto**: Tailscale Serve publica `https://<mac>.ts.net` solo dentro de la red privada del usuario; Ajustes › iPhone y iPad muestra la URL y un código QR, o los pasos que faltan. En iOS fuera de la pantalla de inicio se explica cómo instalarla para activar el push.
- Al volver del segundo plano la app recarga el estado y reconecta el flujo en vivo.

### Despliegue

- **Recomendado: servidor en la nube 24/7** (`cloud/install.sh`, Debian/Ubuntu; p. ej. Google Cloud `e2-micro` Free Tier): servicio systemd con usuario propio y sistema de archivos protegido, datos en `/var/lib/radarnews`, Tailscale Serve para HTTPS privado. Los iPhone, el iPad y el Mac son clientes independientes: ninguno depende de otro para recibir alertas.
- Mac en modo cliente: `RADARNEWS_URL=https://… macos/install.sh` crea `RadarNews.app` apuntando al servidor y retira el servidor local.
- Respuestas gzip, ETag en estáticos y refresco cada 5 min solo con la app visible, para caber en 1 GB/mes de salida.

### Instalación

Un solo comando en Terminal (`macos/install.sh`): Node.js 22 portátil verificado por SHA-256 si falta, servicio launchd en `localhost:4700` que arranca al iniciar sesión, y `~/Applications/RadarNews.app` con icono. Reejecutarlo actualiza sin perder datos; `uninstall.sh` lo retira.

## 8. Alertas — política estricta

- **Solo in-app + push**. **Sin correos, ninguna excepción.**
- Push web estándar (VAPID): funciona en Safari para Mac (web app en el Dock) y en iPhone (web app en la pantalla de inicio, iOS 16.4+), sin cuenta de desarrollador de Apple.
- Disparan alerta: impacto ≥ 4, breaking impacto ≥ 3 con divisa, datos de alto impacto **15 min antes** de su publicación, cambios de régimen y de ranking de cada motor.
- Máx. 4 push por ciclo; el resto se resume en una sola notificación.
- **Todos los dispositivos** suscritos reciben cada alerta en paralelo. Cada uno guarda nombre (iPhone · app, Mac · Chrome…), última entrega y último error; se gestionan en Ajustes › Notificaciones. Las suscripciones caducadas (404/410) se eliminan solas y cada dispositivo renueva la suya al abrir la app.
- El push lleva el número de no leídas para el badge del icono (iOS 16.4+, macOS).
- En macOS el servidor mantiene el Mac despierto (`caffeinate -i -s -w <pid>`) mientras funciona; si deja de sincronizar más de 15 min la app lo indica en todos los dispositivos.
- **Máximo 2 resúmenes al día** fuera del breaking (pendiente).

## 9. Fases

### Fase 1 — entregada ✅
Ingesta (FinancialJuice + 6 bancos centrales + InvestingLive + FT), calendario semanal con pre-alertas y enlace de datos, doble motor con consenso y alertas de ranking/régimen, terminal institucional, push web, sincronización cada 5 min.

### Fase 2 — pendiente
- RBNZ, SNB, BIS (discursos), FMI.
- Resúmenes diarios (máx. 2/día) por push.
- App nativa (requeriría cuenta de desarrollador de Apple).

## 10. Decisiones de diseño inquebrantables

1. La clasificación es **narrativa, no de precios**.
2. **Solo fuentes vivas**: un canal congelado o muerto se descarta.
3. **Sin medios generales/populares**.
4. **Alertas estrictas**: silencio salvo lo que importa; email prohibido.
5. **Deduplicación obligatoria**.
6. Todo el texto visible al usuario, en **español**; los titulares en su idioma original.
