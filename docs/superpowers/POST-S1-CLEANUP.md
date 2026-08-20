# Post-S1 cleanup checklist

Mechanical pass run **after** the schema realignment landed (S1 / T1–T4, `pnpm db:check` green).
Removes stale/conflicting files and records the process decisions so the repo stops carrying
two sources of truth.

Convention: **archive, don't hard-delete** design docs — `git mv` them to `docs/archive/`
(git history keeps everything anyway, but an `archive/` folder stays browsable). Use
`git rm` only for genuinely dead generated files.

## A. Conflicting / stale files

### A1 — Retire the target DBML once Prisma is the source of truth · DONE

- [x] `git mv docs/schema-target.dbml docs/archive/schema-target.dbml`
- [x] Repointed "target/source of record" wording to `prisma/schema.prisma` in
      `docs/superpowers/task-constraints.md`, `docs/superpowers/EXECUTION-PLAN.md`,
      `docs/superpowers/plans/2026-08-20-schema-realignment.md`,
      `docs/superpowers/specs/2026-08-20-schema-realignment-design.md`.
      Lines describing what T1/T2 _did_ keep a working link, repointed to the archive path.
- [x] Verified: `grep -rn "schema-target.dbml" docs CLAUDE.md | grep -v archive` → only this file.

### A2 — Drop the stale ERD · DONE

`docs/schema-erd.mmd` claimed "Mirrors prisma/schema.prisma. 21 models"; the schema has 36.
Dropped rather than regenerated: a generated diagram that drifts is the same two-sources-of-truth
problem this pass exists to kill, and a generator would add a dependency plus a step that has to
be re-run on every schema change. Git history keeps it.

- [x] `git rm docs/schema-erd.mmd`
- [x] Fixed the pointers in `CLAUDE.md` ("Where things live") and `docs/01-architecture-and-plan.md`.
- [x] Verified: `grep -rn "schema-erd" CLAUDE.md docs` → clean.

### A3 — Archive the Groups access-model doc · NOT DUE

Gated on "after S5 (no-groups access built)". S5 is T12–T13; the repo is at the end of S1.
Re-run this item once S5 lands — `docs/04-students-groups-access-model.md` and the live
reference in `docs/local-setup.md` are both untouched.

### A4 — Consolidate architecture docs · NOT DUE (fails its own gate)

The gate is "`git mv` once it adds nothing new". `docs/01-architecture-and-plan.md` still adds:
§6 live-test scaling design, §7 AWS deployment topology, §8 45-day roadmap, §9 open decisions
& risks. `docs/03-shared-architecture.md` covers module boundaries and conventions and overlaps
none of them. Folding those four sections is editorial work, not a mechanical pass — give it its
own task rather than archiving a doc `README.md` still points at.

## B. Over-engineering (process — decisions, not deletes)

### B1 — Sonar stays a local pre-commit gate; no CI scan · DECIDED, NO CHANGE

Decision: keep the blocking gate for **local** commits, run nothing on **remote/CI** commits.
That is already exactly what the current design does, so no code changed:

- `scripts/sonar-precommit.sh` skips when `SONAR_HOST_URL`/`SONAR_TOKEN` are unset **or** the
  host is unreachable. `SONAR_HOST_URL` is `http://localhost:9004` — a self-hosted server no
  GitHub runner can reach — so CI and any remote agent skip it by construction.
- `.github/workflows/ci.yml` has no Sonar job and gets none. The real blocking gates are already
  there: `format:check`, `deps:check`, `lint`, `typecheck`, `test`, `build`.
- `sonar-project.properties` already documents this ("Local only; there is no CI scan and none
  is wanted").
- The original bullet proposed moving Sonar _into_ CI as advisory. That is not achievable while the
  server is on localhost, and it is not wanted — revisit only if Sonar ever moves to a reachable host.

### B2 — The `questions.ts` move-aside ritual · SATISFIED

- [x] `packages/contracts/src/questions.ts` is **tracked** now, so the "untracked file trips the
      working-tree scan" premise is gone and the ritual cannot recur.
- [x] No live template references it: `grep -rn "questions.ts" docs/superpowers/task-constraints.md
docs/superpowers/WORKFLOW.md docs/superpowers/EXECUTION-PLAN.md` → nothing. The remaining
      hits are in the dated `plans/2026-08-18-*` record, left as history.
- [ ] Reduce the `S3776` cognitive complexity in the offending function when Track D / S4 next
      opens this file.

### B3 — Audit depth · DECIDED, ALREADY IMPLEMENTED

Decision: 30-day hot retention in Postgres, everything older archived to S3. The checklist's
"7-yr retention" premise was stale — the code already does this:

- `apps/api/src/audit/audit-archive.ts` — `AUDIT_RETENTION_DAYS = 30`.
- `apps/api/src/audit/audit-archive.processor.ts` — pages rows past the boundary, gzips them to
  NDJSON and uploads via the shared storage port (`audit/row-actions/YYYY/MM/DD.ndjson.gz`).
- Covered by `apps/api/test/audit-archive.unit.test.ts` and `audit-archive-job.unit.test.ts`.
- No change needed. Recorded here so it is a conscious yes.
  No change needed. Recorded here so it is a conscious yes.

## Final verification

- [x] `grep -rniE "schema-target\.dbml|schema-erd|04-students-groups|01-architecture" CLAUDE.md README.md docs --include=*.md | grep -v "docs/archive"`
      → only this file, plus the intended live `04-` / `01-` references that A3 and A4 leave in place.
- [x] Gates green: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
