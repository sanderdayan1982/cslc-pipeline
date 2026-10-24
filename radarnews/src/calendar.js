import { createHash } from 'node:crypto';
import { CURRENCIES, CALENDAR_URL, CALENDAR_PREALERT_MIN, FETCH_TIMEOUT_MS } from './config.js';

const IMPACTS = new Set(['High', 'Medium', 'Low', 'Holiday']);

export function parseCalendar(json) {
  const events = [];
  for (const e of Array.isArray(json) ? json : []) {
    if (!CURRENCIES.includes(e.country) || !IMPACTS.has(e.impact)) continue;
    const at = new Date(e.date);
    if (Number.isNaN(at.getTime())) continue;
    const event_at = at.toISOString();
    events.push({
      id: createHash('sha1').update(`${e.title}|${e.country}|${event_at}`).digest('hex').slice(0, 16),
      title: String(e.title).trim(),
      currency: e.country,
      event_at,
      impact: e.impact,
      forecast: e.forecast || null,
      previous: e.previous || null,
    });
  }
  return events;
}

export function weekStartOf(events) {
  if (!events.length) return '';
  const first = new Date(events[0].event_at);
  const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export async function refreshCalendar(db, { fetcher = defaultFetch } = {}) {
  const events = parseCalendar(await fetcher(CALENDAR_URL)).sort((a, b) => a.event_at.localeCompare(b.event_at));
  const weekStart = weekStartOf(events);
  db.replaceCalendarWeek(weekStart, events);
  db.setMeta('calendar_sync', { at: new Date().toISOString(), events: events.length, week_start: weekStart });
  return events.length;
}

async function defaultFetch(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RadarNews/1.0)', Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`calendario HTTP ${res.status}`);
  return res.json();
}

export function prealertsDue(db, now = Date.now()) {
  const from = new Date(now).toISOString();
  const to = new Date(now + CALENDAR_PREALERT_MIN * 60_000).toISOString();
  const alerts = [];
  for (const ev of db.calendarDue(from, to)) {
    const mins = Math.max(1, Math.round((Date.parse(ev.event_at) - now) / 60_000));
    const parts = [ev.forecast && `EST ${ev.forecast}`, ev.previous && `PREV ${ev.previous}`].filter(Boolean);
    alerts.push({
      title: `En ${mins} min · ${ev.currency} ${ev.title}`,
      body: `Dato de alto impacto${parts.length ? ` · ${parts.join(' / ')}` : ''}`,
      level: 'alto',
      alert_type: 'calendario',
      currency: ev.currency,
      occurred_at: from,
    });
    db.markPrealerted(ev.id);
  }
  return alerts;
}

const SYNONYMS = {
  jobless: 'claims', claims: 'claims', nonfarm: 'nfp', 'non-farm': 'nfp', payrolls: 'nfp', nfp: 'nfp',
  inflation: 'cpi', cpi: 'cpi', hicp: 'cpi', pmi: 'pmi', gdp: 'gdp', unemployment: 'unemployment',
  retail: 'retail', sales: 'sales', confidence: 'confidence', sentiment: 'sentiment', ppi: 'ppi', pce: 'pce',
  core: 'core', services: 'services', manufacturing: 'manufacturing', composite: 'composite', trade: 'trade',
  balance: 'balance', employment: 'employment', wage: 'wage', earnings: 'earnings', housing: 'housing',
  starts: 'starts', permits: 'permits', production: 'production', industrial: 'industrial', ifo: 'ifo', zew: 'zew',
  gfk: 'gfk', ism: 'ism', tankan: 'tankan', 'm/m': 'mm', 'y/y': 'yy', 'q/q': 'qq', mom: 'mm', yoy: 'yy', qoq: 'qq',
  trimmed: 'trimmed', median: 'median', flash: 'flash', prelim: 'flash', preliminary: 'flash', rate: 'rate',
};
const GENERIC = new Set(['core', 'flash', 'mm', 'yy', 'qq', 'rate', 'balance', 'sales']);

function tokens(text) {
  return new Set(text.toLowerCase().split(/[^a-z/-]+/).map((t) => SYNONYMS[t]).filter(Boolean));
}

export function indicatorKey(title) {
  return [...tokens(title)].filter((t) => !['mm', 'yy', 'qq'].includes(t)).sort().join('+');
}

export function matchScore(eventTitle, newsTitle) {
  const a = tokens(eventTitle);
  const b = tokens(newsTitle);
  let score = 0;
  let distinctive = false;
  for (const t of a) {
    if (b.has(t)) {
      score += GENERIC.has(t) ? 0.5 : 1;
      if (!GENERIC.has(t)) distinctive = true;
    } else if (t === 'core' || t === 'trimmed' || t === 'median') {
      score -= 1;
    }
  }
  for (const t of b) if ((t === 'core' || t === 'trimmed' || t === 'median') && !a.has(t)) score -= 1;
  return distinctive ? score : 0;
}

// Links a macro print to its weekly calendar event (same currency, ±30 min).
export function findCalendarEvent(db, item) {
  if (item.category !== 'dato_macro' || !item.actual) return null;
  const t = Date.parse(item.published_at);
  const from = new Date(t - 30 * 60_000).toISOString();
  const to = new Date(t + 30 * 60_000).toISOString();
  let best = null;
  for (const c of item.currencies) {
    for (const ev of db.calendarAround(c, from, to)) {
      const s = matchScore(ev.title, item.title);
      if (s >= 1 && (!best || s > best.score)) best = { event: ev, score: s };
    }
  }
  return best?.event ?? null;
}
