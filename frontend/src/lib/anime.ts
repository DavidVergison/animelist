import type { ListEntry, Media } from '@suivi/shared';

// Ported from proto/anime-tracker.jsx — same logic, typed. Do not change the state
// machine (nextState) without re-checking it against the prototype: it's the reference
// for UX/state behavior (README §1/§9).

export const pickTitle = (t: Media['title']): string => t.english || t.romaji || t.native || 'Sans titre';

export function subTitle(t: Media['title']): string | null {
  const main = pickTitle(t);
  return [t.romaji, t.native, t.english].find((x) => x && x !== main) ?? null;
}

export function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function countdown(ts: number): string {
  const diff = ts * 1000 - Date.now();
  if (diff <= 0) return 'maintenant';
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (d > 0) return `dans ${d} j ${h} h`;
  if (h > 0) return `dans ${h} h ${m} min`;
  return `dans ${m} min`;
}

export type CardState =
  | { kind: 'finished' }
  | { kind: 'available'; epNum: number }
  | { kind: 'scheduled'; epNum: number; airingAt: number }
  | { kind: 'uptodate'; epNum?: number; nextAiringAt?: number }
  | { kind: 'unreleased' };

export const CARD_STATE_ORDER: Record<CardState['kind'], number> = {
  available: 0,
  scheduled: 1,
  uptodate: 2,
  unreleased: 3,
  finished: 4,
};

export function nextState(entry: ListEntry): CardState {
  const { progress, episodes, status, nextAiringEpisode } = entry;
  const nextEp = progress + 1;

  if (episodes && progress >= episodes) return { kind: 'finished' };

  if (nextAiringEpisode) {
    const airedCount = nextAiringEpisode.episode - 1;
    if (nextEp <= airedCount) return { kind: 'available', epNum: nextEp };
    if (nextEp === nextAiringEpisode.episode) {
      return { kind: 'scheduled', epNum: nextEp, airingAt: nextAiringEpisode.airingAt };
    }
    return { kind: 'uptodate', nextAiringAt: nextAiringEpisode.airingAt, epNum: nextAiringEpisode.episode };
  }

  // Not ported from the proto: AniList reports an announced season's final episode
  // count (e.g. a 1-episode movie) before it airs, with no nextAiringEpisode yet —
  // without this check the fallback below misreads that as "already available".
  if (status === 'NOT_YET_RELEASED') return { kind: 'unreleased' };

  if (episodes && nextEp <= episodes) return { kind: 'available', epNum: nextEp };
  if (status === 'FINISHED' && (!episodes || progress >= episodes)) return { kind: 'finished' };
  return { kind: 'uptodate' };
}

/** Ma liste tabs (App.tsx §9). `progress === 0` wins over `finished`: a season that
 * aired in full but was never started belongs in "Non commencées", not "Terminées". */
export type TabId = 'active' | 'unstarted' | 'finished';

export function tabFor(entry: ListEntry): TabId {
  if (entry.progress === 0) return 'unstarted';
  return nextState(entry).kind === 'finished' ? 'finished' : 'active';
}

/** Available first, then scheduled (soonest airingAt first), then uptodate. Shared by
 * the "En cours" and "Non commencées" tabs; "Terminées" sorts alphabetically instead. */
export function byCardState(a: ListEntry, b: ListEntry): number {
  const sa = nextState(a);
  const sb = nextState(b);
  if (CARD_STATE_ORDER[sa.kind] !== CARD_STATE_ORDER[sb.kind]) {
    return CARD_STATE_ORDER[sa.kind] - CARD_STATE_ORDER[sb.kind];
  }
  if (sa.kind === 'scheduled' && sb.kind === 'scheduled') return sa.airingAt - sb.airingAt;
  return 0;
}
