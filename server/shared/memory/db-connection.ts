/**
 * DB Connection — Singleton SQLite connection manager.
 *
 * Internal module. Import `getDb` / `closeDb` from persistent-memory.ts.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const JANUS_DIR = path.join(os.homedir(), '.janus');
const MEMORY_DB = 'memory.db';

// ESM-safe __dirname (Node ESM has no global __dirname)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Singleton DB ----

let _db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (_db && !dbPath) return _db;

  const resolvedPath = dbPath || path.join(JANUS_DIR, MEMORY_DB);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Initialize schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
  }

  if (!dbPath) _db = db;
  return db;
}

/**
 * Close the database connection (for graceful shutdown).
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export { JANUS_DIR, MEMORY_DB };
