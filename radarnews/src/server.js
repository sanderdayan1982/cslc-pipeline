import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import compression from 'compression';
import express from 'express';
import QRCode from 'qrcode';
import webpush from 'web-push';
import { HOST, PORT, SOURCES, WINDOWS, GEMINI_MODEL } from './config.js';
import { openDb, listNews, latestEngine, listAlerts, unreadCount, markAlertsRead, listCalendar, saveDevice, listDevices, removeDevice, touchDeviceOk, touchDeviceErr } from './db.js';
import { refreshFeed } from './refreshFeed.js';
import { fetchMarket } from './market.js';
import { turboEvent } from './calendar.js';
import { publicGemini, readSettings, writeSettings } from './settings.js';
import { testGeminiKey } from './llm.js';

const exec = promisify(execFile);
const SRC = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(SRC);
const PUBLIC = join(ROOT, 'public');
const SPEC = join(ROOT, 'SPEC.md');

const db = openDb();
const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});
app.use(express.static(PUBLIC, { etag: true, maxAge: '2h', extensions: ['html'] }));

const sse = new Set();
let lastSync = null;
let syncing = false;
let lastError = null;
let market = { updated_at: null, basketPct: {}, pairs: {} };
let llmStatus = { provider: 'gemini', ok: true, error: null, at: null };

function ensureVapid() {
  const s = readSettings();
  if (!s.vapid) {
    s.vapid = webpush.generateVAPIDKeys();
    writeSettings(s);
  }
  webpush.setVapidDetails('mailto:radarnews@localhost', s.vapid.publicKey, s.vapid.privateKey);
  return s.vapid;
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`;
  for (const res of sse) {
    try { res.write(payload); } catch { sse.delete(res); }
  }
}

async function sendPush(alerts) {
  ensureVapid();
  const devices = listDevices(db);
  const unread = unreadCount(db);
  const top = alerts.slice(0, 4);
  const rest = alerts.length - top.length;
  const payloads = top.map((a) => ({ title: a.title, body: a.body || '', tag: `rn-${a.alert_type || 'a'}`, url: '/', badge: unread }));
  if (rest > 0) payloads.push({ title: `+${rest} alertas más`, body: 'Abre RadarNews para el resto.', tag: 'rn-more', url: '/', badge: unread });
  for (const d of devices) {
    for (const p of payloads) {
      try {
        await webpush.sendNotification(d.subscription, JSON.stringify(p));
        touchDeviceOk(db, d.id);
      } catch (err) {
        const status = err.statusCode;
        if (status === 404 || status === 410) removeDevice(db, d.id);
        else touchDeviceErr(db, d.id, err.body || err.message);
      }
    }
  }
  return { sent: devices.length, devices: devices.length };
}

export async function runSync() {
  if (syncing) return lastSync;
  syncing = true;
  lastError = null;
  broadcast('sync_start', {});
  try {
    const result = await refreshFeed(db);
    lastSync = result;
    try { market = await fetchMarket(); } catch { /* keep last */ }
    const g = publicGemini(readSettings());
    llmStatus = { provider: 'gemini', ok: true, error: null, at: result.finished_at };
    if (g.configured) {
      /* llm errors are stored as alerts; status flipped if last gemini snapshot lags */
    }
    if (result.new_alerts?.length) {
      broadcast('alerts', { alerts: result.new_alerts.slice(0, 8) });
      sendPush(result.new_alerts).catch(() => {});
    }
    broadcast('sync_done', { inserted: result.inserted });
    return result;
  } catch (err) {
    lastError = String(err.message || err);
    llmStatus = { ...llmStatus, ok: false, error: lastError, at: new Date().toISOString() };
    throw err;
  } finally {
    syncing = false;
  }
}

function state() {
  const settings = readSettings();
  const gemini = publicGemini(settings);
  const engines = ['agente', 'gemini'].map((e) => latestEngine(db, e)).filter(Boolean);
  const cal = listCalendar(db);
  const turbo = turboEvent(cal);
  return {
    now: new Date().toISOString(),
    last_sync: lastSync,
    next_sync_at: new Date(Date.now() + (turbo ? WINDOWS.turboMs : WINDOWS.refreshMs)).toISOString(),
    syncing,
    turbo: turbo ? { currency: turbo.currency, title: turbo.title } : null,
    error: lastError,
    llm: { provider: gemini.configured ? 'gemini' : null, label: 'Gemini', status: llmStatus },
    sources: SOURCES.map(({ id, name, type }) => ({ id, name, type })),
    news: listNews(db, 250),
    engines,
    market,
    calendar: cal,
    calendar_sync: lastSync?.calendar_sync || null,
    settings: { gemini: { configured: gemini.configured, masked: gemini.masked, origin: gemini.origin, model: gemini.model } },
    push_devices: listDevices(db).length,
    keep_awake: process.platform === 'darwin',
    platform: process.platform,
    alerts: listAlerts(db, 25),
    unread: unreadCount(db),
  };
}

app.get('/api/state', (_req, res) => res.json(state()));
app.get('/api/settings', (_req, res) => res.json(state().settings));
app.get('/api/spec', (_req, res) => {
  if (!existsSync(SPEC)) return res.status(404).type('text').send('SPEC.md no encontrado');
  res.type('text/markdown').send(readFileSync(SPEC, 'utf8'));
});
app.get('/api/push/key', (_req, res) => res.json({ publicKey: ensureVapid().publicKey }));
app.get('/api/push/devices', (_req, res) => {
  res.json({
    devices: listDevices(db).map(({ subscription, ...d }) => d),
  });
});
app.post('/api/push/subscribe', (req, res) => {
  const subscription = req.body?.subscription;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Suscripción inválida' });
  const id = req.body.id || randomUUID();
  saveDevice(db, { id, label: req.body.label || 'Dispositivo', subscription });
  res.json({ id });
});
app.post('/api/push/devices/remove', (req, res) => {
  removeDevice(db, req.body?.id);
  res.json({ ok: true });
});
app.post('/api/push/test', async (_req, res) => {
  const r = await sendPush([{ title: 'Prueba RadarNews', body: 'Alertas activas en este dispositivo.', alert_type: 'titular', level: 'alto' }]);
  res.json(r);
});
app.post('/api/alerts/read-all', (_req, res) => {
  markAlertsRead(db);
  res.json({ ok: true });
});
app.post('/api/refresh', async (_req, res) => {
  try {
    const r = await runSync();
    res.json({ ok: true, inserted: r.inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/settings/gemini', async (req, res) => {
  const settings = readSettings();
  const key = String(req.body?.key || '').trim();
  if (!key) {
    settings.gemini = { key: '', model: GEMINI_MODEL };
    writeSettings(settings);
    return res.json({ ok: true, removed: true });
  }
  try {
    const probed = await testGeminiKey(key);
    settings.gemini = { key, model: probed.model };
    writeSettings(settings);
    llmStatus = { provider: 'gemini', ok: true, error: null, at: new Date().toISOString() };
    res.json({ ok: true, model: probed.model });
    runSync().catch(() => {});
  } catch (err) {
    res.status(400).json({ error: err.message || 'Clave inválida' });
  }
});
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write('event: hello\ndata: {}\n\n');
  sse.add(res);
  req.on('close', () => sse.delete(res));
});
app.get('/api/devices', async (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const url = process.env.RADARNEWS_URL || `${proto}://${host}`;
  let tailscale = { installed: false, running: false, dns: '' };
  try {
    const { stdout } = await exec('tailscale', ['status', '--json'], { timeout: 4000 });
    const j = JSON.parse(stdout);
    tailscale = { installed: true, running: true, dns: j.Self?.DNSName || j.Self?.HostName || '' };
  } catch (err) {
    tailscale = { installed: err.code !== 'ENOENT', running: false, dns: '' };
  }
  const secure = /^https:\/\/.+\.ts\.net/i.test(url) || process.env.RADARNEWS_SECURE === '1';
  let qr = '';
  try { qr = `<img alt="QR" src="${await QRCode.toDataURL(url, { margin: 1, width: 180 })}" />`; } catch { qr = ''; }
  res.json({
    url,
    secure,
    qr,
    command: 'sudo tailscale serve --bg --https=443 localhost:4700',
    tailscale,
  });
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(join(PUBLIC, 'index.html'));
});

function loop() {
  const cal = listCalendar(db);
  const wait = turboEvent(cal) ? WINDOWS.turboMs : WINDOWS.refreshMs;
  setTimeout(async () => {
    try { await runSync(); } catch (err) { console.error('sync', err.message); }
    loop();
  }, wait);
}

if (process.env.RADARNEWS_NO_LISTEN !== '1') {
  ensureVapid();
  app.listen(PORT, HOST, () => {
    console.log(`RadarNews http://${HOST}:${PORT}`);
    runSync().catch((err) => console.error('initial sync', err.message));
    loop();
  });
}

export { app, db };
