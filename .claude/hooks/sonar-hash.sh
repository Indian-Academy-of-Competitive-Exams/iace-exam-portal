#!/usr/bin/env bash
# Hash of the STAGED CONTENT of every .ts/.tsx under the directories SonarQube
# scans (sonar.sources = apps,packages,prisma).
#
# Content, not paths: re-editing a file after analysing it has to invalidate the
# marker, or the gate passes on a stale analysis — which is worse than no gate,
# because it reports as verified.
#
# Prints nothing and exits 1 when no such file is staged: there is then nothing
# for Sonar to look at and the commit is none of this script's business.
set -euo pipefail

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 1
cd "$root"

changed=$(git diff --cached --name-only --diff-filter=ACMR -- apps packages prisma 2>/dev/null \
  | grep -E '\.tsx?$' || true)
[ -z "$changed" ] && exit 1

# `git show :path` reads the staged blob, not the working tree — the gate must
# judge what is about to be committed, not what happens to be on disk.
while IFS= read -r f; do
  printf '%s\n' "$f"
  git show ":$f" 2>/dev/null || true
done <<< "$changed" | shasum -a 256 | cut -d' ' -f1
