import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Media } from '@suivi/shared';
import { buildTestApp, loginCookie } from '../test-utils.ts';
import type { AnilistClient } from '../anilist.ts';

function sampleMedia(overrides: Partial<Media> = {}): Media {
  return {
    id: 1,
    title: { romaji: 'Sousou no Frieren', english: null, native: null },
    episodes: 28,
    status: 'RELEASING',
    seasonYear: 2025,
    coverImage: { medium: null, color: null },
    nextAiringEpisode: null,
    ...overrides,
  };
}

test("GET /api/search proxie AniList et mappe les résultats, sans écrire en base", async () => {
  const anilistClient: AnilistClient = {
    search: async (term) => {
      assert.equal(term, 'frieren');
      return [sampleMedia()];
    },
    fetchById: async () => null,
    fetchByIds: async () => new Map(),
  };
  const { app, cleanup } = await buildTestApp({}, { anilistClient });
  try {
    const cookie = await loginCookie(app);

    const res = await app.inject({ method: 'GET', url: '/api/search?q=frieren', headers: { cookie } });
    assert.equal(res.statusCode, 200);
    const results = JSON.parse(res.body) as Media[];
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, 1);

    const list = await app.inject({ method: 'GET', url: '/api/list', headers: { cookie } });
    assert.deepEqual(JSON.parse(list.body), [], 'search must never populate anime_cache/user_list');
  } finally {
    await cleanup();
  }
});

test('GET /api/search exige une session valide', async () => {
  const { app, cleanup } = await buildTestApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=frieren' });
    assert.equal(res.statusCode, 401);
  } finally {
    await cleanup();
  }
});

test('GET /api/search sans q (ou vide) renvoie [] sans appeler AniList', async () => {
  let called = false;
  const anilistClient: AnilistClient = {
    search: async () => {
      called = true;
      return [];
    },
    fetchById: async () => null,
    fetchByIds: async () => new Map(),
  };
  const { app, cleanup } = await buildTestApp({}, { anilistClient });
  try {
    const cookie = await loginCookie(app);

    const noQ = await app.inject({ method: 'GET', url: '/api/search', headers: { cookie } });
    assert.deepEqual(JSON.parse(noQ.body), []);

    const emptyQ = await app.inject({ method: 'GET', url: '/api/search?q=', headers: { cookie } });
    assert.deepEqual(JSON.parse(emptyQ.body), []);

    const blankQ = await app.inject({ method: 'GET', url: '/api/search?q=%20%20', headers: { cookie } });
    assert.deepEqual(JSON.parse(blankQ.body), []);

    assert.equal(called, false);
  } finally {
    await cleanup();
  }
});

test('GET /api/search renvoie une erreur propre (502), jamais un 500 opaque, si AniList échoue', async () => {
  const anilistClient: AnilistClient = {
    search: async () => {
      throw new Error('boom');
    },
    fetchById: async () => null,
    fetchByIds: async () => new Map(),
  };
  const { app, cleanup } = await buildTestApp({}, { anilistClient, logger: false });
  try {
    const cookie = await loginCookie(app);

    const res = await app.inject({ method: 'GET', url: '/api/search?q=frieren', headers: { cookie } });
    assert.equal(res.statusCode, 502);
    assert.deepEqual(JSON.parse(res.body), { error: 'anilist_unavailable' });
  } finally {
    await cleanup();
  }
});
