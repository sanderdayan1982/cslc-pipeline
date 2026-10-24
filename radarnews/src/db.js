import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.js';
import { dedupeNews, fingerprint, normalizeStoredNews, surpriseZ } from './enrich.js';

export function openDb(file = join(DATA_DIR, 'radarnews.db')) {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT,
      source TEXT,
      source_id TEXT,
      source_type TEXT,
      url TEXT,
      published_at TEXT,
      currencies TEXT,
      impact INTEGER,
      category TEXT,
      actual TEXT,
      forecast TEXT,
      previous TEXT,
      calendar_title TEXT,
      fingerprint TEXT UNIQUE,
      z REAL,
      absZ REAL,
      alert_created INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      currency TEXT,
      score INTEGER,
      bias TEXT,
      drivers TEXT,
      rationale TEXT,
      rank INTEGER,
      batch_id TEXT,
      regime_note TEXT,
      engine TEXT,
      snapshot_at TEXT,
      structural INTEGER,
      impulse INTEGER,
      setup TEXT
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      body TEXT,
      level TEXT,
      alert_type TEXT,
      currency TEXT,
      news_item_id INTEGER,
      is_read INTEGER DEFAULT 0,
      occurred_at TEXT
    );
    CREATE TABLE IF NOT EXISTS calendar (
      id TEXT PRIMARY KEY,
      title TEXT,
      currency TEXT,
      event_at TEXT,
      impact TEXT,
      forecast TEXT,
      previous TEXT,
      actual TEXT,
      news_item_id INTEGER,
      prealerted INTEGER DEFAULT 0,
      week_start TEXT
    );
    CREATE TABLE IF NOT EXISTS push_devices (
      id TEXT PRIMARY KEY,
      label TEXT,
      subscription TEXT,
      created_at TEXT,
      last_ok_at TEXT,
      last_error TEXT,
      last_error_at TEXT
    );
    CREATE INDEX IF NOT EXISTS news_pub ON news(published_at DESC);
    CREATE INDEX IF NOT EXISTS scores_snap ON scores(engine, snapshot_at);
  `);
  return db;
}

const json = (v) => JSON.stringify(v ?? null);
const parseJson = (v, fallback) => {
  try { return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};

export function insertNews(db, item) {
  const stmt = db.prepare(`INSERT OR IGNORE INTO news
    (title, body, source, source_id, source_type, url, published_at, currencies, impact, category, actual, forecast, previous, calendar_title, fingerprint, z, absZ)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const info = stmt.run(
    item.title, item.body || '', item.source, item.source_id || '', item.source_type,
    item.url || '', item.published_at, json(item.currencies || []),
    item.impact ?? 1, item.category || 'otro',
    item.actual, item.forecast, item.previous, item.calendar_title,
    item.fingerprint, item.z ?? null, item.absZ ?? null,
  );
  return info.changes > 0;
}

export function listNews(db, limit = 250) {
  return dedupeNews(db.prepare('SELECT * FROM news ORDER BY published_at DESC, id DESC LIMIT ?').all(limit).map(mapNews));
}

export function recentNews(db, sinceIso) {
  return dedupeNews(db.prepare('SELECT * FROM news WHERE published_at >= ? ORDER BY published_at DESC').all(sinceIso).map(mapNews));
}

function mapNews(r) {
  return normalizeStoredNews({
    ...r,
    currencies: parseJson(r.currencies, []),
    alert_created: !!r.alert_created,
    captured_at: r.created_at,
  });
}

export function saveScores(db, engine, rows, batchId, snapshotAt, regimeNote = '') {
  const stmt = db.prepare(`INSERT INTO scores
    (currency, score, bias, drivers, rationale, rank, batch_id, regime_note, engine, snapshot_at, structural, impulse, setup)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const r of rows) {
    stmt.run(
      r.currency, r.score, r.bias, json(r.drivers), r.rationale,
      r.rank, batchId, regimeNote, engine, snapshotAt,
      r.structural ?? r.score, r.impulse == null ? null : r.impulse, r.setup || '',
    );
  }
}

export function latestEngine(db, engine) {
  const snap = db.prepare('SELECT snapshot_at, regime_note, batch_id FROM scores WHERE engine=? ORDER BY snapshot_at DESC LIMIT 1').get(engine);
  if (!snap) return null;
  const rows = db.prepare('SELECT * FROM scores WHERE engine=? AND snapshot_at=?').all(engine, snap.snapshot_at).map((r) => ({
    ...r,
    drivers: parseJson(r.drivers, []),
  }));
  const history = {};
  const hist = db.prepare(`SELECT currency, snapshot_at, score, rank FROM scores WHERE engine=? ORDER BY snapshot_at ASC`).all(engine);
  for (const h of hist) {
    (history[h.currency] ||= []).push([h.snapshot_at, h.score, h.rank]);
  }
  for (const c of Object.keys(history)) history[c] = history[c].slice(-48);
  return { engine, label: engine === 'gemini' ? 'Gemini' : 'Agente', snapshot_at: snap.snapshot_at, regime_note: snap.regime_note || '', rows, history };
}

export function insertAlert(db, a) {
  db.prepare(`INSERT INTO alerts (title, body, level, alert_type, currency, news_item_id, occurred_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    a.title, a.body || '', a.level || 'alto', a.alert_type, a.currency || null,
    a.news_item_id || null, a.occurred_at || new Date().toISOString(),
  );
}

export function listAlerts(db, limit = 25) {
  return db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT ?').all(limit).map((a) => ({ ...a, is_read: !!a.is_read }));
}

export function unreadCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE is_read=0').get().n;
}

export function markAlertsRead(db) {
  db.exec('UPDATE alerts SET is_read=1');
}

export function upsertCalendar(db, events, weekStart) {
  const stmt = db.prepare(`INSERT INTO calendar (id, title, currency, event_at, impact, forecast, previous, actual, news_item_id, prealerted, week_start)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,
      forecast=COALESCE(excluded.forecast, forecast),
      previous=COALESCE(excluded.previous, previous),
      actual=COALESCE(excluded.actual, actual),
      news_item_id=COALESCE(excluded.news_item_id, news_item_id),
      impact=excluded.impact,
      event_at=excluded.event_at,
      week_start=excluded.week_start`);
  for (const e of events) {
    stmt.run(e.id, e.title, e.currency, e.event_at, e.impact, e.forecast, e.previous, e.actual, e.news_item_id, e.prealerted || 0, weekStart);
  }
}

export function persistCalendarLinks(db, events) {
  const stmt = db.prepare(`UPDATE calendar SET
    actual=COALESCE(?, actual),
    news_item_id=COALESCE(?, news_item_id)
    WHERE id=?`);
  for (const e of events) {
    stmt.run(e.actual || null, e.news_item_id || null, e.id);
  }
}

export function persistNewsLinks(db, news) {
  const stmt = db.prepare(`UPDATE news SET calendar_title=COALESCE(?, calendar_title), actual=COALESCE(?, actual), forecast=COALESCE(?, forecast), previous=COALESCE(?, previous) WHERE id=?`);
  for (const n of news) {
    if (!n.id) continue;
    stmt.run(n.calendar_title || null, n.actual || null, n.forecast || null, n.previous || null, n.id);
  }
}

export function repairPersistedNews(db) {
  const rows = db.prepare('SELECT * FROM news ORDER BY id ASC').all();
  const upd = db.prepare(`UPDATE news SET title=?, url=?, published_at=?, currencies=?, category=?, actual=COALESCE(?, actual), forecast=COALESCE(?, forecast), previous=COALESCE(?, previous), fingerprint=?, z=?, absZ=?, impact=? WHERE id=?`);
  const merge = db.prepare(`UPDATE news SET actual=COALESCE(actual, ?), forecast=COALESCE(forecast, ?), previous=COALESCE(previous, ?) WHERE id=?`);
  const del = db.prepare('DELETE FROM news WHERE id=?');
  const byFp = new Map();
  db.exec('BEGIN');
  try {
    for (const raw of rows) {
      const n = mapNews(raw);
      const z = surpriseZ(n);
      const fp = fingerprint(n.title, n.url);
      if (byFp.has(fp)) {
        merge.run(n.actual, n.forecast, n.previous, byFp.get(fp));
        del.run(n.id);
        continue;
      }
      try {
        upd.run(
          n.title, n.url, n.published_at, json(n.currencies), n.category,
          n.actual, n.forecast, n.previous, fp, z.z, z.absZ, n.impact ?? raw.impact, n.id,
        );
        byFp.set(fp, n.id);
      } catch {
        const keep = db.prepare('SELECT id FROM news WHERE fingerprint=?').get(fp);
        if (keep && keep.id !== n.id) {
          merge.run(n.actual, n.forecast, n.previous, keep.id);
          del.run(n.id);
        } else {
          byFp.set(fp, n.id);
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listCalendar(db) {
  return db.prepare('SELECT * FROM calendar ORDER BY event_at ASC').all();
}

export function saveDevice(db, { id, label, subscription }) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO push_devices (id, label, subscription, created_at) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET label=excluded.label, subscription=excluded.subscription`).run(id, label, json(subscription), now);
}

export function listDevices(db) {
  return db.prepare('SELECT * FROM push_devices').all().map((d) => ({ ...d, subscription: parseJson(d.subscription, null) }));
}

export function removeDevice(db, id) {
  db.prepare('DELETE FROM push_devices WHERE id=?').run(id);
}

export function touchDeviceOk(db, id) {
  db.prepare(`UPDATE push_devices SET last_ok_at=?, last_error=NULL WHERE id=?`).run(new Date().toISOString(), id);
}

export function touchDeviceErr(db, id, err) {
  db.prepare(`UPDATE push_devices SET last_error=?, last_error_at=? WHERE id=?`).run(String(err).slice(0, 300), new Date().toISOString(), id);
}
