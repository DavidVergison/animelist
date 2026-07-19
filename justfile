set dotenv-load := true

image := "suivi-anime:local"
e2e_container := "suivi-anime-e2e"
e2e_port := "18080"
e2e_password := "e2e-test-pass"
cookie_jar := "/tmp/suivi-anime-cookie.txt"
api_base := env_var_or_default("API_BASE", "http://localhost:8080")

default:
    @just --list

# --- dev loop -------------------------------------------------------------

install:
    npm install

typecheck:
    npm run typecheck

# Full suite: shared + backend (unit/integration) + e2e (Playwright vs the real Docker
# image, Node 26). This is the one command that must be green before calling anything
# done (Step 12).
test: test-shared test-back test-e2e

test-shared:
    npm run test --workspace=shared

test-back:
    npm run test --workspace=backend

# Runs the Playwright suite against the real Docker image (Node 26) — see
# playwright.config.ts: E2E_BASE_URL makes it target an already-running server instead
# of spawning its own local (Node 24) one.
test-e2e:
    #!/usr/bin/env bash
    set -euo pipefail
    just build
    docker rm -f {{e2e_container}} >/dev/null 2>&1 || true
    docker run -d --name {{e2e_container}} -p {{e2e_port}}:8080 \
      -e APP_PASSWORD={{e2e_password}} -e DB_PATH=/data/suivi-anime.db \
      -e ANILIST_FIXTURES=true {{image}} >/dev/null
    trap 'docker rm -f {{e2e_container}} >/dev/null 2>&1 || true' EXIT
    echo "Waiting for the container to become healthy..."
    ready=false
    for i in $(seq 1 30); do
      if curl -sf http://localhost:{{e2e_port}}/api/health >/dev/null 2>&1; then
        ready=true
        break
      fi
      sleep 1
    done
    if [ "$ready" != "true" ]; then
      echo "Container never became healthy — logs:" >&2
      docker logs {{e2e_container}} >&2
      exit 1
    fi
    cd frontend && E2E_BASE_URL=http://localhost:{{e2e_port}} npx playwright test

# Full production-readiness gate (Step 11): build, healthcheck reports "healthy", the
# container runs as a non-root user, the full Playwright suite passes against it, and
# data survives a restart with the same volume. Slower than `test-e2e` — run before
# considering a change to the Docker setup itself done.
test-e2e-full:
    #!/usr/bin/env bash
    set -euo pipefail
    just build
    docker rm -f {{e2e_container}} >/dev/null 2>&1 || true
    docker volume rm -f {{e2e_container}}-data >/dev/null 2>&1 || true
    docker volume create {{e2e_container}}-data >/dev/null
    docker run -d --name {{e2e_container}} -p {{e2e_port}}:8080 \
      -v {{e2e_container}}-data:/data \
      -e APP_PASSWORD={{e2e_password}} -e DB_PATH=/data/suivi-anime.db \
      -e ANILIST_FIXTURES=true {{image}} >/dev/null
    trap 'docker rm -f {{e2e_container}} >/dev/null 2>&1 || true; docker volume rm -f {{e2e_container}}-data >/dev/null 2>&1 || true' EXIT

    echo "==> waiting for the container to report healthy..."
    status="starting"
    for i in $(seq 1 30); do
      status=$(docker inspect -f '{{"{{"}}.State.Health.Status{{"}}"}}' {{e2e_container}} 2>/dev/null || echo starting)
      [ "$status" = "healthy" ] && break
      sleep 1
    done
    if [ "$status" != "healthy" ]; then
      echo "container never reported healthy (status: $status)" >&2
      docker logs {{e2e_container}} >&2
      exit 1
    fi
    echo "    healthcheck: healthy"

    echo "==> checking the container runs as a non-root user..."
    whoami=$(docker exec {{e2e_container}} whoami)
    if [ "$whoami" = "root" ]; then
      echo "container is running as root!" >&2
      exit 1
    fi
    echo "    running as: $whoami"

    echo "==> running the full Playwright suite against the container..."
    (cd frontend && E2E_BASE_URL=http://localhost:{{e2e_port}} npx playwright test)

    echo "==> checking data survives a restart (same volume)..."
    curl -sf -c /tmp/suivi-anime-persist-cookie.txt -X POST http://localhost:{{e2e_port}}/api/auth/login \
      -H 'Content-Type: application/json' -d '{"password":"{{e2e_password}}"}' >/dev/null
    curl -sf -b /tmp/suivi-anime-persist-cookie.txt -X POST http://localhost:{{e2e_port}}/api/list \
      -H 'Content-Type: application/json' -d '{"anilistId":90001}' >/dev/null
    docker restart {{e2e_container}} >/dev/null
    for i in $(seq 1 30); do
      curl -sf http://localhost:{{e2e_port}}/api/health >/dev/null 2>&1 && break
      sleep 1
    done
    curl -sf -c /tmp/suivi-anime-persist-cookie.txt -X POST http://localhost:{{e2e_port}}/api/auth/login \
      -H 'Content-Type: application/json' -d '{"password":"{{e2e_password}}"}' >/dev/null
    found=$(curl -sf -b /tmp/suivi-anime-persist-cookie.txt http://localhost:{{e2e_port}}/api/list | grep -c '"id":90001' || true)
    rm -f /tmp/suivi-anime-persist-cookie.txt
    if [ "$found" -lt 1 ]; then
      echo "data did not survive the container restart!" >&2
      exit 1
    fi
    echo "    persistence check passed"
    echo "==> all checks passed."

# Runs backend + frontend dev servers together (Ctrl-C stops both).
dev:
    #!/usr/bin/env bash
    trap 'kill 0' EXIT
    (cd backend && npm run dev) &
    (cd frontend && npm run dev) &
    wait

# --- docker -----------------------------------------------------------

build:
    docker build -t {{image}} .

up:
    docker compose up -d --build

# Starts the stack the way a real deployment would (README: "cp .env.example .env,
# edit the password, docker compose up -d") — unlike `up`, it never rebuilds, so it
# only works once an image already exists (`just build` or a prior `just up`).
prod-run:
    docker compose up -d

down:
    docker compose down

logs:
    docker compose logs -f

shell:
    docker compose exec suivi-anime sh

# Drops the named volume — next `just up` starts from an empty database.
reset-db:
    docker compose down -v

# --- manual API helpers (against api_base, default http://localhost:8080) ---

curl-login password=e2e_password:
    curl -c {{cookie_jar}} -s -o /dev/null -w "%{http_code}\n" \
      -X POST {{api_base}}/api/auth/login \
      -H 'Content-Type: application/json' \
      -d '{"password":"{{password}}"}'

curl-list:
    curl -b {{cookie_jar}} -s {{api_base}}/api/list

curl-search q:
    curl -b {{cookie_jar}} -s "{{api_base}}/api/search?q={{q}}"

curl-add anilist_id:
    curl -b {{cookie_jar}} -s -X POST {{api_base}}/api/list \
      -H 'Content-Type: application/json' \
      -d '{"anilistId":{{anilist_id}}}'

curl-patch anilist_id progress:
    curl -b {{cookie_jar}} -s -X PATCH {{api_base}}/api/list/{{anilist_id}} \
      -H 'Content-Type: application/json' \
      -d '{"progress":{{progress}}}'

curl-delete anilist_id:
    curl -b {{cookie_jar}} -s -o /dev/null -w "%{http_code}\n" \
      -X DELETE {{api_base}}/api/list/{{anilist_id}}

curl-backup dest="suivi-anime-backup.json":
    curl -b {{cookie_jar}} -s -D - -o {{dest}} {{api_base}}/api/backup | grep -i content-disposition
    @echo "saved to {{dest}}"

curl-restore file="suivi-anime-backup.json":
    curl -b {{cookie_jar}} -s -X POST {{api_base}}/api/backup/restore -F "file=@{{file}};type=application/json"

# --- production convenience (reads APP_PASSWORD from .env, not an argument) ---

# Downloads a backup from the running docker-compose deployment.
backup dest="suivi-anime-backup.json":
    #!/usr/bin/env bash
    set -euo pipefail
    : "${APP_PASSWORD:?APP_PASSWORD manquant — vérifie ton .env}"
    curl -sf -c {{cookie_jar}} -X POST {{api_base}}/api/auth/login \
      -H 'Content-Type: application/json' -d "{\"password\":\"$APP_PASSWORD\"}" >/dev/null
    curl -sf -b {{cookie_jar}} -o {{dest}} {{api_base}}/api/backup
    echo "Sauvegarde écrite dans {{dest}}"

# Restores a backup into the running docker-compose deployment — replaces everything.
restore file:
    #!/usr/bin/env bash
    set -euo pipefail
    : "${APP_PASSWORD:?APP_PASSWORD manquant — vérifie ton .env}"
    curl -sf -c {{cookie_jar}} -X POST {{api_base}}/api/auth/login \
      -H 'Content-Type: application/json' -d "{\"password\":\"$APP_PASSWORD\"}" >/dev/null
    curl -sf -b {{cookie_jar}} -X POST {{api_base}}/api/backup/restore -F "file=@{{file}};type=application/json"
    echo
