#!/usr/bin/env bash
# Builds both SPAs and publishes them to S3 + CloudFront. docs/04-infrastructure.md §14 is the why.
#
#   ./deploy/publish-spas.sh https://api.staging.examprep.iace.co.in examprep-staging-spas E1234 E5678
#
# VITE_API_URL is substituted at COMPILE time, so an environment is a build, not a variable —
# a staging artifact cannot be promoted to production. FORCE=1 republishes an unchanged commit.
set -euo pipefail

API_ORIGIN=${1:?usage: publish-spas.sh <api-origin> <bucket> <student-distribution> <admin-distribution>}
BUCKET=${2:?bucket}
STUDENT_DISTRIBUTION=${3:?student distribution id}
ADMIN_DISTRIBUTION=${4:?admin distribution id}

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

HEAD=$(git rev-parse HEAD)

# What is SERVING, read from S3 rather than the edge, which may still be holding the old copy.
deployed() {
  aws s3 cp "s3://$BUCKET/$1/version.json" - 2>/dev/null |
    grep -o '"commit":"[^"]*"' | cut -d'"' -f4 || true
}

if [ "${FORCE:-}" != "1" ] && [ "$(deployed student)" = "$HEAD" ] && [ "$(deployed admin)" = "$HEAD" ]; then
  echo "both sites already serving ${HEAD:0:7} — nothing to publish. FORCE=1 to republish."
  exit 0
fi

VITE_API_URL="$API_ORIGIN" pnpm --filter @iace/exams --filter @iace/admin build

publish() {
  local dist=$1 prefix=$2 distribution=$3

  # Hashed assets FIRST. The other order serves a shell pointing at chunks that are not there yet.
  aws s3 sync "$dist/assets/" "s3://$BUCKET/$prefix/assets/" \
    --cache-control "public,max-age=31536000,immutable"

  # A static site cannot be asked what it is, so the answer ships beside it.
  printf '{"commit":"%s","builtAt":"%s","apiOrigin":"%s"}\n' \
    "$HEAD" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$API_ORIGIN" > "$dist/version.json"

  # Then the shell, uncached. Old /assets files are never deleted: a tab opened before the deploy
  # still lazy-loads a chunk by its old name, and keeping them costs about a cent a year.
  aws s3 sync "$dist/" "s3://$BUCKET/$prefix/" --exclude "assets/*" \
    --cache-control "no-cache"

  # Four paths, never /*. That would evict the whole asset cache for nothing, and 1,000
  # invalidation paths a month are free.
  aws cloudfront create-invalidation --distribution-id "$distribution" \
    --paths /index.html /sw.js /manifest.webmanifest /version.json >/dev/null
}

publish apps/exams/dist student "$STUDENT_DISTRIBUTION"
publish apps/admin/dist admin "$ADMIN_DISTRIBUTION"

echo "published ${HEAD:0:7} against $API_ORIGIN"
