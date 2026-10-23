# RadarNews — Especificación del producto

> Terminal de noticias financieras personal que monitoriza fuentes de bancos centrales, agencias y análisis para clasificar la fuerza narrativa de 8 divisas en tiempo real, con marco Mosler / MMT.

## 1. Visión

Un terminal privado (estilo Bloomberg simplificado, pensado para una mesa macro) que:

1. **Agrega** titulares de mercado desde canales de breaking, feeds oficiales de bancos centrales y fuentes de análisis.
2. **Filtra** el ruido: solo entra lo relevante para el macro/divisas.
3. **Clasifica** la fuerza narrativa de cada divisa de −100 a +100 con dos motores (Agente por reglas + Gemini 3.8 Flash), **según noticias, no precios**, con Soft Currency Economics (Mosler).
4. **Sigue el calendario económico de la semana** y avisa de los datos de alto impacto.
5. **Alerta** al usuario de lo importante, dentro de la app y por push — **nunca por email**.

El usuario no ve gráficos de precios como señal. Ve la cinta, el ranking, el calendario y entiende *por qué* se mueve cada divisa. Lenguaje de mesa: **Soporte / Presión / Neutral / N/D**. Prohibido “long”, “short”, “sesgo largo/corto”, “vía libre operativa”.

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

Una divisa **sin titulares propios** no se rankea (`rank: null`, etiqueta **N/D · Sin evidencia**). No hereda narrativa de otra región.

## 3. Fuentes de noticias

Las fuentes que ya estaban en producción **no se quitan**.

### 3.1 Núcleo de breaking — activo

| Fuente | Tipo | Canal | Estado |
|--------|------|-------|--------|
| **FinancialJuice** | breaking | Telegram público `t.me/s/FinancialJuice` | Activo. Datos ACTUAL/FORECAST/PREVIOUS, agencia, geopolítica y **posts de Trump en Truth Social** (vía FJ; no hay API pública de Truth Social). Ventana: 3 días. |

### 3.2 Oficiales G3/G8 ya activos

| Fuente | URL |
|--------|-----|
| **Fed** | federalreserve.gov/feeds/press_all.xml |
| **BCE** | ecb.europa.eu/rss/press.html |
| **BoE** | bankofengland.co.uk/rss/news |
| **BoJ** | boj.or.jp/en/rss/whatsnew.xml |
| **BoC** | bankofcanada.ca/content_type/press-releases/feed/ |
| **RBA** | rba.gov.au/rss/rss-cb-media-releases.xml |

### 3.3 Oficiales NZD (añadidos)

| # | Fuente | Para qué | Canal |
|---|--------|----------|-------|
| 1 | **RBNZ news** | OCR, MPS, FSR, MPC | https://www.rbnz.govt.nz/feeds/news |
| 2 | **Treasury / NZDM** | Emisión, PREFU, tenders (IRMA/NFA) | https://www.treasury.govt.nz/feeds/news |
| 3 | **Stats NZ** | CPI, labour, GDP | https://www.stats.govt.nz/news/ |

Filtro: fuera cyber, TSB, reclutamiento, visitas regionales. Dentro: OCR, MPS, tenders, CPI, employment, PREFU.

### 3.4 Oficiales CHF (añadidos)

| # | Fuente | Para qué | Canal |
|---|--------|----------|-------|
| 1 | **SNB** comunicados / mopo / discursos / ad hoc | El banco | https://www.snb.ch/public/rss/en/pressrel · `/mopo` · `/speeches` · `/adhoc` |
| 2 | **SNB Bills** | Canal operacional Mosler | https://www.snb.ch/public/rss/en/snbbbills |
| 3 | **SNB ciclo** | Economía real | https://www.snb.ch/public/rss/en/buscycletrends |
| 4 | **SECO** | PIB, mercado laboral, previsiones | https://www.seco.admin.ch/en/press-releases |
| 5 | **BIS** press + discursos de bancos centrales | Contexto G8 / CHF | bis.org/doclist/all_pressrels.rss · cbspeeches.rss |

Filtro: fuera premios (Carl Menger), reclutamiento, divulgación. Dentro: assessment, BOP, profit distribution, speeches de política.

### 3.5 Agencias y análisis

| Fuente | Canal |
|--------|-------|
| **InvestingLive** | `t.me/s/InvestingLiveNews` |
| **Financial Times** | RSS global-economy, markets, currencies |
| **Negocios TV** | `t.me/s/negociostv` (solo G8/macro/geo; se descarta política doméstica ES sin divisa) |
| **Brújula de Mercados** | Telegram público `t.me/s/BrujulaDeMercados` (confirmado). Slug override: `RADARNEWS_BURBUJA_CHANNEL`. |

### 3.6 Calendario

| Fuente | Canal |
|--------|-------|
| **ForexFactory** | `nfs.faireconomy.media/ff_calendar_thisweek.json` — semana en curso, 8 divisas, cada hora vía el ciclo de 5 min. |

### 3.7 Descartadas (no reintentar)

DeItaone, FirstSquawk, ZeroHedge (fake), Reuters vía Google News, WSJ congelado, Bloomberg.com (ToS), Truth Social directo (sin credenciales; llega por FJ), MarketWatch, FXStreet, Investing.com, Cinco Días.

## 4. Pipeline de ingesta (`refreshFeed`)

1. Descarga en paralelo, timeout 15 s.
2. Parsea RSS / Telegram público / HTML de comunicados.
3. Frescura: 3 días breaking/agencias, 30 días oficiales.
4. Relevancia: oficiales solo política monetaria/mercado; breaking si divisa, dato o BREAKING real.
5. Enriquece: divisas, impacto 1–5, categoría, ACTUAL/FORECAST/PREVIOUS, z-score heurístico.
6. Enlaza calendario ±30 min.
7. Deduplica por fingerprint SHA-1.
8. Inserta máx. 60 por ciclo, round-robin entre fuentes.
9. Alertas de titulares nuevos (≤12 h) impacto ≥4 (o geo ≥3). Una publicación de datos = una alerta por divisa y 15 min.
10. Informe de salud por fuente.

Frecuencia: 5 min; 15 s en ventana turbo (±5 min de un High).

## 5. Clasificación — Mosler / Soft Currency Economics

Dos motores, historial propio:

- **Agente** (reglas, keyless): canales `DATA_REAL`, `RELATIVE_PRICE`, `POLICY_PRICE`, `FISCAL_NFA`, `RISK_GEO`, `TRADE_EXTERNAL`, `OPERATIONAL`.
- **Gemini 3.8 Flash** (AI Studio free tier): el mismo contrato; cada driver cita fingerprint; si falla, el terminal sigue con el Agente (consenso degradado).

Reglas Mosler (ambos):

1. Solo titulares aportados. Prohibido arrastre regional.
2. **CPI alto + economía débil/insostenible no es soporte** (canal precio relativo; techo 0 en ese catalizador).
3. El overnight es el **precio** del dinero. Un hike en cost-push **no suma**.
4. El déficit no financia gasto; la emisión drena reservas (IRMA). Déficit/downgrade **no es presión automática**.
5. Interés sobre pasivos públicos = ingreso del no-gobierno.
6. Sin evidencia ⇒ score 0, N/D, `rank: null`. No alerta de régimen.
7. Evidencia débil ⇒ −40…+40. Máx. 3 drivers, < 60 caracteres, español.
8. `bias` interno: alcista > 20, bajista < −20; UI: Soporte / Presión / Neutral / N/D.
9. Structural = 72 h (oficiales hasta 10 d, vida media 36 h / 10 d). Impulse = 3 h.
10. Refugio severo: USD/JPY/CHF soporte; AUD/NZD/CAD presión.

**Consenso**: media solo con evidencia; DIVERGENCIA si sesgo distinto, un motor en N/D, o ≥ 35 puntos.

## 6. Interfaz

Grafito, Inter + JetBrains Mono. Verde/rojo solo dirección. PWA: Mac Dock, iPhone/iPad Home Screen. Push VAPID a **todos** los dispositivos a la vez, badge de no leídas. Tailscale Serve (red privada), no Funnel público.

## 7. Alertas

Solo in-app + push. Sin correo. Breaking, dato, agenda −15 min High, cambio de ranking/régimen **con evidencia**. Máx. 4 push por ciclo.

## 8. Despliegue

Datos en `RADARNEWS_DATA_DIR` (prod: `/var/lib/radarnews`). Bind `127.0.0.1:4700` + Tailscale Serve. `cloud/install.sh` systemd.

## 9. Decisiones inquebrantables

1. Narrativa, no precios como señal.
2. Solo fuentes vivas.
3. Sin medios populares.
4. Alertas estrictas; email prohibido.
5. Deduplicación.
6. UI en español; titulares en idioma original.
7. Mosler: CPI+debilidad ≠ soporte.
8. Sin lenguaje de ejecución.
