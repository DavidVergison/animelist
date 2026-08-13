import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListEntry, Media } from '@suivi/shared';
import { Login } from './Login.tsx';
import { Settings } from './Settings.tsx';
import { ListCard } from './ListCard.tsx';
import { byCardState, pickTitle, subTitle, tabFor, type TabId } from './lib/anime.ts';
import {
  ApiError,
  addToList,
  getAuthStatus,
  getList,
  logout,
  removeFromList,
  searchAnime,
  setUnauthorizedHandler,
  updateProgress,
} from './api.ts';

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null); // null = statut pas encore connu
  const [list, setList] = useState<ListEntry[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState<TabId>('active');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Media[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [addingIds, setAddingIds] = useState<Set<number>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000); // keeps countdowns fresh
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthenticated(false));
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    getAuthStatus()
      .then((status) => setAuthenticated(status.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  const loadList = useCallback(() => {
    getList()
      .then((entries) => {
        setList(entries);
        setListError(null);
      })
      .catch((err: unknown) => {
        if (!(err instanceof ApiError && err.status === 401)) {
          setListError('Impossible de charger la liste.');
        }
      });
  }, []);

  useEffect(() => {
    if (authenticated) loadList();
  }, [authenticated, loadList]);

  const runSearch = useCallback(async (term: string): Promise<void> => {
    if (!term.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      setResults(await searchAnime(term));
    } catch {
      setSearchError('Recherche indisponible. Réessaie dans un instant.');
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, runSearch]);

  const inList = (id: number): boolean => list.some((e) => e.id === id);

  async function addSeason(media: Media): Promise<void> {
    if (inList(media.id)) return;
    setAddingIds((s) => new Set(s).add(media.id));
    try {
      const entry = await addToList(media.id);
      setList((l) => [...l, entry]);
      setTab(tabFor(entry));
    } catch {
      setSearchError("Impossible d'ajouter cet anime pour le moment.");
    } finally {
      setAddingIds((s) => {
        const next = new Set(s);
        next.delete(media.id);
        return next;
      });
    }
  }

  /** Optimistic mutation (README §9): UI updates instantly, the API call follows, and a
   * failure rolls the entry back to its pre-mutation progress. */
  function setProgressOptimistic(entry: ListEntry, requestedProgress: number): void {
    const clamped = Math.max(0, requestedProgress);
    setList((l) => l.map((e) => (e.id === entry.id ? { ...e, progress: clamped } : e)));
    updateProgress(entry.id, clamped)
      .then((updated) => {
        setList((l) => l.map((e) => (e.id === entry.id ? updated : e)));
      })
      .catch(() => {
        setList((l) => l.map((e) => (e.id === entry.id ? { ...e, progress: entry.progress } : e)));
      });
  }

  const watch = (entry: ListEntry): void => setProgressOptimistic(entry, entry.progress + 1);
  const unwatch = (entry: ListEntry): void => setProgressOptimistic(entry, entry.progress - 1);
  const catchUp = (entry: ListEntry): void => {
    const cap = entry.nextAiringEpisode ? entry.nextAiringEpisode.episode - 1 : (entry.episodes ?? entry.progress);
    setProgressOptimistic(entry, cap);
  };

  function remove(entry: ListEntry): void {
    setList((l) => l.filter((e) => e.id !== entry.id));
    removeFromList(entry.id).catch(() => {
      setList((l) => (l.some((e) => e.id === entry.id) ? l : [...l, entry]));
    });
  }

  const handleLogout = async (): Promise<void> => {
    await logout().catch(() => {
      // already logged out server-side (e.g. expired session) — proceed to the login screen anyway
    });
    setAuthenticated(false);
  };

  if (authenticated === null) {
    return <div className="app-loading" />;
  }
  if (!authenticated) {
    return <Login onSuccess={() => setAuthenticated(true)} />;
  }
  if (showSettings) {
    return <Settings onClose={() => setShowSettings(false)} onRestored={loadList} />;
  }

  const buckets: Record<TabId, ListEntry[]> = { active: [], unstarted: [], finished: [] };
  for (const entry of list) buckets[tabFor(entry)].push(entry);
  buckets.active.sort(byCardState);
  buckets.unstarted.sort(byCardState);
  buckets.finished.sort((a, b) => pickTitle(a.title).localeCompare(pickTitle(b.title)));
  const shown = buckets[tab];

  return (
    <div className="app">
      <header className="masthead">
        <div className="wordmark">
          <span className="glyph">◎</span> SUIVI<span className="thin">·anime</span>
        </div>
        <div className="masthead-actions">
          <button className="mini ghost" onClick={() => setShowSettings(true)}>
            Réglages
          </button>
          <button className="logout-button" onClick={() => void handleLogout()}>
            Déconnexion
          </button>
        </div>
      </header>

      <section className="search">
        <input
          className="search-input"
          placeholder="Chercher — essaie: frieren, dungeon, kaiju…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && <div className="hint">Recherche…</div>}
        {searchError && (
          <div className="hint err" role="alert">
            {searchError}
          </div>
        )}
        {!searching && query.trim() && results.length === 0 && (
          <div className="hint">Aucun résultat pour « {query} ».</div>
        )}
        {results.length > 0 && (
          <div className="results">
            {results.map((m) => (
              <div className="result" key={m.id}>
                {m.coverImage?.medium && <img className="r-thumb" src={m.coverImage.medium} alt="" />}
                <div className="r-body">
                  <div className="r-title">{pickTitle(m.title)}</div>
                  {subTitle(m.title) && <div className="r-alt">{subTitle(m.title)}</div>}
                  <div className="r-meta">
                    {m.seasonYear ?? '—'} · {m.episodes ? `${m.episodes} ép.` : 'ép. ?'} ·{' '}
                    {m.status === 'RELEASING' ? 'en cours' : m.status === 'FINISHED' ? 'terminé' : m.status.toLowerCase()}
                  </div>
                </div>
                <button className="add" disabled={inList(m.id) || addingIds.has(m.id)} onClick={() => void addSeason(m)}>
                  {inList(m.id) ? 'ajouté' : addingIds.has(m.id) ? 'ajout…' : '+ ajouter'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mylist">
        <div className="section-head">
          <h2>Ma liste</h2>
        </div>
        <div className="tabs" role="tablist">
          <button
            className={`tab${tab === 'active' ? ' active' : ''}`}
            role="tab"
            aria-selected={tab === 'active'}
            onClick={() => setTab('active')}
          >
            En cours <span className="count">{buckets.active.length}</span>
          </button>
          <button
            className={`tab${tab === 'unstarted' ? ' active' : ''}`}
            role="tab"
            aria-selected={tab === 'unstarted'}
            onClick={() => setTab('unstarted')}
          >
            Non commencées <span className="count">{buckets.unstarted.length}</span>
          </button>
          <button
            className={`tab${tab === 'finished' ? ' active' : ''}`}
            role="tab"
            aria-selected={tab === 'finished'}
            onClick={() => setTab('finished')}
          >
            Terminées <span className="count">{buckets.finished.length}</span>
          </button>
        </div>
        {listError && (
          <div className="hint err" role="alert">
            {listError}
          </div>
        )}
        {list.length === 0 ? (
          <div className="empty">Rien à suivre. Cherche une saison ci-dessus et ajoute-la.</div>
        ) : shown.length === 0 ? (
          <div className="empty">
            {tab === 'active'
              ? 'Tout est à jour.'
              : tab === 'unstarted'
                ? 'Aucune saison en attente.'
                : 'Aucune saison terminée pour l’instant.'}
          </div>
        ) : (
          <>
            {(tab === 'active' || tab === 'unstarted') && (
              <div className="swipe-legend">← glisse pour annuler · glisse pour marquer vu →</div>
            )}
            {shown.map((entry) => (
              <div key={entry.id} className="row-wrap">
                <ListCard entry={entry} onWatch={watch} onUnwatch={unwatch} onRemove={remove} onCatchUp={catchUp} />
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
