import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCurrencies, extractMacro, categorize, enrich, fingerprint, isRelevantOfficial, macroSurprise } from '../src/enrich.js';

const fj = { name: 'FinancialJuice', type: 'breaking' };
const now = new Date().toISOString();

test('currency keywords with capitals are case-sensitive ("US" vs "us")', () => {
  assert.deepEqual(detectCurrencies('Let us see what happens'), []);
  assert.deepEqual(detectCurrencies('US retail sales beat'), ['USD']);
  assert.deepEqual(detectCurrencies('Aussie jumps as RBA holds; kiwi lags'), ['AUD', 'NZD']);
});

test('extracts ACTUAL/FORECAST/PREVIOUS in the three source formats', () => {
  assert.deepEqual(extractMacro('AUSTRALIAN SERVICES PMI FLASH ACTUAL 47.8 (FORECAST -, PREVIOUS 51.9)'), { actual: '47.8', forecast: null, previous: '51.9' });
  assert.deepEqual(extractMacro('Australia S&P Global October Flash Services PMI at 47.8 vs 51.9 in September'), { actual: '47.8', forecast: null, previous: '51.9' });
  assert.deepEqual(extractMacro('Japan September 2026 Headline CPI 2.1% y/y (expected 2.1%)'), { actual: '2.1%', forecast: '2.1%', previous: null });
  assert.deepEqual(extractMacro('Trump ends remarks at the White House'), { actual: null, forecast: null, previous: null });
});

test('macro surprise flips sign for inverted indicators', () => {
  assert.equal(macroSurprise('US CPI', { actual: '3.1%', forecast: '2.9%' }).direction, 1);
  assert.equal(macroSurprise('US initial jobless claims', { actual: '250K', forecast: '220K' }).direction, -1);
});

test('auctions are market, previews are analysis', () => {
  const none = { actual: null };
  assert.equal(categorize('US 5-YEAR TIPS HIGH YIELD ACTUAL 2.367%', { actual: '2.367%' }, 'breaking'), 'mercado');
  assert.equal(categorize('ECB preview: MUFG sees October hold', none, 'agencia'), 'analisis');
  assert.equal(categorize('Minutes of the Monetary Policy Meeting', none, 'oficial'), 'banco_central');
});

test('agency bodies do not leak currencies or impact', () => {
  const item = enrich({ title: 'SK hynix drops US IPO plan', body: 'ECB hikes rates, yen, euro, sterling, aussie', published_at: now }, { name: 'InvestingLive', type: 'agencia' });
  assert.deepEqual(item.currencies, ['USD']);
  assert.ok(item.impact <= 2);
});

test('the FinancialJuice ❗ marker only breaks for FX-universe headlines', () => {
  assert.ok(enrich({ title: '❗ MOC IMBALANCE', published_at: now }, fj).impact < 4);
  assert.ok(enrich({ title: '❗ Traders no longer fully price in a Fed hike', published_at: now }, fj).impact >= 4);
});

test('fingerprint ignores word order and punctuation', () => {
  assert.equal(fingerprint('Fed holds rates, signals patience'), fingerprint('fed signals patience; holds rates'));
  assert.notEqual(fingerprint('Fed holds rates'), fingerprint('ECB holds rates'));
});

test('official relevance excludes institutional noise', () => {
  assert.equal(isRelevantOfficial('Monetary Policy Decision: rates unchanged'), true);
  assert.equal(isRelevantOfficial('Bank of Canada unveils new vertical $20 bank note'), false);
  assert.equal(isRelevantOfficial('Minutes of the London FXJSC Legal Sub Committee Meeting'), false);
});
