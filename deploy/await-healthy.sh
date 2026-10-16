#!/usr/bin/env bash
# Fails the deploy unless every API container reports healthy, and prints the logs of one that does not.
#
#   ./deploy/await-healthy.sh --running   # before `up -d`: the image core runs now, the rollback target
#   ./deploy/await-healthy.sh [moving]    # after `up -d`; on success the local `moving` tag points at this release
#
set -euo pipefail
COMPOSE=${COMPOSE:-docker compose -f deploy/compose.yml --env-file deploy/.env}
TRIES=${TRIES:-36}

if [ "${1:-}" = --running ]; then
  ids=$($COMPOSE ps -q core)
  # shellcheck disable=SC2086 # one id per word, every replica
  [ -n "$ids" ] && docker inspect -f '{{.Config.Image}}' $ids | sort -u || echo none
  exit 0
fi

healthy() {
  local ids statuses
  ids=$($COMPOSE ps -q "$1")
  [ -n "$ids" ] || return 1
  # shellcheck disable=SC2086 # one id per word, every replica
  statuses=$(docker inspect -f '{{.State.Health.Status}}' $ids 2>/dev/null) || return 1
  ! grep -qv '^healthy$' <<<"$statuses"
}

for service in exam core worker; do
  ok=false
  for _ in $(seq 1 "$TRIES"); do
    if healthy "$service"; then
      ok=true
      break
    fi
    sleep 5
  done
  if [ "$ok" != true ]; then
    echo "::error::$service is not healthy after the deploy"
    $COMPOSE logs --tail 80 "$service"
    exit 1
  fi
  echo "$service healthy"
done

# A scale or a restart on the moving tag then starts this release, never one that failed here.
if [ -n "${1:-}" ]; then
  docker tag "$API_IMAGE:$API_TAG" "$API_IMAGE:$1"
  docker tag "$MIGRATE_IMAGE:$API_TAG" "$MIGRATE_IMAGE:$1"
fi
