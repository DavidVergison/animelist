import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX_TS = fileURLToPath(new URL('./index.ts', import.meta.url));

/**
 * Integration-level check for README §7/§12's "fermeture propre du scheduler et de la
 * DB sur SIGTERM/SIGINT": spawns the real bootstrap as a child process (so it goes
 * through `index.ts`'s actual signal handlers, not a unit stand-in), waits for it to
 * report healthy, sends the signal, and asserts a clean, prompt exit.
 */
async function testsGracefulShutdown(signal: 'SIGTERM' | 'SIGINT'): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'suivi-anime-shutdown-test-'));
  const port = 8300 + Math.floor(Math.random() * 500);

  const child = spawn(process.execPath, [INDEX_TS], {
    env: {
      ...process.env,
      APP_PASSWORD: 'shutdown-test-pass',
      PORT: String(port),
      DB_PATH: join(dir, 'test.db'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForHealth(port, child);

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('process did not exit within 3s of signal')), 3000);
      child.once('exit', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
      child.kill(signal);
    });

    assert.equal(exitCode, 0, 'the shutdown handler must call process.exit(0)');
  } finally {
    if (!child.killed) child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
}

function waitForHealth(port: number, child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('server did not become healthy in time'));
      }
    }, 5000);

    child.once('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`process exited early with code ${code}`));
      }
    });

    const poll = async (): Promise<void> => {
      while (!settled) {
        try {
          const res = await fetch(`http://localhost:${port}/api/health`);
          if (res.ok) {
            settled = true;
            clearTimeout(timeout);
            resolve();
            return;
          }
        } catch {
          // server not up yet — retry
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    void poll();
  });
}

test('arrêt propre sur SIGTERM (exit 0)', async () => {
  await testsGracefulShutdown('SIGTERM');
});

test('arrêt propre sur SIGINT (exit 0)', async () => {
  await testsGracefulShutdown('SIGINT');
});
