import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { AnimeCacheRow, BackupDump } from '@suivi/shared';
import { openDatabase, createQueries, type Queries } from './db/index.ts';
import { BackupValidationError, buildBackupDump, restoreBackupDump, validateBackupDump } from './backup.ts';

function withTempQueries(fn: (queries: Queries, db: DatabaseSync) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'suivi-anime-test-'));
  const db = openDatabase(join(dir, 'test.db'));
  try {
    fn(createQueries(db), db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function sampleAnimeCacheRow(overrides: Partial<AnimeCacheRow> = {}): AnimeCacheRow {
  return {
    anilistId: 1,
    titleRomaji: 'Sousou no Frieren',
    titleEnglish: "Frieren: Beyond Journey's End",
    titleNative: '葬送のフリーレン',
    coverImage: 'https://example.test/frieren.jpg',
    coverColor: '#5b8def',
    episodes: 28,
    status: 'RELEASING',
    nextEpNum: 12,
    nextEpAiringAt: 1_800_000_000,
    lastSynced: 1_700_000_000,
    ...overrides,
  };
}

function validDump(overrides: Partial<BackupDump> = {}): BackupDump {
  return {
    version: 1,
    exportedAt: '2026-07-19T12:00:00.000Z',
    animeCache: [sampleAnimeCacheRow()],
    userList: [{ anilistId: 1, status: 'watching', progress: 5, addedAt: 1_700_000_000, updatedAt: 1_700_100_000 }],
    ...overrides,
  };
}

test('buildBackupDump assemble version, exportedAt et les deux tables', () => {
  withTempQueries((queries) => {
    queries.upsertAnimeCache(sampleAnimeCacheRow());
    queries.insertUserListEntry(1, 1_700_000_000);

    const dump = buildBackupDump(queries);

    assert.equal(dump.version, 1);
    assert.equal(typeof dump.exportedAt, 'string');
    assert.equal(dump.animeCache.length, 1);
    assert.equal(dump.animeCache[0]?.anilistId, 1);
    assert.equal(dump.userList.length, 1);
    assert.equal(dump.userList[0]?.anilistId, 1);
  });
});

test('validateBackupDump accepte un dump conforme', () => {
  const dump = validateBackupDump(validDump());
  assert.equal(dump.version, 1);
  assert.equal(dump.animeCache.length, 1);
  assert.equal(dump.userList.length, 1);
});

test('validateBackupDump rejette une version inconnue', () => {
  assert.throws(() => validateBackupDump(validDump({ version: 2 as 1 })), BackupValidationError);
});

test('validateBackupDump rejette un JSON qui n\'est pas un objet', () => {
  assert.throws(() => validateBackupDump([1, 2, 3]), BackupValidationError);
  assert.throws(() => validateBackupDump('a string'), BackupValidationError);
  assert.throws(() => validateBackupDump(null), BackupValidationError);
});

test('validateBackupDump rejette animeCache/userList manquants ou mal typés', () => {
  assert.throws(() => validateBackupDump({ version: 1, exportedAt: 'x', userList: [] }), BackupValidationError);
  assert.throws(
    () => validateBackupDump({ version: 1, exportedAt: 'x', animeCache: 'nope', userList: [] }),
    BackupValidationError,
  );
});

test('validateBackupDump rejette une ligne animeCache malformée (champ manquant)', () => {
  const raw = validDump({ animeCache: [{ anilistId: 1 }] as unknown as AnimeCacheRow[] });
  assert.throws(() => validateBackupDump(raw), BackupValidationError);
});

test('validateBackupDump rejette un userStatus invalide', () => {
  const raw = validDump({
    userList: [{ anilistId: 1, status: 'bogus', progress: 1, addedAt: 1, updatedAt: 1 } as never],
  });
  assert.throws(() => validateBackupDump(raw), BackupValidationError);
});

test('restoreBackupDump remplace le contenu en une transaction et renvoie les compteurs', () => {
  withTempQueries((queries) => {
    // pre-existing state that must be wiped
    queries.upsertAnimeCache(sampleAnimeCacheRow({ anilistId: 999 }));
    queries.insertUserListEntry(999, 1);

    const dump = validDump();
    const counts = restoreBackupDump(queries, dump);

    assert.deepEqual(counts, { animeCache: 1, userList: 1 });
    const list = queries.getList();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, 1);
    assert.equal(list[0]?.progress, 5);
    assert.equal(queries.getEntry(999), null, 'pre-existing rows must be gone after restore');
  });
});

test('round-trip export -> restore reconstruit un état identique', () => {
  withTempQueries((queries) => {
    queries.upsertAnimeCache(sampleAnimeCacheRow());
    queries.upsertAnimeCache(sampleAnimeCacheRow({ anilistId: 2, titleRomaji: 'Dungeon Meshi', episodes: 24 }));
    queries.insertUserListEntry(1, 1_700_000_000);
    queries.insertUserListEntry(2, 1_700_000_100);
    queries.setProgress(1, 7, 1_700_000_200);

    const before = buildBackupDump(queries);

    // wipe and restore from the exported dump
    restoreBackupDump(queries, before);

    const after = buildBackupDump(queries);
    assert.deepEqual(
      [...after.animeCache].sort((a, b) => a.anilistId - b.anilistId),
      [...before.animeCache].sort((a, b) => a.anilistId - b.anilistId),
    );
    assert.deepEqual(
      [...after.userList].sort((a, b) => a.anilistId - b.anilistId),
      [...before.userList].sort((a, b) => a.anilistId - b.anilistId),
    );
  });
});

test('un userList référençant un anilistId absent de animeCache fait échouer toute la restauration (rollback, rien de partiel)', () => {
  withTempQueries((queries) => {
    queries.upsertAnimeCache(sampleAnimeCacheRow({ anilistId: 111 }));
    queries.insertUserListEntry(111, 1);

    const inconsistentDump = validDump({
      animeCache: [sampleAnimeCacheRow({ anilistId: 1 })],
      userList: [
        { anilistId: 1, status: 'watching', progress: 0, addedAt: 1, updatedAt: 1 },
        // anilistId 2 has no matching animeCache row -> FK violation
        { anilistId: 2, status: 'watching', progress: 0, addedAt: 1, updatedAt: 1 },
      ],
    });

    assert.throws(() => restoreBackupDump(queries, inconsistentDump));

    // Neither the wipe nor the partial insert must have stuck — original state intact.
    assert.notEqual(queries.getEntry(111), null, 'pre-existing state must survive a rolled-back restore');
    assert.equal(queries.getEntry(1), null);
  });
});
