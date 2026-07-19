import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.ts';

test('refuse de démarrer sans APP_PASSWORD', () => {
  assert.throws(() => loadConfig({}), /APP_PASSWORD/);
});

test('refuse de démarrer avec APP_PASSWORD vide', () => {
  assert.throws(() => loadConfig({ APP_PASSWORD: '' }), /APP_PASSWORD/);
});

test('charge une config valide avec les valeurs par défaut', () => {
  const config = loadConfig({ APP_PASSWORD: 'secret' });
  assert.equal(config.port, 8080);
  assert.equal(config.dbPath, './data/suivi-anime.db');
  assert.equal(config.behindHttps, false);
  assert.ok(config.sessionSecret.length > 0);
  assert.ok(Buffer.isBuffer(config.appPasswordHash));
});

test("respecte les overrides d'environnement", () => {
  const config = loadConfig({
    APP_PASSWORD: 'secret',
    DB_PATH: '/data/x.db',
    PORT: '3000',
    SESSION_SECRET: 'fixed-secret',
    BEHIND_HTTPS: 'true',
  });
  assert.equal(config.dbPath, '/data/x.db');
  assert.equal(config.port, 3000);
  assert.equal(config.sessionSecret, 'fixed-secret');
  assert.equal(config.behindHttps, true);
});

test('ne conserve jamais le mot de passe en clair dans la config (sérialisation)', () => {
  const config = loadConfig({ APP_PASSWORD: 'super-secret-value' });
  const serialized = JSON.stringify(config);
  assert.equal(serialized.includes('super-secret-value'), false);
});
