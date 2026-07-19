import type { Media } from '@suivi/shared';
import type { AnilistClient } from './anilist.ts';
import type { Queries } from './db/index.ts';
import { nowUnixSeconds } from './time.ts';

/** README §7: airing dates change (delays, breaks) — 3–6h is the brief's suggested range. */
const DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000;

export type RefreshScheduler = {
  stop(): void;
};

/**
 * One refresh pass: re-syncs every `RELEASING` cached anime in a single batched AniList
 * request (README §7 — never one request per anime, to stay under the rate limit).
 * A failed AniList call is logged and swallowed, not thrown — a transient outage must
 * never crash the scheduler or the server.
 */
export async function runRefreshOnce(
  queries: Queries,
  anilistClient: AnilistClient,
  onError?: (err: unknown) => void,
): Promise<void> {
  const ids = queries.selectReleasingIds();
  if (ids.length === 0) return;

  let mediaById: Map<number, Media>;
  try {
    mediaById = await anilistClient.fetchByIds(ids);
  } catch (err) {
    onError?.(err);
    return;
  }

  const now = nowUnixSeconds();
  for (const id of ids) {
    const media = mediaById.get(id);
    // AniList no longer recognizing this id is left as-is for this pass rather than
    // guessed at — it'll be retried on the next interval tick.
    if (!media) continue;
    queries.updateRefreshedMeta(id, {
      status: media.status,
      nextEpNum: media.nextAiringEpisode?.episode ?? null,
      nextEpAiringAt: media.nextAiringEpisode?.airingAt ?? null,
      lastSynced: now,
    });
  }
}

/**
 * Starts the recurring refresh: one immediate pass, then every `intervalMs` (default
 * 3–6h per README §7). Returns a handle whose `stop()` clears the interval — call it
 * on `SIGTERM`/`SIGINT` alongside closing the DB (README §7/§12: clean shutdown).
 */
export function startRefreshScheduler(
  queries: Queries,
  anilistClient: AnilistClient,
  options: { intervalMs?: number; onError?: (err: unknown) => void } = {},
): RefreshScheduler {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  const tick = (): void => {
    void runRefreshOnce(queries, anilistClient, options.onError);
  };

  tick(); // immediate pass at startup
  const timer = setInterval(tick, intervalMs);

  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}
