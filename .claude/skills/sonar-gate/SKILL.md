---
name: sonar-gate
description: Run the SonarQube analysis loop in this repo - which project key to use, what is in scope, how to read the gate, and how to clear findings. Use before handing work over, and whenever a Sonar failure needs diagnosing.
---

# SonarQube gate

Run this before handing work over, not per commit.

1. Reload the files you touched.
2. Analyze via the SonarQube MCP tools. Project key: `iace-platform` (matches `sonar-project.properties`). A wrong key 404s silently.
3. Only `apps`, `packages` and `prisma` are scanned. A docs-only change has nothing to submit — say so rather than reporting a scan that never ran.
4. Fix the cause of every BLOCKER/CRITICAL/MAJOR finding.
5. Re-analyze until clean, then report findings and fixes by rule ID.
6. The scanner reads the working tree, not the index, so an unrelated untracked file with a finding fails the gate. Move it aside for the commit and put it back after — never reach for `SKIP_SONAR=1`, and ask first, because the file is not yours.

`RUN_SONAR=1 git commit` runs `scripts/sonar-precommit.sh`: coverage first (`scripts/coverage.mjs`, every test in the repo), then `sonar-scanner`, then the gate — minutes, which is why `pre-commit` no longer runs it on its own. It skips itself when nothing it scans is staged, blocks on a missing token or a server that will not come up, and will not skip a reachable server failing the gate. Keep it local — do not add a Sonar job to CI. `analyze_code_snippet` is useful while writing but applies a narrower rule set than the full scan.

Two rules from `CLAUDE.md` stay in force here: no `// NOSONAR` without asking, and never mark an issue false-positive or won't-fix without asking.
