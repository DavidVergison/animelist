import { useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import type { ListEntry } from '@suivi/shared';
import { countdown, fmtDate, nextState, pickTitle } from './lib/anime.ts';

type ListCardProps = {
  entry: ListEntry;
  onWatch: (entry: ListEntry) => void;
  onUnwatch: (entry: ListEntry) => void;
  onRemove: (entry: ListEntry) => void;
  onCatchUp: (entry: ListEntry) => void;
};

const SWIPE_THRESHOLD = 90;

/** Swipeable list row — ported from proto/anime-tracker.jsx: drag right marks watched
 * (+1), drag left undoes (-1), both mouse and touch. Mutations are optimistic in the
 * caller (App.tsx); this component only reports the gesture. */
export function ListCard({ entry, onWatch, onUnwatch, onRemove, onCatchUp }: ListCardProps) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(0);
  const active = useRef(false);

  const st = nextState(entry);
  const accent = entry.coverImage?.color || 'var(--accent)';

  const commit = (delta: number): void => {
    if (delta > SWIPE_THRESHOLD) onWatch(entry);
    else if (delta < -SWIPE_THRESHOLD) onUnwatch(entry);
    setDx(0);
  };
  const onDown = (x: number): void => {
    active.current = true;
    start.current = x;
    setDragging(true);
  };
  const onMove = (x: number): void => {
    if (active.current) setDx(x - start.current);
  };
  const onUp = (): void => {
    if (!active.current) return;
    active.current = false;
    setDragging(false);
    commit(dx);
  };

  return (
    <div className="row">
      <div className="row-bg">
        <span className="bg-hint left">↺ Annuler</span>
        <span className="bg-hint right">Vu ✓</span>
      </div>
      <article
        className="card"
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform .22s cubic-bezier(.2,.8,.2,1)',
          borderLeft: `3px solid ${accent}`,
        }}
        onMouseDown={(e: MouseEvent<HTMLElement>) => onDown(e.clientX)}
        onMouseMove={(e: MouseEvent<HTMLElement>) => onMove(e.clientX)}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onTouchStart={(e: TouchEvent<HTMLElement>) => onDown(e.touches[0]?.clientX ?? 0)}
        onTouchMove={(e: TouchEvent<HTMLElement>) => onMove(e.touches[0]?.clientX ?? 0)}
        onTouchEnd={onUp}
      >
        {entry.coverImage?.medium && <img className="thumb" src={entry.coverImage.medium} alt="" draggable="false" />}
        <div className="card-body">
          <div className="card-title">{pickTitle(entry.title)}</div>
          <div className="card-status">
            {st.kind === 'available' && <span className="pill pill-go">Ép. {st.epNum} · dispo maintenant</span>}
            {st.kind === 'scheduled' && (
              <span className="pill pill-wait">
                Ép. {st.epNum} · {countdown(st.airingAt)}
                <em>{fmtDate(st.airingAt)}</em>
              </span>
            )}
            {st.kind === 'uptodate' && (
              <span className="pill pill-idle">
                À jour{st.nextAiringAt ? ` · ép. ${st.epNum} ${countdown(st.nextAiringAt)}` : ''}
              </span>
            )}
            {st.kind === 'finished' && <span className="pill pill-done">Saison terminée · vue</span>}
            {st.kind === 'unreleased' && <span className="pill pill-soon">Pas encore diffusé</span>}
          </div>
          <div className="progress-line">
            <span>
              {entry.progress}
              {entry.episodes ? ` / ${entry.episodes}` : ''} ép. vus
            </span>
            {st.kind === 'available' && (
              <button className="catch-up" onClick={() => onCatchUp(entry)}>
                Tout rattraper
              </button>
            )}
          </div>
        </div>
        <button className="remove" title="Retirer" onClick={() => onRemove(entry)}>
          ×
        </button>
      </article>
    </div>
  );
}
