# Realignment execution playbook

How to run the schema-realignment plan under the lean workflow, with time estimates and
paste-ready prompts per session and per task.

- **Plan:** `docs/superpowers/plans/2026-08-20-schema-realignment.md` (Tasks T1–T16)
- **Binding every run:** `CLAUDE.md`, `docs/superpowers/task-constraints.md`, `docs/superpowers/WORKFLOW.md`, `prisma/schema.prisma`, the spec.
- **Model:** strong (opus) throughout — set `CLAUDE_CODE_SUBAGENT_MODEL=opus` in `~/.claude/settings.json` so every subagent uses it.
- **Loop per task:** intent check → implement+tests in one pass → gates green → review _by risk_ → terse report (≤12 lines) → one commit.

## Session & time table (lean loop, strong model)

| Session                             | Tasks                                                   | Risk         | Reviews       | Est. wall-clock |
| ----------------------------------- | ------------------------------------------------------- | ------------ | ------------- | --------------- |
| **S1 — Foundation**                 | T1 schema, T2 migration+raw SQL, T3 seeds, T4 contracts | high (T1,T2) | 2 / 2 / 1 / 1 | 3 – 4.5 h       |
| **S2 — Taxonomy & Config**          | T5 Exam/ExamStage, T6 BaseConfig/modules                | normal       | 1 each        | 1.5 – 2.5 h     |
| **S3 — Platform: perms + audit**    | T7 perms/feature-keys, T8 client purge, T9 audit enums  | mech/normal  | 0–1           | 1.5 – 2.5 h     |
| **S4 — Question versioning**        | T10 QuestionVersion, T11 importer base                  | normal/high  | 1–2           | 2 – 3 h         |
| **S5 — Access: objects & students** | T12 programs/grants/series, T13 student fields+UI       | normal       | 1             | 2 – 3 h         |
| **S6 — Access: resolver & unlock**  | T14 resolver, T15 unlock/notifications                  | high         | 2             | 2.5 – 4 h       |
| **S7 — Integration**                | T16 green + drift check                                 | —            | 1             | 1 – 2 h         |

**Overall:**

- **Sequential (one operator):** ~13.5 – 21.5 h → **≈ 2–3 focused agent-days** with your review checkpoints.
- **Parallel (run S2 / S3 / S4 concurrently after S1):** ~13 – 15 h elapsed. Spine is S1 → (S2‖S3‖S4) → S5 → S6 → S7.

These assume the lean loop (review-by-risk, terse reports, batched tasks, cached prefix). Strong-model-everywhere keeps token cost high by choice; the time savings vs the old 8-hour-per-feature pace come from cutting review rounds and reports, not the model. S1 (raw-SQL migration + from-scratch deploy) and S6 (resolver correctness) are the long poles.

## Session boundaries

One session per row above. Reset context between sessions (the plan/spec/DBML on disk are the memory). Keep S1, S6, S7 on their own; S2/S3/S4 can be three concurrent agents after S1 merges.

---

## Session kickoff prompt (template)

Paste at the start of a session, filling the placeholders:

```
Run Session <S#> — <name>. Execute <tasks> from docs/superpowers/plans/2026-08-20-schema-realignment.md, in order.

Binding (read first): CLAUDE.md, docs/superpowers/task-constraints.md, docs/superpowers/WORKFLOW.md, prisma/schema.prisma, and the spec. Follow the lean loop in WORKFLOW.md. Model: opus throughout.

For each task, in order:
1. Intent check — restate in ≤5 lines the behaviors you will build; wait for my "go".
2. Implement + tests in one pass, mirroring <exemplar>. Write tests from the task's acceptance criteria; do not copy test code from the plan.
3. Gates green before review: pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build (schema tasks also pnpm db:migrate:deploy from scratch && pnpm db:check).
4. Review by risk: <reviews>. A review reads the diff + acceptance criteria only.
5. Terse report ≤12 lines (what changed, gate status, deviations). One commit per task.

Do not start the next task until the current one is committed and green. Stop and ask if any acceptance criterion is ambiguous.
```

## Per-task prompt (template, when running a single task)

```
Task <N>: <title>. Risk: <mech|normal|high>. Reviews: <0|1|2>. Model: opus.
Exemplar to mirror: <path>.
Files: <the task's Files list>.
Acceptance (prove these): <behaviors + the failure it prevents>.
Do: intent check → implement + tests from acceptance → gates green → review per risk → terse report → one commit.
```

---

## Session prompts (filled)

### S1 — Foundation (T1–T4)

```
Run Session S1 — Foundation. Execute T1, T2, T3, T4 from the realignment plan, in order.
Binding: CLAUDE.md, task-constraints.md, WORKFLOW.md, prisma/schema.prisma, the spec. Model: opus. Lean loop.
Prereq before T2: pnpm exec prisma migrate reset --force --skip-seed (dev data is throwaway).
- T1 (high, 2 reviews): generate prisma/schema.prisma from docs/archive/schema-target.dbml — all 36 models + enums, FK @@index, GIN on arrays, Timestamptz. NO composite FKs/partial-uniques/CHECKs here (that's T2). Gate: prisma validate + format.
- T2 (high, 2 reviews): hand-write the first migration incl. the raw SQL from the DBML header — composite FKs (+ their target UNIQUE indexes), partial-uniques, CHECKs, locked-config trigger, outbox partial index. Gate: db:migrate:deploy from scratch + db:check green.
- T3 (normal, 1 review): seeds by pure SQL — first super admin (delete any code seeding), Exam/ExamStage catalog, SSC CGL T1 isDefault BaseConfig + sections. Idempotent.
- T4 (normal, 1 review): regenerate packages/contracts — new enums, DTOs; drop Group/QuestionOption/SubTopic/TestSection/Feature DTOs. Mirror existing packages/contracts/src modules.
Intent check before each. One commit per task. Do not proceed on red.
```

### S2 — Taxonomy & Config (T5–T6)

```
Run Session S2 — Taxonomy & Config. Execute T5, T6. Binding + lean loop + opus.
Exemplar: apps/api/src/students/{students.controller,students.service,students.module}.ts and apps/api/test/students.unit.test.ts.
- T5 (normal, 1 review): rename ExamType→Exam, add ExamStage (mode, disposition); read/manage endpoints; admin taxonomy screen shows Family→Exam→Stage. Exam.family is the ExamFamily enum (no table).
- T6 (normal, 1 review): BaseConfig workbook fields + isDefault + clonedFromId; BaseConfigModule; BaseConfigSection per-section marks/negative/timing/merit; remove TestSection everywhere. Enforce lock-on-first-finalize + clone-to-evolve. Tests: cannot edit a locked config; one default per stage.
Intent check first. One commit per task.
```

### S3 — Platform: perms + audit (T7–T9)

```
Run Session S3 — Platform. Execute T7, T8, T9. Binding + lean loop + opus.
Exemplar: apps/api/src/admins/*, apps/api/src/auth/guards/*, apps/api/src/audit/*.
- T7 (normal, 1 review): replace FeaturePermission(adminIds[]) with AdminFeaturePermission(adminId, featureKey, level); delete the Feature model + createFeature endpoint; guard resolves against the join (super admin bypasses); read-only GET /features from a code FEATURE_KEYS + FEATURES metadata map; AdminBranch + explicit allBranches. Test: unknown featureKey rejected; allBranches explicit.
- T8 (mechanical, 0 reviews — gates only): purge client feature-registration (apps/admin/src/routes/features.tsx → assign-permissions screen reading GET /features; remove POST /admins/features calls).
- T9 (mechanical, 0–1 review): rename AuditActorType→ActorType; align AuditFeature values (drop GROUP, add TEST_SERIES/BASE_CONFIG/EXAM_TAXONOMY). Keep audit always-on.
Intent check first. One commit per task.
```

### S4 — Question versioning (T10–T11)

```
Run Session S4 — Question versioning. Execute T10, T11. Binding + lean loop + opus.
Exemplar: apps/api/src/questions/* and apps/api/src/students/* for module shape.
- T10 (high, 2 reviews): Question=identity; QuestionVersion immutable (content + options JSONB + answerKey); edit inserts a new version + repoints currentVersionId; drop SubTopic + QuestionOption; selectedOptionId app-validated (no FK); tag convention (paper:/set:/pyq:/src:/topic:). Test: an edit never mutates a pinned version; option ids stable.
- T11 (normal, 1 review): align the import base to write QuestionVersion v1 rows (not QuestionOption); row-level errors, commit only valid rows. Test: one valid + one invalid row.
Intent check first. One commit per task.
```

### S5 — Access: objects & students (T12–T13)

```
Run Session S5 — Access objects. Execute T12, T13. Binding + lean loop + opus.
Exemplar: apps/api/src/students/*, apps/api/src/branches/*; structure a new series module like students.
- T12 (normal, 1 review): retire the groups module; add Program catalog + StudentGrant; TestSeries(+programCode, examStageId, prerequisiteSeriesId, sequentialTests, isFree); TestSeriesTest M:N; BranchTestConfig explicit per-branch rows (enable+schedule), created for all branches at series creation. Remove Group/GroupType.
- T13 (normal, 1 review): Student access fields (enrolledExams/enrolledFamilies/programs GIN, currentBranchId, isTestBlocked, soft-delete); repoint admin "assign" UI groups→series/branch+program; repoint "deactivate" onto isTestBlocked.
Intent check first. One commit per task.
```

### S6 — Access: resolver & unlock (T14–T15)

```
Run Session S6 — Access resolver. Execute T14, T15. Binding + lean loop + opus. HIGH STAKES — 2 reviews each; I author the key assertions.
Exemplar: apps/api/src/me/*, apps/api/src/redis/*.
- T14 (high, 2 reviews): the single predicate — (exam-match ∪ program-match ∪ StudentGrant) ∧ BranchTestConfig.enabled ∧ schedule-active ∧ prerequisite-unlocked ∧ ¬isTestBlocked; compute once, cache in Redis student:{id}:catalog; invalidate on enrollment/program/series-tag/BranchTestConfig/unlock events. Student catalog returns series→tests, never groups. Tests (truth table): each access path resolves; a branch-disabled series is hidden; a blocked student is excluded; cache invalidates per event.
- T15 (normal, 1 review): StudentSeriesUnlock lazy upsert; SeriesUnlockRequest request/approve; Notification.testSeriesId deep-links for SERIES_UNLOCKED/ENROLLMENT/GRANT.
Intent check first. One commit per task.
```

### S7 — Integration (T16)

```
Run Session S7 — Integration. Execute T16. Binding + opus.
- Full gates green from a clean checkout: pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build; migration deploy from scratch + pnpm db:check; prisma migrate diff --exit-code clean vs the target schema.
- Grep the repo for dead references — Group, QuestionOption, SubTopic, TestSection, AttemptAnswer, ExamType, createFeature — none outside history/docs.
One commit: chore: realignment integration — workspace green on target schema.
```
