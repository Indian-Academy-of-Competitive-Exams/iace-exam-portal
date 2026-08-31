# CLAUDE.md — IACE Platform

Operating context for anyone (human or agent) in this repo. Read `docs/` and `prisma/schema.prisma`
before writing code. **`prisma/schema.prisma` wins over this file on any data-model conflict.**

<binding-core>

The binding core — gates, commit rules, invariants, API, code style, tests — lives in one file,
imported here. **Never restate it below.**

@docs/superpowers/task-constraints.md

Before any task, follow `docs/superpowers/WORKFLOW.md` (the lean loop: batching, review-by-risk,
terse reports, tests as intent not code).

</binding-core>

## What this is

A learning platform for **IACE**, a government-exam coaching institute (SSC, Banking, RRB JE,
SI/Constable), replacing ThinkExam.

- **V1 = the mock-test feature.** One developer + AI pair, ~45 days.
- **Scale:** ~2K concurrent normal, handle 4K, 5K with minor infra additions. Not 10K.
- **Portals:** **Student** (broad platform, later), **Test** (`apps/test`, V1), **Admin** (V1).
- **Rollout:** internal IACE students first, by branch and enrolment; public later.

## Tech stack (locked)

- **API:** NestJS. **Frontend:** Vite + React SPAs — no Next.js, no SSR.
- **Server data:** TanStack Query over the typed client from `packages/contracts`.
- **Design:** Tailwind + shadcn/ui, tokens in `packages/ui`, light + dark via CSS variables. Brand
  palette and its rules: the `ui-conventions` skill.
- **Client state:** Zustand only where React Query does not fit.
- **DB:** PostgreSQL via Prisma. **Redis:** live test state, leaderboards, OTP, sessions, device
  binding, rate limiting. **Jobs:** BullMQ on Redis.
- **Auth:** self-built JWT + refresh. Students: mobile + OTP at signup, then a 4-digit PIN (not
  unique across students; only ever checked against the one student a mobile resolves to). Admins:
  email + OTP. Admins hold `READ`/`WRITE` per feature key, keys are code-owned (`FEATURE_KEYS`);
  super admins bypass every check.
- **Storage:** S3 SDK in every environment; MinIO locally. **Mobile (post-V1):** React Native + Expo.
- **No WebSockets.** **Payments:** separate portal, not V1. **Infra:** chosen last, AWS-leaning,
  cloud-agnostic Docker + env.

<scaling-rules>

Do not break these — they are why the live test holds at 4–5K:

- Timer is client-side; the server owns `startedAt`/`endsAt`.
- Autosave answers to Redis every ~20–30s. Never write Postgres per keystroke.
- On submit, enqueue a BullMQ scoring job. Workers evaluate, update the Redis leaderboard, write
  durable scored fields.
- Read rank/percentile live from Redis. There is no "regenerate" step.

</scaling-rules>

## Data model (schema is authoritative)

- **Student** and **Admin** are separate tables. A student needs a `mobile` and a `studentType`;
  `mobile` is unique among LIVE rows only (a partial index), so every lookup by it is a filtered
  read, never a key. Admin permissions are one row per grant:
  `AdminFeaturePermission(adminId, featureKey, level)`. There is no `Feature` table.
- **StudentProfile** (1:1). `preTestReady` = mother's name + father's name + DOB; prompt before a
  test. `profileCompleted` only drives a nudge — never block on it. Aadhaar and PAN are
  `aadhaarVerified`/`panVerified` booleans; the images are never stored, so the only upload is the photo.
- **Exam taxonomy: `ExamFamily` (enum) → `Exam` → `ExamStage`.** The STAGE is the level everything
  hangs off — a base config, a test series and a test all point at one. `Exam.code` is what
  `Student.enrolledExams` stores, and `ExamStage.stageKey` is unique table-wide because seeds and
  the exam-pattern workbook address a stage by it. Neither can change once something carries it. A
  CATALOG_ONLY stage is listed so the journey reads whole; nothing is built on it.
- **Question bank:** `Question` is IDENTITY — type, taxonomy, status, tags, `stemHash`,
  `currentVersionId`. Editing a DRAFT rewrites its one `QuestionVersion` in place; editing anything
  past the draft inserts an immutable one (content, options as JSON, answer key) and repoints
  `currentVersionId`, so a paper or an attempt that pinned a version never moves. **Nothing a
  `PaperQuestion`, `AttemptQuestion` or `TestQuestionStat` references can be returned to DRAFT or
  deleted** — being depended on is what freezes a question, not being published. A save that
  changes nothing writes no version. Subject and topic settle when the question leaves the draft.
  Option ids carry over by position. Localized content is JSON keyed by language, rich (text,
  `$LaTeX$`, S3 image URLs). English default.
- **Question taxonomy: `Subject` → `Topic`.** Two levels only. Anything finer is a free-text tag on
  the question. A `Question` carries `subjectId` + optional `topicId`; **the service must check the
  topic belongs to the subject** — no FK can.
- **Base configs** (`BaseConfig` + `BaseConfigModule` + `BaseConfigSection`) are a stage's blueprint,
  and a `Test` INHERITS its shape rather than copying it. Marks, negative marks, timing and
  merit/qualifying are PER SECTION — one paper may mix them. A stage holds exactly one `isDefault`
  config. `locked` trips at the first finalize of any test built from it; after that only name,
  `isDefault` and `isActive` still move, and the way to change the shape is to clone it
  (`clonedFromId` is the lineage).
- **A FIXED paper is picked by hand** from the pool its section's spec describes, and frozen at
  finalize → one `PaperQuestion` paper every student shares. A GENERATED test is DRAWN at finalize
  into `Test.variantCount` papers. Per-student shuffle via `Attempt.shuffleSeed` either way.
- **Lock on first attempt.** The only permitted post-start change is marking a `PaperQuestion`
  DROPPED/BONUS → auto-recompute.
- **`Attempt`** holds live state and scored fields (no Result table). **`AttemptQuestion`** stores
  only questions the student interacted with, plus analytics points.
- **Access has no groups.** A student reaches a `TestSeries` by an exam match, a program match, or
  an explicit `StudentGrant`, gated by the `BranchTestConfig` row for their branch — a switch with
  no window, so a branch runs a series indefinitely.
- **A series' `kind` widens the first two paths.** `STANDARD` is the above; `FREE` also reaches
  anyone enrolled in its exam FAMILY, capped at `FREE_SERIES_EXAM_CAP` exams, and may not sit behind
  a prerequisite (a CHECK refuses it); `SCHOLARSHIP` reaches only a grant. Reaching is not starting:
  `unlockMode` is `AUTO` (at once, or once the prerequisite series is finished) or `REQUEST` (a queue
  an admin decides). A locked series is still LISTED.
- **Scheduling belongs to the TEST.** `TestSeriesTest.unlockAt` is when it opens inside a series,
  one instant for every branch; `BranchTestSchedule(branchId, testId)` — the tests module owns it —
  carries `lateEntrySec` (counted FROM the unlock) and `extraTimeSec`, both null, no row meaning the
  plain rules. It blocks STARTING a test, never seeing one: `assertCanStart` refuses the sitting,
  `assertReachable` still opens it to read about. A series has no availability, and `canStart` is
  derived from the clock on every read. A test that has been sat cannot be taken out of a series.
- **`Branch` is a table.** Super admin writes, everyone managing students reads. `name` is unique
  among live rows only. A branch a student still attends cannot be deleted; a retired branch takes
  no new students.
- **Branch names and exam codes are canonical** (`canonicalName` in
  `packages/contracts/src/naming.ts`): UPPERCASE, letters and digits, single-spaced. **Normalise
  input, never reject it.**
- **Series ↔ test:** many-to-many, optional, flat. A test can be attempted standalone.
- Marks use `Decimal(6,2)`. No certificates in V1.

## Where things live

- `.claude/skills/ui-conventions/` — the binding UI rules. The constraints file above says when to
  invoke it; this is where it lives.
- `graft/` — the wiring graph of every TypeScript and JavaScript file, queried with the `graft` CLI
  or the `graft` skill. Git-ignored, so run `graft build` once in a fresh clone.
- `packages/ui/src/index.ts` — the component inventory.
- `docs/01-architecture-and-plan.md` — architecture, scaling, roadmap.
- `docs/02-mocktest-feature-spec.md` — the mock-test feature in full: render modes and skins (§14),
  access and unlocking (§7), student journey and landing page (§5), results and solutions (§6).
- `docs/03-shared-architecture.md` — module boundaries, the table-ownership map, the event catalog.
- `docs/design/design-system.html` — living style guide.
- `packages/app-kit/` — SPA plumbing (tokens/session, API client, form errors, page size).
