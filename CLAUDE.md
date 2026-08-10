# CLAUDE.md — IACE Platform

Operating context for anyone (human or agent) in this repo. Read `docs/` and `prisma/schema.prisma` before writing code. **`prisma/schema.prisma` is the source of truth for the data model** — this file summarizes it, but the schema wins on any conflict.

## What this is

A full-stack learning platform for **IACE**, a government-exam coaching institute (SSC, Banking, RRB JE, SI/Constable). **V1 is the mock-test feature** — it replaces the current vendor (ThinkExam) and fixes its pain points. The platform grows from there (courses, performance, more test types).

- **Team:** one developer + AI pair. **V1 timeline:** ~45 days.
- **Scale target:** ~2K concurrent normal, must handle 4K, 5K with minor infra additions (NOT 10K).
- **North star:** keep what ThinkExam does well, simplify the friction, upgrade the three things that hurt — slow admin, brittle question import, manual rank/result.

## Tech stack (locked)

- **Monorepo:** Turborepo + pnpm workspaces. **TypeScript everywhere.**
- **API:** NestJS (Node + TS) — one decoupled API for web now, mobile later.
- **Frontend:** **Vite + React + TypeScript SPAs** — `apps/student` and `apps/admin`. No Next.js, no SSR. (A public marketing site, if ever needed, is a separate small thing.)
- **Server data:** TanStack Query (React Query) over a typed client generated from `packages/contracts`.
- **Design system:** Tailwind CSS + shadcn/ui with tokens in **`packages/ui`** — the single source for color, type, spacing, radii, elevation, and components. **Never redefine design values at the component level.** Brand primary = muted brick **`#B83939`**; **Cancel = neutral grey**; **destructive = crimson `#BE123C`**; chart palette is the validated colorblind-safe set (blue-led, never brand red). Light + dark via CSS variables. Living style guide: `docs/design/design-system.html`.
- **Forms:** react-hook-form + zod. **Icons:** lucide-react. **Routing:** React Router. **Client state:** Zustand only where React Query doesn't fit.
- **Mobile (post-V1):** React Native + Expo (reuses the same TS, types, and API).
- **DB:** PostgreSQL via **Prisma** (`prisma/schema.prisma`).
- **Redis:** in-progress test state, live leaderboards, **OTP, sessions, device binding**, rate limiting. **Jobs:** BullMQ (scoring queue, imports) on Redis.
- **Auth:** self-built JWT + refresh. **Students: mobile + OTP. Admins: email + OTP.** OTP, sessions, and device binding all live in **Redis — never the DB**. A super admin is seeded; admins get page-level permissions.
- **Storage:** **S3, via the AWS S3 SDK, in every environment.** Local dev runs **MinIO** (S3-compatible) in docker-compose; only the endpoint/credentials differ via env. **There is exactly one upload code path — never branch it by environment.**
- **No WebSockets** (client timer + periodic HTTP autosave + Redis is enough).
- **Payments:** handled in a separate portal — NOT in V1.
- **Infra:** chosen at the *end*, AWS-leaning. Build cloud-agnostic (Docker + env). Everything containerized.

## Monorepo layout

```
apps/
  student/     Vite + React + TS SPA
  admin/       Vite + React + TS SPA
  api/         NestJS
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
- **StudentProfile** (1:1): email, address, gender, dob, photo, Aadhaar/PAN links, education + past-exam history (JSON). **`Student.profileCompleted`** gates the first test and is true once **photo + DOB + gender + Aadhaar + PAN** are present.
- **Question bank:** `Question` + `QuestionOption` (stable `id` + `isCorrect` — the answer key survives shuffling/editing). Localized content is **JSON** (`Question.content`, `QuestionOption.text`) keyed by language; each field is rich (text, `$LaTeX$`, inline **S3 image URLs**). English default. Imported on **one central screen**, forgiving (preview + row-level errors).
- **Exam-type base configs** (`BaseConfig` + `BaseConfigSection`) are reusable blueprints; a `Test` copies + overrides them (intentional denormalized snapshot). First config: **SSC CGL Tier 1**.
- **Auto-draw (blueprint):** subjects + difficulty % (test default + per-section override). Draw happens **once at finalize** → a **fixed `PaperQuestion` paper every student shares** (fair ranking). Per-student order/option shuffle via `Attempt.shuffleSeed`. Manual pick from the bank also supported.
- **Lock on first attempt.** Only permitted post-start change: mark a `PaperQuestion` **DROPPED/BONUS** → auto-recompute.
- **`Attempt`** holds live state **and** the scored fields (no separate Result table). **`AttemptAnswer`** stores only questions the student interacted with (composite PK) plus analytics data points (time, option, state).
- **Access = two options:** assign to a **group/batch** or to **individual students** (implicit M:N on `Test`) + a `shareSlug` link. **No products, no access codes.** In-app `Notification` on assignment.
- **Series ↔ test:** many-to-many, optional, **flat** (`TestSeries` + implicit M:N). A test can be attempted standalone.
- Marks use `Decimal(6,2)`. **No certificates in V1.**

## Two test-taking UIs

The **standard government CBT interface** (primary V1 build; all exam formats share it, config-driven) and a **generic test UI** (secondary — only if time permits). The portal/admin shell is the shared modern design system. The in-exam CBT screen stays **faithful to the real exam**.

**Language display is per test** (`Test.languageMode`, defaulted from base config): **SINGLE** (student picks one language, optional per-question toggle) or **DUAL** (both languages render together — stem *and* options — no toggle). `Test.languages` is the ordered list. All content is already in the JSON, so this is purely a render mode. SSC CGL defaults to DUAL (English + Hindi).

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
