import React, { useState, useEffect, useRef, useCallback } from "react";

/* =========================================================================
   ANIME TRACKER — testable proto (mock data, canvas-safe)

   The artifact sandbox blocks external fetch (CSP), so AniList can't be
   reached here. This build ships a small MOCK dataset that mimics AniList's
   shape so the full UX is testable in-canvas.

   To go live:
   1. Run outside the artifact (vite/next dev has no CSP) and set API_MODE
      to "anilist" — anilistSearch() already holds the query.
   2. In production, point API_MODE at YOUR backend instead:
        GET   {API}/search?q=...     -> Lambda proxies AniList
        GET   {API}/list             -> Query USER#<sub> from DynamoDB
        POST  {API}/list  {anilistId}
        PATCH {API}/list/{id} {progress}
        DELETE {API}/list/{id}
      The client never calls AniList directly in prod (rate-limit control).
   ========================================================================= */

const API_MODE = "mock"; // "mock" | "anilist" | "backend"
const BACKEND = "";

const SEARCH_Q = `
query ($search: String) {
  Page(perPage: 12) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id episodes status format seasonYear
      coverImage { medium color }
      title { romaji english native }
      nextAiringEpisode { episode airingAt }
    }
  }
}`;

async function anilistSearch(term) {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: SEARCH_Q, variables: { search: term } }),
  });
  if (!res.ok) throw new Error("network");
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || "api");
  return json.data.Page.media;
}
async function backendSearch(term) {
  const res = await fetch(`${BACKEND}/search?q=${encodeURIComponent(term)}`);
  if (!res.ok) throw new Error("network");
  return res.json();
}

const H = 3600, D = 86400;
const now = () => Math.floor(Date.now() / 1000);

function mkCover(color) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='90' height='126'>
    <rect width='90' height='126' fill='${color}'/>
    <rect width='90' height='126' fill='url(%23g)' opacity='.4'/>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='%23000' stop-opacity='0'/>
      <stop offset='1' stop-color='%23000' stop-opacity='.6'/></linearGradient></defs></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

const MOCK = [
  { id: 1, title: { romaji: "Sousou no Frieren", english: "Frieren: Beyond Journey's End", native: "葬送のフリーレン" },
    episodes: 28, status: "RELEASING", format: "TV", seasonYear: 2025,
    coverImage: { medium: mkCover("%234f7cac"), color: "#5b8def" },
    nextAiringEpisode: { episode: 12, airingAt: now() + 2 * D + 3 * H } },
  { id: 2, title: { romaji: "Dungeon Meshi", english: "Delicious in Dungeon", native: "ダンジョン飯" },
    episodes: 24, status: "RELEASING", format: "TV", seasonYear: 2025,
    coverImage: { medium: mkCover("%23c47f2a"), color: "#f5a524" },
    nextAiringEpisode: { episode: 8, airingAt: now() + 4 * H } },
  { id: 3, title: { romaji: "Kusuriya no Hitorigoto", english: "The Apothecary Diaries", native: "薬屋のひとりごと" },
    episodes: 24, status: "FINISHED", format: "TV", seasonYear: 2024,
    coverImage: { medium: mkCover("%237a5ca8"), color: "#9b7fd4" }, nextAiringEpisode: null },
  { id: 4, title: { romaji: "Bocchi the Rock!", english: "Bocchi the Rock!", native: "ぼっち・ざ・ろっく!" },
    episodes: 12, status: "FINISHED", format: "TV", seasonYear: 2022,
    coverImage: { medium: mkCover("%23c25b7a"), color: "#f06292" }, nextAiringEpisode: null },
  { id: 5, title: { romaji: "Kaijuu 8-gou", english: "Kaiju No. 8", native: "怪獣8号" },
    episodes: 12, status: "RELEASING", format: "TV", seasonYear: 2025,
    coverImage: { medium: mkCover("%232f9e6e"), color: "#3ecf8e" },
    nextAiringEpisode: { episode: 5, airingAt: now() + 6 * D + 5 * H } },
  { id: 6, title: { romaji: "Vinland Saga Season 2", english: "Vinland Saga Season 2", native: "ヴィンランド・サガ SEASON2" },
    episodes: 24, status: "FINISHED", format: "TV", seasonYear: 2023,
    coverImage: { medium: mkCover("%23445566"), color: "#78909c" }, nextAiringEpisode: null },
];

function mockSearch(term) {
  const t = term.toLowerCase();
  return MOCK.filter((m) =>
    [m.title.romaji, m.title.english, m.title.native].filter(Boolean)
      .some((x) => x.toLowerCase().includes(t)));
}
async function doSearch(term) {
  if (API_MODE === "anilist") return anilistSearch(term);
  if (API_MODE === "backend") return backendSearch(term);
  await new Promise((r) => setTimeout(r, 180));
  return mockSearch(term);
}

const pickTitle = (t) => t.english || t.romaji || t.native || "Sans titre";
const subTitle = (t) => {
  const main = pickTitle(t);
  return [t.romaji, t.native, t.english].find((x) => x && x !== main) || null;
};
function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleString("fr-FR", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function countdown(ts) {
  const diff = ts * 1000 - Date.now();
  if (diff <= 0) return "maintenant";
  const d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000), m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `dans ${d}\u00a0j ${h}\u00a0h`;
  if (h > 0) return `dans ${h}\u00a0h ${m}\u00a0min`;
  return `dans ${m}\u00a0min`;
}
function nextState(entry) {
  const { progress, episodes, status, nextAiringEpisode } = entry;
  const nextEp = progress + 1;
  if (episodes && progress >= episodes) return { kind: "finished" };
  if (nextAiringEpisode) {
    const airedCount = nextAiringEpisode.episode - 1;
    if (nextEp <= airedCount) return { kind: "available", epNum: nextEp };
    if (nextEp === nextAiringEpisode.episode)
      return { kind: "scheduled", epNum: nextEp, airingAt: nextAiringEpisode.airingAt };
    return { kind: "uptodate", nextAiringAt: nextAiringEpisode.airingAt, epNum: nextAiringEpisode.episode };
  }
  if (episodes && nextEp <= episodes) return { kind: "available", epNum: nextEp };
  if (status === "FINISHED" && (!episodes || progress >= episodes)) return { kind: "finished" };
  return { kind: "uptodate" };
}

function ListCard({ entry, onWatch, onUnwatch, onRemove }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(0), active = useRef(false);
  const st = nextState(entry);
  const accent = entry.coverImage?.color || "var(--accent)";
  const commit = (delta) => { if (delta > 90) onWatch(entry); else if (delta < -90) onUnwatch(entry); setDx(0); };
  const onDown = (x) => { active.current = true; start.current = x; setDragging(true); };
  const onMove = (x) => { if (active.current) setDx(x - start.current); };
  const onUp = () => { if (!active.current) return; active.current = false; setDragging(false); commit(dx); };
  return (
    <div className="row">
      <div className="row-bg"><span className="bg-hint left">↺ Annuler</span><span className="bg-hint right">Vu ✓</span></div>
      <article className="card"
        style={{ transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform .22s cubic-bezier(.2,.8,.2,1)",
          borderLeft: `3px solid ${accent}` }}
        onMouseDown={(e) => onDown(e.clientX)} onMouseMove={(e) => onMove(e.clientX)}
        onMouseUp={onUp} onMouseLeave={onUp}
        onTouchStart={(e) => onDown(e.touches[0].clientX)} onTouchMove={(e) => onMove(e.touches[0].clientX)} onTouchEnd={onUp}>
        {entry.coverImage?.medium && <img className="thumb" src={entry.coverImage.medium} alt="" draggable="false" />}
        <div className="card-body">
          <div className="card-title">{pickTitle(entry.title)}</div>
          <div className="card-status">
            {st.kind === "available" && <span className="pill pill-go">Ép. {st.epNum} · dispo maintenant</span>}
            {st.kind === "scheduled" && <span className="pill pill-wait">Ép. {st.epNum} · {countdown(st.airingAt)}<em>{fmtDate(st.airingAt)}</em></span>}
            {st.kind === "uptodate" && <span className="pill pill-idle">À jour{st.nextAiringAt ? ` · ép. ${st.epNum} ${countdown(st.nextAiringAt)}` : ""}</span>}
            {st.kind === "finished" && <span className="pill pill-done">Saison terminée · vue</span>}
          </div>
          <div className="progress-line">{entry.progress}{entry.episodes ? ` / ${entry.episodes}` : ""} ép. vus</div>
        </div>
        <button className="remove" title="Retirer" onClick={() => onRemove(entry)}>×</button>
      </article>
    </div>
  );
}

export default function App() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState(null);
  const [list, setList] = useState([]);
  const [, tick] = useState(0);
  const debounce = useRef();

  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(id); }, []);

  const runSearch = useCallback(async (term) => {
    if (!term.trim()) { setResults([]); return; }
    setSearching(true); setErr(null);
    try { setResults(await doSearch(term)); }
    catch { setErr("Recherche indisponible. Réessaie dans un instant."); }
    finally { setSearching(false); }
  }, []);

  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(q), 300);
    return () => clearTimeout(debounce.current);
  }, [q, runSearch]);

  const inList = (id) => list.some((e) => e.id === id);
  const addSeason = (m) => {
    if (inList(m.id)) return;
    setList((l) => [...l, { id: m.id, title: m.title, episodes: m.episodes, status: m.status,
      coverImage: m.coverImage, nextAiringEpisode: m.nextAiringEpisode, progress: 0 }]);
  };
  const setProgress = (entry, next) =>
    setList((l) => l.map((e) => (e.id === entry.id ? { ...e, progress: Math.max(0, next) } : e)));
  const watch = (e) => setProgress(e, e.progress + 1);
  const unwatch = (e) => setProgress(e, e.progress - 1);
  const catchUp = (e) => {
    const cap = e.nextAiringEpisode ? e.nextAiringEpisode.episode - 1 : e.episodes || e.progress;
    setProgress(e, cap);
  };
  const remove = (e) => setList((l) => l.filter((x) => x.id !== e.id));

  const order = { available: 0, scheduled: 1, uptodate: 2, finished: 3 };
  const sorted = [...list].sort((a, b) => {
    const sa = nextState(a), sb = nextState(b);
    if (order[sa.kind] !== order[sb.kind]) return order[sa.kind] - order[sb.kind];
    if (sa.kind === "scheduled") return sa.airingAt - sb.airingAt;
    return 0;
  });

  return (
    <div className="app">
      <style>{CSS}</style>
      <header className="masthead">
        <div className="wordmark"><span className="glyph">◎</span> SUIVI<span className="thin">·anime</span></div>
        <div className="tag">radar de diffusion</div>
      </header>

      <section className="search">
        <input className="search-input" placeholder="Chercher — essaie: frieren, dungeon, 薬屋, kaiju…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        {API_MODE === "mock" && <div className="hint demo">Démo hors-ligne · jeu de données fictif · l'API réelle marche hors artifact</div>}
        {searching && <div className="hint">Recherche…</div>}
        {err && <div className="hint err">{err}</div>}
        {!searching && q.trim() && results.length === 0 && <div className="hint">Aucun résultat pour « {q} ».</div>}
        {results.length > 0 && (
          <div className="results">
            {results.map((m) => (
              <div className="result" key={m.id}>
                {m.coverImage?.medium && <img className="r-thumb" src={m.coverImage.medium} alt="" />}
                <div className="r-body">
                  <div className="r-title">{pickTitle(m.title)}</div>
                  {subTitle(m.title) && <div className="r-alt">{subTitle(m.title)}</div>}
                  <div className="r-meta">{m.seasonYear || "—"} · {m.episodes ? `${m.episodes} ép.` : "ép. ?"} · {m.status === "RELEASING" ? "en cours" : m.status === "FINISHED" ? "terminé" : m.status?.toLowerCase()}</div>
                </div>
                <button className="add" disabled={inList(m.id)} onClick={() => addSeason(m)}>{inList(m.id) ? "ajouté" : "+ ajouter"}</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mylist">
        <div className="section-head"><h2>Ma liste</h2><span className="count">{list.length}</span></div>
        {list.length === 0 ? (
          <div className="empty">Rien à suivre. Cherche une saison ci-dessus et ajoute-la.</div>
        ) : (
          <>
            <div className="swipe-legend">← glisse pour annuler · glisse pour marquer vu →</div>
            {sorted.map((entry) => {
              const st = nextState(entry);
              return (
                <div key={entry.id} className="row-wrap">
                  <ListCard entry={entry} onWatch={watch} onUnwatch={unwatch} onRemove={remove} />
                  <div className="row-actions">
                    <button className="mini" onClick={() => watch(entry)}>Vu ✓</button>
                    <button className="mini ghost" onClick={() => unwatch(entry)}>↺</button>
                    {st.kind === "available" && <button className="mini ghost" onClick={() => catchUp(entry)}>Tout rattraper</button>}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </section>

      <footer className="foot">Prototype UX · liste en mémoire (non sauvegardée). En prod : Lambda Go + DynamoDB + Cognito.</footer>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
:root{--ink:#0e1420;--ink2:#161f30;--panel:#1b2740;--line:#2a3852;--text:#e8edf5;--muted:#8798b3;--faint:#5d6f8c;--accent:#f5a524;--wait:#5b8def;--done:#3ecf8e}
*{box-sizing:border-box}
.app{max-width:720px;margin:0 auto;padding:20px 16px 60px;font-family:'IBM Plex Sans',system-ui,sans-serif;color:var(--text);background:var(--ink);min-height:100%}
.masthead{display:flex;align-items:baseline;justify-content:space-between;padding-bottom:14px;border-bottom:1px solid var(--line);margin-bottom:18px}
.wordmark{font-family:'Space Grotesk';font-weight:700;font-size:22px;letter-spacing:.5px}
.wordmark .glyph{color:var(--accent);margin-right:4px}
.wordmark .thin{color:var(--faint);font-weight:500}
.tag{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--faint)}
.search-input{width:100%;padding:13px 15px;border-radius:12px;border:1px solid var(--line);background:var(--ink2);color:var(--text);font-size:15px;font-family:inherit;outline:none}
.search-input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(245,165,36,.12)}
.hint{font-size:12px;color:var(--muted);margin-top:8px}
.hint.err{color:#ff8b7a}
.hint.demo{color:var(--faint)}
.results{margin-top:12px;display:flex;flex-direction:column;gap:8px}
.result{display:flex;gap:12px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px}
.r-thumb{width:44px;height:60px;object-fit:cover;border-radius:6px;flex:none}
.r-body{flex:1;min-width:0}
.r-title{font-weight:600;font-size:14px;line-height:1.25}
.r-alt{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.r-meta{font-size:11px;color:var(--faint);margin-top:3px;letter-spacing:.3px}
.add{flex:none;border:1px solid var(--accent);color:var(--accent);background:transparent;padding:7px 12px;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
.add:hover:not(:disabled){background:var(--accent);color:var(--ink)}
.add:disabled{opacity:.45;border-color:var(--line);color:var(--muted);cursor:default}
.mylist{margin-top:30px}
.section-head{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.section-head h2{font-family:'Space Grotesk';font-size:16px;letter-spacing:1px;text-transform:uppercase;margin:0}
.count{font-size:12px;color:var(--ink);background:var(--muted);border-radius:20px;padding:1px 9px;font-weight:600}
.swipe-legend{font-size:11px;color:var(--faint);margin:4px 0 12px;letter-spacing:.4px}
.empty{color:var(--muted);font-size:14px;background:var(--ink2);border:1px dashed var(--line);border-radius:12px;padding:26px 18px;text-align:center}
.row-wrap{margin-bottom:12px}
.row{position:relative;border-radius:12px;overflow:hidden}
.row-bg{position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;padding:0 18px;font-weight:700;font-size:13px}
.bg-hint.left{color:var(--muted)}
.bg-hint.right{color:var(--done)}
.card{position:relative;display:flex;gap:12px;align-items:center;background:var(--panel);padding:12px;user-select:none;cursor:grab;z-index:1}
.card:active{cursor:grabbing}
.thumb{width:48px;height:66px;object-fit:cover;border-radius:6px;flex:none;pointer-events:none}
.card-body{flex:1;min-width:0}
.card-title{font-weight:600;font-size:15px;line-height:1.2;margin-bottom:6px}
.pill{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px}
.pill em{font-style:normal;font-weight:400;color:var(--faint);font-size:11px}
.pill-go{background:rgba(245,165,36,.15);color:var(--accent)}
.pill-wait{background:rgba(91,141,239,.14);color:var(--wait)}
.pill-idle{background:rgba(135,152,179,.12);color:var(--muted)}
.pill-done{background:rgba(62,207,142,.13);color:var(--done)}
.progress-line{font-size:11px;color:var(--faint);margin-top:6px;letter-spacing:.3px}
.remove{position:absolute;top:8px;right:8px;background:none;border:none;color:var(--faint);font-size:18px;line-height:1;cursor:pointer;padding:2px 6px}
.remove:hover{color:#ff8b7a}
.row-actions{display:flex;gap:6px;margin-top:6px;padding-left:2px}
.mini{background:var(--done);color:var(--ink);border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
.mini.ghost{background:transparent;border:1px solid var(--line);color:var(--muted)}
.mini.ghost:hover{border-color:var(--muted);color:var(--text)}
.foot{margin-top:36px;font-size:11px;color:var(--faint);line-height:1.6;border-top:1px solid var(--line);padding-top:14px}
@media (hover:none){.card{cursor:default}}
@media (prefers-reduced-motion:reduce){.card{transition:none!important}}
`;
