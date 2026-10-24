import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { normalizeBatch, rankingChanges, classifyCurrencies, headlineSignals, biasFor } from '../src/classifyCurrencies.js';
import { enrich } from '../src/enrich.js';
import { CURRENCIES } from '../src/config.js';

const now = Date.parse('2026-10-22T12:00:00Z');
const fj = { name: 'FinancialJuice', type: 'breaking' };
const news = (title) => ({ ...enrich({ title, published_at: new Date(now - 3600_000).toISOString() }, fj) });

test('normalizeBatch enforces the spec rules on any engine output', () => {
  const out = normalizeBatch({ currencies: [{ currency: 'usd', score: 250, drivers: ['a', 'b', 'c', 'd', 'x'.repeat(90)] }, { currency: 'EUR', score: 0 }] });
  assert.deepEqual(out.currencies.map((c) => c.currency).sort(), [...CURRENCIES].sort());
  const scores = out.currencies.map((c) => c.score);
  assert.equal(new Set(scores).size, 8, 'no identical scores');
  assert.ok(scores.every((s) => s >= -100 && s <= 100));
  const usd = out.currencies.find((c) => c.currency === 'USD');
  assert.equal(usd.score, 100);
  assert.equal(usd.drivers.length, 3);
  assert.deepEqual(out.currencies.map((c) => c.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const c of out.currencies) {
    assert.equal(c.bias, biasFor(c.score));
    assert.ok(c.drivers.every((d) => d.length < 60));
  }
});

test('ranking alerts ignore reshuffles inside the neutral cluster', () => {
  const rows = (scores) => normalizeBatch({ currencies: Object.entries(scores).map(([currency, score]) => ({ currency, score })) }).currencies;
  const a = rows({ USD: 40, EUR: 30, JPY: 5, GBP: 3, CHF: 2, CAD: 1, NZD: -30, AUD: -45 });
  const b = rows({ USD: 40, EUR: 30, JPY: 1, GBP: 4, CHF: 6, CAD: 2, NZD: -30, AUD: -45 });
  assert.equal(rankingChanges(a, b), null);
  const c = rows({ EUR: 45, USD: 20, JPY: 5, GBP: 3, CHF: 2, CAD: 1, NZD: -50, AUD: -25 });
  const ch = rankingChanges(a, c);
  assert.equal(ch.newLeader.currency, 'EUR');
  assert.equal(ch.newLaggard.currency, 'NZD');
});

test('agent: tone goes to the bank named, negated hikes are dovish, pair moves are ignored', () => {
  const ecb = headlineSignals(news('ECB hawkish: Lagarde signals more tightening for EUR/USD'), now);
  assert.ok(ecb.some((s) => s.currency === 'EUR' && s.value > 0));
  assert.ok(!ecb.some((s) => s.currency === 'USD'));
  const fed = headlineSignals(news("The market now sees a 22% chance the Fed doesn't hike again"), now);
  assert.ok(fed.some((s) => s.currency === 'USD' && s.value < 0));
  assert.deepEqual(headlineSignals(news('Dollar/yen falls to three-week low'), now), []);
});

test('dual engine: both batches stored, ranking and regime alerts per engine', async () => {
  const db = openDb(':memory:');
  for (const t of ['US CPI ACTUAL 3.4% (FORECAST 3.0%, PREVIOUS 3.1%)', 'Australia GDP ACTUAL -0.5% (FORECAST 0.3%, PREVIOUS 0.2%)']) {
    db.insertNews(news(t));
  }
  const fake = (scores) => async () => ({ regime_note: '', currencies: Object.entries(scores).map(([currency, score]) => ({ currency, score, drivers: ['x'], rationale: 'y' })) });
  await classifyCurrencies(db, { now, provider: 'gemini', llm: fake({ USD: 50, EUR: 10, GBP: 5, JPY: 0, CHF: -2, CAD: -5, NZD: -10, AUD: -60 }) });
  assert.equal(db.latestBatch('agente').length, 8);
  assert.equal(db.latestBatch('gemini').length, 8);
  assert.equal(db.listAlerts().length, 0, 'first batch has nothing to compare against');

  await classifyCurrencies(db, { now: now + 60_000, provider: 'gemini', llm: fake({ EUR: 55, USD: 10, GBP: 5, JPY: 0, CHF: -2, CAD: -5, NZD: -60, AUD: -10 }) });
  const alerts = db.listAlerts();
  assert.ok(alerts.some((a) => a.alert_type === 'cambio_ranking' && a.title.includes('Gemini') && a.title.includes('EUR')));
  assert.ok(alerts.some((a) => a.alert_type === 'cambio_regimen' && a.currency === 'AUD'));
  assert.ok(!alerts.some((a) => a.title.includes('Agente')), 'agent ranking did not change');
});

test('LLM failure falls back to the agent and records the error', async () => {
  const db = openDb(':memory:');
  db.insertNews(news('US CPI ACTUAL 3.4% (FORECAST 3.0%, PREVIOUS 3.1%)'));
  const out = await classifyCurrencies(db, { now, provider: 'gemini', llm: async () => { throw new Error('429 quota'); } });
  assert.deepEqual(out.results.map((r) => r.engine), ['agente']);
  assert.equal(db.getMeta('llm_status').error, '429 quota');
});
