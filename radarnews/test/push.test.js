import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, deviceId } from '../src/db.js';
import { payloadFor } from '../src/push.js';

const sub = (n) => ({ endpoint: `https://web.push.apple.com/abc${n}`, keys: { p256dh: 'p', auth: 'a' } });

test('cada dispositivo queda registrado con su nombre sin exponer el endpoint', () => {
  const db = openDb(':memory:');
  db.savePushSubscription(sub(1), 'iPhone · app');
  db.savePushSubscription(sub(2), 'Mac · Chrome');
  db.savePushSubscription(sub(1), null);
  const devices = db.listPushDevices();
  assert.equal(devices.length, 2);
  assert.equal(devices[0].label, 'iPhone · app');
  assert.ok(devices.every((d) => d.endpoint === undefined && /^[0-9a-f]{12}$/.test(d.id)));

  db.markPushResult(sub(2).endpoint, '403 BadJwtToken');
  assert.equal(db.listPushDevices()[1].last_error, '403 BadJwtToken');
  db.markPushResult(sub(2).endpoint, null);
  assert.equal(db.listPushDevices()[1].last_error, null);
  assert.ok(db.listPushDevices()[1].last_ok_at);

  assert.equal(db.deletePushDevice(deviceId(sub(1).endpoint)), true);
  assert.deepEqual(db.listPushSubscriptions().map((s) => s.endpoint), [sub(2).endpoint]);
});

test('el push lleva el número de alertas sin leer para el icono', () => {
  const p = payloadFor({ id: 7, level: 'critico', title: 'Fed sube tipos', body: '50 pb' }, 3);
  assert.equal(p.badge, 3);
  assert.equal(p.tag, 'rn-7');
  assert.match(p.title, /Fed sube tipos/);
});
