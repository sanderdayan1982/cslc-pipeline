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
