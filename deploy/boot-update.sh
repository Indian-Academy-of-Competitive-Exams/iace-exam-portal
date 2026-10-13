#!/usr/bin/env bash
# Run on every start of the STAGING box: fast-forward the checkout, pull the latest image, bring it up.
set -euo pipefail

REGISTRY=598927569098.dkr.ecr.ap-south-1.amazonaws.com
COMPOSE="docker compose -f deploy/compose.yml --env-file deploy/.env"
ATTEMPTS=80
WAIT_SECONDS=15

# Wrapped in a function so bash has read the whole file before the merge below rewrites it.
main() {
  cd /opt/examprep
  local owner
  owner=$(stat -c %U .git)
  sudo -u "$owner" git fetch --quiet origin staging
  sudo -u "$owner" git merge --quiet --ff-only FETCH_HEAD

  aws ecr get-login-password --region ap-south-1 |
    docker login --username AWS --password-stdin "$REGISTRY"
  export API_IMAGE=$REGISTRY/examprep/api MIGRATE_IMAGE=$REGISTRY/examprep/api-migrate API_TAG=staging
  $COMPOSE pull

  # `migrate` cannot finish until RDS is available, and RDS takes minutes to start.
  for _ in $(seq 1 "$ATTEMPTS"); do
    if $COMPOSE up -d; then
      $COMPOSE ps
      exit 0
    fi
    sleep "$WAIT_SECONDS"
  done
  echo "containers did not come up in $((ATTEMPTS * WAIT_SECONDS / 60)) minutes" >&2
  exit 1
}

main "$@"
