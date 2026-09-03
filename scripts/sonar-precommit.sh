#!/usr/bin/env bash
# A REAL SonarQube scan before the commit lands — not a reminder, not a claim.
#
# Runs for every commit, whoever makes it: a git hook sees a commit typed in a
# terminal and one made by an agent alike, which the previous PreToolUse gate
# could not.
#
# SonarQube costs ~2GB of RAM, so it does not sit running all day. A stopped
# container is not a reason to commit ungated: the hook STARTS it, scans, and
# STOPS it again, so the memory is spent only while a commit is being checked.
#
# It only ever stops what it started — a server you had up for the dashboard is
# yours and stays. It also leaves the server running when the gate FAILS, since
# that is the moment you need to go and read why.
#
# Three deliberate escapes, because a gate that cannot be got past when it is
# wrong stops being a gate and starts being a reason to use --no-verify on
# everything:
#   - no staged .ts/.tsx under the scanned dirs  -> nothing to scan
#   - SKIP_SONAR=1                               -> explicit, deliberate skip
#   - SONAR_KEEP_UP=1                            -> scan, but leave it running
#
# Everything else BLOCKS: no token, a server that will not come up, or a
# reachable server saying the quality gate failed.
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
  echo "sonar: SONAR_HOST_URL / SONAR_TOKEN not set — see .env.example" >&2
  echo "       Set them, or commit with SKIP_SONAR=1 if this is deliberate." >&2
  exit 1
fi

up() { curl -fsS -m 5 "$host/api/system/status" 2>/dev/null | grep -q '"status":"UP"'; }

# Whether WE started it. Only then is it ours to stop again.
ours=0
release() {
  [ "$ours" = "1" ] || return 0
  [ "${SONAR_KEEP_UP:-}" = "1" ] && { echo "sonar: left running (SONAR_KEEP_UP=1)"; return 0; }
  echo "sonar: stopping the container the hook started…"
  docker stop sonarqube >/dev/null 2>&1 || true
}

# Elasticsearch takes the time here, not the web server, so the wait is generous.
if ! up; then
  echo "sonar: $host is down — starting the container…" >&2
  docker compose --profile sonar up -d sonarqube >/dev/null 2>&1 \
    || docker start sonarqube >/dev/null 2>&1 || true
  ours=1
  # A commit interrupted mid-scan must not leave 2GB behind.
  trap release INT TERM

  for _ in $(seq 1 "${SONAR_START_TIMEOUT:-90}"); do
    up && break
    sleep 1
  done
fi

if ! up; then
  release
  echo "" >&2
  echo "sonar: $host would not come up — NOT committing ungated." >&2
  echo "       Start it by hand (docker compose --profile sonar up -d sonarqube)," >&2
  echo "       or commit with SKIP_SONAR=1 if this is deliberate." >&2
  exit 1
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

if [ "$gate" != "OK" ]; then
  echo "" >&2
  echo "sonar: QUALITY GATE ${gate:-UNREADABLE} — $host/dashboard?id=iace-platform" >&2
  echo "       Fix the new issues, or commit with SKIP_SONAR=1 if this is wrong." >&2
  # Deliberately still running: the dashboard is where you go next, and stopping
  # the server on the one path that sends you to it would be its own small cruelty.
  [ "$ours" = "1" ] && echo "       (left running so you can read it; docker stop sonarqube)" >&2
  exit 1
fi

release
echo "sonar: quality gate OK"
