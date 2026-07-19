import type { DatabaseSync } from 'node:sqlite';

/**
 * Idempotent schema setup (README §4). Safe to call on every startup: `IF NOT EXISTS`
 * guards mean re-running this against an already-migrated database is a no-op.
 */
export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS anime_cache (
      anilist_id        INTEGER PRIMARY KEY,
      title_romaji      TEXT,
      title_english     TEXT,
      title_native      TEXT,
      cover_image       TEXT,
      cover_color       TEXT,
      episodes          INTEGER,
      status            TEXT,
      next_ep_num       INTEGER,
      next_ep_airing_at INTEGER,
      last_synced       INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_anime_status ON anime_cache(status);

    CREATE TABLE IF NOT EXISTS user_list (
      anilist_id INTEGER PRIMARY KEY REFERENCES anime_cache(anilist_id) ON DELETE CASCADE,
      status     TEXT    NOT NULL DEFAULT 'watching',
      progress   INTEGER NOT NULL DEFAULT 0,
      added_at   INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
