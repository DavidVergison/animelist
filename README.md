# Suivi-anime

Application web **mono-utilisateur** de suivi d'animes, distribuée comme **un conteneur Docker**
que l'on démarre et utilise comme tracker personnel.

Pour build/run/configuration, voir `USAGE.md`. Pour le développement et les commandes de
test, voir `CLAUDE.md`. Pour l'index fonctionnalité → test, voir `TESTS.md`.

---

# Référence technique

Le reste de ce document est le brief technique complet ayant servi à générer le projet
(architecture, schéma, contrat d'API). Il reste la référence de design à jour —
consulte-le avant de modifier un comportement du produit.

**Un seul langage : TypeScript**, du front au back.

Le prototype UX fonctionnel existe déjà dans `proto/` (composant React, mock data).
**Ne pas le réécrire de zéro** : c'est la référence d'UX, de logique d'état et de contrat de
données. La SPA finale porte ce composant en TypeScript et remplace le mock par des appels API.

---

## 1. Principe

- Un seul utilisateur. Pas d'inscription, pas de table `users`.
- Le mot de passe est fourni au lancement via la variable d'environnement `APP_PASSWORD`.
- La base est un fichier **SQLite** dans un **volume persistant** monté sur le conteneur.
- Sauvegarde / restauration : **téléchargement et upload de la base au format JSON**.
- Recherche d'animes via **AniList**, appelée uniquement par le backend.
- **Ne rien stocker d'inutile** : seuls les animes effectivement ajoutés à la liste sont mis en cache.

Modèle pivot : **`progress`** = dernier épisode vu. Prochain épisode = `progress + 1`.

---

## 2. Stack

| Couche | Choix |
|---|---|
| Langage | **TypeScript** partout |
| Front | **React + TypeScript**, build **Vite** |
| Back | **Node 26+ / Fastify** en TypeScript, sert l'API **et** les fichiers statiques de la SPA |
| DB | **SQLite** via **`node:sqlite`** (module natif intégré à Node, aucune dépendance) |
| Auth | Mot de passe unique via `APP_PASSWORD`, session par cookie signé |
| Packaging | **Dockerfile multi-stage**, `docker-compose.yml` avec volume nommé |
| Source anime | **AniList GraphQL** (`https://graphql.anilist.co`), backend uniquement |

> **`node:sqlite`** est préféré à `better-sqlite3` : pas de compilation native, donc pas de
> build tools dans l'image Docker ni de problème multi-arch. Exige **Node 26 ou supérieur**.
> API synchrone (`DatabaseSync`), parfaitement adaptée à une charge mono-utilisateur.

---

## 3. Arborescence cible

Monorepo simple avec **workspaces npm** (pas de Turborepo/Nx, inutile ici).

```
.
├── package.json                # workspaces: ["shared", "backend", "frontend"]
├── tsconfig.base.json          # config TS commune
├── Dockerfile                  # multi-stage
├── docker-compose.yml
├── .env.example                # APP_PASSWORD=change-me
├── Makefile                    # dev, build, docker-build, docker-run
├── proto/                      # EXISTANT — prototype UX de référence
│   └── anime-tracker.jsx
├── shared/                     # TYPES PARTAGÉS front <-> back
│   ├── package.json
│   └── src/
│       ├── index.ts
│       └── types.ts            # Media, ListEntry, BackupDump, payloads API
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts            # bootstrap: config, DB, routes, static, scheduler
│       ├── config.ts           # lecture env: APP_PASSWORD, DB_PATH, PORT, SESSION_SECRET
│       ├── db/
│       │   ├── index.ts        # ouverture DatabaseSync, PRAGMA, migrations
│       │   ├── migrations.ts   # SQL idempotent
│       │   └── queries.ts      # requêtes typées
│       ├── auth.ts             # hook de session, login/logout
│       ├── anilist.ts          # client GraphQL + mapping (search + fetchById)
│       ├── backup.ts           # export/import JSON
│       ├── refresh.ts          # scheduler de rafraîchissement
│       └── routes/
│           ├── auth.ts
│           ├── search.ts
│           ├── list.ts
│           └── backup.ts
└── frontend/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts          # proxy /api -> backend en dev
    └── src/
        ├── main.tsx
        ├── App.tsx             # porté depuis proto/anime-tracker.jsx
        ├── api.ts              # wrappers fetch typés (importe depuis shared/)
        ├── Login.tsx           # écran mot de passe
        └── Settings.tsx        # sauvegarde / restauration JSON
```

> Le paquet `shared/` est la source de vérité du contrat de données. Front et back l'importent
> tous les deux — impossible de désynchroniser le modèle client et le modèle serveur.

---

## 4. Schéma SQLite

Migrations appliquées au démarrage (SQL idempotent, exécuté via `db.exec()`).

```sql
PRAGMA journal_mode = WAL;      -- lectures non bloquées par les écritures
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS anime_cache (
  anilist_id        INTEGER PRIMARY KEY,
  title_romaji      TEXT,
  title_english     TEXT,
  title_native      TEXT,
  cover_image       TEXT,
  cover_color       TEXT,
  episodes          INTEGER,
  status            TEXT,          -- RELEASING | FINISHED | ...
  next_ep_num       INTEGER,       -- NULL si plus rien de programmé
  next_ep_airing_at INTEGER,       -- timestamp unix UTC, NULL si aucun
  last_synced       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_anime_status ON anime_cache(status);

CREATE TABLE IF NOT EXISTS user_list (
  anilist_id INTEGER PRIMARY KEY REFERENCES anime_cache(anilist_id) ON DELETE CASCADE,
  status     TEXT    NOT NULL DEFAULT 'watching',  -- watching|completed|paused|dropped|planned
  progress   INTEGER NOT NULL DEFAULT 0,
  added_at   INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Mono-utilisateur : `user_list` n'a pas de colonne `user_id`, `anilist_id` suffit en clé primaire.

La liste s'obtient en **un seul JOIN** :

```sql
SELECT a.*, u.progress, u.status AS user_status
FROM user_list u JOIN anime_cache a ON a.anilist_id = u.anilist_id;
```

> Utiliser des **requêtes préparées** (`db.prepare(...)`) réutilisées, pas de concaténation SQL.

---

## 5. Authentification (mono-utilisateur)

- `APP_PASSWORD` lu au démarrage. **Si absent ou vide : refuser de démarrer** avec un message
  clair (ne jamais démarrer sans protection).
- `POST /api/auth/login` — `{password}` : comparaison avec `APP_PASSWORD` en **temps constant**
  (`crypto.timingSafeEqual` sur des buffers de même longueur — hasher les deux côtés en SHA-256
  avant comparaison pour normaliser la longueur). Si OK, pose un cookie de session.
- Cookie via `@fastify/cookie` : `httpOnly`, `sameSite: 'lax'`, `signed: true`,
  `secure` si `BEHIND_HTTPS=true`. Secret = `SESSION_SECRET`, généré aléatoirement au démarrage
  si non fourni (invalide les sessions au redémarrage — acceptable ici, documenté dans le README).
- `POST /api/auth/logout` — efface le cookie.
- `GET /api/auth/status` — `{authenticated: boolean}` (le front décide login vs app).
- Hook `preHandler` global : toutes les routes `/api/*` sauf `login` et `status` exigent
  une session valide, sinon **401**.
- **Rate limit** sur `/api/auth/login` via `@fastify/rate-limit` (ex. 5 essais / minute).

> Pas de hachage stocké : il n'y a pas de mot de passe en base, seulement une variable
> d'environnement comparée à la volée. Ne jamais logger `APP_PASSWORD`.

---

## 6. API

Toutes les routes sous `/api`. Réponses JSON. Types importés depuis `shared/`.

Auth :
- `POST /api/auth/login` — `{password}` → 204 + cookie, ou 401
- `POST /api/auth/logout` → 204
- `GET  /api/auth/status` → `{authenticated: boolean}`

Application (session requise) :
- `GET /api/search?q=<terme>` — **proxy AniList pur : aucune écriture en base.**
  Récupère les résultats, les map au format `Media`, les renvoie. Rien n'est mis en cache.
- `GET /api/list` — JOIN `user_list` × `anime_cache`, renvoie des `ListEntry`.
- `POST /api/list` — `{anilistId}` : **c'est ici et seulement ici que le cache se peuple.**
  1. Fetch AniList pour cet `anilistId` (query `Media(id:)`) — **hors transaction**.
  2. Transaction : upsert dans `anime_cache`, puis insert dans `user_list` (`progress: 0`).
  Si l'anime est déjà présent (ré-ajout), rafraîchir quand même ses métadonnées.
- `PATCH /api/list/{anilistId}` — `{progress}` : borné à `[0, episodes]`.
- `DELETE /api/list/{anilistId}` — retire l'entrée de `user_list` **et** la ligne
  `anime_cache` correspondante (pas d'orphelin conservé).

Sauvegarde :
- `GET  /api/backup` — télécharge un dump JSON (§8), header
  `Content-Disposition: attachment; filename="suivi-anime-<date>.json"`.
- `POST /api/backup/restore` — upload d'un dump JSON, remplace le contenu (§8).

**Contrat de données** (`shared/src/types.ts`, aligné sur AniList et sur le proto) :

```ts
export type Media = {
  id: number;
  title: { romaji: string | null; english: string | null; native: string | null };
  episodes: number | null;
  status: string;
  seasonYear: number | null;
  coverImage: { medium: string | null; color: string | null };
  nextAiringEpisode: { episode: number; airingAt: number } | null; // airingAt = unix UTC
};

export type UserStatus = 'watching' | 'completed' | 'paused' | 'dropped' | 'planned';

export type ListEntry = Media & {
  progress: number;
  userStatus: UserStatus;
};

export type BackupDump = {
  version: 1;
  exportedAt: string;
  animeCache: AnimeCacheRow[];
  userList: UserListRow[];
};
```

`airingAt` reste en **UTC** côté API. Conversion en heure locale uniquement à l'affichage.

---

## 7. Rafraîchissement des dates de diffusion

Les dates AniList changent (pauses, reports) — le refresh n'est pas optionnel.

- `setInterval` lancé au démarrage (+ un passage immédiat), intervalle **3–6 h**.
- Sélectionne les animes à rafraîchir :
  ```sql
  SELECT anilist_id FROM anime_cache WHERE status = 'RELEASING';
  ```
  Pas de `JOIN` nécessaire : le cache ne contient **que** des animes suivis (peuplé uniquement
  à l'ajout), et seuls ceux en cours de diffusion ont des dates qui bougent.
- Requête AniList par batch (alias GraphQL : plusieurs `Media(id:)` dans une même query) pour
  rester sous le rate limit (90 req/min/IP).
- Met à jour `next_ep_num`, `next_ep_airing_at`, `status`, `last_synced`.
- `clearInterval` + fermeture propre de la DB sur `SIGTERM` / `SIGINT` (shutdown gracieux).

---

## 8. Sauvegarde / restauration JSON

**Format du dump** — versionné pour permettre les migrations futures :

```json
{
  "version": 1,
  "exportedAt": "2026-07-19T12:00:00Z",
  "animeCache": [ { "anilistId": 1, "titleRomaji": "...", "episodes": 28, "...": "..." } ],
  "userList":   [ { "anilistId": 1, "status": "watching", "progress": 11,
                    "addedAt": 1737000000, "updatedAt": 1737100000 } ]
}
```

**Export** (`GET /api/backup`) : lit les deux tables, sérialise, renvoie en pièce jointe.

**Import** (`POST /api/backup/restore`, upload via `@fastify/multipart`) :
1. Valider le JSON et le champ `version` (rejeter une version inconnue avec un message explicite).
   Valider la forme des lignes (ne pas faire confiance au fichier uploadé).
2. Exécuter dans **une seule transaction** (`db.exec('BEGIN')` … `COMMIT` / `ROLLBACK`) :
   `DELETE` des deux tables puis insertion du dump. Rollback complet en cas d'erreur —
   jamais d'état partiel.
3. Renvoyer un récapitulatif : `{restored: {animeCache: N, userList: M}}`.
4. Le front demande une **confirmation explicite** avant l'envoi (l'import écrase tout).

> Le dump JSON est volontairement préféré à la copie du fichier SQLite : lisible, inspectable,
> et robuste aux évolutions de schéma.

---

## 9. Frontend (port du proto en TypeScript)

- Porter `proto/anime-tracker.jsx` en `frontend/src/App.tsx` : **conserver à l'identique** la
  direction visuelle, le composant de carte swipeable et les **4 états** de carte
  (`available` / `scheduled` / `uptodate` / `finished`), ainsi que le tri de la liste.
- Deux onglets dans « Ma liste » : **En cours** (tout ce qui n'est pas `finished`) et
  **Terminées** (`finished`), chacun avec son compteur. Une saison qui devient
  `finished` (progress = episodes) bascule automatiquement d'onglet.
- Typer avec les types importés de `shared/` — **ne pas redéclarer** les types du contrat.
- Chargement de la liste via `GET /api/list` au montage.
- **Mutations optimistes** : le swipe met à jour l'UI immédiatement, appelle l'API,
  et rollback en cas d'erreur. Le geste doit rester instantané.
- `Login.tsx` : écran mot de passe. Sur 401 depuis n'importe quel appel, retour au login.
- `Settings.tsx` : bouton « Télécharger la sauvegarde » et upload de fichier pour la
  restauration, avec confirmation explicite et affichage du récapitulatif.
- Le backend sert les fichiers statiques du build Vite (`@fastify/static`), avec **fallback
  SPA** : toute route inconnue hors `/api` renvoie `index.html`.

---

## 10. Docker

**Dockerfile multi-stage :**
1. `node:26-alpine` — install des workspaces, build de `shared/`, `frontend/` (Vite) et
   `backend/` (tsc).
2. Étape finale `node:26-alpine` : copie du `dist/` backend, du `dist/` frontend et des
   `node_modules` de production uniquement. `CMD ["node", "backend/dist/index.js"]`.

> Node 26 minimum est requis pour `node:sqlite`. Aucune compilation native, donc pas de
> build tools à installer.

**docker-compose.yml :**
```yaml
services:
  suivi-anime:
    build: .
    ports: ["8080:8080"]
    environment:
      APP_PASSWORD: ${APP_PASSWORD:?APP_PASSWORD est requis}
      DB_PATH: /data/suivi-anime.db
    volumes:
      - anime-data:/data
    restart: unless-stopped
volumes:
  anime-data:
```

- La DB vit dans le volume `/data` — elle survit aux `docker compose down` et aux mises à jour d'image.
- Le conteneur doit créer le fichier SQLite et appliquer les migrations s'il n'existe pas.
- `HEALTHCHECK` sur un endpoint `/api/health`.
- Tourner en utilisateur non-root ; s'assurer que `/data` est accessible en écriture.
- Démarrage en trois lignes documenté dans `USAGE.md` (`cp .env.example .env`, éditer
  le mot de passe, `docker compose up -d`).

---

## 12. Contraintes à ne pas oublier

- **TypeScript partout**, `strict: true`. Pas de `any` dans le contrat de données.
- **`node:sqlite`** (Node 26+), jamais `better-sqlite3` (compilation native).
- **`PRAGMA journal_mode=WAL`** activé à l'ouverture.
- Types du contrat définis **une seule fois** dans `shared/`, importés des deux côtés.
- Le client ne contacte **jamais** AniList directement — uniquement le backend.
- **Refuser de démarrer** si `APP_PASSWORD` est absent ou vide.
- Comparaison du mot de passe en **temps constant**, jamais loggée.
- **Ne rien stocker d'inutile** : `/api/search` n'écrit **jamais** en base. `anime_cache` ne
  contient que des animes effectivement ajoutés à la liste.
- Au retrait d'une entrée, supprimer aussi la ligne `anime_cache` (pas d'orphelin).
- L'appel AniList du `POST /api/list` se fait **hors transaction** (jamais de réseau dans
  une transaction SQLite).
- La restauration JSON s'exécute dans **une transaction unique** (tout ou rien).
- Dump JSON **versionné** (`"version": 1`), contenu validé à l'import.
- `airingAt` en **UTC** côté API ; heure locale seulement à l'affichage.
- La DB doit être dans le **volume monté**, jamais dans le filesystem du conteneur.
- Refresh ciblé sur les animes en statut **`RELEASING`**, batché pour le rate limit AniList.
- Swipe = **mutation optimiste**, jamais d'attente réseau visible.
- Fermeture propre de la DB et du scheduler sur `SIGTERM` / `SIGINT`.
