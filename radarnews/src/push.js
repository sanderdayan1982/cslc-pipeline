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

export function payloadFor(alert, badge = null) {
  return {
    title: `${LEVEL_PREFIX[alert.level] ?? ''}${alert.title}`.slice(0, 120),
    body: (alert.body || '').slice(0, 240),
    tag: `rn-${alert.id ?? Date.now()}`,
    url: '/',
    badge,
  };
}

// Every subscribed device (each iPhone, iPad and Mac) receives every alert; devices are sent to in parallel.
export async function sendPush(db, alerts) {
  const subs = db.listPushSubscriptions();
  if (!subs.length || !alerts.length) return 0;
  const badge = db.unreadCount();
  const rank = { critico: 0, alto: 1, medio: 2 };
  const ordered = [...alerts].sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3));
  const payloads = ordered.slice(0, MAX_PUSH_PER_CYCLE).map((a) => payloadFor(a, badge));
  if (ordered.length > MAX_PUSH_PER_CYCLE) {
    payloads.push({ title: `RadarNews · ${ordered.length - MAX_PUSH_PER_CYCLE} alertas más`, body: 'Abre el centro de alertas para ver el resto.', tag: 'rn-summary', url: '/', badge });
  }
  const perDevice = await Promise.all(subs.map(async (sub) => {
    let sent = 0;
    for (const p of payloads) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(p), { TTL: 6 * 3600, urgency: 'high' });
        sent += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.deletePushSubscription(sub.endpoint);
          return sent;
        }
        db.markPushResult(sub.endpoint, `${err.statusCode || ''} ${err.body || err.message}`.trim());
        console.warn(`[push] ${err.statusCode || ''} ${err.message}`);
        return sent;
      }
    }
    db.markPushResult(sub.endpoint, null);
    return sent;
  }));
  return perDevice.reduce((a, b) => a + b, 0);
}
