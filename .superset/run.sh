#!/usr/bin/env bash
#
# Superset Run ▸ button: the API, the student portal and the admin portal together,
# on this workspace's ports. Equivalent to `pnpm dev`, except the two vite servers
# are given ports rather than the 5173/5174 their configs pin with strictPort.
#
set -euo pipefail

cd "${SUPERSET_WORKSPACE_PATH:-$(pwd)}"

NVM_SH="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
if [ -s "$NVM_SH" ]; then
  # shellcheck disable=SC1090
  . "$NVM_SH"
  nvm use >/dev/null 2>&1 || true
fi

env_value() {
  sed -n "s/^$1=//p" .env 2>/dev/null | head -n 1 | sed 's/[[:space:]]*#.*$//' | tr -d '[:space:]'
}

API_PORT="$(env_value API_PORT)"
TEST_PORT="$(env_value TEST_PORT)"
ADMIN_PORT="$(env_value ADMIN_PORT)"
: "${API_PORT:=3000}"
: "${TEST_PORT:=5173}"
: "${ADMIN_PORT:=5174}"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker compose up -d postgres redis minio minio-init >/dev/null 2>&1 || true
fi

printf '\033[1mAPI\033[0m    http://localhost:%s\n' "$API_PORT"
printf '\033[1mTest\033[0m   http://localhost:%s\n' "$TEST_PORT"
printf '\033[1mAdmin\033[0m  http://localhost:%s\n\n' "$ADMIN_PORT"

# Job control puts each server in its own process group, so one kill takes its children too.
set -m
pids=()

stop() {
  trap - INT TERM EXIT
  for pid in ${pids[@]+"${pids[@]}"}; do kill -TERM -"$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap stop INT TERM EXIT

pnpm turbo run dev --filter=@iace/api --filter=@iace/contracts &
pids+=($!)
pnpm --filter @iace/test dev --port "$TEST_PORT" &
pids+=($!)
pnpm --filter @iace/admin dev --port "$ADMIN_PORT" &
pids+=($!)

wait
