const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
// Market quoting convention: the higher-priority currency is the base of the pair.
const PAIR_PRIORITY = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];
const CATEGORY_LABEL = { dato_macro: 'Dato', banco_central: 'Banco central', geopolitica: 'Geo', mercado: 'Mercado', analisis: 'Análisis', otro: 'Otro' };
const LEVEL_LABEL = { critico: 'Crítico', alto: 'Alto', medio: 'Medio' };
const TYPE_LABEL = { breaking: 'Breaking', dato_macro: 'Dato macro', cambio_regimen: 'Cambio de régimen', cambio_ranking: 'Cambio de ranking', calendario: 'Calendario', titular: 'Titular' };
const SESSIONS = [
  { city: 'SÍDNEY', tz: 'Australia/Sydney', open: 7, close: 16 },
  { city: 'TOKIO', tz: 'Asia/Tokyo', open: 9, close: 18 },
  { city: 'LONDRES', tz: 'Europe/London', open: 8, close: 17 },
  { city: 'NUEVA YORK', tz: 'America/New_York', open: 8, close: 17 },
];
const INVERTED = /unemployment|jobless|claims/i;

const $ = (sel) => document.querySelector(sel);
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
};

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (d) => d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
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
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
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
    return `<div class="session ${open ? 'open' : ''}" title="${open ? 'Sesión abierta' : 'Sesión cerrada'}"><span class="city">${s.city}</span><span class="clock">${parts.hour}:${parts.minute}</span></div>`;
  }).join('');
  const d = ui.data;
  if (d) {
    $('#next-sync').textContent = d.syncing ? 'en curso' : countdown(Date.parse(d.next_sync_at) - Date.now());
    if (d.last_sync) $('#last-sync').title = relTime(d.last_sync.finished_at);
  }
  renderNextEvent();
}

function renderStatus() {
  const d = ui.data;
  $('#last-sync').textContent = d.last_sync ? new Date(d.last_sync.finished_at).toLocaleTimeString('es-ES') : '—';
  const pills = [`<span class="engine-pill ok" title="Clasificador por reglas: siempre activo">Agente</span>`];
  if (d.llm.provider) {
    const st = d.llm.status;
    const cls = !st ? '' : st.ok ? 'ok' : 'err';
    pills.push(`<span class="engine-pill ${cls}" title="${esc(st?.error || 'Motor LLM activo')}">${esc(d.llm.label)}</span>`);
  } else {
    pills.push('<span class="engine-pill off" title="Añade GEMINI_API_KEY para activar Gemini">Gemini off</span>');
  }
  $('#engines').innerHTML = pills.join('');
  const band = $('#error-band');
  band.hidden = !d.error;
  band.textContent = d.error ? `Error de sincronización: ${d.error}` : '';
  setSyncing(d.syncing);
}

function setSyncing(on) {
  const b = $('#refresh');
  b.disabled = on;
  b.classList.toggle('loading', on);
  b.querySelector('.txt').textContent = on ? 'SINCRONIZANDO' : 'ACTUALIZAR';
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
  return `<span class="macro">ACT <b class="${cls}">${esc(n.actual)}</b>${n.forecast ? ` · EST <b>${esc(n.forecast)}</b>` : ''}${n.previous ? ` · PREV <b>${esc(n.previous)}</b>` : ''}</span>`;
}

function renderCcyFilter() {
  $('#ccy-filter').innerHTML = ['Todas', ...CURRENCIES].map((c) => {
    const active = (c === 'Todas' && !ui.ccy) || c === ui.ccy;
    return `<button data-ccy="${c}" class="${active ? 'active' : ''}">${c === 'Todas' ? 'TODAS' : c}</button>`;
  }).join('');
}

function renderTape() {
  const d = ui.data;
  let items = d.news;
  if (ui.filter === 'breaking') items = items.filter((n) => n.impact >= 4);
  else if (ui.filter !== 'all') items = items.filter((n) => n.category === ui.filter);
  if (ui.ccy) items = items.filter((n) => n.currencies.includes(ui.ccy));

  const el = $('#tape');
  if (!d.news.length) {
    el.innerHTML = `<div class="state-msg"><strong>La cinta está vacía</strong>Todavía no hay titulares relevantes.<button class="primary" data-action="refresh">ACTUALIZAR AHORA</button></div>`;
    return;
  }
  if (!items.length) {
    el.innerHTML = '<div class="state-msg">No hay titulares para este filtro.</div>';
    return;
  }
  const firstLoad = ui.knownNews.size === 0;
  el.innerHTML = items.slice(0, 250).map((n) => {
    const brk = n.impact >= 4;
    const fresh = !firstLoad && !ui.knownNews.has(n.id);
    const day = isToday(n.published_at) ? '' : `<small>${new Date(n.published_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}</small>`;
    const dots = `<span class="impact" title="Impacto ${n.impact}/5"><i>${'■'.repeat(n.impact)}</i>${'■'.repeat(5 - n.impact)}</span>`;
    return `<div class="row ${brk ? 'breaking' : ''} ${fresh ? 'fresh' : ''}">
      <div class="time">${fmtTime(n.published_at)}${day}</div>
      <div class="tags">${brk ? '<span class="tag brk">Breaking</span>' : ''}<span class="tag src ${n.source_type}">${esc(n.source)}</span><span class="tag cat">${CATEGORY_LABEL[n.category] || n.category}</span></div>
      <div class="headline"><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>
        <div class="sub">${macroHtml(n)}${n.calendar_title ? `<span class="cal-link">◆ ${esc(n.calendar_title)}</span>` : ''}${n.currencies.length ? `<span class="ccy">${n.currencies.join(' ')}</span>` : ''}${dots}</div>
      </div>
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
  if (!series || series.length < 2) return '<svg class="spark"></svg>';
  const pts = series.slice(-48);
  const w = 58; const h = 18;
  const x = (i) => (i / (pts.length - 1)) * w;
  const y = (v) => h / 2 - (v / 100) * (h / 2 - 1);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  const color = last > 0 ? '#34d399' : last < 0 ? '#ef4444' : '#7d8a98';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="#1c252e" stroke-width="1"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.3"/></svg>`;
}

function renderEngineTabs() {
  const engines = ui.data.engines.filter((e) => e.rows.length);
  const tabs = engines.length > 1 ? [{ id: 'consenso', label: 'Consenso' }] : [];
  tabs.push(...engines.map((e) => ({ id: e.engine, label: e.label })));
  if (!tabs.some((t) => t.id === ui.engine) && tabs.length) ui.engine = tabs[0].id;
  $('#engine-tabs').innerHTML = tabs.map((t) => `<button data-engine="${t.id}" class="${t.id === ui.engine ? 'active' : ''}">${t.label}</button>`).join('');
}

function renderBoard() {
  renderEngineTabs();
  const view = engineView(ui.engine);
  const board = $('#board');
  if (!view) {
    board.innerHTML = '<li class="state-msg">Sin clasificación todavía. Se genera tras la primera sincronización.</li>';
    $('#matrix').innerHTML = '';
    $('#top-pairs').innerHTML = '';
    $('#batch-time').textContent = '';
    return;
  }
  $('#batch-time').textContent = view.snapshot_at ? `${view.label} · lote ${fmtTime(view.snapshot_at)}` : '';
  const div = view.rows.filter((r) => r.diverge).map((r) => r.currency);
  $('#divergence').innerHTML = div.length ? `<span class="div-flag" title="Los motores discrepan en el sesgo o en más de 40 puntos">DIVERGENCIA ${div.join(' ')}</span>` : '';

  board.innerHTML = view.rows.map((r) => {
    const w = Math.abs(r.score) / 2;
    const cls = r.score > 0 ? 'pos' : r.score < 0 ? 'neg' : 'zero';
    let delta = '<span class="delta flat">·</span>';
    if (r.prevRank && r.prevRank !== r.rank) {
      const up = r.prevRank > r.rank;
      delta = `<span class="delta ${up ? 'up' : 'down'}" title="Antes #${r.prevRank}">${up ? '▲' : '▼'}${Math.abs(r.prevRank - r.rank)}</span>`;
    }
    const markers = view.consensus ? r.perEngine.filter((p) => p.row).map((p) => `<span class="other" title="${esc(p.label)}: ${signed(p.row.score)}" style="left:calc(${50 + p.row.score / 2}% - 1px)"></span>`).join('') : '';
    const detail = view.consensus
      ? r.perEngine.map((p) => p.row ? `<h4>${esc(p.label)} · ${signed(p.row.score)} · ${p.row.bias}</h4><ul>${p.row.drivers.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>Sin catalizadores</li>'}</ul><div>${esc(p.row.rationale)}</div>` : '').join('')
      : `<ul>${r.drivers.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>Sin catalizadores</li>'}</ul><div>${esc(r.rationale || '')}</div>`;
    return `<li class="ccy-row ${ui.open.has(r.currency) ? 'open' : ''}" data-ccy="${r.currency}">
      <div class="ccy-line">
        <span class="rank">${r.rank}</span>${delta}<span class="code">${r.currency}</span>
        <div class="bar"><span class="mid"></span><span class="fill ${cls}" style="width:${w}%"></span>${markers}</div>
        <span class="score ${cls}">${signed(r.score)}</span>${sparkline(r.series)}
      </div>
      <div class="ccy-sub"><span class="bias ${r.bias}">${r.bias}</span>${r.diverge ? '<span class="div-flag">≠</span>' : ''}<span class="driver">${esc(r.drivers[0] || 'Sin catalizadores claros')}</span></div>
      <div class="ccy-detail">${detail}</div>
    </li>`;
  }).join('');

  const regime = $('#regime');
  regime.hidden = !view.regime_note;
  regime.textContent = view.regime_note ? `Régimen · ${view.regime_note}` : '';
  renderMatrix(view.rows);
}

function cellColor(v) {
  const a = Math.min(1, Math.abs(v) / 120);
  return v > 0 ? `rgba(16,185,129,${0.08 + a * 0.62})` : v < 0 ? `rgba(239,68,68,${0.08 + a * 0.62})` : '#0f151b';
}

function renderMatrix(rows) {
  const s = Object.fromEntries(rows.map((r) => [r.currency, r.score]));
  const order = rows.map((r) => r.currency);
  let html = '<span></span>' + order.map((c) => `<span class="h">${c}</span>`).join('');
  for (const a of order) {
    html += `<span class="rh">${a}</span>`;
    for (const b of order) {
      if (a === b) { html += '<span class="c self">·</span>'; continue; }
      const v = s[a] - s[b];
      html += `<span class="c" style="background:${cellColor(v)}" title="${a} vs ${b}: ${signed(v)}">${signed(v)}</span>`;
    }
  }
  $('#matrix').innerHTML = html;

  const pairs = [];
  for (let i = 0; i < CURRENCIES.length; i++) {
    for (let j = i + 1; j < CURRENCIES.length; j++) {
      const [x, y] = [CURRENCIES[i], CURRENCIES[j]];
      const [base, quote] = PAIR_PRIORITY.indexOf(x) < PAIR_PRIORITY.indexOf(y) ? [x, y] : [y, x];
      pairs.push({ pair: `${base}/${quote}`, v: s[base] - s[quote] });
    }
  }
  pairs.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  $('#top-pairs').innerHTML = '<div class="pair muted"><span>MAYOR DIFERENCIAL NARRATIVO</span><span></span></div>'
    + pairs.slice(0, 4).map((p) => `<div class="pair"><b>${p.pair}</b><span class="${p.v > 0 ? 'macro up' : 'macro down'}">${p.v > 0 ? '▲ base' : '▼ base'} ${signed(p.v)}</span></div>`).join('');
}

// ---------------------------------------------------------------- calendar

function calFiltered() {
  const ev = ui.data.calendar;
  if (ui.calImpact === 'High') return ev.filter((e) => e.impact === 'High');
  if (ui.calImpact === 'Medium') return ev.filter((e) => e.impact === 'High' || e.impact === 'Medium' || e.impact === 'Holiday');
  return ev;
}

function renderCalendar() {
  for (const b of document.querySelectorAll('#cal-filter button')) b.classList.toggle('active', b.dataset.impact === ui.calImpact);
  const events = calFiltered();
  const el = $('#calendar');
  if (!ui.data.calendar.length) {
    el.innerHTML = '<div class="cal-empty">Calendario no disponible todavía.</div>';
    return;
  }
  const now = Date.now();
  const nextHigh = ui.data.calendar.find((e) => e.impact === 'High' && Date.parse(e.event_at) > now);
  let html = '';
  let lastDay = '';
  for (const e of events) {
    const k = dayKey(e.event_at);
    if (k !== lastDay) {
      html += `<div class="cal-day ${isToday(e.event_at) ? 'today' : ''}">${fmtDay(new Date(e.event_at))}${isToday(e.event_at) ? ' · hoy' : ''}</div>`;
      lastDay = k;
    }
    const past = Date.parse(e.event_at) < now;
    let actCls = '';
    if (e.actual && e.forecast) {
      const a = num(e.actual); const f = num(e.forecast);
      if (a != null && f != null && a !== f) actCls = ((a > f) !== INVERTED.test(e.title)) ? 'up' : 'down';
    }
    const vals = [e.actual && `ACT <b class="${actCls}">${esc(e.actual)}</b>`, e.forecast && `EST <b>${esc(e.forecast)}</b>`, e.previous && `PREV <b>${esc(e.previous)}</b>`].filter(Boolean).join('');
    html += `<div class="ev ${past ? 'past' : ''} ${nextHigh && e.id === nextHigh.id ? 'next' : ''}">
      <span class="t">${e.impact === 'Holiday' ? 'Día' : fmtTime(e.event_at)}</span><span class="cur">${e.currency}</span><span class="imp ${e.impact}" title="Impacto ${e.impact}"></span>
      <div><div>${esc(e.title)}</div>${vals ? `<div class="vals">${vals}</div>` : ''}</div>
    </div>`;
  }
  el.innerHTML = html || '<div class="cal-empty">Sin eventos para este filtro.</div>';
  renderNextEvent();
}

function renderNextEvent() {
  const d = ui.data;
  const box = $('#next-event');
  if (!d) return;
  const next = d.calendar.find((e) => e.impact === 'High' && Date.parse(e.event_at) > Date.now());
  box.hidden = !next;
  if (next) {
    box.innerHTML = `PRÓXIMO ALTO IMPACTO · <b>${next.currency}</b> ${esc(next.title)} · ${fmtTime(next.event_at)} · <span class="cd">${countdown(Date.parse(next.event_at) - Date.now())}</span>${next.forecast ? ` · EST ${esc(next.forecast)}` : ''}`;
  }
}

// ---------------------------------------------------------------- alerts

function renderAlerts() {
  const d = ui.data;
  const badge = $('#badge');
  badge.hidden = d.unread === 0;
  badge.textContent = d.unread > 99 ? '99+' : d.unread;
  document.title = d.unread ? `(${d.unread}) RadarNews` : 'RadarNews · Terminal macro FX';
  $('#alerts-list').innerHTML = d.alerts.length
    ? d.alerts.map((a) => `<li class="alert ${a.level} ${a.is_read ? '' : 'unread'}">
        <div class="meta"><span class="lvl ${a.level}">${LEVEL_LABEL[a.level]}</span><span>${TYPE_LABEL[a.alert_type] || a.alert_type}</span>${a.currency ? `<span>${a.currency}</span>` : ''}<span>${relTime(a.occurred_at)}</span></div>
        <div class="t">${esc(a.title)}</div>${a.body ? `<div class="b">${esc(a.body)}</div>` : ''}
      </li>`).join('')
    : '<li class="alerts-empty">Sin alertas. Silencio salvo lo que importa.</li>';
  renderNotifButton();
}

function renderNotifButton() {
  const btn = $('#notif-btn');
  const test = $('#notif-test');
  if (!('Notification' in window)) {
    btn.textContent = 'Este navegador no admite notificaciones';
    btn.disabled = true;
    return;
  }
  const perm = Notification.permission;
  btn.classList.toggle('on', perm === 'granted');
  btn.textContent = perm === 'granted'
    ? (ui.pushOn ? 'Notificaciones push activas' : 'Notificaciones activas (con la app abierta)')
    : perm === 'denied' ? 'Notificaciones bloqueadas en Ajustes' : 'Activar notificaciones';
  test.hidden = !ui.pushOn;
}

function toast(a) {
  const el = document.createElement('div');
  el.className = `toast ${a.level}`;
  el.innerHTML = `<div class="t">${esc(a.title)}</div>${a.body ? `<div class="b">${esc(a.body)}</div>` : ''}`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 9000);
}

async function localNotify(a) {
  if (ui.pushOn || !('Notification' in window) || Notification.permission !== 'granted') return;
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
  if (perm !== 'granted') return renderNotifButton();
  try {
    if (ui.swReg && 'PushManager' in window) {
      const { publicKey } = await api('/api/push/key');
      const sub = (await ui.swReg.pushManager.getSubscription())
        || await ui.swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) });
      ui.pushOn = true;
      localStorage.setItem('rn-push', '1');
    }
  } catch (err) {
    console.warn('Push no disponible, se usarán notificaciones locales:', err);
    ui.pushOn = false;
    localStorage.removeItem('rn-push');
  }
  renderNotifButton();
}

// ---------------------------------------------------------------- health

function renderHealth() {
  const h = ui.data.last_sync?.health || [];
  const seen = new Map();
  for (const x of h) {
    const prev = seen.get(x.source);
    seen.set(x.source, prev
      ? { ...prev, ok: prev.ok && x.ok, inserted: prev.inserted + x.inserted, relevant: prev.relevant + x.relevant, error: prev.error || x.error }
      : { ...x });
  }
  const cal = ui.data.calendar_sync;
  const items = [...seen.values()].map((x) => {
    const cls = !x.ok ? 'err' : x.relevant === 0 ? 'idle' : '';
    const title = x.ok ? `${x.relevant} relevantes en ventana · +${x.inserted} en la última sinc.` : `Error: ${x.error}`;
    return `<span class="src ${cls}" title="${esc(title)}">${esc(x.source)} ${x.ok ? `+${x.inserted}` : 'ERR'}</span>`;
  });
  items.push(`<span class="src ${cal ? '' : 'err'}" title="${cal ? `Semana desde ${cal.week_start}` : 'Sin calendario'}">Calendario ${cal ? cal.events : 'ERR'}</span>`);
  $('#health').innerHTML = items.join('');
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
  const dlg = $('#spec-dialog');
  dlg.showModal();
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
  setSyncing(true);
  try {
    await api('/api/refresh', { method: 'POST' });
  } catch (err) {
    toast({ level: 'critico', title: 'Error al actualizar', body: err.message });
  }
  await load();
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('sync_start', () => setSyncing(true));
  es.addEventListener('sync_done', () => load());
  es.addEventListener('alerts', (ev) => {
    const { alerts } = JSON.parse(ev.data);
    for (const a of alerts.slice(0, 4)) { toast(a); localNotify(a); }
    load();
  });
  es.onerror = () => { /* EventSource reconnects on its own */ };
}

function bind() {
  $('#refresh').addEventListener('click', refresh);
  $('#tape').addEventListener('click', (e) => { if (e.target.closest('[data-action="refresh"]')) refresh(); });
  $('#filters').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-filter]');
    if (!b) return;
    ui.filter = b.dataset.filter;
    for (const x of document.querySelectorAll('#filters button')) x.classList.toggle('active', x === b);
    renderTape();
  });
  $('#ccy-filter').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-ccy]');
    if (!b) return;
    ui.ccy = b.dataset.ccy === 'Todas' || b.dataset.ccy === ui.ccy ? null : b.dataset.ccy;
    renderCcyFilter();
    renderTape();
  });
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
  document.addEventListener('click', (e) => { if (!panel.hidden && !e.target.closest('.bell-wrap')) togglePanel(false); });
  $('#read-all').addEventListener('click', async () => { await api('/api/alerts/read-all', { method: 'POST' }); load(); });
  $('#notif-btn').addEventListener('click', enableNotifications);
  $('#notif-test').addEventListener('click', () => api('/api/push/test', { method: 'POST' }));
  $('#spec-btn').addEventListener('click', openSpec);
  $('#spec-close').addEventListener('click', () => $('#spec-dialog').close());

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.matches('input, textarea')) return;
    if ($('#spec-dialog').open) return;
    const k = e.key.toLowerCase();
    if (k === 'r') refresh();
    else if (k === 'a') togglePanel();
    else if (k === 'escape') togglePanel(false);
    else if ('12345'.includes(k)) document.querySelectorAll('#filters button')[Number(k) - 1]?.click();
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

bind();
registerSw().then(renderNotifButton);
load();
connectEvents();
setInterval(renderSessions, 1000);
setInterval(load, 60_000);
renderSessions();
