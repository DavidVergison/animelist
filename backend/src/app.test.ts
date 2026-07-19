import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { buildTestApp, loginCookie } from './test-utils.ts';

test('login : mauvais mot de passe -> 401, bon mot de passe -> 204 + cookie signé', async () => {
  const { app, cleanup } = await buildTestApp();
  try {
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'nope' } });
    assert.equal(bad.statusCode, 401);
    assert.equal(bad.cookies.length, 0);

    const good = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'test-pass' } });
    assert.equal(good.statusCode, 204);
    const sessionCookie = good.cookies.find((c) => c.name === 'session');
    assert.ok(sessionCookie);
    assert.equal(sessionCookie.httpOnly, true);
    assert.equal(sessionCookie.sameSite, 'Lax');
    assert.equal(sessionCookie.path, '/');
  } finally {
    await cleanup();
  }
});

test("status reflète l'état de session", async () => {
  const { app, cleanup } = await buildTestApp();
  try {
    const before = await app.inject({ method: 'GET', url: '/api/auth/status' });
    assert.equal(before.statusCode, 200);
    assert.deepEqual(JSON.parse(before.body), { authenticated: false });

    const cookie = await loginCookie(app);

    const after = await app.inject({ method: 'GET', url: '/api/auth/status', headers: { cookie } });
    assert.deepEqual(JSON.parse(after.body), { authenticated: true });
  } finally {
    await cleanup();
  }
});

test('logout exige une session valide et efface le cookie', async () => {
  const { app, cleanup } = await buildTestApp();
  try {
    const withoutSession = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    assert.equal(withoutSession.statusCode, 401);

    const cookie = await loginCookie(app);

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    assert.equal(logout.statusCode, 204);
    const cleared = logout.cookies.find((c) => c.name === 'session');
    assert.ok(cleared);
    assert.equal(cleared.value, '');
  } finally {
    await cleanup();
  }
});

test("rate-limit sur /api/auth/login : 6e tentative en moins d'une minute -> 429", async () => {
  const { app, cleanup } = await buildTestApp();
  try {
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'nope' } });
      assert.equal(res.statusCode, 401, `attempt ${i + 1} should be a normal 401`);
    }
    const sixth = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'nope' } });
    assert.equal(sixth.statusCode, 429);
  } finally {
    await cleanup();
  }
});

test('/api/health répond 200 sans authentification', async () => {
  const { app, cleanup } = await buildTestApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { status: 'ok' });
  } finally {
    await cleanup();
  }
});

test("APP_PASSWORD n'apparaît jamais dans les logs", async () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });

  const { app, cleanup } = await buildTestApp(
    { APP_PASSWORD: 'super-secret-value' },
    { logger: { level: 'info', stream } },
  );
  try {
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'super-secret-value' } });
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'wrong-guess-attempt' } });
  } finally {
    await cleanup();
  }

  const logged = lines.join('\n');
  assert.equal(logged.includes('super-secret-value'), false);
  assert.equal(logged.includes('wrong-guess-attempt'), false);
});
