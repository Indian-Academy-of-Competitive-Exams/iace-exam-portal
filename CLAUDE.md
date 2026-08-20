# CLAUDE.md — IACE Platform

Operating context for anyone (human or agent) in this repo. Read `docs/` and `prisma/schema.prisma` before writing code. **`prisma/schema.prisma` wins over this file on any data-model conflict.**

**The binding core — gates, commit rules, invariants, API, code style, tests — lives in one file, imported here. Never restate it below.**

@docs/superpowers/task-constraints.md

**Before any task, follow `docs/superpowers/WORKFLOW.md` (the lean task loop — batching, review-by-risk, terse reports, tests as intent not code).**

## What this is

A learning platform for **IACE**, a government-exam coaching institute (SSC, Banking, RRB JE, SI/Constable), replacing ThinkExam.

- **V1 = the mock-test feature.** Team: one developer + AI pair. Timeline ~45 days.
- **Scale:** ~2K concurrent normal, handle 4K, 5K with minor infra additions. Not 10K.
- **Portals:** **Student** (broad platform, later), **Test** (`apps/test`, V1), **Admin** (V1).
- **Rollout:** internal IACE students first (group-based), public later.

## Tech stack (locked)

- **API:** NestJS. **Frontend:** Vite + React SPAs — no Next.js, no SSR.
- **Server data:** TanStack Query over the typed client from `packages/contracts`.
- **Design:** Tailwind + shadcn/ui, tokens in `packages/ui`, light + dark via CSS variables. Brand palette and its rules: the `ui-conventions` skill.
- **Client state:** Zustand only where React Query does not fit.
- **DB:** PostgreSQL via Prisma. **Redis:** live test state, leaderboards, OTP, sessions, device binding, rate limiting. **Jobs:** BullMQ on Redis.
- **Auth:** self-built JWT + refresh. Students: mobile + OTP at signup, then a 4-digit PIN (not unique across students; only ever checked against the one student a mobile resolves to). Admins: email + OTP. Admins hold `READ`/`WRITE` per `Feature` key; super admins bypass every check.
- **Storage:** S3 SDK in every environment; MinIO locally. **Mobile (post-V1):** React Native + Expo.
- **No WebSockets.** **Payments:** separate portal, not V1. **Infra:** chosen last, AWS-leaning, cloud-agnostic Docker + env.

## Scaling rules (do not break)

- Timer is client-side; the server owns `startedAt`/`endsAt`.
- Autosave answers to Redis every ~20–30s. Never write Postgres per keystroke.
- On submit, enqueue a BullMQ scoring job. Workers evaluate, update the Redis leaderboard, write durable scored fields.
- Read rank/percentile live from Redis. There is no "regenerate" step.

## Data model (schema is authoritative)

- **Student** and **Admin** are separate tables. Student: `mobile` is the only mandatory field. Admin permissions via `Feature` + `FeaturePermission` (denormalized `adminIds` array, GIN index).
- **StudentProfile** (1:1). `preTestReady` = mother's name + father's name + DOB; prompt before a test. `profileCompleted` only drives a nudge — never block on it.
- **Question bank:** `Question` + `QuestionOption` (stable `id` + `isCorrect`). Localized content is JSON keyed by language, rich (text, `$LaTeX$`, S3 image URLs). English default.
- **Taxonomy: `Subject` → `Topic` → `SubTopic`.** A sub-topic is shared: one row, M:N to Topic. There is no Subject relation on `SubTopic` — it reaches a second subject only through a topic. `SubTopic.name` is unique table-wide, so **resolve an existing sub-topic before creating one**. A `Question` carries `subjectId` + optional `topicId`/`subTopicId`; **the service must check the sub-topic belongs to the topic** — no FK can.
- **Base configs** (`BaseConfig` + `BaseConfigSection`) are blueprints; a `Test` copies and overrides them (intentional snapshot). A base config `locked`s once a test from it is first attempted — clone it to evolve it.
- **Auto-draw** at finalize only → one fixed `PaperQuestion` paper every student shares. Per-student shuffle via `Attempt.shuffleSeed`. Manual pick also supported.
- **Lock on first attempt.** The only permitted post-start change is marking a `PaperQuestion` DROPPED/BONUS → auto-recompute.
- **`Attempt`** holds live state and scored fields (no Result table). **`AttemptAnswer`** stores only questions the student interacted with, plus analytics points.
- **Access = Student → Group → TestSeries → Test.** Every student is in ≥1 group. No direct student/test grants, no products, no access codes. `shareSlug` exists for edge cases.
- **`Branch` is a table.** Super admin writes, everyone managing groups reads. Exactly one `isGlobal` row (GLOBAL) — never rename, retire or delete it. A branch with groups cannot be deleted; a retired branch takes no new groups.
- **Branch and group names are canonical** (`canonicalName` in `packages/contracts/src/naming.ts`): UPPERCASE, letters and digits, single-spaced. **Normalise input, never reject it.** Group name is unique within its branch; a group never moves branch. Qualify ambiguous names as `AMEERPET / SSC CGL MORNING`.
- **Series ↔ test:** many-to-many, optional, flat. A test can be attempted standalone.
- Marks use `Decimal(6,2)`. No certificates in V1.

## Where things live

- `.claude/skills/ui-conventions/` — **the binding shared-code + UI-behaviour rules.** Invoke the `ui-conventions` skill before writing any screen or component.
- `packages/ui/src/index.ts` — **the component inventory. Read it before building any UI.**
- `docs/01-architecture-and-plan.md` — architecture, scaling, roadmap.
- `docs/02-mocktest-feature-spec.md` — the mock-test feature in full: test-taking UI variants (§14), language display (§2), student journey and landing page (§5), results and solutions (§6).
- `docs/design/design-system.html` — living style guide.
- `packages/app-kit/` — SPA plumbing (tokens/session, API client, form errors, page size).
