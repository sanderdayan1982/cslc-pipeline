import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, setSetting, publicSettings } from '../src/settings.js';
import { llmProvider } from '../src/llm.js';

test('la clave guardada en la app activa Gemini, se enmascara y se guarda con permisos 600', () => {
  delete process.env.GEMINI_API_KEY;
  const file = join(mkdtempSync(join(tmpdir(), 'rn-settings-')), 'settings.json');
  loadSettings(file);
  assert.equal(publicSettings().gemini.configured, false);

  setSetting('GEMINI_API_KEY', 'AIzaSyTEST0123456789abcdWXYZ');
  assert.equal(llmProvider(), 'gemini');
  const pub = publicSettings().gemini;
  assert.equal(pub.masked, 'AIza…WXYZ');
  assert.equal(pub.origin, 'app');
  assert.ok(!JSON.stringify(pub).includes('TEST0123'));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).GEMINI_API_KEY, 'AIzaSyTEST0123456789abcdWXYZ');

  loadSettings(file);
  assert.equal(process.env.GEMINI_API_KEY, 'AIzaSyTEST0123456789abcdWXYZ');

  setSetting('GEMINI_API_KEY', '');
  assert.equal(llmProvider(), null);
  assert.throws(() => setSetting('OTRA', 'x'));
});
