import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, STATIC_FIXTURE_MARKER } from './test-utils.ts';

test('sert index.html à la racine', async () => {
  const { app, cleanup } = await buildTestApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes(STATIC_FIXTURE_MARKER));
  } finally {
    await cleanup();
  }
});

test('fallback SPA sur une route inconnue hors /api', async () => {
  const { app, cleanup } = await buildTestApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/some/unknown/route' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes(STATIC_FIXTURE_MARKER));
  } finally {
    await cleanup();
  }
});

test('404 JSON explicite sur une route /api inconnue (pas de fallback HTML)', async () => {
  const { app, cleanup } = await buildTestApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/inexistant' });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(JSON.parse(res.body), { error: 'not_found' });
  } finally {
    await cleanup();
  }
});
