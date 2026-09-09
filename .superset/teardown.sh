#!/usr/bin/env bash
#
# Superset workspace teardown. Stops what this workspace owns — the dev servers the
# Run button starts — and gives its port slot back. The compose stack is deliberately
# left up: one "iace" project serves the main checkout and every sibling workspace.
#
set -euo pipefail

cd "${SUPERSET_WORKSPACE_PATH:-$(pwd)}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }

say 'Releasing dev ports'
released="$(node .superset/ports.mjs release 2>/dev/null || true)"

for port in $released; do
  pids="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill 2>/dev/null || true
    note "stopped the server on :$port"
  else
    note "nothing listening on :$port"
  fi
done

say 'Left running'
note 'Postgres, Redis and MinIO — shared with every other workspace'
note 'stop them from the main checkout with: pnpm docker:down'
