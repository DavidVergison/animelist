import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import { startRefreshScheduler } from './refresh.ts';
import { createFixtureAnilistClient } from './e2e-anilist-fixtures.ts';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Playwright-only escape hatch (never set in production/docker-compose.yml): swaps
  // in deterministic search results, since real AniList data drifts over time in ways
  // that would make state-dependent E2E assertions flaky. See e2e-anilist-fixtures.ts.
  const anilistOverride = process.env.ANILIST_FIXTURES === 'true' ? createFixtureAnilistClient() : undefined;

  const { fastify, queries, anilistClient } = await buildApp(config, {
    logger: true,
    ...(anilistOverride ? { anilistClient: anilistOverride } : {}),
  });

  const scheduler = startRefreshScheduler(queries, anilistClient, {
    onError: (err) => fastify.log.error({ err }, 'refresh pass failed'),
  });

  const shutdown = async (): Promise<void> => {
    scheduler.stop();
    await fastify.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await fastify.listen({ port: config.port, host: '0.0.0.0' });
}

main();
