import { SOURCES, MAX_INSERT_PER_CYCLE } from './config.js';
import { fetchSource } from './fetchers.js';
import { enrich, isRelevantOfficial, isRelevantBreaking, extractMacro, estimateImpact } from './enrich.js';
import { findCalendarEvent } from './calendar.js';

// Old items (e.g. a 3-week-old official release on first ingest) are stored but never alerted.
const ALERT_MAX_AGE_MS = 12 * 3600 * 1000;

export function alertFor(item) {
  const affectsUniverse = item.currencies.length > 0;
  const qualifies = item.impact >= 4 || (item.source_type === 'breaking' && item.impact >= 3 && affectsUniverse);
  if (!qualifies) return null;
  const level = item.impact >= 5 ? 'critico' : item.impact >= 4 ? 'alto' : 'medio';
  const alert_type = item.category === 'dato_macro' ? 'dato_macro'
    : item.source_type === 'breaking' ? 'breaking' : 'titular';
  const macro = item.actual ? ` · ACT ${item.actual}${item.forecast ? ` / EST ${item.forecast}` : ''}${item.previous ? ` / PREV ${item.previous}` : ''}` : '';
  return {
    title: item.title,
    body: `${item.source}${item.calendar_title ? ` · ${item.calendar_title}` : ''}${item.currencies.length ? ` · ${item.currencies.join(', ')}` : ''}${macro}`,
    level,
    alert_type,
    currency: item.currencies[0] ?? null,
    occurred_at: item.published_at,
  };
}

export function filterRaw(rawItems, source, now = Date.now()) {
  const out = [];
  for (const raw of rawItems) {
    if (!raw.title || !raw.published_at) continue;
    const age = now - Date.parse(raw.published_at);
    if (age > source.freshnessMs || age < -3600_000) continue;
    const enriched = enrich(raw, source);
    const text = `${raw.title} ${raw.body || ''}`;
    const relevant = source.type === 'oficial'
      ? isRelevantOfficial(text)
      : isRelevantBreaking(text, enriched.currencies, extractMacro(raw.title));
    if (relevant) out.push({ ...enriched, _sid: source.id });
  }
  return out;
}

export async function refreshFeed(db, { sources = SOURCES, fetcher = fetchSource, now = Date.now() } = {}) {
  const startedAt = new Date(now).toISOString();
  const results = await Promise.allSettled(sources.map((s) => fetcher(s)));

  const health = [];
  const candidates = [];
  results.forEach((res, i) => {
    const source = sources[i];
    if (res.status === 'rejected') {
      health.push({ id: source.id, source: source.name, url: source.url, type: source.type, ok: false, fetched: 0, relevant: 0, inserted: 0, error: String(res.reason?.message || res.reason) });
      return;
    }
    const relevant = filterRaw(res.value, source, now);
    health.push({ id: source.id, source: source.name, url: source.url, type: source.type, ok: true, fetched: res.value.length, relevant: relevant.length, inserted: 0, error: null });
    candidates.push(...relevant);
  });

  const inserted = insertFair(db, candidates, health);
  const alerts = createAlerts(db, inserted, now);

  const report = { started_at: startedAt, finished_at: new Date().toISOString(), inserted: inserted.length, alerts: alerts.length, health };
  db.setMeta('last_sync', report);
  return report;
}

// Round-robin across sources so a busy breaking channel cannot starve official feeds of the 60-item cap.
function insertFair(db, candidates, health) {
  const seen = new Set();
  const queues = new Map();
  for (const item of [...candidates].sort((a, b) => b.published_at.localeCompare(a.published_at))) {
    if (seen.has(item.fingerprint) || db.hasFingerprint(item.fingerprint)) continue;
    seen.add(item.fingerprint);
    if (!queues.has(item._sid)) queues.set(item._sid, []);
    queues.get(item._sid).push(item);
  }
  const ordered = [];
  while (ordered.length < MAX_INSERT_PER_CYCLE && [...queues.values()].some((q) => q.length)) {
    for (const q of queues.values()) {
      if (q.length && ordered.length < MAX_INSERT_PER_CYCLE) ordered.push(q.shift());
    }
  }

  const inserted = [];
  for (const item of ordered) {
    const event = findCalendarEvent(db, item);
    if (event) {
      item.forecast ??= event.forecast;
      item.previous ??= event.previous;
      item.calendar_title = event.title;
      const floor = event.impact === 'High' ? 4 : event.impact === 'Medium' ? 3 : 1;
      item.impact = Math.max(floor, estimateImpact({ text: item.title, category: item.category, macro: item, sourceType: item.source_type, breaking: false }));
    }
    const id = db.insertNews(item);
    if (id == null) continue;
    if (event) db.setCalendarActual(event.id, item.actual, id);
    inserted.push({ ...item, id });
    const h = health.find((x) => x.id === item._sid);
    if (h) h.inserted += 1;
  }
  return inserted;
}

const DATA_CLUSTER_MS = 15 * 60_000;

function dataRank(item) {
  return item.impact * 100 + (item.calendar_title ? 20 : 0) + (item.forecast ? 10 : 0) + (item.actual ? 5 : 0);
}

// A single release (e.g. Japan CPI) arrives as many headlines across sources: one alert per
// currency per 15-minute window, carrying the most informative headline.
export function createAlerts(db, inserted, now = Date.now()) {
  const fresh = inserted.filter((i) => now - Date.parse(i.published_at) <= ALERT_MAX_AGE_MS);
  const clusters = new Map();
  const singles = [];
  for (const item of fresh) {
    if (!alertFor(item)) continue;
    if (item.category !== 'dato_macro' || !item.currencies.length) {
      singles.push({ item, related: 0 });
      continue;
    }
    const t = Date.parse(item.published_at);
    const key = item.currencies[0];
    const list = clusters.get(key) || [];
    let cluster = list.find((c) => Math.abs(c.t - t) <= DATA_CLUSTER_MS);
    if (!cluster) {
      cluster = { t, items: [] };
      list.push(cluster);
      clusters.set(key, list);
    }
    cluster.items.push(item);
  }

  const picks = [...singles];
  for (const [currency, list] of clusters) {
    for (const c of list) {
      const from = new Date(c.t - DATA_CLUSTER_MS).toISOString();
      const to = new Date(c.t + DATA_CLUSTER_MS).toISOString();
      if (db.hasDataAlert(currency, from, to)) continue;
      const best = [...c.items].sort((a, b) => dataRank(b) - dataRank(a))[0];
      picks.push({ item: best, related: c.items.length - 1 });
    }
  }

  const alerts = [];
  for (const { item, related } of picks) {
    const alert = alertFor(item);
    if (related > 0) alert.body += ` · +${related} titulares del mismo dato`;
    const id = db.insertAlert({ ...alert, news_item_id: item.id });
    db.markAlerted(item.id);
    alerts.push({ ...alert, id });
  }
  return alerts;
}
