import type { Media } from '@suivi/shared';

export type AnilistClient = {
  search(term: string): Promise<Media[]>;
  fetchById(id: number): Promise<Media | null>;
  /** One batched request for all `ids` (GraphQL aliases) — the refresh scheduler's
   * rate-limit-friendly way to re-sync many RELEASING/NOT_YET_RELEASED entries at once
   * (README §7). Ids AniList no longer recognizes are simply absent from the returned map. */
  fetchByIds(ids: number[]): Promise<Map<number, Media>>;
};

export class AnilistError extends Error {}

const ENDPOINT = 'https://graphql.anilist.co';

// Query shape carried over from proto/anime-tracker.jsx — same fields, same sort.
const SEARCH_QUERY = `
query ($search: String) {
  Page(perPage: 12) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id episodes status seasonYear
      coverImage { medium color }
      title { romaji english native }
      nextAiringEpisode { episode airingAt }
    }
  }
}`;

const BY_ID_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id episodes status seasonYear
    coverImage { medium color }
    title { romaji english native }
    nextAiringEpisode { episode airingAt }
  }
}`;

const MEDIA_FIELDS = `
  id episodes status seasonYear
  coverImage { medium color }
  title { romaji english native }
  nextAiringEpisode { episode airingAt }
`;

/** Builds one GraphQL alias per id so a whole batch fits in a single request. Ids come
 * only from our own `anime_cache` primary key (always a validated integer), never from
 * unsanitized input — still guarded here since this string is interpolated directly. */
function buildBatchQuery(ids: number[]): string {
  const aliasedFields = ids.map((id) => {
    if (!Number.isInteger(id) || id <= 0) {
      throw new AnilistError(`invalid anilist id for batch fetch: ${JSON.stringify(id)}`);
    }
    return `m${id}: Media(id: ${id}, type: ANIME) { ${MEDIA_FIELDS} }`;
  });
  return `query {\n${aliasedFields.join('\n')}\n}`;
}

async function callAnilist(query: string, variables: Record<string, unknown>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new AnilistError('AniList unreachable', { cause: err });
  }
  if (!res.ok) {
    throw new AnilistError(`AniList responded with HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data?: unknown; errors?: { message?: string }[] };
  if (json.errors && json.errors.length > 0) {
    throw new AnilistError(json.errors[0]?.message ?? 'AniList GraphQL error');
  }
  return json.data;
}

// --- mapping: raw (untrusted, network-sourced) JSON -> Media, narrowed from `unknown`
// field by field rather than cast with `as`, matching the pattern in db/queries.ts.

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError(`expected string, got ${typeof value}`);
  return value;
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : asString(value);
}

function asNumber(value: unknown): number {
  if (typeof value !== 'number') throw new TypeError(`expected number, got ${typeof value}`);
  return value;
}

function asNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : asNumber(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new TypeError('expected object');
  return value as Record<string, unknown>;
}

/** Maps one raw AniList `Media` object to our `Media` contract. `airingAt` is already a
 * unix UTC timestamp on AniList's side — passed through as-is (README §6). */
export function mapAnilistMedia(raw: unknown): Media {
  const r = asRecord(raw);
  const title = asRecord(r.title);
  const coverImage = asRecord(r.coverImage);
  const nextAiringEpisodeRaw = r.nextAiringEpisode;

  return {
    id: asNumber(r.id),
    title: {
      romaji: asNullableString(title.romaji),
      english: asNullableString(title.english),
      native: asNullableString(title.native),
    },
    episodes: asNullableNumber(r.episodes),
    status: asString(r.status),
    seasonYear: asNullableNumber(r.seasonYear),
    coverImage: {
      medium: asNullableString(coverImage.medium),
      color: asNullableString(coverImage.color),
    },
    nextAiringEpisode:
      nextAiringEpisodeRaw === null || nextAiringEpisodeRaw === undefined
        ? null
        : mapNextAiringEpisode(asRecord(nextAiringEpisodeRaw)),
  };
}

function mapNextAiringEpisode(raw: Record<string, unknown>): { episode: number; airingAt: number } {
  return { episode: asNumber(raw.episode), airingAt: asNumber(raw.airingAt) };
}

export function createAnilistClient(): AnilistClient {
  return {
    async search(term: string): Promise<Media[]> {
      const data = asRecord(await callAnilist(SEARCH_QUERY, { search: term }));
      const page = asRecord(data.Page);
      const media = page.media;
      if (!Array.isArray(media)) {
        throw new AnilistError('unexpected AniList response shape (Page.media not an array)');
      }
      return media.map(mapAnilistMedia);
    },

    async fetchById(id: number): Promise<Media | null> {
      const data = asRecord(await callAnilist(BY_ID_QUERY, { id }));
      if (data.Media === null || data.Media === undefined) return null;
      return mapAnilistMedia(data.Media);
    },

    async fetchByIds(ids: number[]): Promise<Map<number, Media>> {
      const result = new Map<number, Media>();
      if (ids.length === 0) return result;

      const data = asRecord(await callAnilist(buildBatchQuery(ids), {}));
      for (const id of ids) {
        const raw = data[`m${id}`];
        if (raw !== null && raw !== undefined) {
          result.set(id, mapAnilistMedia(raw));
        }
      }
      return result;
    },
  };
}
