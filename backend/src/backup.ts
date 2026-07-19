import type { AnimeCacheRow, BackupDump, UserListRow, UserStatus } from '@suivi/shared';
import type { Queries } from './db/index.ts';

export class BackupValidationError extends Error {}

const USER_STATUSES: readonly string[] = ['watching', 'completed', 'paused', 'dropped', 'planned'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new BackupValidationError(`${field} must be a string`);
  return value;
}

function requireNullableString(value: unknown, field: string): string | null {
  return value === null ? null : requireString(value, field);
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BackupValidationError(`${field} must be a finite number`);
  }
  return value;
}

function requireNullableNumber(value: unknown, field: string): number | null {
  return value === null ? null : requireNumber(value, field);
}

function requireInteger(value: unknown, field: string): number {
  const n = requireNumber(value, field);
  if (!Number.isInteger(n)) throw new BackupValidationError(`${field} must be an integer`);
  return n;
}

function requireUserStatus(value: unknown, field: string): UserStatus {
  const s = requireString(value, field);
  if (!USER_STATUSES.includes(s)) {
    throw new BackupValidationError(`${field} must be one of ${USER_STATUSES.join(', ')}, got "${s}"`);
  }
  return s as UserStatus;
}

function validateAnimeCacheRow(raw: unknown, index: number): AnimeCacheRow {
  if (!isRecord(raw)) throw new BackupValidationError(`animeCache[${index}] must be an object`);
  const p = `animeCache[${index}]`;
  return {
    anilistId: requireInteger(raw.anilistId, `${p}.anilistId`),
    titleRomaji: requireNullableString(raw.titleRomaji, `${p}.titleRomaji`),
    titleEnglish: requireNullableString(raw.titleEnglish, `${p}.titleEnglish`),
    titleNative: requireNullableString(raw.titleNative, `${p}.titleNative`),
    coverImage: requireNullableString(raw.coverImage, `${p}.coverImage`),
    coverColor: requireNullableString(raw.coverColor, `${p}.coverColor`),
    episodes: requireNullableNumber(raw.episodes, `${p}.episodes`),
    status: requireString(raw.status, `${p}.status`),
    nextEpNum: requireNullableNumber(raw.nextEpNum, `${p}.nextEpNum`),
    nextEpAiringAt: requireNullableNumber(raw.nextEpAiringAt, `${p}.nextEpAiringAt`),
    lastSynced: requireInteger(raw.lastSynced, `${p}.lastSynced`),
  };
}

function validateUserListRow(raw: unknown, index: number): UserListRow {
  if (!isRecord(raw)) throw new BackupValidationError(`userList[${index}] must be an object`);
  const p = `userList[${index}]`;
  return {
    anilistId: requireInteger(raw.anilistId, `${p}.anilistId`),
    status: requireUserStatus(raw.status, `${p}.status`),
    progress: requireInteger(raw.progress, `${p}.progress`),
    addedAt: requireInteger(raw.addedAt, `${p}.addedAt`),
    updatedAt: requireInteger(raw.updatedAt, `${p}.updatedAt`),
  };
}

/**
 * Validates an untrusted uploaded dump against the versioned contract (README §8).
 * Never trust the file's shape — every field is checked, not just the top-level keys.
 * Throws `BackupValidationError` (with a field-specific message) on the first problem.
 */
export function validateBackupDump(raw: unknown): BackupDump {
  if (!isRecord(raw)) throw new BackupValidationError('backup must be a JSON object');
  if (raw.version !== 1) {
    throw new BackupValidationError(`unsupported backup version: ${JSON.stringify(raw.version)} (expected 1)`);
  }
  const exportedAt = requireString(raw.exportedAt, 'exportedAt');
  if (!Array.isArray(raw.animeCache)) throw new BackupValidationError('animeCache must be an array');
  if (!Array.isArray(raw.userList)) throw new BackupValidationError('userList must be an array');

  return {
    version: 1,
    exportedAt,
    animeCache: raw.animeCache.map((row, index) => validateAnimeCacheRow(row, index)),
    userList: raw.userList.map((row, index) => validateUserListRow(row, index)),
  };
}

/** Reads both tables and assembles a versioned dump (README §8). */
export function buildBackupDump(queries: Queries): BackupDump {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    animeCache: queries.getAllAnimeCache(),
    userList: queries.getAllUserList(),
  };
}

export type RestoreCounts = { animeCache: number; userList: number };

/**
 * Replaces the database's content with `dump`, in one transaction: any failure (e.g. a
 * `userList` row referencing an `anilistId` absent from `animeCache`, which the FK
 * constraint rejects) rolls back everything — never a partial state (README §8/§12).
 */
export function restoreBackupDump(queries: Queries, dump: BackupDump): RestoreCounts {
  return queries.transaction(() => {
    queries.clearAll();
    for (const row of dump.animeCache) {
      queries.upsertAnimeCache(row);
    }
    for (const row of dump.userList) {
      queries.insertUserListRow(row);
    }
    return { animeCache: dump.animeCache.length, userList: dump.userList.length };
  });
}
