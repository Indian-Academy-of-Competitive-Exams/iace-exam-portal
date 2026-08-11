# CLAUDE.md — IACE Platform

Operating context for anyone (human or agent) in this repo. Read `docs/` and `prisma/schema.prisma` before writing code. **`prisma/schema.prisma` is the source of truth for the data model** — this file summarizes it, but the schema wins on any conflict.

## What this is

A full-stack learning platform for **IACE**, a government-exam coaching institute (SSC, Banking, RRB JE, SI/Constable). **V1 is the mock-test feature** — it replaces the current vendor (ThinkExam) and fixes its pain points. The platform grows from there (courses, performance, more test types).

- **Team:** one developer + AI pair. **V1 timeline:** ~45 days.
- **Scale target:** ~2K concurrent normal, must handle 4K, 5K with minor infra additions (NOT 10K).
- **North star:** keep what ThinkExam does well, simplify the friction, upgrade the three things that hurt — slow admin, brittle question import, manual rank/result.
- **Portals (three):** **Student** (future broad platform — courses, performance), **Test** (test-taking + report — the app under `apps/test`), and **Admin**. **V1 builds the Test portal + Admin**; the full student platform comes later. Rollout: internal IACE students first (group-based), general public later.

## Tech stack (locked)

- **Monorepo:** Turborepo + pnpm workspaces. **TypeScript everywhere.**
- **API:** NestJS (Node + TS) — one decoupled API for web now, mobile later.
- **Frontend:** **Vite + React + TypeScript SPAs** — `apps/test` and `apps/admin` (`apps/student` comes later). No Next.js, no SSR. (A public marketing site, if ever needed, is a separate small thing.)
- **Server data:** TanStack Query (React Query) over a typed client generated from `packages/contracts`.
- **Design system:** Tailwind CSS + shadcn/ui with tokens in **`packages/ui`** — the single source for color, type, spacing, radii, elevation, and components. **Never redefine design values at the component level.** Brand primary = muted brick **`#B83939`**; **Cancel = neutral grey**; **destructive = crimson `#BE123C`**; chart palette is the validated colorblind-safe set (blue-led, never brand red). Light + dark via CSS variables. Living style guide: `docs/design/design-system.html`.
- **Forms:** react-hook-form + zod. **Icons:** lucide-react. **Routing:** React Router. **Client state:** Zustand only where React Query doesn't fit.
- **Mobile (post-V1):** React Native + Expo (reuses the same TS, types, and API).
- **DB:** PostgreSQL via **Prisma** (`prisma/schema.prisma`).
- **Redis:** in-progress test state, live leaderboards, **OTP, sessions, device binding**, rate limiting. **Jobs:** BullMQ (scoring queue, imports) on Redis.
- **Auth:** self-built JWT + refresh. **Students:** mobile + OTP **at signup**, then a **4-digit PIN** for later logins (not unique across students — it is only ever checked against the one student a mobile resolves to) (OTP resets a forgotten PIN; rate-limit / lock PIN attempts in Redis). **Admins:** email + OTP. OTP, sessions, and device binding all live in **Redis — never the DB**. A super admin is seeded; admins get page-level permissions.
- **Storage:** **S3, via the AWS S3 SDK, in every environment.** Local dev runs **MinIO** (S3-compatible) in docker-compose; only the endpoint/credentials differ via env. **There is exactly one upload code path — never branch it by environment.**
- **No WebSockets** (client timer + periodic HTTP autosave + Redis is enough).
- **Payments:** handled in a separate portal — NOT in V1.
- **Infra:** chosen at the _end_, AWS-leaning. Build cloud-agnostic (Docker + env). Everything containerized.

## Monorepo layout

```
apps/
  test/        Vite + React + TS SPA — the test-taking portal (V1)
  admin/       Vite + React + TS SPA
  api/         NestJS
  (student/    the broader student platform — a separate SPA, later)
packages/
  ui/          design tokens + shadcn components (the shared design system)
  contracts/   shared types + typed API client
  config/      tailwind preset, tsconfig, eslint
prisma/
  schema.prisma
docker-compose.yml   # postgres + redis + minio (local)
```

## The scaling rule that must not be broken

Live timed tests are the hard part. Keep Postgres off the hot path:

- Timer is **client-side**; server owns authoritative `startedAt`/`endsAt`.
- Answers **autosave to Redis** (~20–30s), not to Postgres per keystroke.
- On submit, enqueue a **BullMQ** scoring job; workers evaluate, update the **Redis leaderboard** (sorted set), and write the durable scored fields. A spike of thousands of submits becomes a draining queue, not thousands of synchronous DB writes.
- **Rank/percentile is always live** from Redis — there is no manual "regenerate" step.

## Data model (summary — schema is authoritative)

- **Student** and **Admin** are separate tables. Student: `mobile` is the only mandatory field. Admin: `email`, `isSuperAdmin`, page-level permissions (`Page` + implicit M:N).
- **StudentProfile** (1:1): mother/father name, dob, plus optional email, address, gender, photo, Aadhaar/PAN links, education + past-exam history (JSON). **The pre-test gate is minimal** — `Student.preTestReady` = mother's name + father's name + DOB, prompted gently before a test. `profileCompleted` (the full profile) is optional and only drives a nudge — it never blocks.
- **Question bank:** `Question` + `QuestionOption` (stable `id` + `isCorrect` — the answer key survives shuffling/editing). Localized content is **JSON** (`Question.content`, `QuestionOption.text`) keyed by language; each field is rich (text, `$LaTeX$`, inline **S3 image URLs**). English default. Imported on **one central screen**, forgiving (preview + row-level errors).
- **Exam-type base configs** (`BaseConfig` + `BaseConfigSection`) are reusable blueprints; a `Test` copies + overrides them (intentional denormalized snapshot). First config: **SSC CGL Tier 1**. **A base config `locked`s** once any test created from it is first attempted — then it (and its sections) are read-only; to evolve it, the admin **clones** it into a new config. (Existing tests are snapshots, so they're never affected either way.)
- **Auto-draw (blueprint):** subjects + difficulty % (test default + per-section override). Draw happens **once at finalize** → a **fixed `PaperQuestion` paper every student shares** (fair ranking). Per-student order/option shuffle via `Attempt.shuffleSeed`. Manual pick from the bank also supported.
- **Lock on first attempt.** Only permitted post-start change: mark a `PaperQuestion` **DROPPED/BONUS** → auto-recompute.
- **`Attempt`** holds live state **and** the scored fields (no separate Result table). **`AttemptAnswer`** stores only questions the student interacted with (composite PK) plus analytics data points (time, option, state).
- **Access = Student → Group → TestSeries → Test.** A student is always in ≥1 **group**; groups are linked to **test series**; a student can access the tests in the series linked to their groups. **No direct student/test grants, no products, no access codes.** A `shareSlug` link exists for edge cases. In-app `Notification` on assignment.
- **Series ↔ test:** many-to-many, optional, **flat** (`TestSeries` + implicit M:N). A test can be attempted standalone.
- Marks use `Decimal(6,2)`. **No certificates in V1.**

## Two test-taking UIs

The **standard government CBT interface** (primary V1 build; all exam formats share it, config-driven) and a **generic test UI** (secondary — only if time permits). The portal/admin shell is the shared modern design system. The in-exam CBT screen stays **faithful to the real exam**.

**Language display is per test** (`Test.languageMode`, defaulted from base config): **SINGLE** (student picks one language, optional per-question toggle) or **DUAL** (both languages render together — stem _and_ options — no toggle). `Test.languages` is the ordered list. All content is already in the JSON, so this is purely a render mode. SSC CGL defaults to DUAL (English + Hindi).

## Results

Score Card (rank, percentile, correct/wrong/unattempted) + Solution Report (per-question review with correct + chosen answer + explanation). Deeper analytics are fast-follow, but **all data points are captured from day one.** **Report is the student's post-login landing dashboard.** Student portal is **enhanced, not copied** — snappy, uncluttered, icon-driven, with a replayable tour.

## Where things live

- `docs/01-architecture-and-plan.md` — architecture, scaling design, roadmap.
- `docs/02-mocktest-feature-spec.md` — the mock-test feature in full.
- `docs/schema-erd.mmd` — ER diagram of the data model.
- `docs/design/design-system.html` — living style guide (open it to see the system).
- `packages/ui/` — the design tokens + Tailwind preset that back it.
- `prisma/schema.prisma` — **the data model (source of truth).**

## Build order (mock-test feature)

1. Central question bank + forgiving importer (text → then image/equation).
2. Exam-type base configs (seed SSC CGL Tier 1).
3. Test creation: config-driven Step 1 → auto-draw + manual Step 2 → schedule Step 3.
4. Live exam engine (CBT interface — the hard, high-value part): sections, server timer, palette, per-question language, autosave, safe submit.
5. Scoring workers + live rank/percentile + Score Card + Solution Report.
6. Lock + drop/bonus recompute; hardening + load test at target concurrency.

## Conventions & guardrails

- Fewer moving parts beats "best in class" — solo build under a deadline.
- Protect the hard-to-change decisions (data model, live-test scaling); iterate freely on UI/copy.
- **One S3 upload path everywhere** (MinIO locally) — never branch upload code by environment.
- **Design values come only from `packages/ui` tokens** — never a raw hex or one-off spacing in a feature component.
- **OTP, sessions, and device binding live in Redis** — never the DB.
- The importer must be **forgiving**: preview + row-level errors, commit only valid rows.
- No secrets in code; use env / AWS Secrets Manager. Commit a `.env.example`, never real secrets.
- **One API response envelope** (types in `packages/contracts`). Success (2xx): `{ success: true, data, meta }`. Failure (4xx/5xx): `{ success: false, error: { code, message, fieldErrors? }, meta }`. Enforced by a NestJS **response interceptor** (wraps success) + **global exception filter** (maps every thrown error — Http/Prisma/zod — to the envelope with the right status); controllers just return data or throw, never build the envelope. The typed client unwraps `data` and throws a typed error on `success:false`, so React Query error handling is uniform. `error.code` is a **stable enum** (react to the code, never string-match `message`); `fieldErrors` (`{ field: [msgs] }`) feeds react-hook-form; `meta.requestId` rides on every response for tracing; list endpoints add `meta.page/pageSize/total`.
- **No magic strings.** Any string that appears in more than one place, or that a typo would break silently, is declared once as a `SCREAMING_SNAKE_CASE` const object (`as const`, with the type derived from it) and referenced everywhere — never re-typed inline. Cross-app vocabularies live in `packages/contracts` (`ErrorCodes`, `ActorTypes`, `FORM_LEVEL_FIELD`); server-only ones next to their owner (`QUEUE_NAMES`, `NODE_ENVS`, `OTP_SENDERS`, `PRISMA_ERROR_CODES`, `redisKeys`, `AUTH_ROUTES`); per-SPA ones in `apps/<app>/src/lib/constants.ts` (`ROUTES`, `THEMES`, `STORAGE_KEYS`). Where the value is dictated by something external (a Prisma `P2002`, a header name), keep the literal as the value and name the constant. **Exempt:** user-facing copy and log messages — those are prose, not identifiers.
- **Always throw with the `ErrorCodes` constant, never a bare string** — `throw new AppException(ErrorCodes.PIN_LOCKED, '…')`, not `new AppException('PIN_LOCKED', …)`. Both compile (the type is a union of literals), but only the constant breaks at the call site when a code is renamed and is findable by "go to references". Same for any `code:` written into an error object. A new code is added **once**, to `ErrorCodes` in `packages/contracts/src/envelope.ts` — its status and default message are declared beside it, and `Record<ErrorCode, …>` makes a missing entry a compile error. **Every new endpoint follows this: return data, throw `AppException(ErrorCodes.X, …)`, never build an envelope or hand-write a status.**
