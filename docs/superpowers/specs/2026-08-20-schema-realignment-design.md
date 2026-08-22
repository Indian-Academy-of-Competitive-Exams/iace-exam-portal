# Schema realignment + no-groups migration — design spec

> **Binding.** This spec plus `prisma/schema.prisma` are the source of every
> decision in the paired plan, which landed and was removed with the rest of the spent task lists.
> On any data-model conflict, the generated `prisma/schema.prisma` wins.

## Why

The codebase drifted from the finalized data model. The repo is at the Phase-0 /
early-access stage (`ExamType`, `QuestionOption`, `SubTopic`, `TestSection`,
`AttemptAnswer`, the `Group` access model) with no exam-stage layer, no question
versioning, no no-groups access, and none of the analytics/durability tables. This
work realigns everything already built onto the target model so that all forward
feature work (question bank, importer, test engine, scoring, analytics) is built once,
correctly, on the right schema.

Pre-production: there are no real users. The dev database is throwaway and is **reset**,
not data-migrated.

## The target model (`prisma/schema.prisma`, 36 tables)

Read the DBML for the authoritative shape. The decisions that changed relative to the
repo, and are binding here:

1. **Exam taxonomy.** `ExamType` becomes `Exam` (Level: CGL/CHSL/PO…). A new `ExamStage`
   sits under it (the Stage/Paper that carries a config, e.g. SSC CGL Tier 1), with
   `mode` (`ExamMode`), `disposition` (`StageDisposition`: CONDUCTED / PARTIAL /
   CATALOG_ONLY). `ExamFamily` is a **constant enum** (SSC/RRB/BANKING/AP_TS_POLICE),
   not a table.

2. **Base configs — default + custom.** A stage has ONE `isDefault` config (the seeded
   official pattern, partial-unique `UNIQUE(exam_stage_id) WHERE is_default`) plus any
   number of CUSTOM configs admins create and reuse (`isDefault=false`, `clonedFromId`
   lineage). A `Test` points at either. Config carries the workbook fields (timer
   template, navigation, languages, feature flags, `scoringVersion`). `BaseConfigModule`
   ships as a table (the SESSION_MODULE_LOCKED engine is a deferred feature).
   `BaseConfigSection` holds per-section marks/negative/timing/merit. `TestSection` is
   removed — structure comes only from the config. Config locks at first finalize;
   clone-to-evolve.

3. **Immutable question versioning.** `Question` is identity only; `QuestionVersion`
   holds immutable content + **options folded into `options` JSONB** + `answerKey`.
   `QuestionOption` and `SubTopic` are dropped. `Question.tags` is a `text[]` (GIN) with
   a namespaced convention (`paper:<slug>` soft earmark, `set:`, `pyq:`, `src:`,
   `topic:`). Fixed papers and attempts pin a `questionVersionId` for deterministic
   reproduction.

4. **Tests, papers, attempts.** `Test` is minimal (inherits everything from the config;
   carries `scope`/`evaluationMode`/`paperBinding`/`drawStrategy`/pool filter). ONE draw
   engine: FIXED (frozen shared `PaperQuestion` at finalize) vs GENERATED (per attempt).
   `AttemptQuestion` is the single per-attempt-question row (merge of the old
   `AttemptQuestion` + `AttemptAnswer`); `questionVersionId`/`order`/`baseConfigSectionId`
   are NOT NULL; `paperQuestionId` null-ness marks FIXED vs GENERATED.

5. **Access — no groups.** `Group`/`GroupType` and the group joins are removed. Access is
   derived: exam-match (`Student.enrolledExams` ↔ the series' stage exam) ∪ program-match
   (`Program` catalog + `Student.programs[]` ↔ `TestSeries.programCode`) ∪ explicit
   `StudentGrant`, gated by `BranchTestConfig` (explicit per-branch enable/schedule rows)
   - `StudentSeriesUnlock` + not-`isTestBlocked`. `TestSeriesTest` is the M:N join (a test
     is only ever reached through a series). `SeriesUnlockRequest` for the request tier.

6. **Admin permissions — code-owned feature keys.** No `Feature` table. Grants live in
   `AdminFeaturePermission(adminId, featureKey, level)`; `featureKey` mirrors the
   code-owned `FEATURE_KEYS` enum. Registering feature keys from the UI is removed; a
   read-only `GET /features` serves the code catalog to the assign-permissions screen.
   The super admin assigns permissions only. `AdminBranch` join + explicit `allBranches`
   replace `Admin.branchIds[]`.

7. **Durability + analytics.** `OutboxEvent` (transactional outbox, relay drains with
   `FOR UPDATE SKIP LOCKED`) + `ProcessedRollup` (exactly-once). Rollups
   `StudentStat`/`StudentSubjectStat`/`TestStat`/`TestSectionStat`/`TestQuestionStat`
   accumulate in Redis and flush by batch — never synchronous per submit.

8. **Integrity.** Composite FKs enforce cross-entity consistency (test↔config↔stage,
   section↔config, module↔config, version↔question, FIXED attempt↔paper). Partial-unique
   indexes, CHECK constraints, locked-config immutability trigger, GIN forcing, and
   `timestamptz` everywhere are written into the first migration as raw SQL (Prisma can't
   express them).

## Non-negotiables (from `CLAUDE.md`)

- OTP, sessions, device binding live in **Redis**, never the DB.
- Exactly **one S3 upload path** (MinIO locally), never branched by environment.
- No secrets in code; `.env.example` only. First super admin created by **pure SQL**, no
  seed code.
- Mobile number editable by **ADMIN only**. Aadhaar/PAN **images not stored** here (only
  `aadhaarVerified`/`panVerified` booleans).
- One response envelope (`packages/contracts`); controllers return data or throw; react to
  `error.code`, never a message string.

## Out of scope (Phase B — forward features, separate plans)

Building the question-bank backend + forgiving importer, the test-creation flow, the live
exam engine, scoring workers + leaderboard, analytics population, and notifications. These
are net-new and are built on this schema _after_ realignment lands. They are listed at the
end of the plan as a forward backlog, not part of the drift-close.
