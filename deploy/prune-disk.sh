#!/usr/bin/env bash
# Keeps Box A inside its 20 GB. Safe to run any time, including mid-event.
#
#   sudo ./deploy/prune-disk.sh            # keep the last 2 builds
#   KEEP=4 sudo ./deploy/prune-disk.sh     # keep more, before something risky
#
# Counting builds, not days: in the first weeks a release goes out several times an afternoon, so
# "anything older than a week" would keep every one of them and "older than a day" would throw
# away the rollback you wanted. Two is the last release and the one before it — enough to go back
# without a network, and nothing more.
#
# What fills the disk is not logs. Six containers capped at 10 MB x 3 is 180 MB. It is Docker:
# every release leaves the image it replaced behind, and a build leaves layers and cache that are
# never collected on their own.
#
# NEVER add --volumes to any of this. The volumes hold Caddy's issued certificates and, on Box B,
# Valkey's append-only file. Let's Encrypt rate-limits five certificates per hostname per week, so
# a careless `docker system prune --volumes` can lock you out of your own domain for seven days.
set -euo pipefail

KEEP=${KEEP:-2}

say() { printf '\n== %s\n' "$1"; }

say "before"
df -h / | awk 'NR==1 || /\/$/'
docker system df

# First, so the images behind them stop counting as in use. `migrate` is always among them: it
# runs to completion on every release and exits by design.
say "stopped containers"
docker container prune -f

# Our own images only, found by name rather than listed, so an account id never lands in here and
# a renamed registry needs no edit. Third-party images — caddy, alloy, valkey — are left alone.
say "keeping the newest ${KEEP} of each app image"
docker images --format '{{.Repository}}' \
  | grep -E '(^|/)(examprep/api|examprep/api-migrate|iace-api|iace-migrate)$' \
  | sort -u \
  | while read -r repo; do
    # `docker images` lists newest first; dedupe ids because one build carries both its sha tag
    # and its moving tag, then drop everything past the first KEEP.
    stale=$(docker images "$repo" --format '{{.ID}}' | awk '!seen[$0]++' | tail -n +$((KEEP + 1)))
    [ -z "$stale" ] && { printf '  %-44s nothing to drop\n' "$repo"; continue; }
    printf '  %-44s dropping %s\n' "$repo" "$(echo "$stale" | wc -l | tr -d ' ')"
    # -f because one id can hold several tags. It still refuses an image a RUNNING container
    # uses, which is the guard that matters and the reason this is safe mid-event.
    echo "$stale" | xargs -r docker rmi -f >/dev/null 2>&1 || true
  done

say "dangling layers"
docker image prune -f

# The big one on a box that builds. Harmless where nothing does — it reports 0 B.
say "build cache"
docker builder prune -af

say "networks"
docker network prune -f

say "after"
df -h / | awk 'NR==1 || /\/$/'
docker system df
