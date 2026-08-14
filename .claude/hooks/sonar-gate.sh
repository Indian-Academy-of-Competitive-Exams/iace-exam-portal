#!/usr/bin/env bash
# PreToolUse(Bash) gate: refuses `git commit` until the staged source has been
# SonarQube-analysed.
#
# Why a marker file rather than a real scan: the analysis that CLAUDE.md asks
# for is the SonarQube MCP tool, which only the agent can call — a shell hook
# can neither invoke it nor observe it. And a real `sonar-scanner` run here
# would need the server up on every commit and would block on the quality gate,
# so an offline laptop could not commit at all.
#
# So this checks a claim: the agent records the hash of what it analysed, and
# the gate refuses if that does not match what is staged now. It cannot prove
# the analysis happened — it makes skipping it a deliberate act rather than the
# default, which is the failure this exists to prevent.
set -euo pipefail

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
hash_script="$root/.claude/hooks/sonar-hash.sh"
marker="$root/.claude/.sonar-verified"

# Exit 1 from the hash script means nothing Sonar scans is staged.
want=$(bash "$hash_script" 2>/dev/null) || exit 0

if [ -f "$marker" ] && [ "$(cat "$marker")" = "$want" ]; then
  exit 0
fi

reason="SonarQube check not recorded for the staged source (CLAUDE.md 'SonarQube verification').
Run mcp__sonarqube__analyze_code_snippet on the staged .ts/.tsx files
(projectKey: iace-platform), fix every BLOCKER/CRITICAL/MAJOR, then record it:

    bash .claude/hooks/sonar-record.sh

Re-staging a file after analysing it invalidates the record, on purpose."

# jq -Rs so the multi-line reason survives as one JSON string.
printf '%s' "$reason" | jq -Rs '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: .
  }
}'
