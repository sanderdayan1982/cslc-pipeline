import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, deviceId } from './db.js';
import { spawn } from 'node:child_process';
import { refreshFeed } from './refreshFeed.js';
import { classifyCurrencies, ENGINE_LABEL } from './classifyCurrencies.js';
import { refreshCalendar, prealertsDue } from './calendar.js';
import { initPush, sendPush } from './push.js';
import { llmProvider, testGeminiKey } from './llm.js';
import { loadSettings, setSetting, publicSettings } from './settings.js';
import { devicesInfo } from './devices.js';
import { SYNC_INTERVAL_MS, CALENDAR_REFRESH_MS, SOURCES } from './config.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const DATA = process.env.RADARNEWS_DATA || join(ROOT, 'data');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

loadSettings(join(DATA, 'settings.json'));
const db = openDb(process.env.RADARNEWS_DB || join(DATA, 'radarnews.db'));
const vapidPublicKey = initPush(join(DATA, 'vapid.json'));
const clients = new Set();
let inFlight = null;
let lastError = null;
let nextSyncAt = Date.now();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}

async function deliver(alerts) {
  if (!alerts.length) return;
  broadcast('alerts', { alerts });
  try {
    await sendPush(db, alerts);
  } catch (err) {
    console.warn(`[push] ${err.message}`);
  }
}

async function syncCalendar() {
  try {
    const n = await refreshCalendar(db);
    console.log(`[calendario] ${n} eventos de la semana`);
  } catch (err) {
    console.warn(`[calendario] ${err.message}`);
    db.setMeta('calendar_error', { at: new Date().toISOString(), error: err.message });
  }
}

async function checkCalendar() {
  const ids = prealertsDue(db).map((a) => db.insertAlert(a));
  if (ids.length) await deliver(db.alertsSince(Math.min(...ids) - 1));
}

async function sync(trigger) {
  if (inFlight) return inFlight;
  broadcast('sync_start', { trigger });
  nextSyncAt = Date.now() + SYNC_INTERVAL_MS;
  inFlight = (async () => {
    const lastAlertId = db.listAlerts(1)[0]?.id ?? 0;
    try {
      const report = await refreshFeed(db);
      const needsBatch = report.inserted > 0 || db.latestBatch('agente').length === 0
        || (llmProvider() && db.latestBatch(llmProvider()).length === 0);
      const classified = needsBatch ? await classifyCurrencies(db) : null;
      lastError = report.health.every((h) => !h.ok) ? 'Ninguna fuente respondió' : null;
      const newAlerts = db.alertsSince(lastAlertId);
      await deliver(newAlerts);
      broadcast('sync_done', { error: lastError });
      console.log(`[sync:${trigger}] +${report.inserted} titulares · ${newAlerts.length} alertas${classified ? ` · motores: ${classified.results.map((r) => r.engine).join(', ')}` : ''}`);
      return { report, alerts: newAlerts };
    } catch (err) {
      lastError = err.message;
      broadcast('sync_done', { error: lastError });
      console.error(`[sync:${trigger}] ${err.stack}`);
      throw err;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function scoresByEngine() {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const engines = ['agente', llmProvider()].filter(Boolean);
  return engines.map((engine) => {
    const rows = db.latestBatch(engine);
    const history = {};
    for (const h of db.scoreHistory(engine, since)) (history[h.currency] ||= []).push([h.snapshot_at, h.score, h.rank]);
    return { engine, label: ENGINE_LABEL[engine] || engine, snapshot_at: rows[0]?.snapshot_at ?? null, regime_note: rows[0]?.regime_note ?? '', rows, history };
  });
}

function state() {
  return {
    now: new Date().toISOString(),
    last_sync: db.getMeta('last_sync'),
    next_sync_at: new Date(nextSyncAt).toISOString(),
    syncing: !!inFlight,
    error: lastError,
    llm: { provider: llmProvider(), label: ENGINE_LABEL[llmProvider()] ?? null, status: db.getMeta('llm_status') },
    sources: SOURCES.map((s) => ({ id: s.id, name: s.label || s.name, type: s.type })),
    news: db.listNews({ limit: 250 }),
    engines: scoresByEngine(),
    calendar: db.listCalendar(),
    calendar_sync: db.getMeta('calendar_sync'),
    settings: publicSettings(),
    push_devices: db.listPushSubscriptions().length,
    keep_awake: awake,
    platform: process.platform,
    alerts: db.listAlerts(25),
    unread: db.unreadCount(),
  };
}

// Compressed responses keep a cloud VM well inside free-tier egress (≈5× smaller).
function send(req, res, status, headers, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (buf.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    return res.end(gzipSync(buf));
  }
  res.writeHead(status, headers);
  res.end(buf);
}

function json(res, status, body) {
  send(res.req, res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, JSON.stringify(body));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 16_384) throw new Error('cuerpo demasiado grande');
  }
  return data ? JSON.parse(data) : {};
}

const etags = new Map();

async function serveStatic(req, res, pathname) {
  const file = normalize(join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'prohibido' });
  try {
    const { mtimeMs } = await stat(file);
    let entry = etags.get(file);
    if (!entry || entry.mtimeMs !== mtimeMs) {
      const body = await readFile(file);
      entry = { mtimeMs, body, etag: `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"` };
      etags.set(file, entry);
    }
    const headers = { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: entry.etag };
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    send(req, res, 200, headers, entry.body);
  } catch {
    json(res, 404, { error: 'no encontrado' });
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && pathname === '/api/state') return json(res, 200, state());
    if (req.method === 'POST' && pathname === '/api/refresh') {
      const out = await sync('manual');
      return json(res, 200, { inserted: out.report.inserted, alerts: out.alerts.length, health: out.report.health });
    }
    if (req.method === 'POST' && pathname === '/api/alerts/read-all') return json(res, 200, { updated: db.markAllRead() });
    if (req.method === 'GET' && pathname === '/api/push/key') return json(res, 200, { publicKey: vapidPublicKey });
    if (req.method === 'POST' && pathname === '/api/push/subscribe') {
      const body = await readBody(req);
      const sub = body?.subscription ?? body;
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'suscripción inválida' });
      if (!/^https:\/\//.test(sub.endpoint)) return json(res, 400, { error: 'endpoint no válido' });
      const label = typeof body.label === 'string' ? body.label.slice(0, 60) : null;
      db.savePushSubscription(sub, label);
      return json(res, 200, { ok: true, id: deviceId(sub.endpoint) });
    }
    if (req.method === 'GET' && pathname === '/api/push/devices') return json(res, 200, { devices: db.listPushDevices() });
    if (req.method === 'POST' && pathname === '/api/push/devices/remove') {
      const { id } = await readBody(req);
      return json(res, 200, { removed: db.deletePushDevice(String(id || '')) });
    }
    if (req.method === 'POST' && pathname === '/api/push/test') {
      const devices = db.listPushDevices().length;
      const sent = await sendPush(db, [{ id: Date.now(), level: 'alto', title: 'Prueba de RadarNews', body: 'Si ves esto, las alertas llegan a este dispositivo.' }]);
      return json(res, 200, { sent, devices, list: db.listPushDevices() });
    }
    if (req.method === 'GET' && pathname === '/api/devices') {
      const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
      return json(res, 200, await devicesInfo(PORT, `${proto}://${req.headers.host}`));
    }
    if (req.method === 'GET' && pathname === '/api/settings') return json(res, 200, publicSettings());
    if (req.method === 'POST' && pathname === '/api/settings/gemini') {
      const { key } = await readBody(req);
      const clean = typeof key === 'string' ? key.trim() : '';
      if (clean) {
        if (!/^[\w-]{20,200}$/.test(clean)) return json(res, 400, { error: 'Formato de clave no válido' });
        const test = await testGeminiKey(clean);
        if (!test.ok) return json(res, 400, { error: test.error });
      }
      setSetting('GEMINI_API_KEY', clean);
      console.log(`[ajustes] clave Gemini ${clean ? 'guardada' : 'eliminada'}`);
      if (clean) {
        const lastAlertId = db.listAlerts(1)[0]?.id ?? 0;
        broadcast('sync_start', { trigger: 'ajustes' });
        classifyCurrencies(db)
          .then(() => deliver(db.alertsSince(lastAlertId)))
          .catch((e) => console.warn(`[ajustes] ${e.message}`))
          .finally(() => broadcast('sync_done', { error: lastError }));
      } else {
        broadcast('sync_done', { error: lastError });
      }
      return json(res, 200, publicSettings());
    }
    if (req.method === 'GET' && pathname === '/api/spec') {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      return res.end(await readFile(join(ROOT, 'SPEC.md')));
    }
    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': conectado\n\n');
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (req.method === 'GET') return serveStatic(req, res, pathname);
    json(res, 405, { error: 'método no permitido' });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

// The Mac is the server: if it idles into sleep, iPhones stop receiving alerts.
// caffeinate -w ties the assertion to this process, so it ends when RadarNews stops.
function keepAwake() {
  if (process.platform !== 'darwin' || process.env.RADARNEWS_KEEP_AWAKE === '0') return false;
  try {
    spawn('/usr/bin/caffeinate', ['-i', '-s', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref();
    return true;
  } catch (err) {
    console.warn(`[reposo] ${err.message}`);
    return false;
  }
}
const awake = keepAwake();

server.listen(PORT, HOST, async () => {
  const llm = llmProvider();
  console.log(`RadarNews en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} · motores: Agente${llm ? ` + ${ENGINE_LABEL[llm]}` : ' (sin GEMINI_API_KEY)'}`);
  await syncCalendar();
  sync('arranque').catch(() => {});
  setInterval(() => sync('auto').catch(() => {}), SYNC_INTERVAL_MS);
  setInterval(syncCalendar, CALENDAR_REFRESH_MS);
  setInterval(() => checkCalendar().catch((e) => console.warn(`[calendario] ${e.message}`)), 60_000);
});
