import { randomUUID } from 'node:crypto';
import { SOURCES, WINDOWS, UA } from './config.js';
import { enrichRaw, isRelevant, parseRss, parseTelegram, parseHtmlList } from './enrich.js';
import { insertNews, recentNews, listNews, saveScores, latestEngine, insertAlert, listCalendar, upsertCalendar, persistCalendarLinks, persistNewsLinks, repairPersistedNews } from './db.js';
import { classifyAgent, attachRanks, rankingAlerts, isNoEvidence } from './classifyCurrencies.js';
import { classifyWithGemini } from './llm.js';
import { fetchCalendar, linkNewsToCalendar, duePrealerts } from './calendar.js';
import { publicGemini, readSettings } from './settings.js';

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/html, */*' },
    signal: AbortSignal.timeout(WINDOWS.fetchTimeoutMs),
    redirect: 'follow',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { text, finalUrl: res.url, contentType: res.headers.get('content-type') || '' };
}

function parseSource(source, text) {
  if (source.kind === 'telegram') return parseTelegram(text);
  if (source.kind === 'html') return parseHtmlList(text, source.url);
  return parseRss(text);
}

export async function pullSource(source, now = Date.now()) {
  const health = { id: source.id, source: source.name, url: source.url, type: source.type, ok: false, fetched: 0, relevant: 0, inserted: 0, error: null };
  try {
    const { text, finalUrl } = await fetchText(source.url);
    if (source.kind === 'telegram' && /Telegram: Contact @/.test(text) && !/tgme_widget_message_text/.test(text)) {
      throw new Error('Canal sin vista pública t.me/s/…; comprueba RADARNEWS_BURBUJA_CHANNEL.');
    }
    const windowMs = source.type === 'oficial' ? WINDOWS.oficialMs : WINDOWS.breakingMs;
    const raw = parseSource(source, text).filter((r) => now - Date.parse(r.published_at) <= windowMs || source.kind === 'html');
    health.fetched = raw.length;
    const items = raw.map((r) => enrichRaw({ ...r, url: r.url || finalUrl }, source)).filter(isRelevant);
    health.relevant = items.length;
    health.ok = true;
    return { health, items };
  } catch (err) {
    health.error = String(err.message || err).slice(0, 240);
    return { health, items: [] };
  }
}

function roundRobinInsert(groups, cap) {
  const queues = groups.map((g) => [...g]);
  const out = [];
  let added = true;
  while (out.length < cap && added) {
    added = false;
    for (const q of queues) {
      if (!q.length || out.length >= cap) continue;
      out.push(q.shift());
      added = true;
    }
  }
  return out;
}

export async function refreshFeed(db, { classify = true } = {}) {
  const started = new Date().toISOString();
  const pulled = await Promise.all(SOURCES.map((s) => pullSource(s)));
  const health = pulled.map((p) => p.health);
  const grouped = pulled.map((p) => p.items);
  const batch = roundRobinInsert(grouped, WINDOWS.insertCap);

  let calendarSync = null;
  try {
    const cal = await fetchCalendar();
    upsertCalendar(db, cal.events, cal.week_start);
    calendarSync = { events: cal.events.length, ok: true };
  } catch (err) {
    calendarSync = { events: 0, ok: false, error: String(err.message || err) };
  }
  repairPersistedNews(db);
  let events = listCalendar(db);
  linkNewsToCalendar(batch, events);

  let inserted = 0;
  const alerts = [];
  const seenMacro = new Set();
  for (const item of batch) {
    const isNew = insertNews(db, item);
    if (!isNew) continue;
    inserted++;
    const row = health.find((h) => h.id === item.source_id);
    if (row) row.inserted += 1;
    const fresh = Date.now() - Date.parse(item.published_at) <= 12 * 3600_000;
    const fire = fresh && (item.impact >= 4 || (item.impact >= 3 && item.category === 'geopolitica' && item.currencies?.length));
    if (!fire) continue;
    const bucket = `${(item.currencies || [])[0] || ''}|${item.calendar_title || item.title.slice(0, 40)}|${Math.floor(Date.parse(item.published_at) / (15 * 60_000))}`;
    if (item.actual && seenMacro.has(bucket)) continue;
    seenMacro.add(bucket);
    const alert = {
      title: item.title.slice(0, 180),
      body: `${item.source}${item.actual ? ` · Act ${item.actual}` : ''}`,
      level: item.impact >= 5 ? 'critico' : 'alto',
      alert_type: item.category === 'dato_macro' ? 'dato_macro' : item.category === 'geopolitica' ? 'breaking' : 'titular',
      currency: (item.currencies || [])[0] || null,
    };
    insertAlert(db, alert);
    alerts.push(alert);
  }

  for (const e of duePrealerts(events)) {
    insertAlert(db, {
      title: `Agenda 15 min · ${e.currency} ${e.title}`,
      body: `Est ${e.forecast || '—'} · Prev ${e.previous || '—'}`,
      level: 'alto',
      alert_type: 'calendario',
      currency: e.currency,
    });
    db.prepare('UPDATE calendar SET prealerted=1 WHERE id=?').run(e.id);
    alerts.push({ title: `Agenda 15 min · ${e.currency} ${e.title}` });
  }

  events = listCalendar(db);
  const stored = listNews(db, 2000);
  linkNewsToCalendar(stored, events);
  persistCalendarLinks(db, events);
  persistNewsLinks(db, stored);

  if (classify) {
    const horizon = new Date(Date.now() - WINDOWS.oficialMs).toISOString();
    const news = recentNews(db, horizon);
    const snapshot = new Date().toISOString();
    const prevAgent = latestEngine(db, 'agente');
    const agentRows = attachRanks(classifyAgent(news));
    saveScores(db, 'agente', agentRows, randomUUID(), snapshot, '');
    alerts.push(...rankingAlerts(prevAgent?.rows, agentRows, 'Agente').map((a) => {
      insertAlert(db, a);
      return a;
    }));

    const settings = readSettings();
    const gemini = publicGemini(settings);
    if (gemini.key) {
      try {
        const prevG = latestEngine(db, 'gemini');
        const g = await classifyWithGemini(news.filter((n) => Date.now() - Date.parse(n.published_at) <= WINDOWS.structuralMs || n.source_type === 'oficial').slice(0, 80), gemini.key, gemini.model);
        const gRows = g.rows.map((r) => (isNoEvidence(r) ? { ...r, score: 0, bias: 'neutral', rank: null } : r));
        saveScores(db, 'gemini', gRows, randomUUID(), snapshot, g.regime_note || '');
        alerts.push(...rankingAlerts(prevG?.rows, gRows, 'Gemini').map((a) => {
          insertAlert(db, a);
          return a;
        }));
        settings.gemini.model = g.model;
      } catch (err) {
        insertAlert(db, {
          title: 'Gemini no disponible este ciclo',
          body: String(err.message || err).slice(0, 200),
          level: 'medio',
          alert_type: 'titular',
        });
      }
    }
  }

  return {
    started_at: started,
    finished_at: new Date().toISOString(),
    inserted,
    alerts: alerts.length,
    health,
    calendar_sync: calendarSync,
    news_count: listNews(db, 1).length,
    new_alerts: alerts,
  };
}
