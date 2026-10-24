import { createHash } from 'node:crypto';
import { CURRENCIES, UA, WINDOWS } from './config.js';
import { parseNumber } from './enrich.js';

const FF = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

function weekStart(d = new Date()) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() - day + 1);
  return x.toISOString().slice(0, 10);
}

export async function fetchCalendar() {
  const res = await fetch(FF, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(WINDOWS.fetchTimeoutMs) });
  if (!res.ok) throw new Error(`ForexFactory HTTP ${res.status}`);
  const rows = await res.json();
  const events = [];
  for (const r of rows) {
    const currency = CURRENCIES.includes(r.country) ? r.country : null;
    if (!currency && r.impact !== 'Holiday') continue;
    const eventAt = new Date(r.date).toISOString();
    const id = createHash('sha1').update(`${r.title}|${r.country}|${eventAt}`).digest('hex').slice(0, 16);
    events.push({
      id,
      title: r.title,
      currency: currency || 'USD',
      event_at: eventAt,
      impact: r.impact || 'Low',
      forecast: r.forecast || null,
      previous: r.previous || null,
      actual: r.actual || null,
      news_item_id: null,
      prealerted: 0,
    });
  }
  return { events, week_start: weekStart(), source: FF };
}

const MATCH_MS = 18 * 3600_000;

export function eventFamily(title) {
  const t = String(title || '').toLowerCase();
  if (/\bpmi\b|purchasing managers/.test(t)) return 'pmi';
  if (/retail/.test(t)) return 'retail';
  if (/unemployment|jobless|claims|payroll|employment|\bnfp\b/.test(t)) return 'labour';
  if (/\bcpi\b|\bipc\b|inflation/.test(t)) return 'cpi';
  if (/\bgdp\b|\bpib\b/.test(t)) return 'gdp';
  if (/housing|home sales|building permit/.test(t)) return 'housing';
  if (/trade balance|current account/.test(t)) return 'trade';
  if (/confidence|ifo|zew/.test(t)) return 'confidence';
  if (/industrial|factory|production/.test(t)) return 'production';
  return null;
}

export function linkNewsToCalendar(news, events) {
  for (const n of news) {
    if (!n.actual && !n.forecast) continue;
    const t = Date.parse(n.published_at);
    if (!Number.isFinite(t)) continue;
    const hit = events.find((e) => n.currencies?.includes(e.currency)
      && Math.abs(Date.parse(e.event_at) - t) <= MATCH_MS
      && titlesClose(n.title, e.title));
    if (!hit) continue;
    n.calendar_title = hit.title;
    if (hit.impact === 'High') n.impact = Math.max(n.impact || 1, 4);
    hit.news_item_id = n.id || hit.news_item_id;
    if (n.actual && !hit.actual) hit.actual = n.actual;
  }
}

function titlesClose(a, b) {
  const fa = eventFamily(a);
  const fb = eventFamily(b);
  if (fa && fa === fb) return true;
  const na = norm(a); const nb = norm(b);
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(' ').filter((w) => w.length > 3));
  const wb = nb.split(' ').filter((w) => w.length > 3);
  const inter = wb.filter((w) => wa.has(w)).length;
  return inter >= 2;
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9% ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function duePrealerts(events, now = Date.now()) {
  return events.filter((e) => e.impact === 'High'
    && !e.prealerted
    && Date.parse(e.event_at) - now <= 15 * 60_000
    && Date.parse(e.event_at) - now > 0);
}

export function turboEvent(events, now = Date.now()) {
  return events.find((e) => e.impact === 'High' && Math.abs(Date.parse(e.event_at) - now) <= 5 * 60_000) || null;
}

export { parseNumber, weekStart };
