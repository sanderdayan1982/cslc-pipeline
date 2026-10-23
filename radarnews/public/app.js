const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
const BANK = { USD: 'Fed', EUR: 'BCE', GBP: 'BoE', JPY: 'BoJ', CHF: 'SNB', CAD: 'BoC', AUD: 'RBA', NZD: 'RBNZ' };
// Market quoting convention: the higher-priority currency is the base of the pair.
const PAIR_PRIORITY = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];
const CATEGORY_LABEL = { dato_macro: 'Dato', banco_central: 'Banco central', geopolitica: 'Geopolítica', mercado: 'Mercado', analisis: 'Análisis', otro: 'General' };
const LEVEL_LABEL = { critico: 'Crítico', alto: 'Alto', medio: 'Medio' };
const TYPE_LABEL = { breaking: 'Breaking', dato_macro: 'Dato macro', cambio_regimen: 'Cambio de régimen', cambio_ranking: 'Cambio de ranking', calendario: 'Agenda', titular: 'Titular' };
const SOURCE_TYPE = { breaking: 'Breaking', oficial: 'Oficial', agencia: 'Agencia' };
const SESSIONS = [
  { city: 'Sídney', tz: 'Australia/Sydney', open: 7, close: 16 },
  { city: 'Tokio', tz: 'Asia/Tokyo', open: 9, close: 18 },
  { city: 'Londres', tz: 'Europe/London', open: 8, close: 17 },
  { city: 'Nueva York', tz: 'America/New_York', open: 8, close: 17 },
];
const INVERTED = /unemployment|jobless|claims/i;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const m = /-?\d+(?:\.\d+)?/.exec(String(v ?? '').replace(/,/g, '')); return m ? Number(m[0]) : null; };
const biasFor = (s) => (s > 20 ? 'alcista' : s < -20 ? 'bajista' : 'neutral');
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

const ui = {
  data: null,
  filter: 'all',
  ccy: null,
  engine: localStorage.getItem('rn-engine') || 'consenso',
  calImpact: localStorage.getItem('rn-cal') || 'Medium',
  open: new Set(),
  knownNews: new Set(),
  pushOn: localStorage.getItem('rn-push') === '1',
  swReg: null,
  syncing: false,
  view: localStorage.getItem('rn-view') || 'board',
  es: null,
};

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_STANDALONE = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const phone = window.matchMedia('(max-width: 760px)');

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (iso) => { const t = new Date(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }); return t[0].toUpperCase() + t.slice(1); };
const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();
const dayKey = (iso) => new Date(iso).toDateString();

function relTime(iso) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

function countdown(ms) {
  if (ms <= 0) return '0:00';
  const t = Math.round(ms / 1000);
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (d) return `${d}d ${h}h`;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`;
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------- header

function renderSessions() {
  const now = new Date();
  $('#sessions').innerHTML = SESSIONS.map((s) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: s.tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
      .formatToParts(now).map((p) => [p.type, p.value]));
    const h = Number(parts.hour) % 24;
    const open = !['Sat', 'Sun'].includes(parts.weekday) && h >= s.open && h < s.close;
    return `<div class="session ${open ? 'open' : ''}" title="${s.city}: sesión ${open ? 'abierta' : 'cerrada'}"><span class="d"></span>${s.city}<span class="clock">${parts.hour}:${parts.minute}</span></div>`;
  }).join('');
  renderLive();
  renderNextEvent();
}

function renderLive() {
  const d = ui.data;
  const el = $('#live');
  if (!d) return;
  const err = d.error;
  el.classList.toggle('syncing', ui.syncing);
  el.classList.toggle('err', !!err && !ui.syncing);
  const last = d.last_sync?.finished_at;
  $('#live-text').textContent = ui.syncing ? 'Sincronizando…' : err ? 'Error de sincronización' : last ? `En vivo · ${relTime(last)}` : 'En vivo';
  el.title = `${last ? `Última sincronización ${new Date(last).toLocaleTimeString('es-ES')}` : 'Sin sincronizar'} · próxima en ${countdown(Date.parse(d.next_sync_at) - Date.now())}`;
}

function setSyncing(on) {
  ui.syncing = on;
  $('#refresh').disabled = on;
  $('#refresh').classList.toggle('loading', on);
  renderLive();
}

function renderStatus() {
  const d = ui.data;
  const band = $('#error-band');
  band.hidden = !d.error;
  band.textContent = d.error ? `Error de sincronización: ${d.error}` : '';
  setSyncing(d.syncing);
}

// ---------------------------------------------------------------- tape

function macroHtml(n) {
  if (!n.actual) return '';
  const a = num(n.actual);
  const ref = num(n.forecast) ?? num(n.previous);
  let cls = '';
  if (a != null && ref != null && a !== ref) {
    const up = a > ref;
    cls = (INVERTED.test(n.title) ? !up : up) ? 'up' : 'down';
  }
  return `<span class="macro">Act <b class="${cls}">${esc(n.actual)}</b>${n.forecast ? ` · Est <b>${esc(n.forecast)}</b>` : ''}${n.previous ? ` · Prev <b>${esc(n.previous)}</b>` : ''}</span>`;
}

function renderCcyFilter() {
  const sel = $('#ccy-filter');
  if (!sel.options.length) {
    sel.innerHTML = '<option value="">Todas las divisas</option>' + CURRENCIES.map((c) => `<option value="${c}">${c}</option>`).join('');
  }
  sel.value = ui.ccy || '';
}

function renderTape() {
  const d = ui.data;
  let items = d.news;
  if (ui.filter === 'breaking') items = items.filter((n) => n.impact >= 4);
  else if (ui.filter !== 'all') items = items.filter((n) => n.category === ui.filter);
  if (ui.ccy) items = items.filter((n) => n.currencies.includes(ui.ccy));

  const el = $('#tape');
  if (!d.news.length) {
    el.innerHTML = '<div class="state-msg"><strong>Aún no hay titulares</strong>Se cargan en la primera sincronización.<button class="btn primary" data-action="refresh">Actualizar ahora</button></div>';
    return;
  }
  if (!items.length) {
    el.innerHTML = '<div class="state-msg">No hay titulares con este filtro.</div>';
    return;
  }
  const firstLoad = ui.knownNews.size === 0;
  let lastDay = '';
  el.innerHTML = items.slice(0, 250).map((n) => {
    let sep = '';
    const k = dayKey(n.published_at);
    if (k !== lastDay) {
      if (lastDay || !isToday(n.published_at)) sep = `<div class="day-sep">${isToday(n.published_at) ? 'Hoy' : fmtDay(n.published_at)}</div>`;
      lastDay = k;
    }
    const cls = [n.impact >= 5 ? 'critical' : n.impact >= 4 ? 'hot' : '', !firstLoad && !ui.knownNews.has(n.id) ? 'fresh' : ''].join(' ');
    const meta = [
      n.impact >= 4 ? `<span class="tag-hot">${n.impact >= 5 ? 'Crítico' : 'Breaking'}</span>` : '',
      `<span>${esc(n.source)}</span>`,
      `<span>${CATEGORY_LABEL[n.category] || n.category}</span>`,
      n.currencies.length ? `<span class="ccy">${n.currencies.join(' · ')}</span>` : '',
      macroHtml(n),
      n.calendar_title ? `<span class="cal-link" title="Enlazado con la agenda">◆ ${esc(n.calendar_title)}</span>` : '',
    ].filter(Boolean).join('');
    return `${sep}<div class="row ${cls}">
      <div class="time">${fmtTime(n.published_at)}</div>
      <div class="headline"><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="meta">${meta}</div></div>
    </div>`;
  }).join('');
  for (const n of d.news) ui.knownNews.add(n.id);
}

// ---------------------------------------------------------------- board

function engineView(engineId) {
  const engines = ui.data.engines.filter((e) => e.rows.length);
  if (!engines.length) return null;
  if (engineId !== 'consenso' || engines.length === 1) {
    const e = engines.find((x) => x.engine === engineId) || engines[engines.length - 1];
    const rows = e.rows.map((r) => {
      const h = e.history[r.currency] || [];
      return { ...r, prevRank: h.length > 1 ? h[h.length - 2][2] : null, series: h.map((p) => p[1]) };
    });
    return { label: e.label, snapshot_at: e.snapshot_at, regime_note: e.regime_note, rows, engines };
  }

  const scoreMaps = engines.map((e) => new Map(e.rows.map((r) => [r.currency, r])));
  const byTime = new Map();
  for (const e of engines) {
    for (const [ccy, pts] of Object.entries(e.history)) {
      for (const [t, s] of pts) {
        const k = `${ccy}|${t}`;
        const v = byTime.get(k) || { ccy, t, sum: 0, n: 0 };
        v.sum += s; v.n += 1; byTime.set(k, v);
      }
    }
  }
  const series = {};
  for (const v of [...byTime.values()].filter((x) => x.n === engines.length).sort((a, b) => a.t.localeCompare(b.t))) {
    (series[v.ccy] ||= []).push(Math.round(v.sum / v.n));
  }
  const prevScores = Object.fromEntries(CURRENCIES.map((c) => [c, series[c]?.length > 1 ? series[c][series[c].length - 2] : null]));
  const prevRanks = Object.fromEntries([...CURRENCIES].filter((c) => prevScores[c] != null)
    .sort((a, b) => prevScores[b] - prevScores[a]).map((c, i) => [c, i + 1]));

  const rows = CURRENCIES.map((c) => {
    const parts = scoreMaps.map((m) => m.get(c)).filter(Boolean);
    const score = Math.round(parts.reduce((s, r) => s + r.score, 0) / parts.length);
    const diverge = parts.length > 1 && (new Set(parts.map((p) => p.bias)).size > 1 || Math.abs(parts[0].score - parts[1].score) >= 40);
    return {
      currency: c, score, bias: biasFor(score), diverge,
      drivers: [...new Set(parts.flatMap((p) => p.drivers))].slice(0, 3),
      perEngine: engines.map((e, i) => ({ label: e.label, row: scoreMaps[i].get(c) })),
      prevRank: prevRanks[c] ?? null,
      series: series[c] || [],
    };
  }).sort((a, b) => b.score - a.score).map((r, i) => ({ ...r, rank: i + 1 }));
  const notes = engines.map((e) => e.regime_note && `${e.label}: ${e.regime_note}`).filter(Boolean).join(' · ');
  return { label: 'Consenso', snapshot_at: engines[0].snapshot_at, regime_note: notes, rows, engines, consensus: true };
}

function sparkline(series) {
  if (!series || series.length < 2) return '';
  const pts = series.slice(-48);
  const w = 120; const h = 22;
  const x = (i) => (i / (pts.length - 1)) * w;
  const y = (v) => h / 2 - (v / 100) * (h / 2 - 1);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  const color = last > 0 ? '#22c55e' : last < 0 ? '#ef4444' : '#7c8794';
  return `<div class="spark-row"><svg class="spark" viewBox="0 0 ${w} ${h}"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="#2a323d"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>Últimas 24 h</div>`;
}

function renderEngineTabs() {
  const engines = ui.data.engines.filter((e) => e.rows.length);
  const tabs = engines.length > 1 ? [{ id: 'consenso', label: 'Consenso' }] : [];
  tabs.push(...engines.map((e) => ({ id: e.engine, label: e.label })));
  if (!tabs.some((t) => t.id === ui.engine) && tabs.length) ui.engine = tabs[0].id;
  $('#engine-tabs').innerHTML = tabs.map((t) => `<button data-engine="${t.id}" class="${t.id === ui.engine ? 'active' : ''}">${t.label}</button>`).join('');
}

const driversList = (drivers) => `<ul>${drivers.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>Sin catalizadores</li>'}</ul>`;

function renderBoard() {
  renderEngineTabs();
  $('#gemini-hint').hidden = !!ui.data.settings?.gemini?.configured || localStorage.getItem('rn-hide-gemini-hint') === '1';
  const view = engineView(ui.engine);
  const board = $('#board');
  if (!view) {
    board.innerHTML = '<li class="state-msg">Sin clasificación todavía. Se genera tras la primera sincronización.</li>';
    $('#matrix').innerHTML = '';
    $('#top-pairs').innerHTML = '';
    $('#batch-time').textContent = '';
    $('#divergence').textContent = '';
    return;
  }
  $('#batch-time').textContent = view.snapshot_at ? `${view.label} · actualizado ${fmtTime(view.snapshot_at)}` : '';
  const div = view.rows.filter((r) => r.diverge).map((r) => r.currency);
  $('#divergence').innerHTML = div.length ? `<span class="div-flag" title="Agente y Gemini discrepan en el sesgo o en más de 40 puntos">Divergencia: ${div.join(', ')}</span>` : '';

  board.innerHTML = view.rows.map((r) => {
    const w = Math.abs(r.score) / 2;
    const cls = r.score > 0 ? 'pos' : r.score < 0 ? 'neg' : 'zero';
    let delta = '<span class="delta"></span>';
    if (r.prevRank && r.prevRank !== r.rank) {
      const up = r.prevRank > r.rank;
      delta = `<span class="delta ${up ? 'up' : 'down'}" title="Antes #${r.prevRank}">${up ? '▲' : '▼'}${Math.abs(r.prevRank - r.rank)}</span>`;
    }
    const markers = view.consensus ? r.perEngine.filter((p) => p.row).map((p) => `<span class="other" title="${esc(p.label)}: ${signed(p.row.score)}" style="left:calc(${50 + p.row.score / 2}% - 1px)"></span>`).join('') : '';
    const detail = view.consensus
      ? r.perEngine.map((p) => (p.row ? `<h4>${esc(p.label)} · ${signed(p.row.score)} · ${p.row.bias}</h4>${driversList(p.row.drivers)}<div>${esc(p.row.rationale)}</div>` : '')).join('')
      : `${driversList(r.drivers)}<div>${esc(r.rationale || '')}</div>`;
    return `<li class="ccy-row ${ui.open.has(r.currency) ? 'open' : ''}" data-ccy="${r.currency}">
      <div class="ccy-line">
        <span class="rank">${r.rank}</span><span class="code">${r.currency}</span>
        <div class="bar"><span class="mid"></span><span class="fill ${cls}" style="width:${w}%"></span>${markers}</div>
        <span class="score ${cls}">${signed(r.score)}</span>${delta}
      </div>
      <div class="ccy-sub"><span class="bias ${r.bias}">${r.bias[0].toUpperCase() + r.bias.slice(1)}</span>${r.diverge ? '<span class="div-flag" title="Los motores discrepan">≠</span>' : ''}<span class="driver">${esc(r.drivers[0] || 'Sin catalizadores claros')}</span></div>
      <div class="ccy-detail">${detail}${sparkline(r.series)}</div>
    </li>`;
  }).join('');

  const regime = $('#regime');
  regime.hidden = !view.regime_note;
  regime.textContent = view.regime_note ? `Régimen · ${view.regime_note}` : '';
  renderMatrix(view.rows);
}

function cellColor(v) {
  const a = Math.min(1, Math.abs(v) / 120);
  return v > 0 ? `rgba(34,197,94,${0.06 + a * 0.5})` : v < 0 ? `rgba(239,68,68,${0.06 + a * 0.5})` : '#0a0d11';
}

function renderMatrix(rows) {
  const s = Object.fromEntries(rows.map((r) => [r.currency, r.score]));
  const order = rows.map((r) => r.currency);
  let html = '<span></span>' + order.map((c) => `<span class="h">${c}</span>`).join('');
  for (const a of order) {
    html += `<span class="rh">${a}</span>`;
    for (const b of order) {
      if (a === b) { html += '<span class="self">·</span>'; continue; }
      const v = s[a] - s[b];
      html += `<span style="background:${cellColor(v)}" title="${a} vs ${b}: ${signed(v)}">${signed(v)}</span>`;
    }
  }
  $('#matrix').innerHTML = html;

  const pairs = [];
  for (let i = 0; i < CURRENCIES.length; i++) {
    for (let j = i + 1; j < CURRENCIES.length; j++) {
      const [x, y] = [CURRENCIES[i], CURRENCIES[j]];
      const [base, quote] = PAIR_PRIORITY.indexOf(x) < PAIR_PRIORITY.indexOf(y) ? [x, y] : [y, x];
      pairs.push({ base, quote, v: s[base] - s[quote] });
    }
  }
  pairs.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  $('#top-pairs').innerHTML = pairs.slice(0, 4).map((p) => `<div class="pair">
      <div><b>${p.base}/${p.quote}</b><small>${p.v > 0 ? p.base : p.quote} más fuerte</small></div>
      <span class="${p.v > 0 ? 'up' : 'down'}">${p.v > 0 ? '▲' : '▼'} ${Math.abs(p.v)}</span>
    </div>`).join('');
}

// ---------------------------------------------------------------- agenda

function calFiltered() {
  const ev = ui.data.calendar;
  if (ui.calImpact === 'High') return ev.filter((e) => e.impact === 'High');
  if (ui.calImpact === 'Medium') return ev.filter((e) => e.impact === 'High' || e.impact === 'Medium' || e.impact === 'Holiday');
  return ev;
}

function renderCalendar() {
  for (const b of $$('#cal-filter button')) b.classList.toggle('active', b.dataset.impact === ui.calImpact);
  const events = calFiltered();
  const el = $('#calendar');
  if (!ui.data.calendar.length) {
    el.innerHTML = '<div class="cal-empty">La agenda de la semana aún no está disponible.</div>';
    renderNextEvent();
    return;
  }
  const now = Date.now();
  const upcoming = ui.data.calendar.filter((e) => Date.parse(e.event_at) > now);
  const nextHigh = upcoming.find((e) => e.impact === 'High') || upcoming.find((e) => e.impact === 'Medium');
  let html = '';
  let lastDay = '';
  let scrollTo = null;
  for (const e of events) {
    const k = dayKey(e.event_at);
    if (k !== lastDay) {
      html += `<div class="cal-day ${isToday(e.event_at) ? 'today' : ''}" ${isToday(e.event_at) ? 'id="cal-today"' : ''}>${fmtDay(e.event_at)}</div>`;
      lastDay = k;
    }
    const past = Date.parse(e.event_at) < now;
    if (!past && !scrollTo) scrollTo = e.id;
    let actCls = '';
    if (e.actual && e.forecast) {
      const a = num(e.actual); const f = num(e.forecast);
      if (a != null && f != null && a !== f) actCls = ((a > f) !== INVERTED.test(e.title)) ? 'up' : 'down';
    }
    const vals = [e.actual && `<span>Act <b class="${actCls}">${esc(e.actual)}</b></span>`, e.forecast && `<span>Est <b>${esc(e.forecast)}</b></span>`, e.previous && `<span>Prev <b>${esc(e.previous)}</b></span>`].filter(Boolean).join('');
    const impactLabel = { High: 'Alto', Medium: 'Medio', Low: 'Bajo', Holiday: 'Festivo' }[e.impact] || e.impact;
    html += `<div class="ev ${e.impact} ${past ? 'past' : ''} ${nextHigh && e.id === nextHigh.id ? 'next' : ''}" data-ev="${esc(e.id)}" title="Impacto ${impactLabel}">
      <span class="t">${e.impact === 'Holiday' ? 'Día' : fmtTime(e.event_at)}</span><span class="cur">${e.currency}</span>
      <div><div class="title">${esc(e.title)}</div>${vals ? `<div class="vals">${vals}</div>` : ''}</div>
    </div>`;
  }
  const first = !el.dataset.rendered;
  el.innerHTML = html || '<div class="cal-empty">Sin eventos para este filtro.</div>';
  if (first && scrollTo) {
    el.dataset.rendered = '1';
    const target = el.querySelector(`[data-ev="${CSS.escape(scrollTo)}"]`);
    if (target) el.scrollTop = Math.max(0, target.offsetTop - 80);
  }
  renderNextEvent();
}

function renderNextEvent() {
  const d = ui.data;
  const box = $('#next-event');
  if (!d) return;
  const upcoming = d.calendar.filter((e) => Date.parse(e.event_at) > Date.now());
  const next = upcoming.find((e) => e.impact === 'High') || upcoming.find((e) => e.impact === 'Medium');
  box.hidden = !d.calendar.length;
  if (!next) {
    box.innerHTML = '<div class="lbl">Próximo dato</div><div class="ttl"><span>Sin más datos relevantes esta semana</span></div>';
    return;
  }
  const when = isToday(next.event_at) ? `Hoy ${fmtTime(next.event_at)}` : `${new Date(next.event_at).toLocaleDateString('es-ES', { weekday: 'long' })} ${fmtTime(next.event_at)}`;
  box.innerHTML = `<div class="lbl">Próximo dato · impacto ${next.impact === 'High' ? 'alto' : 'medio'}</div>
    <div class="ttl"><span class="cur">${next.currency}</span><span>${esc(next.title)}</span></div>
    <div class="bottom"><span>${when}${next.forecast ? ` · Est ${esc(next.forecast)}` : ''}${next.previous ? ` · Prev ${esc(next.previous)}` : ''}</span><span class="cd">${countdown(Date.parse(next.event_at) - Date.now())}</span></div>`;
}

// ---------------------------------------------------------------- alerts

function renderAlerts() {
  const d = ui.data;
  const badge = $('#badge');
  badge.hidden = d.unread === 0;
  badge.textContent = d.unread > 99 ? '99+' : d.unread;
  $('#tab-badge').hidden = d.unread === 0;
  $('#tab-badge').textContent = badge.textContent;
  document.title = d.unread ? `(${d.unread}) RadarNews` : 'RadarNews';
  navigator.setAppBadge?.(d.unread || undefined)?.catch?.(() => {});
  $('#alerts-list').innerHTML = d.alerts.length
    ? d.alerts.map((a) => `<li class="alert ${a.level} ${a.is_read ? '' : 'unread'}">
        <div class="meta"><span class="lvl ${a.level}">${LEVEL_LABEL[a.level]}</span><span>${TYPE_LABEL[a.alert_type] || a.alert_type}</span>${a.currency ? `<span>${a.currency}</span>` : ''}<span>${relTime(a.occurred_at)}</span></div>
        <div class="t">${esc(a.title)}</div>${a.body ? `<div class="b">${esc(a.body)}</div>` : ''}
      </li>`).join('')
    : '<li class="alerts-empty">Sin alertas. Solo avisamos de lo que importa.</li>';
  renderNotif();
}

function notifState() {
  if (IS_IOS && !IS_STANDALONE) return 'ios-browser';
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return ui.pushOn ? 'push' : 'local';
  return Notification.permission;
}

function renderNotif() {
  const st = notifState();
  const btn = $('#notif-btn');
  const text = {
    unsupported: 'Este navegador no admite notificaciones. En Mac usa Safari (Añadir al Dock) o Chrome.',
    'ios-browser': 'Abre RadarNews desde la pantalla de inicio para activarlas.',
    push: 'Push activo: recibirás alertas aunque la app esté cerrada.',
    local: 'Activas mientras la app esté abierta. Pulsa para activar push.',
    denied: 'Bloqueadas. Actívalas en Ajustes del Sistema › Notificaciones.',
    default: 'Desactivadas.',
  }[st];
  $('#notif-state').textContent = text;
  btn.disabled = ['unsupported', 'ios-browser', 'denied', 'push'].includes(st);
  $('#ios-install').hidden = st !== 'ios-browser';
  btn.textContent = st === 'push' ? 'Activas' : 'Activar';
  btn.classList.toggle('on', st === 'push');
  $('#notif-test').hidden = st !== 'push' && st !== 'local';
  const n = ui.data?.push_devices ?? 0;
  $('#push-devices').textContent = `${n} ${n === 1 ? 'dispositivo suscrito' : 'dispositivos suscritos'}`;
  $('#notif-hint').hidden = ['push', 'unsupported', 'denied', 'ios-browser'].includes(st);
}

function toast(a) {
  const el = document.createElement('div');
  el.className = `toast ${a.level || ''}`;
  el.innerHTML = `<div class="t">${esc(a.title)}</div>${a.body ? `<div class="b">${esc(a.body)}</div>` : ''}`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 9000);
}

async function localNotify(a) {
  if (ui.pushOn || notifState() !== 'local') return;
  const opts = { body: a.body || '', tag: `rn-${a.id}`, icon: '/icon-512.png' };
  try {
    if (ui.swReg) await ui.swReg.showNotification(a.title, opts);
    else new Notification(a.title, opts);
  } catch { /* notification APIs vary by browser; the in-app toast already covers it */ }
}

function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enableNotifications() {
  if (!('Notification' in window)) return;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return renderNotif();
  try {
    if (ui.swReg && 'PushManager' in window) {
      const { publicKey } = await api('/api/push/key');
      const sub = (await ui.swReg.pushManager.getSubscription())
        || await ui.swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) });
      ui.pushOn = true;
      localStorage.setItem('rn-push', '1');
      toast({ level: 'alto', title: 'Notificaciones activadas', body: 'Recibirás las alertas en este dispositivo.' });
    }
  } catch (err) {
    console.warn('Push no disponible, se usarán notificaciones locales:', err);
    ui.pushOn = false;
    localStorage.removeItem('rn-push');
  }
  await load();
}

async function testNotification() {
  if (ui.pushOn) {
    const { sent } = await api('/api/push/test', { method: 'POST' });
    toast({ title: 'Prueba enviada', body: `${sent} ${sent === 1 ? 'dispositivo' : 'dispositivos'}` });
  } else {
    localNotify({ id: Date.now(), title: 'Prueba de RadarNews', body: 'Las notificaciones funcionan con la app abierta.' });
  }
}

// ---------------------------------------------------------------- health & settings

function sourceRows() {
  const health = ui.data.last_sync?.health || [];
  const byId = new Map(health.map((h) => [h.id, h]));
  return ui.data.sources.map((s) => ({ ...s, h: byId.get(s.id) }));
}

function renderHealth() {
  const rows = sourceRows();
  const checked = rows.filter((r) => r.h);
  const ok = checked.filter((r) => r.h.ok).length;
  const cal = ui.data.calendar_sync;
  const el = $('#health');
  el.className = `health ${!checked.length ? 'warn' : ok === checked.length && cal ? '' : ok === 0 ? 'err' : 'warn'}`;
  el.innerHTML = `<span class="d"></span>${checked.length ? `${ok}/${rows.length} fuentes operativas` : 'Fuentes pendientes'} · Agenda ${cal ? `${cal.events} eventos` : 'no disponible'}`;

  const llm = ui.data.llm;
  const st = llm.status;
  $('#engines-status').textContent = llm.provider
    ? `Motores: Agente + ${llm.label}${st && !st.ok ? ' (error)' : ''}`
    : 'Motor: Agente · Gemini sin configurar';

  $('#sources-body').innerHTML = rows.map((r) => `<tr>
      <td>${esc(r.name)}</td><td class="muted">${SOURCE_TYPE[r.type] || r.type}</td>
      <td>${r.h ? r.h.relevant : '—'}</td><td>${r.h ? `+${r.h.inserted}` : '—'}</td>
      <td>${!r.h ? '<span class="muted">Pendiente</span>' : r.h.ok ? '<span class="st">Operativa</span>' : `<span class="st err" title="${esc(r.h.error)}">Error</span>`}</td>
    </tr>`).join('') + `<tr><td>Agenda (ForexFactory)</td><td class="muted">Calendario</td><td>${cal ? cal.events : '—'}</td><td>—</td><td>${cal ? '<span class="st">Operativa</span>' : '<span class="st err">Error</span>'}</td></tr>`;
}

function renderSettings() {
  const g = ui.data.settings?.gemini || {};
  const st = ui.data.llm.status;
  const pill = $('#gemini-pill');
  if (!g.configured) {
    pill.className = 'pill';
    pill.textContent = 'Sin configurar';
    $('#gemini-state').textContent = 'Pega tu clave gratuita para activar el segundo motor.';
  } else {
    const err = st?.provider === 'gemini' && st.ok === false;
    pill.className = `pill ${err ? 'err' : 'ok'}`;
    pill.textContent = err ? 'Error' : 'Activo';
    $('#gemini-state').textContent = `Clave ${g.masked} · ${g.model}${g.origin === 'env' ? ' · desde .env' : ''}${err ? ` · ${st.error}` : ''}`;
  }
  $('#gemini-remove').hidden = g.origin !== 'app';
  $('#gemini-save').textContent = g.configured ? 'Probar y reemplazar' : 'Probar y guardar';
}

function formMsg(text, kind) {
  const el = $('#gemini-msg');
  el.hidden = !text;
  el.className = `form-msg ${kind || ''}`;
  el.textContent = text || '';
}

async function saveGemini(e) {
  e.preventDefault();
  const key = $('#gemini-key').value.trim();
  if (!key) return formMsg('Pega primero la clave.', 'err');
  const btn = $('#gemini-save');
  btn.disabled = true;
  formMsg('Comprobando la clave con Google…');
  try {
    await api('/api/settings/gemini', { method: 'POST', body: JSON.stringify({ key }) });
    $('#gemini-key').value = '';
    formMsg('Clave válida y guardada. Gemini está analizando los titulares…', 'ok');
    await load();
  } catch (err) {
    formMsg(err.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function removeGemini() {
  if (!confirm('¿Eliminar la clave de Gemini? El Agente seguirá funcionando.')) return;
  await api('/api/settings/gemini', { method: 'POST', body: JSON.stringify({ key: '' }) });
  formMsg('Clave eliminada.', 'ok');
  await load();
}

async function renderDevices() {
  const el = $('#devices-body');
  let d;
  try {
    d = await api('/api/devices');
  } catch (err) {
    el.innerHTML = `<p class="form-msg err">${esc(err.message)}</p>`;
    return;
  }
  const ts = d.tailscale;
  const cmd = `<code class="cmd">${esc(d.command)}</code>`;
  if (d.secure) {
    const here = location.origin === d.url;
    el.innerHTML = `<div class="card"><div class="qr-wrap">
        <div class="qr">${d.qr}</div>
        <div>
          <div class="card-title">Acceso seguro activo</div>
          <div class="url">${esc(d.url)}</div>
          ${here ? '<p class="form-msg ok">Estás usando esta conexión ahora mismo.</p>' : ''}
        </div>
      </div></div>
      <h4>En el iPhone o el iPad</h4>
      <ol>
        <li>Instala <b>Tailscale</b> desde el App Store e inicia sesión con la misma cuenta que en el Mac.</li>
        <li>Escanea el código con la cámara o abre la dirección en <b>Safari</b>.</li>
        <li>Pulsa <b>Compartir</b> y luego <b>Añadir a pantalla de inicio</b>.</li>
        <li>Abre RadarNews desde su icono → <b>Ajustes › Notificaciones › Activar</b>.</li>
      </ol>`;
    return;
  }
  const steps = !ts.installed
    ? `<li>Instala <b>Tailscale</b> en el Mac (App Store o <a href="https://tailscale.com/download" target="_blank" rel="noopener">tailscale.com/download</a>) e inicia sesión. El plan personal es gratuito.</li>
       <li>Vuelve a ejecutar el instalador de RadarNews: activa el acceso seguro automáticamente. O ejecuta en Terminal:${cmd}</li>`
    : !ts.running
      ? '<li>Abre <b>Tailscale</b> en el Mac e inicia sesión.</li><li>Vuelve a esta pantalla.</li>'
      : `<li>Tailscale está activo en este Mac (${esc(ts.dns || '')}). Activa el acceso seguro a RadarNews ejecutando en Terminal:${cmd}</li>`;
  el.innerHTML = `<div class="card"><div class="card-row"><div><div class="card-title">Acceso desde iPhone y iPad</div><div class="muted">Aún no configurado</div></div><span class="pill">Pendiente</span></div></div>
    <h4>Cómo activarlo</h4><ol>${steps}<li>Cuando esté listo, aquí aparecerá un código QR para abrirlo en el iPhone o el iPad.</li></ol>
    <div class="about-actions"><button class="btn" id="devices-retry">Comprobar de nuevo</button></div>`;
  $('#devices-retry').addEventListener('click', renderDevices);
}

function setView(view) {
  ui.view = view;
  document.body.dataset.view = view;
  if (view !== 'alerts') localStorage.setItem('rn-view', view);
  for (const b of $$('#tabbar button')) b.classList.toggle('active', b.dataset.view === view);
  const panel = $('#alerts-panel');
  if (phone.matches) panel.hidden = view !== 'alerts';
}

function openSettings(tab = 'ai') {
  if (tab === 'devices') renderDevices();
  for (const b of $$('#settings-tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const p of $$('#settings .tab')) p.hidden = p.dataset.pane !== tab;
  const dlg = $('#settings');
  if (!dlg.open) dlg.showModal();
}

// ---------------------------------------------------------------- spec

function mdToHtml(md) {
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const lines = md.split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      html += `<table><thead><tr>${cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>`
        + rows.slice(2).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
      continue;
    }
    if (/^\s*[-*] /.test(l) || /^\s*\d+\. /.test(l)) {
      const ordered = /^\s*\d+\. /.test(l);
      const items = [];
      while (i < lines.length && (/^\s*[-*] /.test(lines[i]) || /^\s*\d+\. /.test(lines[i]))) items.push(lines[i++].replace(/^\s*([-*]|\d+\.) /, ''));
      html += `<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
      continue;
    }
    const h = /^(#{1,4}) (.*)/.exec(l);
    if (h) html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
    else if (/^---+$/.test(l)) html += '<hr/>';
    else if (/^> /.test(l)) html += `<blockquote>${inline(l.slice(2))}</blockquote>`;
    else if (l.trim()) html += `<p>${inline(l)}</p>`;
    i++;
  }
  return html;
}

async function openSpec() {
  $('#settings').close();
  $('#spec-dialog').showModal();
  try {
    const res = await fetch('/api/spec');
    $('#spec-body').innerHTML = mdToHtml(await res.text());
  } catch {
    $('#spec-body').textContent = 'No se pudo cargar la especificación.';
  }
}

// ---------------------------------------------------------------- data flow

function renderAll() {
  renderStatus();
  renderCcyFilter();
  renderTape();
  renderBoard();
  renderCalendar();
  renderAlerts();
  renderHealth();
  renderSettings();
}

async function load() {
  try {
    ui.data = await api('/api/state');
    renderAll();
  } catch (err) {
    const band = $('#error-band');
    band.hidden = false;
    band.textContent = `Sin conexión con el servidor de RadarNews: ${err.message}`;
  }
}

async function refresh() {
  if (ui.syncing) return;
  setSyncing(true);
  try {
    await api('/api/refresh', { method: 'POST' });
  } catch (err) {
    toast({ level: 'critico', title: 'Error al actualizar', body: err.message });
  }
  await load();
}

function connectEvents() {
  ui.es?.close();
  const es = new EventSource('/api/events');
  ui.es = es;
  es.addEventListener('sync_start', () => setSyncing(true));
  es.addEventListener('sync_done', () => load());
  es.addEventListener('alerts', (ev) => {
    const { alerts } = JSON.parse(ev.data);
    for (const a of alerts.slice(0, 4)) { toast(a); localNotify(a); }
    load();
  });
  es.onopen = () => { if (ui.data) load(); };
}

function bind() {
  $('#refresh').addEventListener('click', refresh);
  $('#live').addEventListener('click', () => openSettings('sources'));
  $('#tape').addEventListener('click', (e) => { if (e.target.closest('[data-action="refresh"]')) refresh(); });
  $('#filters').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-filter]');
    if (!b) return;
    ui.filter = b.dataset.filter;
    for (const x of $$('#filters button')) x.classList.toggle('active', x === b);
    renderTape();
  });
  $('#ccy-filter').addEventListener('change', (e) => { ui.ccy = e.target.value || null; renderTape(); });
  $('#engine-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-engine]');
    if (!b) return;
    ui.engine = b.dataset.engine;
    localStorage.setItem('rn-engine', ui.engine);
    renderBoard();
  });
  $('#board').addEventListener('click', (e) => {
    const li = e.target.closest('.ccy-row');
    if (!li) return;
    const c = li.dataset.ccy;
    if (ui.open.has(c)) ui.open.delete(c); else ui.open.add(c);
    li.classList.toggle('open');
  });
  $('#cal-filter').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-impact]');
    if (!b) return;
    ui.calImpact = b.dataset.impact;
    localStorage.setItem('rn-cal', ui.calImpact);
    renderCalendar();
  });

  const panel = $('#alerts-panel');
  const togglePanel = (force) => {
    panel.hidden = force === undefined ? !panel.hidden : !force;
    $('#bell').setAttribute('aria-expanded', String(!panel.hidden));
  };
  $('#bell').addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
  document.addEventListener('click', (e) => { if (!phone.matches && !panel.hidden && !e.target.closest('.bell-wrap')) togglePanel(false); });
  $('#tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) setView(b.dataset.view);
  });
  phone.addEventListener('change', () => { panel.hidden = !(phone.matches && ui.view === 'alerts'); });
  // iOS suspends background tabs and drops the event stream; catch up when the app returns.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!ui.es || ui.es.readyState === EventSource.CLOSED) connectEvents();
    load();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) { connectEvents(); load(); } });
  $('#read-all').addEventListener('click', async () => { await api('/api/alerts/read-all', { method: 'POST' }); load(); });
  $('#notif-hint-btn').addEventListener('click', enableNotifications);

  $('#settings-btn').addEventListener('click', () => openSettings());
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open-settings]');
    if (t) openSettings(t.dataset.openSettings);
  });
  $('#settings-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) openSettings(b.dataset.tab);
  });
  for (const b of $$('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close());
  for (const d of $$('dialog')) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  $('#gemini-form').addEventListener('submit', saveGemini);
  $('#gemini-remove').addEventListener('click', removeGemini);
  $('#notif-btn').addEventListener('click', enableNotifications);
  $('#notif-test').addEventListener('click', testNotification);
  $('#spec-btn').addEventListener('click', openSpec);

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.matches('input, textarea, select')) return;
    if ($$('dialog').some((d) => d.open)) return;
    const k = e.key.toLowerCase();
    if (k === 'r') refresh();
    else if (k === 'a') togglePanel();
    else if (k === ',') openSettings();
    else if (k === 'escape') togglePanel(false);
    else if ('12345'.includes(k)) $$('#filters button')[Number(k) - 1]?.click();
  });
}

async function registerSw() {
  if (!('serviceWorker' in navigator)) return;
  try {
    ui.swReg = await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('Service worker no registrado:', err);
  }
}

if (ui.view === 'alerts') ui.view = 'board';
bind();
setView(ui.view);
registerSw().then(() => ui.data && renderNotif());
load();
connectEvents();
setInterval(renderSessions, 1000);
setInterval(load, 60_000);
renderSessions();
