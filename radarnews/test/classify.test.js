import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAgent, attachRanks, isNoEvidence, rankingAlerts, biasFor, MOSLER_RULES,
} from '../src/classifyCurrencies.js';

const now = Date.parse('2026-10-24T00:00:00Z');
const t = (minsAgo, extra) => ({
  title: extra.title,
  body: extra.body || '',
  currencies: extra.currencies,
  source_type: extra.source_type || 'breaking',
  category: extra.category || 'dato_macro',
  actual: extra.actual ?? null,
  forecast: extra.forecast ?? null,
  previous: extra.previous ?? null,
  impact: extra.impact ?? 4,
  fingerprint: extra.fingerprint || extra.title.slice(0, 12),
  published_at: new Date(now - minsAgo * 60_000).toISOString(),
  absZ: extra.absZ,
});

test('CPI alto con economía débil no suma soporte', () => {
  const rows = attachRanks(classifyAgent([
    t(30, { title: 'UK CPI ACTUAL 3.8% FORECAST 3.2% PREVIOUS 3.1%', currencies: ['GBP'], actual: '3.8', forecast: '3.2', previous: '3.1' }),
    t(40, { title: 'UK retail sales miss: contraction, weak economy', currencies: ['GBP'], actual: '-0.7', forecast: '0.2', category: 'dato_macro' }),
    t(50, { title: 'UK PMI services falls below 50, slowdown', currencies: ['GBP'], actual: '48.1', forecast: '51.0' }),
  ], now));
  const gbp = rows.find((r) => r.currency === 'GBP');
  assert.ok(gbp.drivers.some((d) => /escasez relativa|no NFA/i.test(d)));
  assert.ok(gbp.score <= 0, `CPI+debilidad no puede ser soporte, score=${gbp.score}`);
});

test('CPI alto con economía en capacidad queda acotado, no long automático', () => {
  const rows = classifyAgent([
    t(20, { title: 'US CPI ACTUAL 3.4% FORECAST 3.1%', currencies: ['USD'], actual: '3.4', forecast: '3.1' }),
    t(25, { title: 'US payrolls beat, hot labor market expansion', currencies: ['USD'], actual: '250', forecast: '160' }),
    t(35, { title: 'US PMI jumps above 52, strong growth', currencies: ['USD'], actual: '56.0', forecast: '52.0' }),
  ], now);
  const usd = rows.find((r) => r.currency === 'USD');
  assert.ok(usd.score <= 40);
  assert.ok(!usd.drivers.some((d) => /escasez relativa/i.test(d)));
});

test('titular de déficit/downgrade no es presión automática (Mosler)', () => {
  const rows = classifyAgent([
    t(15, { title: 'France deficit cannot afford spending, downgrade fears', currencies: ['EUR'], category: 'analisis', impact: 3 }),
  ], now);
  const eur = rows.find((r) => r.currency === 'EUR');
  assert.equal(eur.score, 0);
  assert.ok(eur.drivers.some((d) => /déficit no es restricción/i.test(d)));
});

test('hike en régimen débil/cost-push no es soporte', () => {
  const rows = classifyAgent([
    t(10, { title: 'BoE hike as stagflation unsustainable economy persists', currencies: ['GBP'], category: 'banco_central' }),
    t(20, { title: 'UK CPI ACTUAL 4.1% FORECAST 3.5% weak economy', currencies: ['GBP'], actual: '4.1', forecast: '3.5' }),
    t(30, { title: 'UK PMI contracts below 50, recession fears', currencies: ['GBP'], actual: '47.0', forecast: '50.2' }),
  ], now);
  const gbp = rows.find((r) => r.currency === 'GBP');
  assert.ok(gbp.score <= 0, `hike+cost-push score=${gbp.score}`);
});

test('does not hike se trata como negación, no hawkish', () => {
  const rows = classifyAgent([
    t(12, { title: "Fed doesn't hike, holds rates", currencies: ['USD'], category: 'banco_central' }),
  ], now);
  const usd = rows.find((r) => r.currency === 'USD');
  assert.ok(usd.score <= 0);
});

test('desempleo invertido: alta vs forecast es presión', () => {
  const rows = classifyAgent([
    t(8, { title: 'US unemployment ACTUAL 4.5% FORECAST 4.1%', currencies: ['USD'], actual: '4.5', forecast: '4.1' }),
  ], now);
  const usd = rows.find((r) => r.currency === 'USD');
  assert.ok(usd.score < 0);
});

test('oficial de hace 20 días sigue en ventana (30 d), breaking de 20 días no', () => {
  const oldOff = t(20 * 24 * 60, { title: 'Updates to the October Monetary Policy Review', currencies: ['NZD'], source_type: 'oficial', category: 'banco_central', impact: 2 });
  const oldBrk = t(20 * 24 * 60, { title: 'Kiwi CPI miss ACTUAL 1.0 FORECAST 2.0', currencies: ['NZD'], actual: '1.0', forecast: '2.0' });
  const rows = attachRanks(classifyAgent([oldOff, oldBrk], now));
  const nzd = rows.find((r) => r.currency === 'NZD');
  assert.equal(nzd.noEvidence, false);
});

test('titular oficial de política cuenta como evidencia aunque el score sea 0', () => {
  const rows = attachRanks(classifyAgent([
    t(20, { title: 'Updates to the October Monetary Policy Review', currencies: ['NZD'], source_type: 'oficial', category: 'banco_central', impact: 2 }),
  ], now));
  const nzd = rows.find((r) => r.currency === 'NZD');
  assert.equal(nzd.noEvidence, false);
  assert.equal(typeof nzd.rank, 'number');
  assert.ok(nzd.drivers[0]);
  assert.ok(!/^sin catalizadores/i.test(nzd.drivers[0]));
});

test('sin titulares: N/D, score 0, rank null, no alerta de régimen', () => {
  const rows = attachRanks(classifyAgent([
    t(5, { title: 'US payrolls beat ACTUAL 250 FORECAST 160', currencies: ['USD'], actual: '250', forecast: '160' }),
  ], now));
  const chf = rows.find((r) => r.currency === 'CHF');
  const nzd = rows.find((r) => r.currency === 'NZD');
  assert.equal(chf.rank, null);
  assert.equal(nzd.rank, null);
  assert.equal(chf.score, 0);
  assert.ok(isNoEvidence(chf));
  const prev = rows.map((r) => ({ ...r }));
  const next = rows.map((r) => ({ ...r, bias: r.currency === 'CHF' ? 'alcista' : r.bias, score: r.currency === 'CHF' ? 0 : r.score }));
  const alerts = rankingAlerts(prev, next, 'Agente');
  assert.ok(!alerts.some((a) => a.currency === 'CHF' && a.alert_type === 'cambio_regimen'));
});

test('refugio geopolítico: USD/JPY/CHF soporte, NZD presión', () => {
  const rows = classifyAgent([
    t(6, { title: 'Missile attack closes Hormuz, war risk', currencies: ['USD', 'JPY', 'CHF', 'NZD'], category: 'geopolitica', impact: 5 }),
  ], now);
  assert.ok(rows.find((r) => r.currency === 'CHF').score > 0);
  assert.ok(rows.find((r) => r.currency === 'NZD').score < 0);
});

test('máximo 3 drivers y sesgo por umbral ±20', () => {
  const items = Array.from({ length: 8 }, (_, i) => t(10 + i, {
    title: `US payrolls beat ACTUAL ${200 + i} FORECAST 100`,
    currencies: ['USD'],
    actual: String(200 + i),
    forecast: '100',
  }));
  const usd = classifyAgent(items, now).find((r) => r.currency === 'USD');
  assert.ok(usd.drivers.length <= 3);
  assert.equal(biasFor(21), 'alcista');
  assert.equal(biasFor(-21), 'bajista');
  assert.equal(biasFor(0), 'neutral');
});

test('prompt Mosler veta CPI+debilidad y lenguaje de ejecución', () => {
  assert.match(MOSLER_RULES, /CPI\/inflación ALTO con economía DÉBIL/);
  assert.match(MOSLER_RULES, /Prohibido "long"/);
  assert.match(MOSLER_RULES, /fingerprint/);
});
