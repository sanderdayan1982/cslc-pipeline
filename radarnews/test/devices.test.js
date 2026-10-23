import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTailscale } from '../src/devices.js';

const status = { BackendState: 'Running', Self: { DNSName: 'mac-de-sander.tail1234.ts.net.' } };

test('Tailscale sirviendo el puerto de RadarNews da la URL HTTPS para iPhone y iPad', () => {
  const serve = { Web: { 'mac-de-sander.tail1234.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4700' } } } } };
  const info = parseTailscale(JSON.stringify(status), JSON.stringify(serve), 4700);
  assert.equal(info.running, true);
  assert.equal(info.serving, true);
  assert.equal(info.url, 'https://mac-de-sander.tail1234.ts.net');
});

test('Tailscale activo pero sin servir RadarNews no da URL', () => {
  const other = { Web: { 'x:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:47000' } } } } };
  assert.equal(parseTailscale(status, other, 4700).url, null);
  assert.equal(parseTailscale(status, {}, 4700).serving, false);
  assert.equal(parseTailscale({ BackendState: 'Stopped', Self: {} }, {}, 4700).dns, null);
});
