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

Estética de terminal financiero: fondo oscuro, JetBrains Mono para datos, verde esmeralda para acción, rojo para negativo, ámbar para alertas. Pensada para pantalla de Mac.

- **Cabecera**: relojes de sesión (Sídney, Tokio, Londres, Nueva York, con abierta/cerrada), última y próxima sincronización, estado de los motores, ESPECIFICACIÓN, campana y ACTUALIZAR.
- **Cinta** (columna principal): hora, BREAKING (impacto ≥ 4), fuente, categoría, titular, ACT/EST/PREV coloreado según sorpresa, evento de calendario enlazado, divisas, impacto. Filtros: Todas / Breaking / Datos / Bancos / Geo, y por divisa.
- **Fuerza relativa**: pestañas Consenso / Gemini / Agente; ranking 1–8 con flecha de cambio de puesto, barra bipolar −100/+100 (marcas de cada motor en Consenso), score, mini-gráfico 24 h, sesgo y primer catalizador; detalle al pulsar. Nota de régimen.
- **Diferencial narrativo**: matriz 8×8 (fila − columna) y los cuatro cruces con mayor diferencial.
- **Calendario semanal**: agrupado por día, impacto por color, ACT/EST/PREV, próximo evento de alto impacto con cuenta atrás. Filtros Alto / Alto+Medio / Todos.
- **Barra de estado**: salud de cada fuente y del calendario; atajos de teclado (R, A, 1–5, Esc).
- **Centro de alertas**: badge, últimas 25, nivel por color, marcar todas leídas, activar notificaciones.

## 8. Alertas — política estricta

- **Solo in-app + push**. **Sin correos, ninguna excepción.**
- Push web estándar (VAPID): funciona en Safari para Mac (web app en el Dock) y en iPhone (web app en la pantalla de inicio, iOS 16.4+), sin cuenta de desarrollador de Apple.
- Disparan alerta: impacto ≥ 4, breaking impacto ≥ 3 con divisa, datos de alto impacto **15 min antes** de su publicación, cambios de régimen y de ranking de cada motor.
- Máx. 4 push por ciclo; el resto se resume en una sola notificación.
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
