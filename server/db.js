import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const MIGRATIONS = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    default_currency TEXT NOT NULL DEFAULT 'EUR',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE trips (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    currency TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id),
    invite_code TEXT NOT NULL UNIQUE,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE trip_members (
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (trip_id, user_id)
  );
  CREATE INDEX trip_members_user ON trip_members(user_id);
  CREATE TABLE entries (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    volume_ml REAL,
    abv REAL,
    quantity REAL NOT NULL,
    unit_price REAL,
    currency TEXT NOT NULL,
    consumed_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    server_seq INTEGER NOT NULL
  );
  CREATE INDEX entries_trip_seq ON entries(trip_id, server_seq);
  CREATE TABLE fx_rates (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    base TEXT NOT NULL,
    rates_json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    source TEXT NOT NULL
  );
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
  INSERT INTO meta (key, value) VALUES ('server_seq', 0);
  `,
  `
  DROP TABLE IF EXISTS fx_rates;
  CREATE TEMP TABLE moved AS
    SELECT id, ROW_NUMBER() OVER (ORDER BY server_seq) AS n FROM entries WHERE category = 'water';
  UPDATE entries SET category = 'soft',
    server_seq = (SELECT value FROM meta WHERE key = 'server_seq') + (SELECT n FROM moved m WHERE m.id = entries.id)
    WHERE id IN (SELECT id FROM moved);
  UPDATE meta SET value = value + (SELECT COUNT(*) FROM moved) WHERE key = 'server_seq';
  DROP TABLE moved;
  ALTER TABLE entries DROP COLUMN unit_price;
  ALTER TABLE entries DROP COLUMN currency;
  ALTER TABLE users DROP COLUMN default_currency;
  ALTER TABLE trips DROP COLUMN currency;
  `,
];

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'trip-drinks.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  let version = db.prepare('PRAGMA user_version').get().user_version;
  while (version < MIGRATIONS.length) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
    version += 1;
  }
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function nextSeq(db) {
  return db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'server_seq' RETURNING value").get().value;
}
