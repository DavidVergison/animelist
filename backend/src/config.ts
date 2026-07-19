import { createHash, randomBytes } from 'node:crypto';

export type Config = {
  /** SHA-256 digest of APP_PASSWORD — the raw password is never retained past startup. */
  appPasswordHash: Buffer;
  dbPath: string;
  port: number;
  sessionSecret: string;
  behindHttps: boolean;
};

/**
 * Reads and validates the process environment. Throws if `APP_PASSWORD` is missing or
 * empty — the caller (bootstrap) must treat this as fatal: never start unprotected.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const appPassword = env.APP_PASSWORD;
  if (appPassword === undefined || appPassword.length === 0) {
    throw new Error(
      'APP_PASSWORD environment variable is required and must not be empty. Refusing to start unprotected.',
    );
  }

  const sessionSecret =
    env.SESSION_SECRET !== undefined && env.SESSION_SECRET.length > 0
      ? env.SESSION_SECRET
      : randomBytes(32).toString('hex');

  return {
    appPasswordHash: createHash('sha256').update(appPassword).digest(),
    dbPath: env.DB_PATH ?? './data/suivi-anime.db',
    port: env.PORT !== undefined ? Number(env.PORT) : 8080,
    sessionSecret,
    behindHttps: env.BEHIND_HTTPS === 'true',
  };
}
