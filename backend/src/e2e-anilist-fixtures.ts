import type { Media } from '@suivi/shared';
import type { AnilistClient } from './anilist.ts';

/**
 * Deterministic `AnilistClient` used only by Playwright (enabled via the
 * `ANILIST_FIXTURES=true` env var — see `index.ts`). Real AniList data changes over
 * time (airing dates, statuses), which would make the 4-card-states E2E assertions
 * flaky; this fixture set is crafted so each entry lands in a known state at
 * `progress: 0`, deterministically, in both the local dev run and the Docker-based
 * `just test-e2e` run.
 */

function buildFixtures(): Media[] {
  const inTwoDays = Math.floor(Date.now() / 1000) + 2 * 24 * 3600;
  return [
    // nextEp(1) <= episodes(12), no nextAiringEpisode -> "available" at progress 0.
    {
      id: 90_001,
      title: { romaji: 'Available Show', english: 'Available Show', native: null },
      episodes: 12,
      status: 'FINISHED',
      seasonYear: 2024,
      coverImage: { medium: null, color: '#5b8def' },
      nextAiringEpisode: null,
    },
    // nextEp(1) === nextAiringEpisode.episode(1) -> "scheduled" at progress 0.
    {
      id: 90_002,
      title: { romaji: 'Scheduled Show', english: 'Scheduled Show', native: null },
      episodes: null,
      status: 'RELEASING',
      seasonYear: 2026,
      coverImage: { medium: null, color: '#f5a524' },
      nextAiringEpisode: { episode: 1, airingAt: inTwoDays },
    },
    // no episodes, no nextAiringEpisode, not FINISHED -> "uptodate" at progress 0.
    {
      id: 90_003,
      title: { romaji: 'Uptodate Show', english: 'Uptodate Show', native: null },
      episodes: null,
      status: 'RELEASING',
      seasonYear: 2026,
      coverImage: { medium: null, color: '#8798b3' },
      nextAiringEpisode: null,
    },
    // episodes: 1 -> "available" at progress 0, "finished" the moment it's marked watched once.
    {
      id: 90_004,
      title: { romaji: 'Finishable Show', english: 'Finishable Show', native: null },
      episodes: 1,
      status: 'FINISHED',
      seasonYear: 2023,
      coverImage: { medium: null, color: '#3ecf8e' },
      nextAiringEpisode: null,
    },
  ];
}

const FIXTURES: Media[] = buildFixtures();

function matches(media: Media, term: string): boolean {
  const haystack = [media.title.romaji, media.title.english, media.title.native]
    .filter((x): x is string => x !== null)
    .join(' ')
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
}

export function createFixtureAnilistClient(): AnilistClient {
  return {
    async search(term: string): Promise<Media[]> {
      return FIXTURES.filter((m) => matches(m, term));
    },
    async fetchById(id: number): Promise<Media | null> {
      return FIXTURES.find((m) => m.id === id) ?? null;
    },
    async fetchByIds(ids: number[]): Promise<Map<number, Media>> {
      const result = new Map<number, Media>();
      for (const id of ids) {
        const media = FIXTURES.find((m) => m.id === id);
        if (media) result.set(id, media);
      }
      return result;
    },
  };
}
