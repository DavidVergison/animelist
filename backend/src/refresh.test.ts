import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Media } from '@suivi/shared';
import type { AnilistClient } from './anilist.ts';
import { openDatabase, createQueries, type Queries } from './db/index.ts';
import { runRefreshOnce, startRefreshScheduler } from './refresh.ts';

async function withTempQueries(fn: (queries: Queries) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'suivi-anime-test-'));
  const db = openDatabase(join(dir, 'test.db'));
  try {
    await fn(createQueries(db));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedAnime(
  queries: Queries,
  anilistId: number,
  status: string,
  overrides: { nextEpNum?: number | null; nextEpAiringAt?: number | null } = {},
): void {
  queries.upsertAnimeCache({
    anilistId,
    titleRomaji: `Anime ${anilistId}`,
    titleEnglish: null,
    titleNative: null,
    coverImage: null,
    coverColor: null,
    episodes: 24,
    status,
    nextEpNum: overrides.nextEpNum ?? null,
    nextEpAiringAt: overrides.nextEpAiringAt ?? null,
    lastSynced: 1_000,
  });
  // README §7: anime_cache only ever holds anime that are actually tracked — a
  // matching user_list row always exists, so seed one here too.
  queries.insertUserListEntry(anilistId, 1_000);
}

function mediaFor(anilistId: number, overrides: Partial<Media> = {}): Media {
  return {
    id: anilistId,
    title: { romaji: `Anime ${anilistId}`, english: null, native: null },
    episodes: 24,
    status: 'RELEASING',
    seasonYear: 2025,
    coverImage: { medium: null, color: null },
    nextAiringEpisode: null,
    ...overrides,
  };
}

function recordingClient(
  responses: Map<number, Media>,
): { client: AnilistClient; calls: number[][] } {
  const calls: number[][] = [];
  const client: AnilistClient = {
    search: async () => [],
    fetchById: async (id) => responses.get(id) ?? null,
    fetchByIds: async (ids) => {
      calls.push([...ids]);
      const result = new Map<number, Media>();
      for (const id of ids) {
        const media = responses.get(id);
        if (media) result.set(id, media);
      }
      return result;
    },
  };
  return { client, calls };
}

test('runRefreshOnce ne rafraîchit que les animes RELEASING', () =>
  withTempQueries(async (queries) => {
    seedAnime(queries, 1, 'RELEASING');
    seedAnime(queries, 2, 'FINISHED');
    seedAnime(queries, 3, 'RELEASING');

    const { client, calls } = recordingClient(
      new Map([
        [1, mediaFor(1, { status: 'FINISHED' })],
        [2, mediaFor(2, { status: 'FINISHED' })], // would prove a bug if this got applied
        [3, mediaFor(3, { status: 'RELEASING' })],
      ]),
    );

    await runRefreshOnce(queries, client);

    assert.deepEqual(calls, [[1, 3]], 'only RELEASING ids must be sent to AniList');
  }));

test('runRefreshOnce met à jour exactement les colonnes de rafraîchissement', () =>
  withTempQueries(async (queries) => {
    seedAnime(queries, 1, 'RELEASING', { nextEpNum: 5, nextEpAiringAt: 1_700_000_000 });

    const { client } = recordingClient(
      new Map([[1, mediaFor(1, { status: 'FINISHED', nextAiringEpisode: null })]]),
    );

    await runRefreshOnce(queries, client);

    const entry = queries.getEntry(1);
    assert.ok(entry);
    assert.equal(entry.status, 'FINISHED');
    assert.equal(entry.nextAiringEpisode, null, 'nextEpNum/nextEpAiringAt must both be cleared together');
    // title/episodes/etc were never part of updateRefreshedMeta's SET clause — untouched.
    assert.equal(entry.title.romaji, 'Anime 1');
    assert.equal(entry.episodes, 24);
  }));

test('runRefreshOnce regroupe N animes RELEASING en un seul appel batché', () =>
  withTempQueries(async (queries) => {
    for (const id of [10, 11, 12, 13]) seedAnime(queries, id, 'RELEASING');

    const { client, calls } = recordingClient(
      new Map([10, 11, 12, 13].map((id) => [id, mediaFor(id)])),
    );

    await runRefreshOnce(queries, client);

    assert.equal(calls.length, 1, 'fetchByIds must be called exactly once, not once per id');
    assert.deepEqual(calls[0]?.sort((a, b) => a - b), [10, 11, 12, 13]);
  }));

test("runRefreshOnce n'écrit rien et ne jette pas si l'appel AniList échoue (avalé + onError)", () =>
  withTempQueries(async (queries) => {
    seedAnime(queries, 1, 'RELEASING', { nextEpNum: 5, nextEpAiringAt: 1_700_000_000 });
    const client: AnilistClient = {
      search: async () => [],
      fetchById: async () => null,
      fetchByIds: async () => {
        throw new Error('AniList down');
      },
    };
    let captured: unknown;

    await assert.doesNotReject(() => runRefreshOnce(queries, client, (err) => (captured = err)));

    assert.ok(captured instanceof Error);
    const entry = queries.getEntry(1);
    assert.deepEqual(entry?.nextAiringEpisode, { episode: 5, airingAt: 1_700_000_000 }, 'left untouched on failure');
  }));

test("runRefreshOnce ne fait aucun appel réseau s'il n'y a aucun anime RELEASING", () =>
  withTempQueries(async (queries) => {
    seedAnime(queries, 1, 'FINISHED');
    const { client, calls } = recordingClient(new Map());

    await runRefreshOnce(queries, client);

    assert.equal(calls.length, 0);
  }));

test('startRefreshScheduler déclenche un passage immédiat puis répète, et stop() nettoie bien l\'intervalle', () =>
  withTempQueries(async (queries) => {
    seedAnime(queries, 1, 'RELEASING');
    const { client, calls } = recordingClient(new Map([[1, mediaFor(1)]]));

    const scheduler = startRefreshScheduler(queries, client, { intervalMs: 15 });

    // immediate pass fires synchronously (before the first interval tick)
    await sleep(5);
    assert.equal(calls.length, 1, 'expected exactly the immediate startup pass so far');

    await sleep(40); // several interval ticks worth
    const callsAfterRunning = calls.length;
    assert.ok(callsAfterRunning >= 2, 'the interval must have ticked at least once more');

    scheduler.stop();
    await sleep(40); // long enough for more ticks to have happened, if not cleared

    assert.equal(calls.length, callsAfterRunning, 'no further calls after stop() — interval was actually cleared');
  }));
