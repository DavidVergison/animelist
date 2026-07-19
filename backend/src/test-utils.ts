import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type Config } from './config.ts';
import { buildApp, type BuildAppOptions } from './app.ts';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({ APP_PASSWORD: 'test-pass', SESSION_SECRET: 'test-secret', ...overrides });
}

const STATIC_FIXTURE_MARKER = 'test shell';

/**
 * Builds a fully wired app against throwaway temp resources (DB file + a fixture
 * static root containing a minimal `index.html`), so tests never touch the real
 * `./data` directory or depend on `frontend/dist` being built. Always call the
 * returned `cleanup()` in a `finally`.
 */
export async function buildTestApp(
  configOverrides: Record<string, string> = {},
  appOptions: BuildAppOptions = {},
): Promise<{ app: FastifyInstance; staticRoot: string; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'suivi-anime-test-'));
  const dbPath = join(dir, 'test.db');
  const staticRoot = join(dir, 'static');
  mkdirSync(staticRoot, { recursive: true });
  writeFileSync(join(staticRoot, 'index.html'), `<!doctype html><html><body>${STATIC_FIXTURE_MARKER}</body></html>`);

  const config = testConfig(configOverrides);
  const { fastify: app } = await buildApp(config, { dbPath, staticRoot, ...appOptions });

  return {
    app,
    staticRoot,
    cleanup: async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export { STATIC_FIXTURE_MARKER };

export function cookieHeaderFrom(res: { cookies: { name: string; value: string }[] }): string {
  return res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/** Logs in against `app` with the standard test password and returns a `cookie` header
 * value ready to pass in `headers` for subsequent authenticated `.inject()` calls. */
export async function loginCookie(app: FastifyInstance, password = 'test-pass'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password } });
  return cookieHeaderFrom(res);
}
