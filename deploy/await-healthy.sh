#!/usr/bin/env bash
# Fails the deploy unless every API container reports healthy, and prints the logs of one that does not.
#
#   ./deploy/await-healthy.sh            # after `compose up -d`; COMPOSE names the compose command
#
set -euo pipefail
COMPOSE=${COMPOSE:-docker compose -f deploy/compose.yml --env-file deploy/.env}
TRIES=${TRIES:-36}

for service in exam core worker; do
  status=missing
  for _ in $(seq 1 "$TRIES"); do
    id=$($COMPOSE ps -q "$service")
    status=$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null) || status=missing
    [ "$status" = healthy ] && break
    sleep 5
  done
  if [ "$status" != healthy ]; then
    echo "::error::$service is $status after the deploy"
    $COMPOSE logs --tail 80 "$service"
    exit 1
  fi
  echo "$service healthy"
done
