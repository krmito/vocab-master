import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbClient = null;
let isPostgres = false;

export async function initDb() {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://'))) {
    console.log('[DB] Conectando a PostgreSQL en Railway...');
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: process.env.NODE_ENV === 'production' && !databaseUrl.includes('localhost') ? { rejectUnauthorized: false } : false
    });
    dbClient = pool;
    isPostgres = true;
    await setupPostgresTables(pool);
  } else {
    console.log('[DB] Usando SQLite local (node:sqlite)...');
    const { DatabaseSync } = await import('node:sqlite');
    const dbDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, 'vocab.sqlite');
    const sqlite = new DatabaseSync(dbPath);
    sqlite.exec('PRAGMA journal_mode = WAL;');
    dbClient = sqlite;
    isPostgres = false;
    setupSqliteTables(sqlite);
  }

  return dbClient;
}

function setupSqliteTables(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lang TEXT NOT NULL,
      word TEXT NOT NULL,
      transcription TEXT DEFAULT '',
      translation TEXT DEFAULT '',
      additional_translation TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      examples TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(lang, word)
    );

    CREATE TABLE IF NOT EXISTS srs_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word_id INTEGER NOT NULL UNIQUE,
      state INTEGER DEFAULT 0, -- 0: new, 1: learning, 2: review, 3: relearning
      due TEXT NOT NULL,
      stability REAL DEFAULT 0,
      difficulty REAL DEFAULT 0,
      elapsed_days INTEGER DEFAULT 0,
      scheduled_days INTEGER DEFAULT 0,
      reps INTEGER DEFAULT 0,
      lapses INTEGER DEFAULT 0,
      last_review TEXT,
      FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS study_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      review_time TEXT DEFAULT CURRENT_TIMESTAMP,
      duration_ms INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS wiktionary_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lang TEXT NOT NULL,
      word TEXT NOT NULL,
      data_json TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(lang, word)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_words_lang ON words(lang);
    CREATE INDEX IF NOT EXISTS idx_srs_due ON srs_cards(due);
    CREATE INDEX IF NOT EXISTS idx_srs_state ON srs_cards(state);
  `);
}

async function setupPostgresTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS words (
      id SERIAL PRIMARY KEY,
      lang VARCHAR(10) NOT NULL,
      word VARCHAR(255) NOT NULL,
      transcription TEXT DEFAULT '',
      translation TEXT DEFAULT '',
      additional_translation TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      examples TEXT DEFAULT '',
      active SMALLINT DEFAULT 1,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_lang_word UNIQUE(lang, word)
    );

    CREATE TABLE IF NOT EXISTS srs_cards (
      id SERIAL PRIMARY KEY,
      word_id INTEGER NOT NULL UNIQUE REFERENCES words(id) ON DELETE CASCADE,
      state SMALLINT DEFAULT 0,
      due TIMESTAMP WITH TIME ZONE NOT NULL,
      stability DOUBLE PRECISION DEFAULT 0,
      difficulty DOUBLE PRECISION DEFAULT 0,
      elapsed_days INTEGER DEFAULT 0,
      scheduled_days INTEGER DEFAULT 0,
      reps INTEGER DEFAULT 0,
      lapses INTEGER DEFAULT 0,
      last_review TIMESTAMP WITH TIME ZONE
    );

    CREATE TABLE IF NOT EXISTS study_logs (
      id SERIAL PRIMARY KEY,
      word_id INTEGER NOT NULL,
      rating SMALLINT NOT NULL,
      review_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      duration_ms INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS wiktionary_cache (
      id SERIAL PRIMARY KEY,
      lang VARCHAR(10) NOT NULL,
      word VARCHAR(255) NOT NULL,
      data_json TEXT NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_wiki_lang_word UNIQUE(lang, word)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_words_lang ON words(lang);
    CREATE INDEX IF NOT EXISTS idx_srs_due ON srs_cards(due);
    CREATE INDEX IF NOT EXISTS idx_srs_state ON srs_cards(state);
  `);
}

export function getDb() {
  if (!dbClient) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return { db: dbClient, isPostgres };
}

// Helper for unified queries
export async function query(sql, params = []) {
  if (isPostgres) {
    // Convert ? to $1, $2, ... for postgres
    let pIdx = 1;
    const pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
    const res = await dbClient.query(pgSql, params);
    return res.rows;
  } else {
    const stmt = dbClient.prepare(sql);
    return stmt.all(...params);
  }
}

export async function execute(sql, params = []) {
  if (isPostgres) {
    let pIdx = 1;
    const pgSql = sql.replace(/\?/g, () => `$${pIdx++}`);
    const res = await dbClient.query(pgSql, params);
    return {
      changes: res.rowCount,
      lastInsertRowid: res.rows?.[0]?.id || null
    };
  } else {
    const stmt = dbClient.prepare(sql);
    const res = stmt.run(...params);
    return {
      changes: res.changes,
      lastInsertRowid: res.lastInsertRowid
    };
  }
}

export async function getSetting(key, defaultValue = null) {
  const rows = await query('SELECT value FROM settings WHERE key = ?', [key]);
  if (rows.length > 0) {
    return rows[0].value;
  }
  return defaultValue;
}

export async function setSetting(key, value) {
  if (isPostgres) {
    await execute(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `, [key, String(value)]);
  } else {
    await execute(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `, [key, String(value)]);
  }
}
