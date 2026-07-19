import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { request } from '@playwright/test';
import { AUTH_FILE } from './auth-file.ts';

const PORT = 8181;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const PASSWORD = 'e2e-test-pass';

/**
 * Logs in once for the whole Playwright run and saves the session cookie, so
 * individual tests reuse it via `storageState` instead of hitting `/api/auth/login`
 * themselves — every spec logging in fresh was tripping the 5/minute rate limit
 * (README §5) once the suite grew past a handful of tests, since they all share one
 * server and therefore one rate-limit bucket keyed by IP.
 */
export default async function globalSetup(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) break;
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const context = await request.newContext({ baseURL: BASE_URL });
  const res = await context.post('/api/auth/login', { data: { password: PASSWORD } });
  if (!res.ok()) {
    throw new Error(`global-setup: login failed with status ${res.status()}`);
  }

  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  await context.storageState({ path: AUTH_FILE });
  await context.dispose();
}
