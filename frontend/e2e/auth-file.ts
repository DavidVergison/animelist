import { fileURLToPath } from 'node:url';

/** Shared storage-state path: `global-setup.ts` writes it once, `playwright.config.ts`
 * loads it as the default authenticated state, and `login.spec.ts` opts back out of it
 * (it explicitly tests the unauthenticated flow). */
export const AUTH_FILE = fileURLToPath(new URL('./.auth/user.json', import.meta.url));
