import type { FastifyInstance } from 'fastify';
import type { AddListItemRequest, AnimeCacheRow, ListEntry, Media, UpdateProgressRequest } from '@suivi/shared';
import type { AnilistClient } from '../anilist.ts';
import type { Queries } from '../db/index.ts';
import { nowUnixSeconds } from '../time.ts';

type ErrorReply = { error: string };

function mediaToAnimeCacheRow(media: Media, lastSynced: number): AnimeCacheRow {
  return {
    anilistId: media.id,
    titleRomaji: media.title.romaji,
    titleEnglish: media.title.english,
    titleNative: media.title.native,
    coverImage: media.coverImage.medium,
    coverColor: media.coverImage.color,
    episodes: media.episodes,
    status: media.status,
    nextEpNum: media.nextAiringEpisode?.episode ?? null,
    nextEpAiringAt: media.nextAiringEpisode?.airingAt ?? null,
    lastSynced,
  };
}

/** Parses a route param expected to be a positive integer `anilistId`; `null` if invalid. */
function parseAnilistId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function registerListRoutes(fastify: FastifyInstance, queries: Queries, anilistClient: AnilistClient): void {
  fastify.get<{ Reply: ListEntry[] }>('/api/list', async () => queries.getList());

  // The only route that populates anime_cache (README §6). The AniList fetch happens
  // outside `queries.transaction` — never do network I/O inside a SQLite transaction.
  fastify.post<{ Body: AddListItemRequest; Reply: ListEntry | ErrorReply }>('/api/list', async (request, reply) => {
    const anilistId = request.body?.anilistId;
    if (typeof anilistId !== 'number' || !Number.isInteger(anilistId) || anilistId <= 0) {
      return reply.code(400).send({ error: 'invalid_anilist_id' });
    }

    let media: Media | null;
    try {
      media = await anilistClient.fetchById(anilistId);
    } catch (err) {
      request.log.error({ err }, 'AniList fetchById failed');
      return reply.code(502).send({ error: 'anilist_unavailable' });
    }
    if (media === null) {
      return reply.code(404).send({ error: 'anime_not_found' });
    }

    const now = nowUnixSeconds();
    queries.transaction(() => {
      queries.upsertAnimeCache(mediaToAnimeCacheRow(media, now));
      if (!queries.userListEntryExists(media.id)) {
        queries.insertUserListEntry(media.id, now);
      }
    });

    const entry = queries.getEntry(media.id);
    /* c8 ignore next 3 -- entry always exists right after the writes above */
    if (entry === null) {
      return reply.code(500).send({ error: 'internal_error' });
    }
    return reply.code(201).send(entry);
  });

  fastify.patch<{ Params: { anilistId: string }; Body: UpdateProgressRequest; Reply: ListEntry | ErrorReply }>(
    '/api/list/:anilistId',
    async (request, reply) => {
      const anilistId = parseAnilistId(request.params.anilistId);
      if (anilistId === null) {
        return reply.code(400).send({ error: 'invalid_anilist_id' });
      }
      const progress = request.body?.progress;
      if (typeof progress !== 'number' || !Number.isFinite(progress)) {
        return reply.code(400).send({ error: 'invalid_progress' });
      }
      if (!queries.userListEntryExists(anilistId)) {
        return reply.code(404).send({ error: 'not_found' });
      }

      queries.setProgress(anilistId, progress, nowUnixSeconds());

      const entry = queries.getEntry(anilistId);
      /* c8 ignore next 3 -- entry always exists, we just confirmed it above */
      if (entry === null) {
        return reply.code(500).send({ error: 'internal_error' });
      }
      return reply.send(entry);
    },
  );

  // Removes both user_list and anime_cache rows (via FK CASCADE) — no orphan left in
  // either table (README §6/§12). Idempotent: deleting an id that isn't tracked is a
  // no-op 204, not an error.
  fastify.delete<{ Params: { anilistId: string } }>('/api/list/:anilistId', async (request, reply) => {
    const anilistId = parseAnilistId(request.params.anilistId);
    if (anilistId === null) {
      return reply.code(400).send({ error: 'invalid_anilist_id' });
    }
    queries.removeFromList(anilistId);
    return reply.code(204).send();
  });
}
