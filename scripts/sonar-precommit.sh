#!/usr/bin/env bash
# A REAL SonarQube scan before the commit lands — not a reminder, not a claim.
#
# Runs for every commit, whoever makes it: a git hook sees a commit typed in a
# terminal and one made by an agent alike, which the previous PreToolUse gate
# could not.
#
# Three deliberate escapes, because a gate that cannot be got past when it is
# wrong stops being a gate and starts being a reason to use --no-verify on
# everything:
#   - no staged .ts/.tsx under the scanned dirs  -> nothing to scan
#   - server unreachable or no token             -> warn, do not block
#   - SKIP_SONAR=1                               -> explicit, deliberate skip
#
# What it does NOT skip is a reachable server saying the quality gate failed.
set -euo pipefail

root=$(git rev-parse --show-toplevel); cd "$root"

[ "${SKIP_SONAR:-}" = "1" ] && { echo "sonar: skipped (SKIP_SONAR=1)"; exit 0; }

staged=$(git diff --cached --name-only --diff-filter=ACMR -- apps packages prisma 2>/dev/null \
  | grep -E '\.tsx?$' || true)
[ -z "$staged" ] && exit 0

# Read .env without sourcing it: values there contain spaces, and `. .env`
# executes them as commands.
env_val() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }
host=${SONAR_HOST_URL:-$(env_val SONAR_HOST_URL)}
token=${SONAR_TOKEN:-$(env_val SONAR_TOKEN)}

if [ -z "$host" ] || [ -z "$token" ]; then
  echo "sonar: SONAR_HOST_URL / SONAR_TOKEN not set — skipping (see .env.example)" >&2
  exit 0
fi
if ! curl -fsS -m 5 -o /dev/null "$host/api/system/status" 2>/dev/null; then
  echo "sonar: $host unreachable — skipping (start the container to enable the gate)" >&2
  exit 0
fi

# Coverage first, or the scan uploads a stale lcov and the coverage condition
# judges today's code on last week's numbers. scripts/coverage.mjs exists for
# exactly this — it rewrites the package-relative paths Sonar would otherwise
# discard in silence.
echo "sonar: generating coverage…"
pnpm test:coverage >/dev/null

echo "sonar: scanning (quality gate is enforced)…"
node_modules/.bin/sonar-scanner-npm \
  -Dsonar.host.url="$host" -Dsonar.token="$token" 2>&1 \
  | grep -E 'QUALITY GATE|ERROR|WARN.*coverage' || true

# grep swallows the scanner's exit code, so ask the server directly.
gate=$(curl -fsS -u "$token:" "$host/api/qualitygates/project_status?projectKey=iace-platform" 2>/dev/null \
  | sed -n 's/.*"status":"\([A-Z]*\)".*/\1/p' | head -1)

if [ "$gate" = "ERROR" ]; then
  echo "" >&2
  echo "sonar: QUALITY GATE FAILED — $host/dashboard?id=iace-platform" >&2
  echo "       Fix the new issues, or commit with SKIP_SONAR=1 if this is wrong." >&2
  exit 1
fi

echo "sonar: quality gate ${gate:-unknown}"
