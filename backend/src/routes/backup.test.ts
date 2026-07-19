import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BackupDump, ListEntry, RestoreSummary } from '@suivi/shared';
import { buildTestApp, loginCookie } from '../test-utils.ts';
import { clientReturningMedia } from './test-fixtures.ts';

const BOUNDARY = '----suiviAnimeTestBoundary';

function multipartPayload(filename: string, content: string): { body: Buffer; contentType: string } {
  const body =
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${content}\r\n` +
    `--${BOUNDARY}--\r\n`;
  return { body: Buffer.from(body, 'utf8'), contentType: `multipart/form-data; boundary=${BOUNDARY}` };
}

test('GET /api/backup renvoie un dump versionné avec le bon Content-Disposition', async () => {
  const { app, cleanup } = await buildTestApp({}, { anilistClient: clientReturningMedia() });
  try {
    const cookie = await loginCookie(app);
    await app.inject({ method: 'POST', url: '/api/list', headers: { cookie }, payload: { anilistId: 1 } });

    const res = await app.inject({ method: 'GET', url: '/api/backup', headers: { cookie } });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-disposition'] as string, /^attachment; filename="suivi-anime-\d{4}-\d{2}-\d{2}\.json"$/);

    const dump = JSON.parse(res.body) as BackupDump;
    assert.equal(dump.version, 1);
    assert.equal(dump.animeCache.length, 1);
    assert.equal(dump.userList.length, 1);
  } finally {
    await cleanup();
  }
});

test('GET /api/backup exige une session valide', async () => {
  const { app, cleanup } = await buildTestApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/backup' });
    assert.equal(res.statusCode, 401);
  } finally {
    await cleanup();
  }
});

test('round-trip complet via HTTP : export -> restore -> la liste est reconstruite à l\'identique', async () => {
  const { app, cleanup } = await buildTestApp({}, { anilistClient: clientReturningMedia() });
  try {
    const cookie = await loginCookie(app);
    await app.inject({ method: 'POST', url: '/api/list', headers: { cookie }, payload: { anilistId: 1 } });
    await app.inject({ method: 'PATCH', url: '/api/list/1', headers: { cookie }, payload: { progress: 9 } });

    const exportRes = await app.inject({ method: 'GET', url: '/api/backup', headers: { cookie } });
    const dumpText = exportRes.body;

    // Restore into a database that currently holds something different.
    await app.inject({ method: 'DELETE', url: '/api/list/1', headers: { cookie } });
    const emptyList = await app.inject({ method: 'GET', url: '/api/list', headers: { cookie } });
    assert.deepEqual(JSON.parse(emptyList.body), []);

    const { body, contentType } = multipartPayload('backup.json', dumpText);
    const restoreRes = await app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      headers: { cookie, 'content-type': contentType },
      payload: body,
    });
    assert.equal(restoreRes.statusCode, 200);
    const summary = JSON.parse(restoreRes.body) as RestoreSummary;
    assert.deepEqual(summary, { restored: { animeCache: 1, userList: 1 } });

    const restoredList = await app.inject({ method: 'GET', url: '/api/list', headers: { cookie } });
    const entries = JSON.parse(restoredList.body) as ListEntry[];
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.progress, 9);
  } finally {
    await cleanup();
  }
});

test('POST /api/backup/restore rejette une version inconnue et laisse la base inchangée', async () => {
  const { app, cleanup } = await buildTestApp({}, { anilistClient: clientReturningMedia() });
  try {
    const cookie = await loginCookie(app);
    await app.inject({ method: 'POST', url: '/api/list', headers: { cookie }, payload: { anilistId: 1 } });

    const badDump = JSON.stringify({ version: 2, exportedAt: 'x', animeCache: [], userList: [] });
    const { body, contentType } = multipartPayload('bad.json', badDump);
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      headers: { cookie, 'content-type': contentType },
      payload: body,
    });
    assert.equal(res.statusCode, 400);
    assert.equal((JSON.parse(res.body) as { error: string }).error, 'invalid_backup');

    const list = await app.inject({ method: 'GET', url: '/api/list', headers: { cookie } });
    assert.equal(JSON.parse(list.body).length, 1, 'the original entry must still be there');
  } finally {
    await cleanup();
  }
});

test('POST /api/backup/restore rejette un JSON malformé', async () => {
  const { app, cleanup } = await buildTestApp();
  try {
    const cookie = await loginCookie(app);
    const { body, contentType } = multipartPayload('bad.json', '{not valid json');
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      headers: { cookie, 'content-type': contentType },
      payload: body,
    });
    assert.equal(res.statusCode, 400);
    assert.equal((JSON.parse(res.body) as { error: string }).error, 'invalid_json');
  } finally {
    await cleanup();
  }
});

test('une ligne malformée dans le dump est rejetée sans toucher la base (rollback)', async () => {
  const { app, cleanup } = await buildTestApp({}, { anilistClient: clientReturningMedia() });
  try {
    const cookie = await loginCookie(app);
    await app.inject({ method: 'POST', url: '/api/list', headers: { cookie }, payload: { anilistId: 1 } });

    const malformed = JSON.stringify({
      version: 1,
      exportedAt: 'x',
      animeCache: [{ anilistId: 'not-a-number' }],
      userList: [],
    });
    const { body, contentType } = multipartPayload('malformed.json', malformed);
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      headers: { cookie, 'content-type': contentType },
      payload: body,
    });
    assert.equal(res.statusCode, 400);

    const list = await app.inject({ method: 'GET', url: '/api/list', headers: { cookie } });
    assert.equal(JSON.parse(list.body).length, 1, 'no rollback side effect: original entry untouched');
  } finally {
    await cleanup();
  }
});

test('POST /api/backup/restore exige une session valide', async () => {
  const { app, cleanup } = await buildTestApp();
  try {
    const { body, contentType } = multipartPayload('x.json', '{}');
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      headers: { 'content-type': contentType },
      payload: body,
    });
    assert.equal(res.statusCode, 401);
  } finally {
    await cleanup();
  }
});
