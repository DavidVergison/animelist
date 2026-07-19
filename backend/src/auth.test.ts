import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyPassword } from './auth.ts';

test('verifyPassword accepte le bon mot de passe', () => {
  const hash = createHash('sha256').update('correct-horse').digest();
  assert.equal(verifyPassword('correct-horse', hash), true);
});

test('verifyPassword rejette un mauvais mot de passe', () => {
  const hash = createHash('sha256').update('correct-horse').digest();
  assert.equal(verifyPassword('wrong-guess', hash), false);
});

test('verifyPassword rejette une chaîne vide', () => {
  const hash = createHash('sha256').update('correct-horse').digest();
  assert.equal(verifyPassword('', hash), false);
});
