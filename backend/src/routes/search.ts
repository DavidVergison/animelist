import type { FastifyInstance } from 'fastify';
import type { Media } from '@suivi/shared';
import type { AnilistClient } from '../anilist.ts';

/** Pure AniList proxy (README §6): never writes to `anime_cache`/`user_list`. */
export function registerSearchRoutes(fastify: FastifyInstance, anilistClient: AnilistClient): void {
  fastify.get<{ Querystring: { q?: string }; Reply: Media[] | { error: string } }>('/api/search', async (request, reply) => {
    const term = request.query.q?.trim();
    if (!term) return [];

    try {
      return await anilistClient.search(term);
    } catch (err) {
      request.log.error({ err }, 'AniList search failed');
      return reply.code(502).send({ error: 'anilist_unavailable' });
    }
  });
}
