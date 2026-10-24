import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseModelJson, GEMINI_JSON_INSTRUCTIONS } from '../src/llm.js';
import { MOSLER_RULES } from '../src/classifyCurrencies.js';
import { GEMINI_MODEL } from '../src/config.js';

test('modelo Gemini pinneado al free-tier estable', () => {
  assert.equal(GEMINI_MODEL, 'gemini-3.8-flash');
});

test('prompt obliga a citar fingerprints y veta alucinación regional', () => {
  const prompt = buildPrompt([
    { fingerprint: 'abc123', title: 'RBNZ OCR held', currencies: ['NZD'], published_at: '2026-10-23T00:00:00Z', source: 'RBNZ' },
  ]);
  assert.match(prompt, /abc123/);
  assert.match(prompt, /RBNZ OCR held/);
  assert.match(prompt, /Mosler/);
  assert.match(prompt, /Sin catalizadores/);
});

test('Gemini sin campo impulse no finge un 0 táctico', () => {
  const news = [{ fingerprint: 'fff', title: 'Fed hike', currencies: ['USD'] }];
  const parsed = parseModelJson(JSON.stringify({
    rows: [{ currency: 'USD', score: 30, drivers: ['Fed hike'], rationale: 'cita', citations: ['fff'] }],
  }), news);
  const usd = parsed.rows.find((r) => r.currency === 'USD');
  assert.equal(usd.impulse, null);
});

test('salida JSON se rellena a 8 divisas y anula scores sin citas', () => {
  const news = [{ fingerprint: 'fff', title: 'Fed hike', currencies: ['USD'] }];
  const parsed = parseModelJson(JSON.stringify({
    regime_note: 'USD único con evidencia',
    rows: [
      { currency: 'USD', score: 30, drivers: ['Fed hike'], rationale: 'cita fff', citations: ['fff'] },
      { currency: 'NZD', score: 22, drivers: ['arrastre Australia'], rationale: 'sin titular', citations: [] },
    ],
  }), news);
  const nzd = parsed.rows.find((r) => r.currency === 'NZD');
  const usd = parsed.rows.find((r) => r.currency === 'USD');
  assert.equal(usd.score, 30);
  assert.equal(nzd.score, 0);
  assert.ok(isNaN(nzd.rank) || nzd.noEvidence || nzd.drivers[0].startsWith('Sin catalizadores'));
  assert.equal(parsed.rows.length, 8);
});

test('instrucciones prohíben long/short', () => {
  assert.match(GEMINI_JSON_INSTRUCTIONS + MOSLER_RULES, /long/);
});

test('rationale de Gemini se limpia de hashes fingerprint', () => {
  const news = [{ fingerprint: '322b654e2a51299ea878b062612715314913c08', title: 'SECO raises growth', currencies: ['CHF'] }];
  const parsed = parseModelJson(JSON.stringify({
    rows: [{
      currency: 'CHF',
      score: 25,
      drivers: ['Revisión al alza'],
      rationale: 'SECO [322b654e2a51299ea878b062612715314913c08] eleva previsión.',
      citations: ['322b654e2a51299ea878b062612715314913c08'],
    }],
  }), news);
  const chf = parsed.rows.find((r) => r.currency === 'CHF');
  assert.doesNotMatch(chf.rationale, /322b654e2a/);
  assert.match(chf.rationale, /SECO/);
});
