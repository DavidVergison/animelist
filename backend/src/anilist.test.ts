import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnilistError, createAnilistClient, mapAnilistMedia } from './anilist.ts';

function withMockFetch(t: { after: (fn: () => void) => void }, impl: typeof fetch): void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('mapAnilistMedia mappe un résultat complet (titres, cover, prochain épisode en UTC)', () => {
  const raw = {
    id: 1,
    episodes: 28,
    status: 'RELEASING',
    seasonYear: 2025,
    coverImage: { medium: 'https://example.test/frieren.jpg', color: '#5b8def' },
    title: { romaji: 'Sousou no Frieren', english: "Frieren: Beyond Journey's End", native: '葬送のフリーレン' },
    nextAiringEpisode: { episode: 12, airingAt: 1_800_000_000 },
  };

  const media = mapAnilistMedia(raw);

  assert.equal(media.id, 1);
  assert.equal(media.episodes, 28);
  assert.equal(media.status, 'RELEASING');
  assert.equal(media.seasonYear, 2025);
  assert.deepEqual(media.coverImage, { medium: 'https://example.test/frieren.jpg', color: '#5b8def' });
  assert.deepEqual(media.title, {
    romaji: 'Sousou no Frieren',
    english: "Frieren: Beyond Journey's End",
    native: '葬送のフリーレン',
  });
  // AniList already reports airingAt as a unix UTC timestamp — passed through unchanged.
  assert.deepEqual(media.nextAiringEpisode, { episode: 12, airingAt: 1_800_000_000 });
});

test('mapAnilistMedia gère les champs nullable (rien de programmé, titres manquants)', () => {
  const raw = {
    id: 2,
    episodes: null,
    status: 'FINISHED',
    seasonYear: null,
    coverImage: { medium: null, color: null },
    title: { romaji: null, english: null, native: 'ぼっち・ざ・ろっく!' },
    nextAiringEpisode: null,
  };

  const media = mapAnilistMedia(raw);

  assert.equal(media.episodes, null);
  assert.equal(media.seasonYear, null);
  assert.deepEqual(media.coverImage, { medium: null, color: null });
  assert.equal(media.nextAiringEpisode, null);
});

test('createAnilistClient().search envoie le terme et mappe les résultats', async (t) => {
  let capturedVariables: unknown;
  withMockFetch(t, (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { variables: unknown };
    capturedVariables = body.variables;
    return jsonResponse({
      data: {
        Page: {
          media: [
            {
              id: 5,
              episodes: 12,
              status: 'RELEASING',
              seasonYear: 2025,
              coverImage: { medium: null, color: '#3ecf8e' },
              title: { romaji: 'Kaijuu 8-gou', english: 'Kaiju No. 8', native: '怪獣8号' },
              nextAiringEpisode: null,
            },
          ],
        },
      },
    });
  }) as typeof fetch);

  const client = createAnilistClient();
  const results = await client.search('kaiju');

  assert.deepEqual(capturedVariables, { search: 'kaiju' });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.id, 5);
  assert.equal(results[0]?.title.english, 'Kaiju No. 8');
});

test('createAnilistClient().fetchById renvoie null si AniList renvoie Media: null', async (t) => {
  withMockFetch(t, (async () => jsonResponse({ data: { Media: null } })) as typeof fetch);

  const client = createAnilistClient();
  const result = await client.fetchById(999_999);

  assert.equal(result, null);
});

test('createAnilistClient().fetchByIds regroupe N ids en une seule requête HTTP (alias GraphQL)', async (t) => {
  let fetchCallCount = 0;
  let capturedQuery = '';
  withMockFetch(t, (async (_url: string | URL, init?: RequestInit) => {
    fetchCallCount += 1;
    const body = JSON.parse(String(init?.body)) as { query: string };
    capturedQuery = body.query;
    return jsonResponse({
      data: {
        m1: { id: 1, episodes: 12, status: 'RELEASING', seasonYear: 2025, coverImage: { medium: null, color: null }, title: { romaji: 'A', english: null, native: null }, nextAiringEpisode: null },
        m2: { id: 2, episodes: 24, status: 'FINISHED', seasonYear: 2024, coverImage: { medium: null, color: null }, title: { romaji: 'B', english: null, native: null }, nextAiringEpisode: null },
        m3: null, // AniList no longer knows this id
      },
    });
  }) as typeof fetch);

  const client = createAnilistClient();
  const result = await client.fetchByIds([1, 2, 3]);

  assert.equal(fetchCallCount, 1, 'must be a single HTTP request regardless of batch size');
  assert.match(capturedQuery, /m1: Media\(id: 1,/);
  assert.match(capturedQuery, /m2: Media\(id: 2,/);
  assert.match(capturedQuery, /m3: Media\(id: 3,/);
  assert.equal(result.size, 2, 'the null (unknown) id must be omitted, not mapped');
  assert.equal(result.get(1)?.status, 'RELEASING');
  assert.equal(result.get(2)?.status, 'FINISHED');
  assert.equal(result.has(3), false);
});

test('createAnilistClient().fetchByIds ne fait aucun appel réseau pour une liste vide', async (t) => {
  let called = false;
  withMockFetch(t, (async () => {
    called = true;
    return jsonResponse({ data: {} });
  }) as typeof fetch);

  const client = createAnilistClient();
  const result = await client.fetchByIds([]);

  assert.equal(called, false);
  assert.equal(result.size, 0);
});

test('createAnilistClient().search lève AnilistError sur une erreur GraphQL', async (t) => {
  withMockFetch(t, (async () => jsonResponse({ errors: [{ message: 'Invalid search' }] })) as typeof fetch);

  const client = createAnilistClient();
  await assert.rejects(() => client.search('x'), AnilistError);
});

test('createAnilistClient().search lève AnilistError sur un échec réseau', async (t) => {
  withMockFetch(t, (async () => {
    throw new Error('network down');
  }) as typeof fetch);

  const client = createAnilistClient();
  await assert.rejects(() => client.search('x'), AnilistError);
});

test('createAnilistClient().search lève AnilistError sur une réponse HTTP non-ok', async (t) => {
  withMockFetch(t, (async () => jsonResponse({}, 500)) as typeof fetch);

  const client = createAnilistClient();
  await assert.rejects(() => client.search('x'), AnilistError);
});
