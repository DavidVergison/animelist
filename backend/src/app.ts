import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.ts';
import { isAuthenticated } from './auth.ts';
import { type AnilistClient, createAnilistClient } from './anilist.ts';
import { openDatabase, createQueries, type Queries } from './db/index.ts';
import { registerBackupRoutes } from './routes/backup.ts';
import { registerPublicAuthRoutes, registerProtectedAuthRoutes } from './routes/auth.ts';
import { registerListRoutes } from './routes/list.ts';
import { registerSearchRoutes } from './routes/search.ts';
import { defaultStaticRoot, registerStatic } from './static.ts';

export type BuildAppOptions = {
  logger?: FastifyServerOptions['logger'];
  /** Overrides `config.dbPath` — tests point this at a throwaway temp file. */
  dbPath?: string;
  /** Overrides the computed default (`frontend/dist`) — tests point this at a fixture dir. */
  staticRoot?: string;
  /** Overrides the real HTTP client — tests inject a mock, never hitting the network. */
  anilistClient?: AnilistClient;
};

export type BuiltApp = {
  fastify: FastifyInstance;
  queries: Queries;
  anilistClient: AnilistClient;
};

/** Builds a fully wired Fastify instance without calling `.listen()` — used by both the
 * bootstrap entrypoint and tests (via `.inject()`). Also returns `queries`/`anilistClient`
 * so the bootstrap can start the refresh scheduler (Step 9) against the same instances. */
export async function buildApp(config: Config, options: BuildAppOptions = {}): Promise<BuiltApp> {
  const fastify = Fastify({ logger: options.logger ?? false });

  const db = openDatabase(options.dbPath ?? config.dbPath);
  fastify.addHook('onClose', () => db.close());
  const queries = createQueries(db);
  const anilistClient = options.anilistClient ?? createAnilistClient();

  await fastify.register(cookie, { secret: config.sessionSecret });
  await fastify.register(rateLimit, { global: false });

  // Public (README §5): login, status, health — no session required.
  registerPublicAuthRoutes(fastify, config);
  fastify.get('/api/health', async () => ({ status: 'ok' }));

  // Protected: everything else under /api/*, gated by a session-auth preHandler that
  // only applies within this encapsulated child context — it must never reach Fastify's
  // internal not-found route (registered at the root, via registerStatic below), or an
  // unmatched /api/* path would 401 instead of the plain 404 the SPA fallback expects.
  await fastify.register(async (protectedApi) => {
    protectedApi.addHook('preHandler', async (request, reply) => {
      if (!isAuthenticated(request)) {
        await reply.code(401).send({ error: 'unauthorized' });
      }
    });
    await protectedApi.register(multipart);
    registerProtectedAuthRoutes(protectedApi);
    registerListRoutes(protectedApi, queries, anilistClient);
    registerSearchRoutes(protectedApi, anilistClient);
    registerBackupRoutes(protectedApi, queries);
  });

  await registerStatic(fastify, options.staticRoot ?? defaultStaticRoot());

  return { fastify, queries, anilistClient };
}
