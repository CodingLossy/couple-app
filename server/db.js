import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PRESETS, QUESTIONS } from './content.js';

export function nowIso() {
  return new Date().toISOString();
}

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'app.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS anniversaries (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      yearly INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('album', 'diary', 'checklist')),
      stored_name TEXT NOT NULL UNIQUE,
      width INTEGER,
      height INTEGER,
      bytes INTEGER NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS diary_entries (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      visibility TEXT NOT NULL CHECK (visibility IN ('private', 'shared')),
      mood TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checklist_items (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      preset INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      note TEXT NOT NULL DEFAULT '',
      photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS question_pool (
      id INTEGER PRIMARY KEY,
      text TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS daily_questions (
      day TEXT PRIMARY KEY,
      question_id INTEGER NOT NULL REFERENCES question_pool(id)
    );

    CREATE TABLE IF NOT EXISTS daily_answers (
      day TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      answer TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (day, user_id)
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_log (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      sent_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      due_time TEXT,
      audience TEXT NOT NULL CHECK (audience IN ('private', 'assigned', 'shared')),
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      completed_at TEXT,
      completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_tokens (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_photos_kind_id ON photos(kind, id);
    CREATE INDEX IF NOT EXISTS idx_diary_user ON diary_entries(user_id, id);
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_todos_due ON todos(due_date, id);
    CREATE INDEX IF NOT EXISTS idx_todos_owner ON todos(owner_id, id);

    CREATE TABLE IF NOT EXISTS meal_rounds (
      id INTEGER PRIMARY KEY,
      day TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'revealed')),
      result_mode TEXT,
      result_cuisine TEXT,
      result_quip TEXT,
      result_fallback INTEGER NOT NULL DEFAULT 0,
      result_wheel TEXT,
      rerolls INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      revealed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS meal_votes (
      id INTEGER PRIMARY KEY,
      round_id INTEGER NOT NULL REFERENCES meal_rounds(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      energy TEXT NOT NULL,
      mood TEXT NOT NULL,
      budget TEXT NOT NULL,
      mode TEXT NOT NULL,
      cuisines TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (round_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS places (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      cuisine TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('out', 'delivery')),
      platform TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      visited INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meal_logs (
      id INTEGER PRIMARY KEY,
      round_id INTEGER REFERENCES meal_rounds(id) ON DELETE SET NULL,
      mode TEXT NOT NULL,
      cuisine TEXT NOT NULL,
      place_id INTEGER REFERENCES places(id) ON DELETE SET NULL,
      place_name TEXT NOT NULL DEFAULT '',
      rating INTEGER,
      note TEXT NOT NULL DEFAULT '',
      photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meal_presence (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_meal_rounds_day ON meal_rounds(day, id);
    CREATE INDEX IF NOT EXISTS idx_meal_votes_round ON meal_votes(round_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_meal_logs_created ON meal_logs(created_at);
  `);

  const insertQuestion = db.prepare('INSERT OR IGNORE INTO question_pool (text) VALUES (?)');
  const seed = db.transaction((items) => {
    for (const text of items) insertQuestion.run(text);
  });
  seed(QUESTIONS);
  const roundCols = db.prepare('PRAGMA table_info(meal_rounds)').all();
  if (roundCols.length && !roundCols.some((col) => col.name === 'result_fallback')) {
    db.exec('ALTER TABLE meal_rounds ADD COLUMN result_fallback INTEGER NOT NULL DEFAULT 0');
  }
  if (roundCols.length && !roundCols.some((col) => col.name === 'result_wheel')) {
    db.exec('ALTER TABLE meal_rounds ADD COLUMN result_wheel TEXT');
  }
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

export function userCount(db) {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
}

export function seedPresets(db) {
  const insert = db.prepare('INSERT INTO checklist_items (title, preset, sort_order, created_at) VALUES (?, 1, ?, ?)');
  const now = nowIso();
  PRESETS.forEach((title, index) => insert.run(title, index, now));
}

export function emptyContent(db) {
  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM meal_presence;
      DELETE FROM meal_votes;
      DELETE FROM meal_logs;
      DELETE FROM meal_rounds;
      DELETE FROM places;
      DELETE FROM daily_answers;
      DELETE FROM daily_questions;
      DELETE FROM diary_entries;
      DELETE FROM checklist_items;
      DELETE FROM todos;
      DELETE FROM photos;
      DELETE FROM anniversaries;
      DELETE FROM push_log;
    `);
    seedPresets(db);
  });
  tx();
}

export function emptyEverything(db) {
  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM meal_presence;
      DELETE FROM meal_votes;
      DELETE FROM meal_logs;
      DELETE FROM meal_rounds;
      DELETE FROM places;
      DELETE FROM daily_answers;
      DELETE FROM daily_questions;
      DELETE FROM diary_entries;
      DELETE FROM checklist_items;
      DELETE FROM todos;
      DELETE FROM calendar_tokens;
      DELETE FROM photos;
      DELETE FROM anniversaries;
      DELETE FROM push_subscriptions;
      DELETE FROM push_log;
      DELETE FROM sessions;
      DELETE FROM users;
      DELETE FROM settings;
    `);
  });
  tx();
}
