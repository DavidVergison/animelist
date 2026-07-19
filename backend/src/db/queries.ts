import type { DatabaseSync } from 'node:sqlite';
import type { AnimeCacheRow, ListEntry, UserListRow, UserStatus } from '@suivi/shared';

// --- Coercion helpers -----------------------------------------------------
// node:sqlite's `all()`/`get()` return `Record<string, SQLOutputValue>`, i.e. columns
// typed as `unknown` from TS's point of view. These narrow them without resorting to `any`.

function asNumber(value: unknown): number {
  if (typeof value !== 'number') throw new TypeError(`expected number, got ${typeof value}`);
  return value;
}

function asNullableNumber(value: unknown): number | null {
  return value === null ? null : asNumber(value);
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError(`expected string, got ${typeof value}`);
  return value;
}

function asNullableString(value: unknown): string | null {
  return value === null ? null : asString(value);
}

function asUserStatus(value: unknown): UserStatus {
  return asString(value) as UserStatus;
}

/** Clamps a requested progress value to `[0, episodes]`; unbounded above if `episodes` is unknown. */
export function clampProgress(progress: number, episodes: number | null): number {
  const upperBound = episodes ?? Number.POSITIVE_INFINITY;
  return Math.min(Math.max(progress, 0), upperBound);
}

type ListEntryRow = {
  anilistId: unknown;
  titleRomaji: unknown;
  titleEnglish: unknown;
  titleNative: unknown;
  coverImage: unknown;
  coverColor: unknown;
  episodes: unknown;
  status: unknown;
  nextEpNum: unknown;
  nextEpAiringAt: unknown;
  progress: unknown;
  userStatus: unknown;
};

type AnimeCacheDbRow = {
  anilistId: unknown;
  titleRomaji: unknown;
  titleEnglish: unknown;
  titleNative: unknown;
  coverImage: unknown;
  coverColor: unknown;
  episodes: unknown;
  status: unknown;
  nextEpNum: unknown;
  nextEpAiringAt: unknown;
  lastSynced: unknown;
};

function toAnimeCacheRow(row: AnimeCacheDbRow): AnimeCacheRow {
  return {
    anilistId: asNumber(row.anilistId),
    titleRomaji: asNullableString(row.titleRomaji),
    titleEnglish: asNullableString(row.titleEnglish),
    titleNative: asNullableString(row.titleNative),
    coverImage: asNullableString(row.coverImage),
    coverColor: asNullableString(row.coverColor),
    episodes: asNullableNumber(row.episodes),
    status: asString(row.status),
    nextEpNum: asNullableNumber(row.nextEpNum),
    nextEpAiringAt: asNullableNumber(row.nextEpAiringAt),
    lastSynced: asNumber(row.lastSynced),
  };
}

type UserListDbRow = {
  anilistId: unknown;
  status: unknown;
  progress: unknown;
  addedAt: unknown;
  updatedAt: unknown;
};

function toUserListRow(row: UserListDbRow): UserListRow {
  return {
    anilistId: asNumber(row.anilistId),
    status: asUserStatus(row.status),
    progress: asNumber(row.progress),
    addedAt: asNumber(row.addedAt),
    updatedAt: asNumber(row.updatedAt),
  };
}

function toListEntry(row: ListEntryRow): ListEntry {
  const nextEpNum = asNullableNumber(row.nextEpNum);
  const nextEpAiringAt = asNullableNumber(row.nextEpAiringAt);
  return {
    id: asNumber(row.anilistId),
    title: {
      romaji: asNullableString(row.titleRomaji),
      english: asNullableString(row.titleEnglish),
      native: asNullableString(row.titleNative),
    },
    episodes: asNullableNumber(row.episodes),
    status: asString(row.status),
    // `anime_cache` does not persist seasonYear (README §4) — it is only known at
    // search time and intentionally not stored once an anime enters the cache.
    seasonYear: null,
    coverImage: { medium: asNullableString(row.coverImage), color: asNullableString(row.coverColor) },
    nextAiringEpisode:
      nextEpNum !== null && nextEpAiringAt !== null ? { episode: nextEpNum, airingAt: nextEpAiringAt } : null,
    progress: asNumber(row.progress),
    userStatus: asUserStatus(row.userStatus),
  };
}

/**
 * Prepares (once) and exposes the statements the app needs against `db`. Statements are
 * reused across calls — never build SQL by string concatenation (README §4).
 */
export function createQueries(db: DatabaseSync) {
  const stmtUpsertAnimeCache = db.prepare(`
    INSERT INTO anime_cache (
      anilist_id, title_romaji, title_english, title_native,
      cover_image, cover_color, episodes, status,
      next_ep_num, next_ep_airing_at, last_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(anilist_id) DO UPDATE SET
      title_romaji      = excluded.title_romaji,
      title_english     = excluded.title_english,
      title_native      = excluded.title_native,
      cover_image        = excluded.cover_image,
      cover_color        = excluded.cover_color,
      episodes           = excluded.episodes,
      status             = excluded.status,
      next_ep_num        = excluded.next_ep_num,
      next_ep_airing_at  = excluded.next_ep_airing_at,
      last_synced        = excluded.last_synced
  `);

  const stmtInsertUserListEntry = db.prepare(`
    INSERT INTO user_list (anilist_id, status, progress, added_at, updated_at)
    VALUES (?, 'watching', 0, ?, ?)
  `);

  const stmtUserListEntryExists = db.prepare(`SELECT 1 FROM user_list WHERE anilist_id = ?`);

  const stmtGetList = db.prepare(`
    SELECT
      a.anilist_id        AS anilistId,
      a.title_romaji       AS titleRomaji,
      a.title_english      AS titleEnglish,
      a.title_native       AS titleNative,
      a.cover_image        AS coverImage,
      a.cover_color        AS coverColor,
      a.episodes           AS episodes,
      a.status             AS status,
      a.next_ep_num        AS nextEpNum,
      a.next_ep_airing_at  AS nextEpAiringAt,
      u.progress           AS progress,
      u.status             AS userStatus
    FROM user_list u JOIN anime_cache a ON a.anilist_id = u.anilist_id
  `);

  const stmtGetEntry = db.prepare(`
    SELECT
      a.anilist_id        AS anilistId,
      a.title_romaji       AS titleRomaji,
      a.title_english      AS titleEnglish,
      a.title_native       AS titleNative,
      a.cover_image        AS coverImage,
      a.cover_color        AS coverColor,
      a.episodes           AS episodes,
      a.status             AS status,
      a.next_ep_num        AS nextEpNum,
      a.next_ep_airing_at  AS nextEpAiringAt,
      u.progress           AS progress,
      u.status             AS userStatus
    FROM user_list u JOIN anime_cache a ON a.anilist_id = u.anilist_id
    WHERE a.anilist_id = ?
  `);

  const stmtGetEpisodes = db.prepare(`SELECT episodes FROM anime_cache WHERE anilist_id = ?`);

  const stmtUpdateProgress = db.prepare(`
    UPDATE user_list SET progress = ?, updated_at = ? WHERE anilist_id = ?
  `);

  const stmtDeleteAnimeCache = db.prepare(`DELETE FROM anime_cache WHERE anilist_id = ?`);

  const stmtSelectReleasingIds = db.prepare(`
    SELECT anilist_id AS anilistId FROM anime_cache WHERE status = 'RELEASING'
  `);

  const stmtUpdateRefreshedMeta = db.prepare(`
    UPDATE anime_cache
    SET status = ?, next_ep_num = ?, next_ep_airing_at = ?, last_synced = ?
    WHERE anilist_id = ?
  `);

  const stmtGetAllAnimeCache = db.prepare(`
    SELECT
      anilist_id        AS anilistId,
      title_romaji       AS titleRomaji,
      title_english      AS titleEnglish,
      title_native       AS titleNative,
      cover_image        AS coverImage,
      cover_color        AS coverColor,
      episodes,
      status,
      next_ep_num        AS nextEpNum,
      next_ep_airing_at  AS nextEpAiringAt,
      last_synced        AS lastSynced
    FROM anime_cache
  `);

  const stmtGetAllUserList = db.prepare(`
    SELECT anilist_id AS anilistId, status, progress, added_at AS addedAt, updated_at AS updatedAt
    FROM user_list
  `);

  // Deleting anime_cache cascades to user_list (FK ON DELETE CASCADE) — one statement
  // clears both tables, matching README §8's "DELETE des deux tables" restore step.
  const stmtClearAnimeCache = db.prepare(`DELETE FROM anime_cache`);

  // Unlike insertUserListEntry (which forces progress:0/status:'watching' for a brand
  // new add), restore must reproduce the dump's exact stored values.
  const stmtInsertUserListRow = db.prepare(`
    INSERT INTO user_list (anilist_id, status, progress, added_at, updated_at) VALUES (?, ?, ?, ?, ?)
  `);

  return {
    /** Upserts cache metadata for one anime — the only write path that populates `anime_cache`. */
    upsertAnimeCache(row: AnimeCacheRow): void {
      stmtUpsertAnimeCache.run(
        row.anilistId,
        row.titleRomaji,
        row.titleEnglish,
        row.titleNative,
        row.coverImage,
        row.coverColor,
        row.episodes,
        row.status,
        row.nextEpNum,
        row.nextEpAiringAt,
        row.lastSynced,
      );
    },

    userListEntryExists(anilistId: number): boolean {
      return stmtUserListEntryExists.get(anilistId) !== undefined;
    },

    /** Inserts a fresh `user_list` row at `progress: 0`, `status: 'watching'`. */
    insertUserListEntry(anilistId: number, now: number): void {
      stmtInsertUserListEntry.run(anilistId, now, now);
    },

    getList(): ListEntry[] {
      return stmtGetList.all().map((row) => toListEntry(row as ListEntryRow));
    },

    /** Same JOIN as `getList`, filtered to one anime — `null` if not in the user's list. */
    getEntry(anilistId: number): ListEntry | null {
      const row = stmtGetEntry.get(anilistId);
      return row === undefined ? null : toListEntry(row as ListEntryRow);
    },

    getEpisodes(anilistId: number): number | null {
      const row = stmtGetEpisodes.get(anilistId);
      return row === undefined ? null : asNullableNumber(row.episodes);
    },

    /** Clamps `requestedProgress` to `[0, episodes]` and persists it. Returns the clamped value. */
    setProgress(anilistId: number, requestedProgress: number, now: number): number {
      const row = stmtGetEpisodes.get(anilistId);
      const episodes = row === undefined ? null : asNullableNumber(row.episodes);
      const clamped = clampProgress(requestedProgress, episodes);
      stmtUpdateProgress.run(clamped, now, anilistId);
      return clamped;
    },

    /**
     * Removes an anime from tracking. Deleting the `anime_cache` row cascades (FK
     * `ON DELETE CASCADE`) to remove the matching `user_list` row — no orphan is left
     * in either table.
     */
    removeFromList(anilistId: number): void {
      stmtDeleteAnimeCache.run(anilistId);
    },

    /** IDs of every cached anime still airing — the refresh scheduler's target set. */
    selectReleasingIds(): number[] {
      return stmtSelectReleasingIds.all().map((row) => asNumber(row.anilistId));
    },

    updateRefreshedMeta(
      anilistId: number,
      meta: { status: string; nextEpNum: number | null; nextEpAiringAt: number | null; lastSynced: number },
    ): void {
      stmtUpdateRefreshedMeta.run(meta.status, meta.nextEpNum, meta.nextEpAiringAt, meta.lastSynced, anilistId);
    },

    /** Every cached anime, for backup export (README §8). */
    getAllAnimeCache(): AnimeCacheRow[] {
      return stmtGetAllAnimeCache.all().map((row) => toAnimeCacheRow(row as AnimeCacheDbRow));
    },

    /** Every tracked list entry (raw row, not joined), for backup export (README §8). */
    getAllUserList(): UserListRow[] {
      return stmtGetAllUserList.all().map((row) => toUserListRow(row as UserListDbRow));
    },

    /** Wipes both tables (via cascade) — restore's first step, always inside a transaction. */
    clearAll(): void {
      stmtClearAnimeCache.run();
    },

    /** Inserts a `user_list` row with the dump's exact values — restore only, never for a fresh add. */
    insertUserListRow(row: UserListRow): void {
      stmtInsertUserListRow.run(row.anilistId, row.status, row.progress, row.addedAt, row.updatedAt);
    },

    /**
     * Runs `fn` inside a SQL transaction — commits on success, rolls back (and
     * rethrows) on error. `fn` must be synchronous and do no network I/O: the AniList
     * fetch in `POST /api/list` happens *before* calling this, never inside it
     * (README §6/§12 — never hold a SQLite transaction open across a network call).
     */
    transaction<T>(fn: () => T): T {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

export type Queries = ReturnType<typeof createQueries>;
