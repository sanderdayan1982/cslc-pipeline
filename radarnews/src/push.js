import webpush from 'web-push';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_PUSH_PER_CYCLE = 4;
const LEVEL_PREFIX = { critico: '🔴 ', alto: '🟠 ', medio: '' };

export function initPush(keyPath) {
  let keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else if (existsSync(keyPath)) {
    keys = JSON.parse(readFileSync(keyPath, 'utf8'));
  } else {
    keys = webpush.generateVAPIDKeys();
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, JSON.stringify(keys, null, 2), { mode: 0o600 });
  }
  // VAPID requires a contact URI; a URL is used because the product forbids email channels.
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://github.com/radarnews', keys.publicKey, keys.privateKey);
  return keys.publicKey;
}

export function payloadFor(alert) {
  return {
    title: `${LEVEL_PREFIX[alert.level] ?? ''}${alert.title}`.slice(0, 120),
    body: (alert.body || '').slice(0, 240),
    tag: `rn-${alert.id ?? Date.now()}`,
    url: '/',
  };
}

export async function sendPush(db, alerts) {
  const subs = db.listPushSubscriptions();
  if (!subs.length || !alerts.length) return 0;
  const ordered = [...alerts].sort((a, b) => ({ critico: 0, alto: 1, medio: 2 }[a.level] - { critico: 0, alto: 1, medio: 2 }[b.level]));
  const payloads = ordered.slice(0, MAX_PUSH_PER_CYCLE).map(payloadFor);
  if (ordered.length > MAX_PUSH_PER_CYCLE) {
    payloads.push({ title: `RadarNews · ${ordered.length - MAX_PUSH_PER_CYCLE} alertas más`, body: 'Abre el centro de alertas para ver el resto.', tag: 'rn-summary', url: '/' });
  }
  let sent = 0;
  for (const sub of subs) {
    for (const p of payloads) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(p), { TTL: 3600, urgency: 'high' });
        sent += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.deletePushSubscription(sub.endpoint);
          break;
        }
        console.warn(`[push] ${err.statusCode || ''} ${err.message}`);
      }
    }
  }
  return sent;
}
