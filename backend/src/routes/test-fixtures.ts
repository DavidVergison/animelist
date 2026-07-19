import type { Media } from '@suivi/shared';
import type { AnilistClient } from '../anilist.ts';

export function sampleMedia(overrides: Partial<Media> = {}): Media {
  return {
    id: 1,
    title: { romaji: 'Sousou no Frieren', english: "Frieren: Beyond Journey's End", native: '葬送のフリーレン' },
    episodes: 28,
    status: 'RELEASING',
    seasonYear: 2025,
    coverImage: { medium: 'https://example.test/frieren.jpg', color: '#5b8def' },
    nextAiringEpisode: { episode: 12, airingAt: 1_800_000_000 },
    ...overrides,
  };
}

/** A mock `AnilistClient` whose `fetchById`/`fetchByIds` always resolve to `media`
 * (default: `sampleMedia()`). */
export function clientReturningMedia(media: Media | null = sampleMedia()): AnilistClient {
  return {
    search: async () => (media ? [media] : []),
    fetchById: async () => media,
    fetchByIds: async (ids) => new Map(media ? ids.map((id) => [id, { ...media, id }]) : []),
  };
}
