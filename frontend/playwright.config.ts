import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { AUTH_FILE } from './e2e/auth-file.ts';

const PORT = 8181;

// `just test-e2e` (Step 5+) sets E2E_BASE_URL to point at the real Docker container
// instead of spawning a local ts-directly dev server — this is what validates
// node:sqlite against actual Node 26, sidestepping the local Node 24 runtime. Without
// it (plain `npm run test:e2e`), Playwright manages its own local backend process.
const externalBaseURL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // All specs share one backend server/DB and one login rate-limit bucket (5/min) —
  // parallel workers logging in concurrently across files spuriously trip the rate
  // limiter (observed: login silently 429ing mid-suite). Keep this at 1.
  workers: 1,
  retries: 0,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: externalBaseURL ?? `http://localhost:${PORT}`,
    storageState: AUTH_FILE,
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command: 'node src/index.ts',
        cwd: '../backend',
        url: `http://localhost:${PORT}/api/health`,
        reuseExistingServer: false,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          APP_PASSWORD: 'e2e-test-pass',
          PORT: String(PORT),
          DB_PATH: join(mkdtempSync(join(tmpdir(), 'suivi-anime-e2e-')), 'e2e.db'),
          ANILIST_FIXTURES: 'true',
        },
      },
});
