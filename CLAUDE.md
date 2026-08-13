# CLAUDE.md

Ce fichier guide Claude Code dans ce dépôt.

## Projet

Suivi-anime : tracker d'anime mono-utilisateur, un seul conteneur Docker. TypeScript
partout (`strict`, aucun `any` dans le contrat), React + Vite (front), Node 26+ / Fastify
(back), SQLite via `node:sqlite`. Monorepo npm workspaces : `shared/` (contrat),
`backend/`, `frontend/`.

Le projet est **implémenté et testé** (95 tests : 7 shared + 76 backend + 12 e2e, tous
verts via `just test`). Références : `README.md` (architecture/schéma/contrat d'API,
source de vérité pour tout comportement produit), `TESTS.md` (index fonctionnalité →
test), `USAGE.md` (guide de build/run/config pour l'utilisateur final),
`proto/anime-tracker.jsx` (référence UX d'origine, déjà portée dans `frontend/src/`).

## Structure

- `shared/src/types.ts` — contrat de données unique (`Media`, `ListEntry`, `BackupDump`,
  …), importé des deux côtés, jamais redéclaré ailleurs.
- `backend/src/db/` — `node:sqlite`, migrations idempotentes, `queries.ts` (statements
  préparés uniquement, jamais de SQL concaténé).
- `backend/src/routes/` — handlers HTTP (auth, list, search, backup) ; `app.ts` assemble
  tout (voir règle d'encapsulation ci-dessous).
- `backend/src/refresh.ts` — scheduler de rafraîchissement des dates de diffusion.
- `frontend/src/lib/anime.ts` — logique pure portée du proto (états de carte, tri) ;
  `App.tsx` gère les mutations optimistes et les onglets En cours/Non commencées/Terminées.

## Commandes

- `just test` — suite complète (shared + backend + e2e contre le vrai conteneur Docker),
  doit être vert avant de considérer un changement terminé.
- `just typecheck` — `tsc -b` sur les 3 paquets.
- `just dev` — backend `--watch` + Vite en parallèle.
- `just build` / `up` / `down` / `logs` / `shell` — cycle Docker de dev.
- `just test-e2e` — Playwright contre le conteneur réel (Node 26) ; `test-e2e-full`
  ajoute healthcheck/non-root/persistance (plus lent — à lancer si le Dockerfile change).
- `just curl-*` — sondage manuel de l'API (login/list/search/add/patch/delete/backup/restore).
- Node local est en v24 ; `node:sqlite` exige 26+ — tout ce qui touche la DB doit être
  validé via Docker (`just test-e2e*`), pas seulement en local.

## Règles d'architecture (ne pas enfreindre)

- Refuse de démarrer si `APP_PASSWORD` absent/vide (`config.ts`). Comparaison mot de
  passe en temps constant (SHA-256 + `timingSafeEqual`), jamais loggé.
- Protection des routes **par encapsulation** dans `app.ts` (sous-contexte Fastify
  protégé), pas par un flag par route — un hook `preHandler` global casserait le 404 du
  fallback SPA sur `/api/*` inconnu.
- `POST /api/list` est l'unique point d'écriture de `anime_cache` : fetch AniList **hors
  transaction**, puis `queries.transaction()` (upsert cache + insert user_list si
  nouveau). Un ré-ajout rafraîchit les métadonnées mais ne touche jamais `progress`.
- `DELETE /api/list/:id` supprime `anime_cache` ; `user_list` suit via `ON DELETE
  CASCADE` (nécessite `foreign_keys=ON`, actif dans `openDatabase`). Idempotent (204
  même si l'id n'était pas suivi).
- `GET /api/search` est un proxy pur, n'écrit jamais en base.
- Restauration : valide `version` + la forme de chaque ligne (jamais confiance dans le
  fichier uploadé), puis une seule transaction ; s'appuie sur la contrainte FK
  `user_list → anime_cache` plutôt qu'une double validation manuelle.
- Refresh scheduler cible uniquement `status='RELEASING'`, batché via alias GraphQL
  (`fetchByIds`), jamais un appel par anime.
- `airingAt` toujours en UTC ; conversion locale seulement à l'affichage.
- Swipe = mutation optimiste (UI immédiate, rollback si l'appel échoue) ; l'ajout d'un
  anime n'est **pas** optimiste (attend la réponse serveur).
- Arrêt propre sur `SIGTERM`/`SIGINT` : stop du scheduler puis `fastify.close()`.
- Le frontend n'appelle jamais AniList directement, toujours via le backend.

## Pièges connus

- **Imports relatifs toujours en `.ts`**, jamais `.js` : `node --test` (type-stripping
  natif) ne résout pas un import de valeur `.js` vers un `.ts` voisin ; `tsc` réécrit
  `.ts`→`.js` à la compilation (`allowImportingTsExtensions` +
  `rewriteRelativeImportExtensions` dans `tsconfig.base.json` — ne pas toucher).
- **Glob de test toujours quoté** : `node --test 'src/**/*.test.ts'` — sans guillemets,
  le shell étend `**` lui-même et ignore silencieusement les fichiers à la racine de
  `src/`.
- **`api.ts`** : ne mettre `Content-Type: application/json` que s'il y a un vrai corps
  JSON (jamais pour un body vide, jamais pour un `FormData`) — Fastify rejette sinon.
- **`SESSION_SECRET`** non fixé = secret aléatoire à **chaque démarrage du conteneur**
  (pas à chaque session utilisateur) → toutes les sessions sont invalidées à chaque
  redémarrage. Fixer une valeur dans `.env` pour l'éviter en usage réel.
- **`justfile` + `docker inspect -f`** : échapper les accolades Go en
  `{{"{{"}}...{{"}}"}}`, jamais `{{{{...}}}}` (le doublon ne s'échappe pas
  correctement, le healthcheck resterait bloqué sur "starting").
- `anime_cache` n'a pas de colonne `season_year` (voulu par le brief) — `seasonYear`
  est toujours `null` une fois l'anime en cache.

## Tests

- Backend : `node:test`, DB SQLite temporaire (jamais `:memory:` — WAL l'exige),
  `fastify.inject`. AniList toujours mocké via l'interface `AnilistClient`, jamais de
  vrai réseau en test.
- E2E : Playwright (`frontend/e2e/`). Fixtures AniList déterministes
  (`ANILIST_FIXTURES=true`, ids 90001–90004) pour les assertions dépendant d'un état
  stable. Un seul serveur/DB/rate-limit partagé entre tous les specs → authentification
  unique via `global-setup.ts` + `storageState`, `workers:1`, nettoyage systématique des
  ids de fixture en `beforeEach`/`afterEach`.
