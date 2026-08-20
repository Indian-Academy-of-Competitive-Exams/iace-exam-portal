# Schema realignment + no-groups migration — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Realign the built codebase onto the finalized target data model so all forward feature work builds on the correct schema. Close the drift: exam-stage taxonomy, immutable question versioning, default/custom base configs, no-groups access, merged `AttemptQuestion`, code-owned feature keys, durability + analytics tables.

**Architecture:** One **foundation wave** lands the schema, migration, seeds and contracts (blocks everything). Then **four mechanical tracks run in parallel** (taxonomy+config, admin-perms+feature-keys, audit enums, question versioning) because they touch disjoint modules. Then the **no-groups access rework** (the one logic-heavy area) lands. A final integration task makes the whole workspace green. Each track is a small number of commit-sized tasks; commit once per task's final step.

**Tech Stack:** TypeScript everywhere. NestJS + Prisma/Postgres (`apps/api`), Vite + React SPAs (`apps/admin`, `apps/test`), zod contracts + typed client (`packages/contracts`), Tailwind + shadcn (`packages/ui`, `packages/app-kit`), react-hook-form, TanStack Query, `node:test` for tests. Redis + BullMQ for hot-path/jobs. S3/MinIO for storage.

**Spec:** `docs/superpowers/specs/2026-08-20-schema-realignment-design.md` — binding. Data model of record: `docs/schema-target.dbml`.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Read first, binding:** `docs/superpowers/task-constraints.md`, `docs/superpowers/WORKFLOW.md` (lean loop — batch tasks, review-by-risk, terse reports, tests as intent), `CLAUDE.md`, `docs/03-shared-architecture.md`, `docs/schema-target.dbml`, the spec above, and (once generated) `prisma/schema.prisma` — which wins on any data-model conflict.
- **Prerequisite, once, before Task 2:** reset the throwaway dev DB — `pnpm exec prisma migrate reset --force --skip-seed --schema prisma/schema.prisma`. There are no real users; the old rows are exactly the shapes the new model refuses.
- **One commit per task**, made in that task's final step, never before. Intermediate steps stage nothing.
- **Gates, green per commit:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus the migration path (`pnpm db:migrate:deploy` from scratch and `pnpm db:check`).
- **Node 22 in the shell that commits** (`source ~/.nvm/nvm.sh && nvm use 22`).
- **Never push.** No `git push`, no branches, no PRs. Commit on the current branch.
- **Never `--no-verify`, never `git commit -n`, never `SKIP_SONAR=1`.** The pre-commit hook runs the real SonarQube scan and enforces the gate. Fix the cause.
- **Never `git add -A` blind.** Check `git status`, stage whole files, run prettier first; `git diff --stat` empty after `git add`.
- **Commit subject:** `type(scope): what changed, in plain words`. Body carries the why. **No `Co-Authored-By`, no tool attribution.**
- **Tests ship in the same commit as the change.** `node:test` + `node:assert/strict`, named after the unit, no Postgres/Redis/S3 — extend `apps/api/test/support/fakes.ts`. Cover the happy path **and** the failure the change exists to prevent.
- **Code style:** default to no comment; no magic strings (`SCREAMING_SNAKE_CASE as const`); design values from `packages/ui` tokens only.
- **API:** one envelope; controllers return data or throw `AppException(ErrorCodes.X, …)`; react to `error.code`. `fieldErrors` feed react-hook-form. `meta.requestId` on every response.
- **Raw SQL for what Prisma cannot express** (composite FKs, partial-unique indexes, CHECK constraints, triggers, GIN forcing) goes into the migration `.sql` by hand — see Task 2.
- **Confirm before destructive UI** with `ConfirmDialog`, naming the consequence and count.

---

## Dependency graph & parallel assignment

```
WAVE 0  (single owner, sequential)         WAVE 1  (4 parallel tracks)          WAVE 2            FINAL
┌───────────────────────────────┐          ┌───────────────────────────┐       ┌───────────┐    ┌──────┐
│ T1 prisma schema ─▶ T2 migration│──▶ all  │ Track A: T5 → T6          │──┐    │ T12→T13→  │    │ T16  │
│ ─▶ T3 seeds        ─▶ T4 contracts│        │ Track B: T7 → T8          │  ├──▶ │ T14 → T15 │──▶ │ green│
└───────────────────────────────┘          │ Track C: T9               │  │    │ (access)  │    │ build│
                                            │ Track D: T10 → T11        │──┘    └───────────┘    └──────┘
                                            └───────────────────────────┘
```

- **Wave 0 (T1–T4)** blocks everything and is one owner's sequential chain. T4 (contracts) may begin as soon as T1 fixes the schema shape.
- **Wave 1** — Tracks **A, B, C, D are fully independent** (disjoint modules) and can be four concurrent agents once Wave 0 is merged.
- **Wave 2 (access, T12–T15)** depends on Wave 0 **and** Track A (it needs `Exam`/`ExamStage` and `TestSeries.examStageId`). Its internal tasks are sequential.
- **T16** (integration/green) depends on all.

| Agent              | Can pick up        | After                   |
| ------------------ | ------------------ | ----------------------- |
| A0                 | T1 → T2 → T3 → T4  | —                       |
| A1                 | Track A (T5, T6)   | Wave 0 merged           |
| A2                 | Track B (T7, T8)   | Wave 0 merged           |
| A3                 | Track C (T9)       | Wave 0 merged           |
| A4                 | Track D (T10, T11) | Wave 0 merged           |
| A1 (or free agent) | Wave 2 (T12–T15)   | Wave 0 + Track A merged |
| any                | T16                | all merged              |

---

## WAVE 0 — Foundation (blocks everything)

### Task 1: Generate `prisma/schema.prisma` from the target DBML

**Files:** Modify `prisma/schema.prisma` (full replace). Reference `docs/schema-target.dbml`.
**Interfaces:** Produces the 36-model Prisma schema + all enums, matching the DBML. Consumes the DBML.

- [ ] Translate every DBML `Table` → Prisma `model`, every `Enum` → Prisma `enum`. PKs are `String @id @default(cuid())`. `text[]` columns → `String[]`; enum-array columns (`languages`, `enrolledExams`, `enrolledFamilies`, `Attempt.languages`) → real enum arrays.
- [ ] Every FK column gets `@@index`. Force GIN on array columns: `@@index([tags], type: Gin)` etc. `DateTime` fields → `@db.Timestamptz(3)`.
- [ ] Express the plain relations Prisma can model. **Do NOT** attempt composite FKs / partial-uniques / CHECKs here — they are Task 2. Leave the composite-FK columns as plain indexed columns; the relation is enforced in raw SQL.
- [ ] `pnpm exec prisma format` clean; `prisma validate` passes. Commit `chore(db): target schema (exam-stage, versioning, no-groups, analytics)`.

### Task 2: First migration — raw-SQL constraints + dev reset

**Files:** Create `prisma/migrations/<ts>_schema_realignment/migration.sql`. `prisma/migrations/migration_lock.toml`.
**Interfaces:** Produces a from-scratch migration that builds the full target DB incl. everything Prisma can't express.

- [ ] Run the reset prerequisite (Global Constraints). Generate the base migration from Task 1's schema, then **hand-append** the raw SQL from `docs/schema-target.dbml` header rules:
  - Composite FKs: `Test.(baseConfigId,examStageId)→BaseConfig`; `BaseConfigSection.(baseConfigId,moduleId)→BaseConfigModule`; `PaperQuestion.(testId,baseConfigId)→Test`, `.(baseConfigId,baseConfigSectionId)→BaseConfigSection`, `.(questionId,questionVersionId)→QuestionVersion`; `Question.(id,currentVersionId)→QuestionVersion`; `AttemptQuestion.(paperQuestionId,questionId,questionVersionId)→PaperQuestion`, `.(paperQuestionId,baseConfigSectionId)→PaperQuestion`, `.(questionId,questionVersionId)→QuestionVersion`. Add the matching **target UNIQUE indexes** first.
  - Partial-unique indexes: `Student.mobile/externalRef WHERE deleted_at IS NULL`; `Branch.name WHERE deleted_at IS NULL`; `UNIQUE(test_id,student_id) WHERE is_graded`; `UNIQUE(student_id,test_series_id) WHERE status='PENDING'`; `UNIQUE(exam_stage_id) WHERE is_default`; flat-config `UNIQUE(base_config_id,order) WHERE module_id IS NULL`; outbox poll `(created_at) WHERE processed_at IS NULL`.
  - CHECK constraints: `BaseConfigSection` module/timing rules; RANKED⇒FIXED on `Test`.
  - Locked-config immutability trigger (reject UPDATE of a `BaseConfig`/`BaseConfigSection` where `locked=true`).
- [ ] `pnpm db:migrate:deploy` from scratch is green; `pnpm db:check` clean. Commit `feat(db): initial realignment migration with raw-SQL invariants`.

### Task 3: Seeds — super admin (pure SQL), exam taxonomy, SSC CGL T1 default config

**Files:** Create `prisma/seed.sql` (or the repo's seed path). Modify seed runner script if present.
**Interfaces:** Consumes `exam_patterns.xlsx` decisions (already in the DBML). Produces one super admin, the `Exam`/`ExamStage` catalog for at least SSC CGL, and the SSC CGL Tier 1 `isDefault` `BaseConfig` + sections.

- [ ] First super admin by **pure SQL only** (no seed code path); delete any code-level super-admin seeding.
- [ ] Seed `Exam` + `ExamStage` rows (disposition per the coverage pass — CONDUCTED/PARTIAL get configs). Seed the SSC CGL Tier 1 default `BaseConfig` (`isDefault=true`) + `BaseConfigSection` rows (DUAL EN+HI, per-section marks/negative from the workbook).
- [ ] Idempotent (`ON CONFLICT DO NOTHING`). Commit `feat(db): seed super admin, exam taxonomy, SSC CGL T1 default config`.

### Task 4: Regenerate `packages/contracts`

**Files:** Modify `packages/contracts/src/*` (entity DTOs, enums, zod schemas, typed-client types).
**Interfaces:** Produces contract types matching the new shapes; the response envelope is unchanged. **Gates Wave 1** — every app track consumes this.

- [ ] Update enums (add `ExamFamily`, `ExamMode`, `StageDisposition`, `TimerTemplate`, `NavigationPolicy`, `TestScope`, `EvaluationMode`, `PaperBinding`, `DrawStrategy`, `SupportedLanguage`, `AnswerMode`, `UnlockMode/State/RequestStatus`; rename `AuditActorType`→`ActorType`; drop `GroupType`).
- [ ] Update DTOs: `Exam`/`ExamStage`, `Question`+`QuestionVersion`, `BaseConfig`(+isDefault/clonedFromId/modules), no-groups access (`Program`, `StudentGrant`, `TestSeries`, `TestSeriesTest`), `AttemptQuestion`, `featureKey`-based permissions. Remove `Group`, `QuestionOption`, `SubTopic`, `TestSection`, `Feature` DTOs.
- [ ] Typecheck + `packages/contracts` tests green. Commit `feat(contracts): types for the realigned model`.

---

## WAVE 1 — Mechanical realignment (Tracks A–D run in parallel)

### Track A — Taxonomy & Config

#### Task 5: `ExamType` → `Exam` + `ExamStage` layer

**Files:** `apps/api/src/configs/*` (rename `exam-types` → `exams`), `apps/admin/src/routes/taxonomy.tsx`, contracts already done in T4.
**Interfaces:** Consumes the T1 schema. Produces exam + stage CRUD (read-mostly), stage `disposition`/`mode` surfaced.
**Depends on:** Wave 0. **Parallel-safe with B, C, D.**

- [ ] Repoint the module from `ExamType` to `Exam`; add `ExamStage` read/manage endpoints. `Exam.family` is the `ExamFamily` enum (no table).
- [ ] Admin taxonomy screen lists Family → Exam → Stage; stage shows mode/disposition. `RequiresFeature` unchanged (`QUESTION_MANAGEMENT`/appropriate key).
- [ ] Unit tests for the exam/stage rules. Commit `feat(configs): exam + exam-stage taxonomy`.

#### Task 6: BaseConfig (workbook fields, default/custom, modules), drop `TestSection`

**Files:** `apps/api/src/configs/*` (base-config service/controller), `apps/admin/src/routes/*` (config screens), remove `TestSection` usage repo-wide.
**Interfaces:** Produces default+custom config CRUD with lock-on-finalize and clone-to-evolve; `BaseConfigModule` + `BaseConfigSection`.
**Depends on:** Task 5.

- [ ] Add config fields (timerTemplate, navigation, languages, featureFlags, scoringVersion, totalQuestions/totalMarks cache), `isDefault` (one default/stage), `clonedFromId` lineage. "Clone from default → tweak → save as custom" flow.
- [ ] `BaseConfigSection` per-section marks/negative/timing/merit; `BaseConfigModule` seam. Remove `TestSection` model usage everywhere.
- [ ] Enforce lock-on-first-finalize + clone-to-evolve in the service; tests cover "cannot edit a locked config" and "one default per stage". Commit `feat(configs): default/custom base configs + modules, drop TestSection`.

### Track B — Admin permissions & feature keys

#### Task 7: `AdminFeaturePermission` join + `AdminBranch`, remove UI feature registration

**Files:** `apps/api/src/admins/*` (`admins.service.ts` `createFeature`, `admins.controller.ts` `POST /features`), `apps/api/src/auth/guards/*` (the `RequiresFeature` guard), `apps/admin/src/routes/features.tsx`.
**Interfaces:** Consumes the code `FEATURE_KEYS`. Produces grant-only permissions keyed on `featureKey`; a read-only `GET /features` catalog; `AdminBranch` scope.
**Depends on:** Wave 0. **Parallel-safe with A, C, D.**

- [ ] Replace `FeaturePermission(adminIds[])` with `AdminFeaturePermission(adminId, featureKey, level)` (join, one row per grant). Delete the `Feature` model usage and the `createFeature` endpoint/service. The guard resolves `(admin, featureKey, level)` against the join (super admin bypasses).
- [ ] Add read-only `GET /features` returning the code catalog (`FEATURE_KEYS` + display name + group). Move feature display metadata into a `FEATURES` const map beside the enum.
- [ ] Replace `Admin.branchIds[]` with `AdminBranch` join + explicit `allBranches`. Never infer "all branches" from absence.
- [ ] Rework `apps/admin/src/routes/features.tsx` into an **assign-permissions** screen (lists features from `GET /features`, toggles READ/WRITE per admin) — no create-feature UI.
- [ ] Tests: unknown `featureKey` rejected; grant/revoke concurrent-safe; `allBranches` explicit. Commit `feat(admins): code-owned feature keys, permission grants join, AdminBranch`.

#### Task 8: Purge `FEATURE_KEYS` UI-registration remnants + guard hardening

**Files:** `apps/admin/src/lib/constants.ts`, any client calls to `POST /admins/features`.
**Depends on:** Task 7.

- [ ] Remove client code that registered features. Ensure the admin app reads the catalog from `GET /features` only.
- [ ] Confirm `isActive=false` gates attempt-start only, not login (decouple per DBML `Student` note if the admin login path touches it). Commit `refactor(admin): consume code feature catalog, drop registration UI`.

### Track C — Audit enums

#### Task 9: `AuditActorType` → `ActorType`, `AuditFeature` values

**Files:** `apps/api/src/audit/*`, `packages/contracts` (done in T4), any enum references.
**Interfaces:** Produces the renamed audit enums; `RowActionLog`/`ImportLog` unchanged in shape.
**Depends on:** Wave 0. **Parallel-safe with A, B, D.**

- [ ] Rename the enum + all usages; align `AuditFeature` values with the DBML (drop `GROUP`, add `TEST_SERIES`/`BASE_CONFIG`/`EXAM_TAXONOMY` as needed). Keep audit always-on, scope = data CRUD + imports, never exam interactions.
- [ ] Tests green. Commit `refactor(audit): rename ActorType, align AuditFeature values`.

### Track D — Question bank versioning

#### Task 10: `Question` identity + `QuestionVersion`, fold options, drop `SubTopic`/`QuestionOption`

**Files:** `apps/api/src/questions/*` (service, controller, taxonomy), `apps/admin/src/routes/questions.tsx`, `apps/admin/src/routes/taxonomy.tsx`.
**Interfaces:** Produces immutable versioning (`Question` → `QuestionVersion` with options-in-JSON), 2-level subject/topic taxonomy, tag convention.
**Depends on:** Wave 0. **Parallel-safe with A, B, C.** (Questions is UI-base only, so this is mostly a fresh backend build against the new schema.)

- [ ] `Question` = identity (type, subject/topic, difficulty, status, currentVersionId, tags, fixedUseCount). `QuestionVersion` immutable (content + `options` JSONB + answerKey). Editing inserts a new version + repoints `currentVersionId`.
- [ ] Drop `SubTopic` and `QuestionOption` models/usages. Options live in `QuestionVersion.options` with stable option ids; `selectedOptionId` is app-validated (no FK).
- [ ] Implement the tag convention (`paper:`/`set:`/`pyq:`/`src:`/`topic:`, lowercase `key:value`); soft-validate at import (warn, don't reject) or auto-normalize — pick per the design's open item.
- [ ] Tests: an edit creates a new version and never mutates a pinned one; option ids stable. Commit `feat(questions): immutable versioning, options-in-JSON, tag convention`.

#### Task 11: Question importer alignment (base only)

**Files:** `apps/api/src/imports/*`, import templates if referenced.
**Depends on:** Task 10.

- [ ] Align the existing import base to write `QuestionVersion` rows (v1) instead of `QuestionOption`; row-level errors, commit only valid rows (forgiving). Full importer depth is Phase B.
- [ ] Tests for a valid + an invalid row. Commit `feat(imports): write question versions, row-level validation`.

---

## WAVE 2 — No-groups access (logic-heavy; sequential)

**Depends on:** Wave 0 + Track A. **This is the one non-mechanical rework — assign a strong agent, keep tasks in order.**

### Task 12: Schema-side access objects live + Group removal

**Files:** `apps/api/src/groups/*` (remove/retire), `apps/api/src/students/*`, `apps/api/src/branches/*`, new `apps/api/src/series/*` (or `access/`).
**Interfaces:** Produces `Program`, `StudentGrant`, `TestSeries`(+programCode/examStageId/prereq), `TestSeriesTest`, `StudentSeriesUnlock`, `SeriesUnlockRequest`, `BranchTestConfig` fan-out. Removes `Group`/`GroupType`.

- [ ] Retire the `groups` module. Add the `Program` catalog and `StudentGrant` escape hatch. `TestSeries` gains `programCode`, `examStageId`, `prerequisiteSeriesId`, `sequentialTests`, `isFree`. `TestSeriesTest` M:N.
- [ ] `BranchTestConfig` explicit per-branch rows (enable + schedule), created for all branches (nullable) at series creation. Commit `feat(access): programs, grants, series, branch fan-out; remove groups`.

### Task 13: Student access fields + admin assignment UI

**Files:** `apps/api/src/students/*`, `apps/admin/src/routes/students.tsx`, series/branch admin screens.

- [ ] `Student`: `enrolledExams`/`enrolledFamilies`/`programs` (GIN), `currentBranchId`, `isTestBlocked`, soft-delete. Repoint admin "assign" UI from groups → series/branch + program tag; repoint "deactivate" onto `isTestBlocked`.
- [ ] Tests for the access-field write paths. Commit `feat(students): access fields; admin series/branch assignment`.

### Task 14: Access resolver (single predicate, Redis-cached)

**Files:** `apps/api/src/access/*` (resolver), `apps/api/src/redis/*`, `apps/api/src/me/*` (student catalog).

- [ ] Implement the one canonical predicate: `(exam-match ∪ program-match ∪ StudentGrant) ∧ BranchTestConfig.enabled ∧ schedule-active ∧ prerequisite-unlocked ∧ ¬isTestBlocked`. Compute once, cache in Redis (`student:{id}:catalog`), invalidate on the access-moving events (enrollment, program tag, series tag, BranchTestConfig, unlock).
- [ ] Student-facing catalog returns series → tests (never groups). Tests: each access path resolves; a blocked student is excluded; cache invalidation on each event. Commit `feat(access): single-predicate resolver with Redis catalog cache`.

### Task 15: Series unlock + notifications wiring

**Files:** `apps/api/src/series/*`, `apps/api/src/common/messaging/*` (Notification).

- [ ] `StudentSeriesUnlock` lazy upsert; `SeriesUnlockRequest` request/approve; `Notification.testSeriesId` deep-links for `SERIES_UNLOCKED`/`ENROLLMENT`/`GRANT`. Commit `feat(access): sequential unlock + series notifications`.

---

## FINAL — Integration

### Task 16: Whole-workspace green + drift check

**Files:** as needed across apps/packages.

- [ ] Full gates green from a clean checkout: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`; migration deploy from scratch + `pnpm db:check`.
- [ ] `prisma migrate diff --exit-code` clean against the target schema. Grep the repo for dead references (`Group`, `QuestionOption`, `SubTopic`, `TestSection`, `AttemptAnswer`, `ExamType`, `createFeature`) — none remain outside history/docs. Commit `chore: realignment integration — workspace green on target schema`.

---

## Phase B — forward features (build on this schema; separate plans, NOT part of the drift-close)

These are net-new and out of scope here; listed so the sequence is visible.

- **Question bank + forgiving importer (full):** preview + row-level errors, image/equation, tag-driven search.
- **Test creation flow:** config-driven Step 1 → auto-draw + manual Step 2 → schedule Step 3; RANKED⇒FIXED validation; finalize freezes `PaperQuestion`.
- **Live exam engine (`apps/test`):** sections, server-authoritative timer, palette, per-question language, autosave to Redis, safe submit; OMR render mode.
- **Scoring workers + leaderboard:** BullMQ scoring job, Redis sorted-set rank/percentile, `AttemptQuestion` durable write (single-writer idempotent UPSERT), DROPPED/BONUS recompute.
- **Durability + analytics population:** `OutboxEvent` relay (`FOR UPDATE SKIP LOCKED`), `ProcessedRollup` exactly-once, Redis→batch flush into the rollup tables; Score Card + Solution Report; strength maps.
- **Notifications delivery** (in-app now; push seam later).
