import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * The product database: accounts, sessions, each user's assistant settings,
 * plans and UNC payments. SQLite (built into Node) keeps it one file and no
 * service to run; on AWS it can move to Postgres behind the same functions.
 */

const FILE = process.env.DATABASE_FILE || path.join(process.cwd(), "data", "app.db");

let db: DatabaseSync | null = null;

export function database(): DatabaseSync {
  if (db) return db;
  mkdirSync(path.dirname(FILE), { recursive: true });
  db = new DatabaseSync(FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      assistant_name TEXT NOT NULL,
      face TEXT NOT NULL,
      voice TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL,
      status TEXT NOT NULL,
      period_end TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      tx_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      plan TEXT NOT NULL,
      amount TEXT NOT NULL,
      payer TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}
