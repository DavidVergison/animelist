# Utilisation — Suivi-anime

Guide pratique pour construire, lancer et configurer le conteneur. Pour l'architecture
et les décisions de conception, voir `README.md` et `CLAUDE.md`.

## Prérequis

- Docker et Docker Compose (plugin `docker compose`, pas l'ancien `docker-compose`).
- Rien d'autre : le conteneur embarque tout (Node 26, dépendances, build de la SPA).

## Démarrage rapide

```sh
cp .env.example .env
# éditer .env et changer APP_PASSWORD
docker compose up -d
```

L'application est disponible sur **http://localhost:8080**. Premier écran : mot de
passe (celui défini dans `APP_PASSWORD`).

Arrêter :

```sh
docker compose down
```

`down` (sans `-v`) préserve les données — voir [Persistance](#persistance-des-données).

## Configuration (`.env`)

Toutes les variables sont lues par le conteneur au démarrage. Copier `.env.example`
vers `.env` et éditer les valeurs nécessaires ; `docker compose` charge ce fichier
automatiquement.

| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `APP_PASSWORD` | **oui** | — | Mot de passe unique de l'application. Le conteneur **refuse de démarrer** si absent ou vide. |
| `SESSION_SECRET` | non | aléatoire à chaque démarrage | Secret de signature du cookie de session. Si non fourni, un secret est généré à chaque démarrage du conteneur, ce qui **déconnecte tous les utilisateurs à chaque redémarrage**. Fixer une valeur ici si tu veux que les sessions survivent aux redémarrages/mises à jour. |
| `BEHIND_HTTPS` | non | `false` | Mettre à `true` si l'application est servie derrière un reverse proxy HTTPS (active l'attribut `secure` du cookie de session). |
| `DB_PATH` | non | `/data/suivi-anime.db` (fixé par `docker-compose.yml`) | Chemin du fichier SQLite **à l'intérieur du conteneur**. Ne pas modifier sauf changement du montage de volume — c'est ce chemin qui doit pointer dans `/data`. |
| `PORT` | non | `8080` | Port d'écoute interne de l'application. `docker-compose.yml` mappe actuellement `8080:8080` en dur : si tu changes `PORT`, mets aussi à jour le mapping de port dans `docker-compose.yml`. |

> `APP_PASSWORD` est comparé en temps constant à chaque connexion et n'est jamais
> stocké en base ni journalisé.

## Persistance des données

La base SQLite vit dans le volume nommé **`anime-data`**, monté sur `/data` dans le
conteneur — jamais dans le système de fichiers du conteneur lui-même. Elle survit à :

- `docker compose down` (sans `-v`)
- une mise à jour de l'image (`docker compose up -d --build`)
- un redémarrage du conteneur

Pour repartir d'une base vide (⚠️ irréversible, supprime toutes les données) :

```sh
docker compose down -v
```

## Sauvegarde / restauration

Dans l'application (bouton **Réglages**) :
- **Télécharger la sauvegarde** exporte un fichier JSON complet (versionné).
- **Choisir un fichier…** restaure une sauvegarde — une confirmation explicite est
  demandée car cette action **remplace intégralement** la liste actuelle.

En ligne de commande (nécessite [`just`](https://github.com/casey/just)) :

```sh
just backup                       # écrit suivi-anime-backup.json
just restore suivi-anime-backup.json
```

Ces deux commandes lisent `APP_PASSWORD` depuis `.env` automatiquement.

## Construire l'image manuellement

```sh
docker build -t suivi-anime:local .
```

Puis, sans passer par `docker compose` :

```sh
docker run -d -p 8080:8080 \
  -e APP_PASSWORD=change-me \
  -e DB_PATH=/data/suivi-anime.db \
  -v anime-data:/data \
  suivi-anime:local
```

> Avec `docker run` direct (contrairement à `docker-compose.yml`), il faut explicitement
> passer `DB_PATH=/data/...` et monter un volume sur `/data` — sinon la base tente de
> s'écrire dans le système de fichiers du conteneur, propriété de `root`, et le
> processus (non-root) échoue au démarrage.

## Vérifier que ça tourne

```sh
docker compose ps                       # colonne STATUS : "healthy" après ~5-10s
curl http://localhost:8080/api/health   # {"status":"ok"}
docker compose logs -f                  # logs en continu
```

Le conteneur tourne en utilisateur non-root et expose un `HEALTHCHECK` Docker natif
(pas besoin de `curl`/`wget` installés dans l'image).

## Avec `just` (outillage de développement)

Si le dépôt source est disponible (pas seulement l'image), `just` regroupe les
commandes utiles :

| Commande | Effet |
|---|---|
| `just prod-run` | `docker compose up -d` (ne reconstruit pas l'image) |
| `just up` | `docker compose up -d --build` (reconstruit — usage dev) |
| `just down` | `docker compose down` |
| `just reset-db` | `docker compose down -v` — supprime le volume |
| `just logs` | `docker compose logs -f` |
| `just shell` | shell interactif dans le conteneur |
| `just backup` / `just restore <fichier>` | sauvegarde/restauration via l'API |

## Dépannage

- **Le conteneur ne démarre pas, log `APP_PASSWORD environment variable is required...`**
  → `APP_PASSWORD` est absent ou vide dans `.env` (ou dans l'environnement passé à
  `docker compose`).
- **Je suis déconnecté à chaque redémarrage du conteneur** → comportement attendu si
  `SESSION_SECRET` n'est pas fixé (voir [Configuration](#configuration-env)) ; fixe une
  valeur dans `.env` pour l'éviter.
- **Erreur `EACCES` / permission denied sur la base au démarrage** → uniquement en cas
  de `docker run` manuel sans monter `/data` en volume ou sans définir `DB_PATH=/data/...`
  (voir la note dans « Construire l'image manuellement » ci-dessus). Ne se produit pas
  avec `docker compose up`.
