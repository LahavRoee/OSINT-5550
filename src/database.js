const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS updates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_text          TEXT    NOT NULL,
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

// --- Updates ---

async function insertUpdate({ rawText, sourceNumber, sourceName, actor, domain }) {
  const d = await getDb();
  d.run(
    `INSERT INTO updates (raw_text, source_number, source_name, actor, domain)
     VALUES (?, ?, ?, ?, ?)`,
    [rawText, sourceNumber || null, sourceName || null, actor || null, domain || null]
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
  getDb, save, insertUpdate, getUnprocessed, markProcessed,
  getPersistentIntel, upsertPersistentIntel,
  createDigest, updateDigest, getDigests,
};
