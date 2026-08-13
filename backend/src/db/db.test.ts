import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { AnimeCacheRow } from '@suivi/shared';
import { openDatabase, runMigrations, createQueries, clampProgress } from './index.ts';

/** Opens a throwaway file-backed DB (WAL needs a real file, not `:memory:`) and cleans up after. */
function withTempDb(fn: (db: DatabaseSync) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'suivi-anime-test-'));
  const db = openDatabase(join(dir, 'test.db'));
  try {
    fn(db);
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

test("openDatabase crée le dossier parent s'il n'existe pas (volume Docker pas encore monté en local)", () => {
  const dir = mkdtempSync(join(tmpdir(), 'suivi-anime-test-'));
  const nestedPath = join(dir, 'nested', 'sub', 'test.db');
  try {
    const db = openDatabase(nestedPath);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migrations sont idempotentes (ré-exécution sans erreur, schéma stable)', () => {
  withTempDb((db) => {
    assert.doesNotThrow(() => runMigrations(db));
    assert.doesNotThrow(() => runMigrations(db));
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .map((r) => r.name);
    assert.deepEqual(tables, ['anime_cache', 'user_list']);
  });
});

test('WAL est actif sur une base fichier', () => {
  withTempDb((db) => {
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    assert.equal(row.journal_mode, 'wal');
  });
});

test('upsert anime_cache puis insert user_list peuplent la liste', () => {
  withTempDb((db) => {
    const q = createQueries(db);
    q.upsertAnimeCache(sampleAnimeCacheRow());
    assert.equal(q.userListEntryExists(1), false);
    q.insertUserListEntry(1, 1_700_000_000);
    assert.equal(q.userListEntryExists(1), true);

    const list = q.getList();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, 1);
    assert.equal(list[0]?.progress, 0);
    assert.equal(list[0]?.userStatus, 'watching');
  });
});

test('ré-upsert met à jour les métadonnées existantes (ré-ajout)', () => {
  withTempDb((db) => {
    const q = createQueries(db);
    q.upsertAnimeCache(sampleAnimeCacheRow({ episodes: 24, status: 'RELEASING' }));
    q.upsertAnimeCache(sampleAnimeCacheRow({ episodes: 28, status: 'FINISHED' }));
    const row = db.prepare('SELECT episodes, status FROM anime_cache WHERE anilist_id = ?').get(1) as {
      episodes: number;
      status: string;
    };
    assert.equal(row.episodes, 28);
    assert.equal(row.status, 'FINISHED');
  });
});

test('CASCADE — supprimer anime_cache retire aussi la ligne user_list (pas d\'orphelin)', () => {
  withTempDb((db) => {
    const q = createQueries(db);
    q.upsertAnimeCache(sampleAnimeCacheRow());
    q.insertUserListEntry(1, 1_700_000_000);

    q.removeFromList(1);

    assert.equal(q.userListEntryExists(1), false);
    const cacheRow = db.prepare('SELECT * FROM anime_cache WHERE anilist_id = ?').get(1);
    assert.equal(cacheRow, undefined);
  });
});

test('clampProgress borne dans [0, episodes]', () => {
  assert.equal(clampProgress(-5, 28), 0);
  assert.equal(clampProgress(50, 28), 28);
  assert.equal(clampProgress(10, 28), 10);
  assert.equal(clampProgress(10, null), 10);
  assert.equal(clampProgress(-1, null), 0);
});

test('setProgress clampe et persiste via la DB (episodes connus)', () => {
  withTempDb((db) => {
    const q = createQueries(db);
    q.upsertAnimeCache(sampleAnimeCacheRow({ episodes: 12 }));
    q.insertUserListEntry(1, 1_700_000_000);

    const clamped = q.setProgress(1, 999, 1_700_100_000);
    assert.equal(clamped, 12);
    const list = q.getList();
    assert.equal(list[0]?.progress, 12);

    const clampedNegative = q.setProgress(1, -3, 1_700_200_000);
    assert.equal(clampedNegative, 0);
  });
});

test('JOIN liste renvoie un ListEntry conforme au contrat', () => {
  withTempDb((db) => {
    const q = createQueries(db);
    q.upsertAnimeCache(sampleAnimeCacheRow());
    q.insertUserListEntry(1, 1_700_000_000);
    q.setProgress(1, 5, 1_700_100_000);

    const [entry] = q.getList();
    assert.ok(entry);
    assert.deepEqual(entry.title, {
      romaji: 'Sousou no Frieren',
      english: "Frieren: Beyond Journey's End",
      native: '葬送のフリーレン',
    });
    assert.equal(entry.episodes, 28);
    assert.equal(entry.status, 'RELEASING');
    assert.deepEqual(entry.coverImage, { medium: 'https://example.test/frieren.jpg', color: '#5b8def' });
    assert.deepEqual(entry.nextAiringEpisode, { episode: 12, airingAt: 1_800_000_000 });
    assert.equal(entry.progress, 5);
    assert.equal(entry.userStatus, 'watching');
    assert.equal(entry.seasonYear, null);
  });
});

test('sélection RELEASING/NOT_YET_RELEASED ne renvoie que les animes à rafraîchir', () => {
  withTempDb((db) => {
    const q = createQueries(db);
    q.upsertAnimeCache(sampleAnimeCacheRow({ anilistId: 1, status: 'RELEASING' }));
    q.upsertAnimeCache(sampleAnimeCacheRow({ anilistId: 2, status: 'FINISHED' }));
    q.upsertAnimeCache(sampleAnimeCacheRow({ anilistId: 3, status: 'RELEASING' }));
    q.upsertAnimeCache(sampleAnimeCacheRow({ anilistId: 4, status: 'NOT_YET_RELEASED' }));

    const ids = q.selectRefreshableIds().sort();
    assert.deepEqual(ids, [1, 3, 4]);
  });
});

test('updateRefreshedMeta met à jour les colonnes de rafraîchissement', () => {
  withTempDb((db) => {
    const q = createQueries(db);
    q.upsertAnimeCache(
      sampleAnimeCacheRow({ status: 'RELEASING', episodes: null, nextEpNum: 12, nextEpAiringAt: 1_800_000_000 }),
    );

    q.updateRefreshedMeta(1, {
      status: 'FINISHED',
      episodes: 12,
      nextEpNum: null,
      nextEpAiringAt: null,
      lastSynced: 1_900_000_000,
    });

    const row = db
      .prepare('SELECT status, episodes, next_ep_num, next_ep_airing_at, last_synced FROM anime_cache WHERE anilist_id = ?')
      .get(1) as {
      status: string;
      episodes: number | null;
      next_ep_num: number | null;
      next_ep_airing_at: number | null;
      last_synced: number;
    };
    assert.equal(row.status, 'FINISHED');
    assert.equal(row.episodes, 12);
    assert.equal(row.next_ep_num, null);
    assert.equal(row.next_ep_airing_at, null);
    assert.equal(row.last_synced, 1_900_000_000);
  });
});
