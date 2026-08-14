#!/usr/bin/env bash
# Records that the staged source has been SonarQube-analysed and came back
# clean. Run ONLY after actually running the analysis and acting on it.
set -euo pipefail

root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo" >&2; exit 1; }

if ! want=$(bash "$root/.claude/hooks/sonar-hash.sh" 2>/dev/null); then
  echo "Nothing SonarQube scans is staged — no record needed."
  exit 0
fi

printf '%s' "$want" > "$root/.claude/.sonar-verified"
echo "Recorded Sonar analysis for staged source (${want:0:12}…)."
