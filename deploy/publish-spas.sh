#!/usr/bin/env bash
# Builds both SPAs and publishes them to S3 + CloudFront. docs/04-infrastructure.md §14 is the why.
#
#   ./deploy/publish-spas.sh https://api.staging.iace.co.in iace-staging-spas E1234 E5678
#
# VITE_API_URL is substituted at COMPILE time, so an environment is a build, not a variable —
# a staging artifact cannot be promoted to production.
set -euo pipefail

API_ORIGIN=${1:?usage: publish-spas.sh <api-origin> <bucket> <student-distribution> <admin-distribution>}
BUCKET=${2:?bucket}
STUDENT_DISTRIBUTION=${3:?student distribution id}
ADMIN_DISTRIBUTION=${4:?admin distribution id}

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

VITE_API_URL="$API_ORIGIN" pnpm --filter @iace/test --filter @iace/admin build

publish() {
  local dist=$1 prefix=$2 distribution=$3

  # Hashed assets FIRST. The other order serves a shell pointing at chunks that are not there yet.
  aws s3 sync "$dist/assets/" "s3://$BUCKET/$prefix/assets/" \
    --cache-control "public,max-age=31536000,immutable"

  # Then the shell, uncached. Old /assets files are never deleted: a tab opened before the deploy
  # still lazy-loads a chunk by its old name, and keeping them costs about a cent a year.
  aws s3 sync "$dist/" "s3://$BUCKET/$prefix/" --exclude "assets/*" \
    --cache-control "no-cache"

  # Three paths, never /*. That would evict the whole asset cache for nothing, and 1,000
  # invalidation paths a month are free.
  aws cloudfront create-invalidation --distribution-id "$distribution" \
    --paths /index.html /sw.js /manifest.webmanifest >/dev/null
}

publish apps/test/dist student "$STUDENT_DISTRIBUTION"
publish apps/admin/dist admin "$ADMIN_DISTRIBUTION"

echo "published against $API_ORIGIN"
