import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrations.ts';

/**
 * Opens (creating if absent) the SQLite database at `path`, enables WAL + FK
 * enforcement, and applies migrations. `path` must point at a real file for
 * `PRAGMA journal_mode = WAL` to take effect — it is a no-op on `:memory:`.
 * Creates the parent directory if missing (Docker mounts it as a volume; local dev
 * doesn't have one yet).
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db);
  return db;
}

export { runMigrations } from './migrations.ts';
export * from './queries.ts';
