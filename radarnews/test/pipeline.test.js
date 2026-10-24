import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { refreshFeed } from '../src/refreshFeed.js';
import { parseCalendar, refreshCalendar, prealertsDue, matchScore } from '../src/calendar.js';

const now = Date.parse('2026-10-22T23:50:00Z');
const iso = (minAgo) => new Date(now - minAgo * 60_000).toISOString();
const DAY = 86400_000;
const fjSrc = { id: 'fj', name: 'FinancialJuice', type: 'breaking', freshnessMs: 3 * DAY };
const ilSrc = { id: 'il', name: 'InvestingLive', type: 'agencia', freshnessMs: 3 * DAY };
const fedSrc = { id: 'fed', name: 'Fed', type: 'oficial', freshnessMs: 30 * DAY, currency: 'USD' };

const calendarJson = [
  { title: 'National Core CPI y/y', country: 'JPY', date: '2026-10-22T19:30:00-04:00', impact: 'High', forecast: '2.1%', previous: '1.7%' },
  { title: 'CPI m/m', country: 'USD', date: '2026-10-23T08:30:00-04:00', impact: 'High', forecast: '0.3%', previous: '0.4%' },
  { title: 'Bank Holiday', country: 'CNY', date: '2026-10-23T00:00:00-04:00', impact: 'Holiday' },
];

test('calendar keeps the 8 currencies and matches the right indicator', () => {
  const ev = parseCalendar(calendarJson);
  assert.deepEqual(ev.map((e) => e.currency), ['JPY', 'USD']);
  assert.ok(matchScore('National Core CPI y/y', 'JAPANESE CORE CPI NATIONWIDE YOY ACTUAL 2.1%') >= 1);
  assert.ok(matchScore('CPI m/m', 'US Core CPI m/m ACTUAL 0.3%') < matchScore('Core CPI m/m', 'US Core CPI m/m ACTUAL 0.3%'));
  assert.equal(matchScore('Retail Sales m/m', 'US CPI m/m ACTUAL 0.3%'), 0);
});

test('high-impact pre-alert fires once, 15 minutes before', async () => {
  const db = openDb(':memory:');
  await refreshCalendar(db, { fetcher: async () => calendarJson });
  const usdCpi = Date.parse('2026-10-23T12:30:00Z');
  assert.equal(prealertsDue(db, usdCpi - 30 * 60_000).length, 0);
  const due = prealertsDue(db, usdCpi - 10 * 60_000);
  assert.equal(due.length, 1);
  assert.match(due[0].title, /En 10 min · USD CPI m\/m/);
  assert.equal(prealertsDue(db, usdCpi - 5 * 60_000).length, 0);
});

test('one release = one alert; data linked to calendar; dedupe across sources', async () => {
  const db = openDb(':memory:');
  await refreshCalendar(db, { fetcher: async () => calendarJson });
  const feeds = {
    fj: [
      { title: '❗ JAPANESE CORE CPI NATIONWIDE YOY ACTUAL 2.1% (FORECAST 2.1%, PREVIOUS 1.7%)', published_at: iso(20) },
      { title: 'Japan Sept nationwide core CPI 2.1% yr/yr: govt (Poll +2.1%)', published_at: iso(20) },
      { title: 'Japan core-core CPI climbs over 2% for first time since March', published_at: iso(19) },
      { title: 'Fed holds rates steady, signals patience', published_at: iso(5) },
    ],
    il: [
      { title: 'Japan September 2026 Headline CPI 2.1% y/y (expected 2.1%)', published_at: iso(15) },
      { title: 'fed signals patience; holds rates steady', published_at: iso(4) },
    ],
    fed: [{ title: 'Federal Reserve issues FOMC statement', published_at: iso(60 * 24 * 40) }],
  };
  const report = await refreshFeed(db, { sources: [fjSrc, ilSrc, fedSrc], fetcher: async (s) => feeds[s.id], now });

  assert.equal(report.inserted, 5, 'duplicate Fed headline from a second source is dropped, stale official is filtered');
  const jpyAlerts = db.listAlerts().filter((a) => a.currency === 'JPY');
  assert.equal(jpyAlerts.length, 1);
  assert.match(jpyAlerts[0].body, /National Core CPI y\/y/);
  assert.match(jpyAlerts[0].body, /\+\d titulares del mismo dato/);
  assert.equal(db.listCalendar().find((e) => e.currency === 'JPY').actual, '2.1%');
  assert.deepEqual(report.health.map((h) => h.ok), [true, true, true]);
});

test('per-source fairness: a busy channel cannot starve the rest of the 60-item cap', async () => {
  const db = openDb(':memory:');
  const flood = Array.from({ length: 80 }, (_, i) => ({ title: `US headline number ${i} on dollar flows`, published_at: iso(i) }));
  const official = [{ title: 'Speech by Governor Waller on the economic outlook and monetary policy', published_at: iso(600) }];
  const report = await refreshFeed(db, { sources: [fjSrc, fedSrc], fetcher: async (s) => (s.id === 'fj' ? flood : official), now });
  assert.equal(report.inserted, 60);
  assert.equal(report.health.find((h) => h.id === 'fed').inserted, 1);
});

test('a failing source is reported without breaking the cycle', async () => {
  const db = openDb(':memory:');
  const report = await refreshFeed(db, {
    sources: [fjSrc, fedSrc],
    fetcher: async (s) => { if (s.id === 'fed') throw new Error('timeout 15s'); return [{ title: 'BoJ Ueda: will raise rates if outlook realised', published_at: iso(3) }]; },
    now,
  });
  assert.equal(report.inserted, 1);
  assert.deepEqual(report.health.map((h) => [h.ok, h.error]), [[true, null], [false, 'timeout 15s']]);
});
