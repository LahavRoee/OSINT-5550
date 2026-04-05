const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS updates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_text          TEXT    NOT NULL,
  content_hash      TEXT,
  source_number     TEXT,
  source_name       TEXT,
  received_at       TEXT    DEFAULT (datetime('now','localtime')),
  actor             TEXT    CHECK(actor IN ('HAMAS','HEZBOLLAH','IRAN','OTHERS')),
  domain            TEXT    CHECK(domain IN ('KINETIC','TERRAIN','SOCIAL','CYBER','GENERAL')),
  digest_id         INTEGER,
  processed         INTEGER DEFAULT 0,
  relevance_score   INTEGER DEFAULT 5,
  still_relevant    INTEGER DEFAULT 1,
  expires_at        TEXT
);

CREATE TABLE IF NOT EXISTS pending_review (
  id          INTEGER PRIMARY KEY,
  digest_id   INTEGER NOT NULL,
  version     TEXT    NOT NULL,
  pdf_path    TEXT,
  web_url     TEXT,
  maps_json   TEXT,
  created_at  TEXT    DEFAULT (datetime('now','localtime')),
  expires_at  TEXT
);

CREATE TABLE IF NOT EXISTS digests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  version          TEXT    NOT NULL UNIQUE,
  date             TEXT    NOT NULL,
  threat_level     TEXT    DEFAULT 'LOW',
  headline         TEXT,
  new_count        INTEGER DEFAULT 0,
  historical_count INTEGER DEFAULT 0,
  synthesis_json   TEXT,
  pdf_path         TEXT,
  docs_path        TEXT,
  pushed_to_github INTEGER DEFAULT 0,
  sent_to_roee     INTEGER DEFAULT 0,
  created_at       TEXT    DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS persistent_intel (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  original_id     INTEGER,
  actor           TEXT,
  domain          TEXT,
  summary         TEXT,
  first_seen      TEXT,
  last_confirmed  TEXT,
  relevance_score INTEGER,
  expires_at      TEXT
);
`;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  // Ensure data directory exists
  if (!fs.existsSync(config.paths.data)) {
    fs.mkdirSync(config.paths.data, { recursive: true });
  }

  // Load existing DB or create new
  if (fs.existsSync(config.paths.db)) {
    const buffer = fs.readFileSync(config.paths.db);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(SCHEMA);
  save();
  return db;
}

function save() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(config.paths.db, buffer);
}

// --- Deduplication helper ---

function hashText(text) {
  // Normalize: trim, lowercase, collapse whitespace → stable 16-char hex fingerprint
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

async function isDuplicate(hash) {
  const d = await getDb();
  const result = d.exec(
    `SELECT id FROM updates WHERE content_hash = ? LIMIT 1`,
    [hash]
  );
  return result.length > 0 && result[0].values.length > 0;
}

// --- Updates ---

async function insertUpdate({ rawText, sourceNumber, sourceName, actor, domain }) {
  const d = await getDb();
  const hash = hashText(rawText);

  // Deduplication: skip if identical content already exists
  if (await isDuplicate(hash)) {
    console.log(`  [dedup] Skipping duplicate message (hash: ${hash})`);
    return null; // null = duplicate, not inserted
  }

  d.run(
    `INSERT INTO updates (raw_text, content_hash, source_number, source_name, actor, domain)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [rawText, hash, sourceNumber || null, sourceName || null, actor || null, domain || null]
  );
  const stmt = d.prepare('SELECT last_insert_rowid() as id');
  stmt.step();
  const id = stmt.getAsObject().id;
  stmt.free();
  save();
  return id;
}

async function getUnprocessed() {
  const d = await getDb();
  const result = d.exec(
    `SELECT * FROM updates WHERE processed = 0 ORDER BY received_at DESC`
  );
  return rowsToObjects(result);
}

async function getUpdatesForDate(dateStr) {
  // dateStr: YYYY-MM-DD — returns only updates received on that calendar day
  const d = await getDb();
  const result = d.exec(
    `SELECT * FROM updates WHERE date(received_at) = ? ORDER BY received_at ASC`,
    [dateStr]
  );
  return rowsToObjects(result);
}

async function markProcessed(ids, digestId) {
  if (!ids.length) return;
  const d = await getDb();
  const placeholders = ids.map(() => '?').join(',');
  d.run(
    `UPDATE updates SET processed = 1, digest_id = ? WHERE id IN (${placeholders})`,
    [digestId, ...ids]
  );
  save();
}

// --- Persistent Intel ---

async function getPersistentIntel({ days } = {}) {
  const d = await getDb();
  const daysVal = days || config.historicalDays;
  const result = d.exec(
    `SELECT * FROM persistent_intel
     WHERE (expires_at IS NULL OR expires_at > datetime('now','localtime'))
       AND last_confirmed > datetime('now', '-${daysVal} days', 'localtime')
     ORDER BY relevance_score DESC`
  );
  return rowsToObjects(result);
}

async function upsertPersistentIntel(items) {
  const d = await getDb();
  for (const item of items) {
    d.run(
      `INSERT INTO persistent_intel (original_id, actor, domain, summary, first_seen, last_confirmed, relevance_score, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.original_id || null, item.actor, item.domain, item.summary,
       item.first_seen || new Date().toISOString(), new Date().toISOString(),
       item.relevance_score || 5, item.expires_at || null]
    );
  }
  save();
}

// --- Digests ---

async function createDigest({ version, date, threatLevel, headline, newCount, historicalCount, synthesisJson, pdfPath, docsPath }) {
  const d = await getDb();
  d.run(
    `INSERT INTO digests (version, date, threat_level, headline, new_count, historical_count, synthesis_json, pdf_path, docs_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [version, date, threatLevel || 'LOW', headline || '', newCount || 0, historicalCount || 0,
     typeof synthesisJson === 'string' ? synthesisJson : JSON.stringify(synthesisJson),
     pdfPath || null, docsPath || null]
  );
  save();
  const stmt = d.prepare('SELECT last_insert_rowid() as id');
  stmt.step();
  const id = stmt.getAsObject().id;
  stmt.free();
  return id;
}

async function updateDigest(id, fields) {
  const d = await getDb();
  const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  const vals = Object.values(fields);
  d.run(`UPDATE digests SET ${sets} WHERE id = ?`, [...vals, id]);
  save();
}

async function getDigests() {
  const d = await getDb();
  const result = d.exec('SELECT * FROM digests ORDER BY created_at DESC');
  return rowsToObjects(result);
}

// --- Pending Review ---

async function setPendingReview({ digestId, version, pdfPath, webUrl, mapsJson, timeoutMinutes }) {
  const d = await getDb();
  const mins = timeoutMinutes || 120;
  // Clear any existing pending review first
  d.run('DELETE FROM pending_review');
  d.run(
    `INSERT INTO pending_review (digest_id, version, pdf_path, web_url, maps_json, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '+${mins} minutes', 'localtime'))`,
    [digestId, version, pdfPath || null, webUrl || null,
     typeof mapsJson === 'string' ? mapsJson : JSON.stringify(mapsJson || {})]
  );
  save();
}

async function getPendingReview() {
  const d = await getDb();
  const result = d.exec(
    `SELECT * FROM pending_review
     WHERE expires_at > datetime('now','localtime')
     LIMIT 1`
  );
  const rows = rowsToObjects(result);
  if (!rows.length) return null;
  const row = rows[0];
  try { row.maps = JSON.parse(row.maps_json || '{}'); } catch { row.maps = {}; }
  return row;
}

async function clearPendingReview() {
  const d = await getDb();
  d.run('DELETE FROM pending_review');
  save();
}

// --- Helpers ---

function rowsToObjects(result) {
  if (!result.length) return [];
  const cols = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    cols.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

module.exports = {
  getDb, save, hashText, isDuplicate,
  insertUpdate, getUnprocessed, getUpdatesForDate, markProcessed,
  getPersistentIntel, upsertPersistentIntel,
  createDigest, updateDigest, getDigests,
  setPendingReview, getPendingReview, clearPendingReview,
};
