#!/usr/bin/env bash
#
# Superset workspace setup. Idempotent: safe to re-run on an existing workspace.
# Brings a fresh worktree to the state docs/local-setup.md §2-§4 describes, with
# dev ports that do not collide with the main checkout or a sibling workspace.
#
set -euo pipefail

WORKSPACE="${SUPERSET_WORKSPACE_PATH:-$(pwd)}"
ROOT="${SUPERSET_ROOT_PATH:-}"
cd "$WORKSPACE"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }

# Files git never carries: secrets, machine-local agent config, the ignored backlog.
UNTRACKED_FROM_ROOT=(
  '.env'
  '.claude/settings.local.json'
  '.superset/config.local.json'
  'docs/05-question-bank-follow-ups.md'
)

say 'Node toolchain'
NVM_SH="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
if [ -s "$NVM_SH" ]; then
  # shellcheck disable=SC1090
  . "$NVM_SH"
  nvm use >/dev/null 2>&1 || nvm install >/dev/null 2>&1 || true
fi
corepack enable >/dev/null 2>&1 || true
note "node $(node --version)  pnpm $(pnpm --version 2>/dev/null || echo 'missing')"

say 'Untracked files from the main checkout'
if [ -n "$ROOT" ] && [ "$ROOT" != "$WORKSPACE" ]; then
  for relative in "${UNTRACKED_FROM_ROOT[@]}"; do
    if [ -e "$ROOT/$relative" ] && [ ! -e "$WORKSPACE/$relative" ]; then
      mkdir -p "$(dirname "$WORKSPACE/$relative")"
      cp -R "$ROOT/$relative" "$WORKSPACE/$relative"
      note "copied $relative"
    fi
  done
else
  note 'SUPERSET_ROOT_PATH unset or identical — nothing to copy'
fi

if [ ! -f .env ]; then
  cp .env.example .env
  note 'no .env in the main checkout — started from .env.example'
fi

say 'Dev ports for this workspace'
if ! allocated="$(node .superset/ports.mjs allocate)"; then
  echo 'could not reserve dev ports — see ~/.superset/port-allocations.json' >&2
  exit 1
fi
eval "$allocated"
note "API        http://localhost:${API_PORT}"
note "Test       http://localhost:${TEST_PORT}"
note "Admin      http://localhost:${ADMIN_PORT}"
note 'written to .env (API_PORT, VITE_API_URL, CORS_ORIGINS) — do not commit it'

say 'Shared infrastructure (Postgres, Redis, MinIO)'
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker compose up -d postgres redis minio minio-init >/dev/null
  for _ in $(seq 1 30); do
    docker compose exec -T postgres pg_isready >/dev/null 2>&1 && break
    sleep 1
  done
  note 'compose project "iace" is up — one stack shared by every workspace'
else
  note 'docker unavailable — start Postgres/Redis/MinIO before running the apps'
fi

say 'Dependencies'
pnpm install --frozen-lockfile
pnpm db:generate

say 'Shared database'
if pnpm exec prisma migrate status --schema prisma/schema.prisma >/dev/null 2>&1; then
  note 'every migration is applied'
else
  note 'migrations are pending or the database is empty — run: pnpm db:setup'
  note 'that writes to the ONE shared iace database, so it affects every workspace'
fi

if command -v graft >/dev/null 2>&1; then
  say 'Code graph'
  if graft build >/dev/null 2>&1; then note 'graft/ built'; else note 'graft build failed — run it by hand'; fi
fi

say 'Ready'
note 'Run ▸ starts the API and both SPAs on the ports above'
