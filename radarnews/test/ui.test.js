import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIAS_LABEL, GEMINI_MODEL } from '../src/config.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('UI muestra Soporte/Presión/N/D, no sesgo de ejecución', () => {
  assert.equal(BIAS_LABEL.alcista, 'Soporte');
  assert.equal(BIAS_LABEL.bajista, 'Presión');
  assert.match(app, /BIAS_LABEL|Soporte/);
  assert.doesNotMatch(app, /Sesgo Largo/);
  assert.doesNotMatch(app, /vía libre operativa/);
  assert.match(app, /Soporte relativo|presión narrativa|Ficha comparativa/i);
});

test('ficha y ajustes hablan de narrativa Mosler, no de operar', () => {
  assert.match(html, /Fuerza narrativa/);
  assert.match(html, /Mosler|NFA|sin sesgo de ejecución/i);
  assert.doesNotMatch(html, /ficha operativa/i);
});

test('modelo anunciado es gemini-3.8-flash', () => {
  assert.equal(GEMINI_MODEL, 'gemini-3.8-flash');
});

test('ranking no aprieta meta y driver en una sola línea nowrap', () => {
  assert.match(app, /class="ccy-meta"/);
  assert.match(app, /class="driver"/);
  assert.match(app, /function cleanRationale/);
  assert.doesNotMatch(app, /ccy-sub/);
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /ccy-meta/);
  assert.match(css, /-webkit-line-clamp:\s*2/);
  assert.doesNotMatch(css, /\.ccy-sub \.driver \{[^}]*white-space:\s*nowrap/);
});

test('cruces no venden Flujo confirmado ni dejan el spot en blanco', () => {
  assert.doesNotMatch(app, /Flujo confirmado/);
  assert.match(app, /Alineado con spot/);
  assert.match(app, /sin precio/);
  assert.match(app, /datos degradados/i);
  assert.match(app, /fmtImpulse/);
  assert.match(app, /BIAS_THRESHOLD = 12/);
});

test('la metodología declara Mosler/MMT, umbral ±12 y fechas reales', () => {
  const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
  assert.match(spec, /Marco interpretativo/);
  assert.match(spec, /datos degradados/);
  assert.match(spec, /alcista > 12/);
  assert.match(spec, /fecha de publicación/);
});
