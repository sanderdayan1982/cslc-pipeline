import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS news_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('breaking','oficial','agencia','local')),
  url TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL,
  currencies TEXT NOT NULL DEFAULT '[]',
  impact INTEGER NOT NULL CHECK (impact BETWEEN 1 AND 5),
  category TEXT NOT NULL CHECK (category IN ('dato_macro','banco_central','geopolitica','mercado','analisis','otro')),
  actual TEXT, forecast TEXT, previous TEXT,
  calendar_title TEXT,
  fingerprint TEXT NOT NULL UNIQUE,
  alert_created INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_news_published ON news_items (published_at DESC);

CREATE TABLE IF NOT EXISTS currency_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  currency TEXT NOT NULL CHECK (currency IN ('USD','EUR','GBP','JPY','CHF','CAD','AUD','NZD')),
  score INTEGER NOT NULL CHECK (score BETWEEN -100 AND 100),
  bias TEXT NOT NULL CHECK (bias IN ('alcista','bajista','neutral')),
  drivers TEXT NOT NULL DEFAULT '[]',
  rationale TEXT NOT NULL DEFAULT '',
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 8),
  batch_id TEXT NOT NULL,
  regime_note TEXT NOT NULL DEFAULT '',
  engine TEXT NOT NULL DEFAULT '',
  snapshot_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_batch ON currency_scores (batch_id);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL CHECK (level IN ('critico','alto','medio')),
  alert_type TEXT NOT NULL CHECK (alert_type IN ('breaking','dato_macro','cambio_regimen','cambio_ranking','calendario','titular')),
  currency TEXT,
  news_item_id INTEGER REFERENCES news_items(id),
  is_read INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_occurred ON alerts (occurred_at DESC);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  currency TEXT NOT NULL,
  event_at TEXT NOT NULL,
  impact TEXT NOT NULL,
  forecast TEXT,
  previous TEXT,
  actual TEXT,
  news_item_id INTEGER REFERENCES news_items(id),
  prealerted INTEGER NOT NULL DEFAULT 0,
  week_start TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_at ON calendar_events (event_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  subscription TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const parseNews = (r) => r && { ...r, currencies: JSON.parse(r.currencies), alert_created: !!r.alert_created };
const parseScore = (r) => r && { ...r, drivers: JSON.parse(r.drivers) };
const parseAlert = (r) => r && { ...r, is_read: !!r.is_read };

// Opaque id so the UI can manage devices without ever seeing push endpoints.
export const deviceId = (endpoint) => createHash('sha1').update(endpoint).digest('hex').slice(0, 12);

export function openDb(path = process.env.RADARNEWS_DB || 'data/radarnews.db') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  const pushCols = new Set(db.prepare('PRAGMA table_info(push_subscriptions)').all().map((c) => c.name));
  for (const [col, type] of [['label', 'TEXT'], ['last_ok_at', 'TEXT'], ['last_error', 'TEXT'], ['last_error_at', 'TEXT']]) {
    if (!pushCols.has(col)) db.exec(`ALTER TABLE push_subscriptions ADD COLUMN ${col} ${type}`);
  }

  const stmts = {
    hasFp: db.prepare('SELECT 1 FROM news_items WHERE fingerprint = ?'),
    insertNews: db.prepare(`INSERT OR IGNORE INTO news_items
      (title, body, source, source_type, url, published_at, currencies, impact, category, actual, forecast, previous, calendar_title, fingerprint)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    markAlerted: db.prepare('UPDATE news_items SET alert_created = 1 WHERE id = ?'),
    insertAlert: db.prepare(`INSERT INTO alerts (title, body, level, alert_type, currency, news_item_id, occurred_at)
      VALUES (?,?,?,?,?,?,?)`),
    insertScore: db.prepare(`INSERT INTO currency_scores
      (currency, score, bias, drivers, rationale, rank, batch_id, regime_note, engine, snapshot_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
  };

  return {
    raw: db,
    close: () => db.close(),

    hasFingerprint: (fp) => !!stmts.hasFp.get(fp),

    insertNews(n) {
      const r = stmts.insertNews.run(n.title, n.body, n.source, n.source_type, n.url, n.published_at,
        JSON.stringify(n.currencies), n.impact, n.category, n.actual, n.forecast, n.previous, n.calendar_title ?? null, n.fingerprint);
      return r.changes ? Number(r.lastInsertRowid) : null;
    },

    markAlerted: (id) => stmts.markAlerted.run(id),

    listNews({ limit = 200, category, minImpact } = {}) {
      const where = [];
      const params = [];
      if (category) { where.push('category = ?'); params.push(category); }
      if (minImpact) { where.push('impact >= ?'); params.push(minImpact); }
      const sql = `SELECT * FROM news_items ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY published_at DESC LIMIT ?`;
      return db.prepare(sql).all(...params, limit).map(parseNews);
    },

    // Most recent headlines, then ordered by impact so the classifier sees the strongest catalysts first.
    headlinesForClassifier(limit) {
      return db.prepare(`SELECT * FROM (SELECT * FROM news_items ORDER BY published_at DESC LIMIT ?)
        ORDER BY impact DESC, published_at DESC`).all(limit * 2).slice(0, limit).map(parseNews);
    },

    insertAlert(a) {
      const r = stmts.insertAlert.run(a.title, a.body || '', a.level, a.alert_type, a.currency ?? null,
        a.news_item_id ?? null, a.occurred_at || new Date().toISOString());
      return Number(r.lastInsertRowid);
    },

    listAlerts(limit = 25) {
      return db.prepare('SELECT * FROM alerts ORDER BY occurred_at DESC, id DESC LIMIT ?').all(limit).map(parseAlert);
    },

    alertsSince(id) {
      return db.prepare('SELECT * FROM alerts WHERE id > ? ORDER BY id ASC').all(id).map(parseAlert);
    },

    hasDataAlert: (currency, fromIso, toIso) => !!db.prepare(`SELECT 1 FROM alerts
      WHERE alert_type = 'dato_macro' AND currency = ? AND occurred_at BETWEEN ? AND ? LIMIT 1`).get(currency, fromIso, toIso),

    unreadCount: () => db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE is_read = 0').get().n,

    markAllRead: () => db.prepare('UPDATE alerts SET is_read = 1 WHERE is_read = 0').run().changes,

    insertBatch(scores) {
      db.exec('BEGIN');
      try {
        for (const s of scores) {
          stmts.insertScore.run(s.currency, s.score, s.bias, JSON.stringify(s.drivers), s.rationale,
            s.rank, s.batch_id, s.regime_note || '', s.engine || '', s.snapshot_at);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    latestBatch(engine) {
      const last = engine
        ? db.prepare('SELECT batch_id FROM currency_scores WHERE engine = ? ORDER BY id DESC LIMIT 1').get(engine)
        : db.prepare('SELECT batch_id FROM currency_scores ORDER BY id DESC LIMIT 1').get();
      if (!last) return [];
      return db.prepare('SELECT * FROM currency_scores WHERE batch_id = ? ORDER BY rank ASC').all(last.batch_id).map(parseScore);
    },

    scoreHistory(engine, sinceIso) {
      return db.prepare(`SELECT currency, score, rank, snapshot_at FROM currency_scores
        WHERE engine = ? AND snapshot_at >= ? ORDER BY snapshot_at ASC`).all(engine, sinceIso);
    },

    replaceCalendarWeek(weekStart, events) {
      const existing = new Map(db.prepare('SELECT id, actual, news_item_id, prealerted FROM calendar_events').all().map((r) => [r.id, r]));
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM calendar_events').run();
        const ins = db.prepare(`INSERT INTO calendar_events (id, title, currency, event_at, impact, forecast, previous, actual, news_item_id, prealerted, week_start)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
        for (const e of events) {
          const prev = existing.get(e.id);
          ins.run(e.id, e.title, e.currency, e.event_at, e.impact, e.forecast, e.previous,
            prev?.actual ?? null, prev?.news_item_id ?? null, prev?.prealerted ?? 0, weekStart);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    listCalendar: () => db.prepare('SELECT * FROM calendar_events ORDER BY event_at ASC, currency ASC').all(),
    calendarDue: (fromIso, toIso) => db.prepare(`SELECT * FROM calendar_events
      WHERE prealerted = 0 AND impact = 'High' AND event_at > ? AND event_at <= ?`).all(fromIso, toIso),
    markPrealerted: (id) => db.prepare('UPDATE calendar_events SET prealerted = 1 WHERE id = ?').run(id),
    calendarAround: (currency, fromIso, toIso) => db.prepare(`SELECT * FROM calendar_events
      WHERE currency = ? AND event_at BETWEEN ? AND ? AND actual IS NULL`).all(currency, fromIso, toIso),
    setCalendarActual: (id, actual, newsId) => db.prepare('UPDATE calendar_events SET actual = ?, news_item_id = ? WHERE id = ?').run(actual, newsId, id),

    savePushSubscription: (sub, label = null) => db.prepare(`INSERT INTO push_subscriptions (endpoint, subscription, label) VALUES (?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET subscription = excluded.subscription, label = COALESCE(excluded.label, label)`).run(sub.endpoint, JSON.stringify(sub), label),
    deletePushSubscription: (endpoint) => db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint),
    listPushSubscriptions: () => db.prepare('SELECT subscription FROM push_subscriptions').all().map((r) => JSON.parse(r.subscription)),
    listPushDevices: () => db.prepare('SELECT endpoint, label, created_at, last_ok_at, last_error, last_error_at FROM push_subscriptions ORDER BY created_at').all()
      .map((r) => ({ ...r, id: deviceId(r.endpoint), endpoint: undefined })),
    deletePushDevice(id) {
      const row = db.prepare('SELECT endpoint FROM push_subscriptions').all().find((r) => deviceId(r.endpoint) === id);
      if (row) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(row.endpoint);
      return !!row;
    },
    markPushResult: (endpoint, error) => (error
      ? db.prepare(`UPDATE push_subscriptions SET last_error = ?, last_error_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE endpoint = ?`).run(String(error).slice(0, 200), endpoint)
      : db.prepare(`UPDATE push_subscriptions SET last_ok_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_error = NULL WHERE endpoint = ?`).run(endpoint)),

    setMeta: (k, v) => stmts.setMeta.run(k, JSON.stringify(v)),
    getMeta(k) {
      const r = stmts.getMeta.get(k);
      return r ? JSON.parse(r.value) : null;
    },
  };
}
