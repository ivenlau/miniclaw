import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { createLogger } from './logger.js';

const log = createLogger('db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function initDb(dataDir: string): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'miniclaw.db');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);
  log.info({ dbPath }, 'Database initialized');
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'global',
      scope_id TEXT,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      tone TEXT NOT NULL DEFAULT 'professional',
      language TEXT NOT NULL DEFAULT 'zh-CN',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT,
      cron_expression TEXT NOT NULL,
      command TEXT NOT NULL,
      workspace TEXT,
      chat_target TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run INTEGER,
      next_run INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
    log.info('Database closed');
  }
}
