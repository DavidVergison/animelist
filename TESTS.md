# TESTS — Couverture fonctionnelle

Index de correspondance **fonctionnalité du brief (voir `README.md`) → test qui la
couvre**, pour garantir qu'aucune exigence n'est sans test. `just test` (shared +
backend + e2e Playwright contre le vrai conteneur Docker) doit rester intégralement
vert — 95 tests actuellement (7 shared + 76 backend + 12 e2e).

Convention des références : `fichier :: nom du test`. `[e2e]` = spec Playwright dans
`frontend/e2e/`, sans préfixe = test `backend/src/...` ou `shared/src/...`.

### §1 — Principe
| Fonctionnalité | Test |
|---|---|
| Refuse de démarrer sans `APP_PASSWORD` (ou vide) | `config.test.ts :: refuse de démarrer sans APP_PASSWORD` / `... avec APP_PASSWORD vide` |
| DB SQLite fichier, créée si absente | `db/db.test.ts :: openDatabase crée le dossier parent s'il n'existe pas...` |
| Sauvegarde/restauration JSON | voir §8 |
| Recherche AniList, jamais d'écriture DB | `routes/search.test.ts :: ... sans écrire en base` |
| Cache ne contient que les animes ajoutés | `routes/search.test.ts` (recherche n'écrit rien) + `routes/list.test.ts :: POST /api/list peuple anime_cache...` (seul point d'écriture) |

### §4 — Schéma SQLite
| Fonctionnalité | Test |
|---|---|
| `PRAGMA journal_mode = WAL` actif | `db/db.test.ts :: WAL est actif sur une base fichier` |
| Migrations idempotentes | `db/db.test.ts :: migrations sont idempotentes...` |
| FK `ON DELETE CASCADE` (user_list → anime_cache) | `db/db.test.ts :: CASCADE — supprimer anime_cache retire aussi la ligne user_list...` |
| JOIN liste → `ListEntry` conforme | `db/db.test.ts :: JOIN liste renvoie un ListEntry conforme au contrat` |

### §5 — Authentification
| Fonctionnalité | Test |
|---|---|
| Comparaison mot de passe temps constant | `auth.test.ts :: verifyPassword accepte/rejette...` (3 tests) |
| `APP_PASSWORD` jamais loggé | `app.test.ts :: APP_PASSWORD n'apparaît jamais dans les logs` + `config.test.ts :: ne conserve jamais le mot de passe en clair...` |
| Cookie signé httpOnly/sameSite/path | `app.test.ts :: login : mauvais mot de passe -> 401, bon mot de passe -> 204 + cookie signé` |
| Logout efface le cookie | `app.test.ts :: logout exige une session valide et efface le cookie` |
| `GET /api/auth/status` reflète la session | `app.test.ts :: status reflète l'état de session` |
| 401 sur `/api/*` protégé sans session | `app.test.ts` (logout) + `routes/list.test.ts :: les routes /api/list exigent une session valide` + `routes/search.test.ts :: GET /api/search exige une session valide` + `routes/backup.test.ts` (2 tests) |
| 404 (pas 401) sur `/api/*` inconnu — le hook d'auth ne doit pas polluer le 404 | `static.test.ts :: 404 JSON explicite sur une route /api inconnue...` |
| Rate-limit login (5/min) | `app.test.ts :: rate-limit sur /api/auth/login : 6e tentative...` |

### §6 — API / contrat de données
| Fonctionnalité | Test |
|---|---|
| Types `Media`/`ListEntry`/`BackupDump`/payloads conformes | `shared/types.test.ts` (7 tests) |
| `GET /api/list` (JOIN) | `db/db.test.ts :: JOIN liste...` + `routes/list.test.ts` |
| `POST /api/list` peuple le cache | `routes/list.test.ts :: POST /api/list peuple anime_cache + user_list...` |
| Fetch AniList hors transaction | `routes/list.test.ts :: un échec AniList pendant POST ne laisse aucune écriture partielle...` |
| Ré-ajout rafraîchit les métadonnées sans réinitialiser `progress` | `routes/list.test.ts :: ré-ajout (même id déjà présent) rafraîchit les métadonnées mais ne réinitialise pas la progression` |
| `PATCH` borne `progress` à `[0, episodes]` | `db/db.test.ts :: clampProgress borne dans [0, episodes]` + `routes/list.test.ts :: PATCH /api/list/:id borne la progression...` |
| `DELETE` retire `user_list` **et** `anime_cache` | `routes/list.test.ts :: DELETE /api/list/:id retire user_list ET anime_cache — aucun orphelin` |
| `airingAt` en UTC (passthrough AniList) | `anilist.test.ts :: mapAnilistMedia mappe un résultat complet (..., prochain épisode en UTC)` |

### §7 — Rafraîchissement
| Fonctionnalité | Test |
|---|---|
| Passage immédiat au démarrage + intervalle | `refresh.test.ts :: startRefreshScheduler déclenche un passage immédiat puis répète, et stop() nettoie bien l'intervalle` |
| Cible `RELEASING` et `NOT_YET_RELEASED`, jamais `FINISHED` | `db/db.test.ts :: sélection RELEASING/NOT_YET_RELEASED...` + `refresh.test.ts :: runRefreshOnce rafraîchit les animes RELEASING et NOT_YET_RELEASED, jamais les FINISHED` |
| Batch = une seule requête AniList pour N ids | `anilist.test.ts :: fetchByIds regroupe N ids en une seule requête HTTP (alias GraphQL)` + `refresh.test.ts :: ... regroupe N animes à rafraîchir en un seul appel batché` |
| Met à jour exactement les colonnes de refresh (`episodes` inclus) | `refresh.test.ts :: runRefreshOnce met à jour exactement les colonnes de rafraîchissement (episodes inclus)` |
| Échec AniList avalé, jamais de crash | `refresh.test.ts :: ...n'écrit rien et ne jette pas si l'appel AniList échoue` |
| Fermeture propre (DB + scheduler) sur signal | `shutdown.test.ts :: arrêt propre sur SIGTERM/SIGINT` (processus réel) |

### §8 — Sauvegarde / restauration
| Fonctionnalité | Test |
|---|---|
| Export = dump versionné (`version:1`) | `backup.test.ts :: buildBackupDump assemble version, exportedAt et les deux tables` + `routes/backup.test.ts :: GET /api/backup renvoie un dump versionné avec le bon Content-Disposition` |
| Import valide version + forme des lignes, jamais confiance au fichier | `backup.test.ts :: validateBackupDump ...` (6 tests : version inconnue, JSON non-objet, tableaux manquants, ligne malformée, `userStatus` invalide) |
| Restauration = transaction unique, rollback total | `backup.test.ts :: un userList référençant un anilistId absent... fait échouer toute la restauration (rollback, rien de partiel)` + `routes/backup.test.ts :: une ligne malformée dans le dump est rejetée sans toucher la base (rollback)` |
| Round-trip export→restore identique | `backup.test.ts :: round-trip export -> restore reconstruit un état identique` + `routes/backup.test.ts :: round-trip complet via HTTP...` |
| Récapitulatif `{restored:{animeCache,userList}}` | `routes/backup.test.ts :: round-trip complet via HTTP...` |
| Confirmation explicite avant envoi (front) | `[e2e] settings.spec.ts :: restauration : confirmation explicite avant envoi, puis récapitulatif` + `:: annuler la restauration ne modifie rien` |

### §9 — Frontend
| Fonctionnalité | Test |
|---|---|
| Port fidèle du proto (4 états) + 5e état `unreleased` (`NOT_YET_RELEASED`) | `[e2e] list.spec.ts :: les 5 états de carte (available / scheduled / uptodate / unreleased / finished)` |
| Tri de la liste par état | `lib/anime.ts`'s `CARD_STATE_ORDER`, exercé par `[e2e] list.spec.ts` (ordre d'affichage des fixtures) |
| Onglets En cours / Non commencées / Terminées : une saison terminée bascule d'onglet | `[e2e] list.spec.ts :: une saison terminée bascule de l'onglet Non commencées vers Terminées` |
| Onglet Non commencées : `progress === 0` bascule vers En cours au premier épisode vu | `[e2e] list.spec.ts :: une saison ajoutée mais non vue bascule vers En cours au premier épisode vu` |
| Chargement de la liste au montage + persistance | `[e2e] list.spec.ts :: recherche -> ajout -> ... -> persiste après reload` + `login.spec.ts :: reload après login reste connecté` |
| Swipe = mutation optimiste, rollback sur erreur | `[e2e] list.spec.ts :: swipe droite marque +1...` + `:: un échec réseau simulé sur la progression déclenche un rollback` |
| Bouton Tout rattraper (dans la carte) | `[e2e] list.spec.ts :: bouton Tout rattraper (dans la carte)` |
| Suppression retire la carte, persiste | `[e2e] list.spec.ts :: suppression retire la carte, y compris après reload` |
| Login : mauvais/bon mot de passe, retour au login sur 401/logout | `[e2e] login.spec.ts` (2 tests) |
| Settings : téléchargement + restauration + récap | `[e2e] settings.spec.ts` (3 tests) |
| Fallback SPA + fichiers statiques | `static.test.ts` (3 tests) |

### §10 / §12 — Docker, contraintes transverses
| Fonctionnalité | Test |
|---|---|
| Build multi-stage (typecheck + `vite build` réels dans l'image) | `just build` — vérifié en direct (échoue si `tsc`/`vite build` échoue à l'intérieur du conteneur) |
| DB créée + migrations au premier démarrage | `db/db.test.ts :: openDatabase crée le dossier parent...` + vérification manuelle (démarrage conteneur à vide) |
| `HEALTHCHECK` → `healthy` | `just test-e2e-full` (assertion automatisée sur `docker inspect`) + vérifié en direct |
| Utilisateur non-root, `/data` inscriptible | `just test-e2e-full` (assertion automatisée `whoami`) + vérifié en direct |
| Persistance du volume (`down`/`up`, `restart`) | `just test-e2e-full` (redémarrage + re-lecture) + vérification manuelle via le vrai cycle `docker compose down`/`up` avec données réelles |
| `node:sqlite` (jamais `better-sqlite3`) | structurel — aucune dépendance native dans `backend/package.json` |
| TypeScript strict, aucun `any` dans le contrat | `npm run typecheck` (échoue sinon) |
| Client ne contacte jamais AniList directement | structurel — `frontend/src/api.ts` n'appelle que `/api/*` |
