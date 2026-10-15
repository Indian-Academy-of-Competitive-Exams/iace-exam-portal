# IACE Platform

Full-stack learning platform for IACE (government-exam coaching — SSC, Banking, RRB JE, SI/Constable). **V1 delivers the mock-test feature**, replacing the current vendor and fixing its worst friction (slow admin, brittle imports, manual rank/result).

## Start here

- **`CLAUDE.md`** — operating context: locked stack, key decisions, and what to read next (read first).
- **`docs/01-architecture.md`** — architecture, live-test scaling design, deployment topology.
- **`docs/02-domain-rules.md`** — the mock-test rules the schema cannot state.
- **`docs/03-conventions.md`** — where code goes, table ownership, the event catalog.
- **`docs/design/design-system.html`** — the living style guide, and the **admin** composition language (open in a browser).
- **`docs/design/student/README.md`** — the **student** composition language, binding for every `apps/exams` screen.
- **`docs/local-setup.md`** — the same run-through as below, at a new machine's pace.
- **`prisma/schema.prisma`** — the data model (source of truth).

## Your first week

The docs above total about 3,000 lines. Each of `docs/01`–`04` opens with a Contents list that says when to read each section; read in this order and stop when you have what the task needs.

1. **Day one:** this README to the end, `docs/local-setup.md`, and get the stack running. Then `docs/01-architecture.md` §1–5 for the shape and the live-test scaling design.
2. **Keep the glossary open:** [`docs/02-domain-rules.md` §15](docs/02-domain-rules.md#15-glossary) maps every word the code and the admins use — sitting, paper, blueprint, series, offer, cohort, rollup, skin — to what it means and its name in the schema.
3. **Before any change:** `docs/superpowers/task-constraints.md` — the gates, commit rules and invariants. It is binding, and the pre-commit hook enforces most of it.
4. **When the task touches a rule:** the matching section of `docs/02-domain-rules.md` (§7 the sitting, §8 results, §5 access). Read sections, not the file.
5. **When you add a file:** `docs/03-conventions.md` for where it goes and which module owns which table.
6. **Before UI work:** `.claude/skills/ui-conventions/SKILL.md`. `docs/04-infrastructure.md` only when you touch AWS.

Where the code that matters most lives:

| What                                                                | Where                                     |
| ------------------------------------------------------------------- | ----------------------------------------- |
| A sitting: start, autosave, submit, sweep, live ops                 | `apps/api/src/attempts/sitting/`          |
| Scoring and its queue                                               | `apps/api/src/attempts/scoring/`          |
| Score card, leaderboards, analytics, rollups                        | `apps/api/src/attempts/results/`          |
| Who may see and start what (`AccessResolverService`)                | `apps/api/src/reach/`                     |
| Series, programs and grants                                         | `apps/api/src/access/`                    |
| The exam engine shared by web and mobile (timer, save loop, submit) | `packages/app-kit/src/exam/`              |
| The exam skins (Default, SSC, Banking, Railways)                    | `apps/exams/src/features/exam/templates/` |
| The mobile exam screen                                              | `apps/mobile/app/exam/[testId].tsx`       |
| API types, schemas and the typed client                             | `packages/contracts/`                     |

Five rules that break production when forgotten: an answer save never writes Postgres (Redis only); a controller throws `AppException` and never builds the response envelope; every route names `@Public()` or `@Actors(...)`, or the guard refuses it; a civil date uses the IST helpers in CLAUDE.md, never `getUTC*`; and a database test runs against a real database, never a fake Prisma.

## Stack

TypeScript monorepo (Turborepo + pnpm) · NestJS API · **Vite + React + TS** for both the test & admin SPAs · TanStack Query · **Tailwind + shadcn/ui** design system in `packages/ui` · PostgreSQL + Prisma · Redis (BullMQ, live sittings, OTP/sessions) · **S3 via the AWS SDK in every env (MinIO locally)** · self-built JWT auth (students: a code by SMS every time, no PIN; admins: email OTP). No SSR, no WebSockets. Runs on AWS — see `docs/04-infrastructure.md`.

`apps/exams` is the test-taking portal (test player + report), and `apps/mobile` is the same student app for Android (Expo). The broader student platform — courses, performance — becomes a separate `apps/student` later.

`apps/mobile` is the student client in Expo + React Native (Android first). It is **in progress and not yet shipped**: the screens are built, push is dark until Firebase is wired, and nothing is device-verified. It shares `@iace/contracts` and `@iace/app-kit` with the SPAs and nothing else — `@iace/ui` is web, so the mobile app has its own components.

Both SPAs are thin by construction: the bootstrap, the session, the route guard and the chrome all come from `@iace/app-kit`, and the form and table kits from `@iace/ui`. What an app owns is its routes, its nav, its storage keys, its login screen and its dashboard — the things that genuinely differ. See `docs/03-conventions.md` §2–§3.

## Local prerequisites

**Node 22 LTS** (pinned in `.nvmrc`; `nvm use` picks it up), pnpm 11 via corepack, Docker Desktop, Git, and `shellcheck` (the pre-commit hook runs it on any `.sh` you stage — `brew install shellcheck`). Local services (Postgres + Valkey + MinIO) run via `docker compose up`.

`engine-strict` is on, so an older Node fails immediately with a clear message instead of part-way through a build.

## How to run

```bash
cp .env.example .env       # then edit if a port is already taken locally
nvm use                    # Node 22 LTS, from .nvmrc
corepack enable            # activates the pinned pnpm from package.json
docker compose up -d       # postgres + valkey + minio (+ one-shot bucket create)
pnpm install
pnpm db:setup              # generate the client, apply prisma/migrations, insert prisma/seed.sql
pnpm dev                   # api + exams + admin, together
pnpm dev:mobile            # the Expo client, against the same API, in its own terminal
```

The seed includes the first super admin, `developer@iace.co.in` — see [Bootstrapping the first admin](#bootstrapping-the-first-admin) to use your own address.

| What          | Where                        |
| ------------- | ---------------------------- |
| API           | http://localhost:3000        |
| Health check  | http://localhost:3000/health |
| Test app      | http://localhost:5173        |
| Admin app     | http://localhost:5174        |
| MinIO console | http://localhost:9001        |
| Expo (mobile) | http://localhost:8081        |

### Signing in

`OTP_SENDER` picks the transport: `console`, `sms` or `whatsapp` (`OTP_SENDERS` in `apps/api/src/config/env.schema.ts`). Development uses `console`: **the code is printed in the API log**, and with `NODE_ENV=development` the response also carries it as `devCode`, which both login screens show in an info alert — so no SMS or email is sent. Production refuses `console`.

- **Student** (:5173) — enter any valid 10-digit Indian mobile → enter the code. The first sign-in on a number is the signup; every sign-in after that is the same code-by-mobile flow. There is no PIN and no password.
- **Admin** (:5174) — email + OTP every time. Admins cannot self-register, and **no application code creates one** — the first row is SQL (below), and every admin after that is created by a super admin in the admin app.

### Bootstrapping the first admin

Admins cannot sign up, so an empty `Admin` table means nobody can reach the admin app. The first one is pure SQL, never application code: a code path that mints a super admin is one that can be run against production by accident, by CI, by a container entrypoint, and eventually by someone debugging. `prisma/seed.sql` holds it (`developer@iace.co.in`), and only a person runs it, with `pnpm db:seed` or `pnpm db:setup` — no deploy step does. To use your own address instead:

```sql
INSERT INTO "Admin" (id, email, "fullName", role, "isSuperAdmin", "isActive")
VALUES (
  gen_random_uuid(),         -- the column is a uuid; createdAt and updatedAt default to now()
  'you@iace.co.in',          -- lowercase: login looks the row up by exact match
  'Super Admin',
  'SUPER_ADMIN',             -- role and isSuperAdmin say the same thing; the admin screens write both
  true,
  true
);
```

Locally: `docker compose exec -T postgres psql -U iace -d iace -c "<the statement above>"`.
(`iace` is `POSTGRES_USER` in `docker-compose.yml`; there is no `postgres` role in this image.)

That account bypasses every permission check, so it can immediately grant permissions to other admins. Everything after the first row is done in the UI.

**Feature keys are code-owned.** They live in `FEATURE_KEYS` (`@iace/contracts`) — there is no `Feature` table and no screen that registers one. A super admin only assigns `READ`/`WRITE` per key, one `AdminFeaturePermission` row per grant. A key nobody has been granted grants nobody anything, which is the safe direction to fail.

### The API response envelope

Every response has one of two shapes, and no endpoint can produce a third:

```jsonc
{ "success": true,  "data": { … }, "meta": { "requestId": "…" } }          // 2xx
{ "success": false, "error": { "code": "OTP_EXPIRED", "message": "…" },     // 4xx/5xx
  "meta": { "requestId": "…" } }
```

Controllers return plain data (or `{ items, page, pageSize, total }` for a list, whose counts move into `meta`) and throw `AppException`; a global interceptor wraps the returns and a global exception filter converts everything thrown. Types live in `packages/contracts/src/envelope.ts`.

- **Branch on `error.code`, never on `message`** — the codes are the contract, the wording is not.
- **Throw with the constant**: `throw new AppException(ErrorCodes.OTP_EXPIRED, '…')`. A bare `'OTP_EXPIRED'` also compiles, but survives a rename silently and cannot be found by "go to references". A new code is added once, to `ErrorCodes`, where its status and default message sit beside it.
- `fieldErrors` (`{ field: [messages] }`) feeds react-hook-form directly.
- `meta.requestId` is also the `X-Request-Id` header and the id in the server log line for that request.
- The typed client unwraps `data` and throws `AppException`, so React Query sees plain data or one error type.

### CI

`.github/workflows/ci.yml` runs on every push to `staging` or `main` and every pull request, in three jobs (a fourth, **Docs**, runs weekly and on demand — it judges the whole doc set against the whole schema, so it gates nothing):

| Job            | What it proves                                                                                                                                   | Needs                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| **Verify**     | `format:check` · `deps:check` · `env:check` · `lint` · `typecheck` · `test` · `build`                                                            | nothing — no Postgres, Redis, S3 or `.env` |
| **Database**   | every migration applies to an **empty** database, `prisma/migrations` still produces `schema.prisma`, and `pnpm test:db` passes against Postgres | a Postgres service container               |
| **End to end** | `pnpm e2e`: one student signs in and sits a real paper in Chromium against the real API, Postgres, Valkey and queue                              | Postgres and Valkey service containers     |

The split is the point: the test suite is deliberately infrastructure-free, so the job that gates every PR stays fast, and the one database that CI does start exists only for what genuinely cannot be verified without one: the migrations and the hand-written SQL.

Steps in Verify use `if: '!cancelled()'`, so a run reports _every_ failure rather than stopping at the first.

`pnpm db:check` is the drift gate and works locally too — set `SHADOW_DATABASE_URL` to a throwaway database and it exits non-zero when `schema.prisma` has been edited without a migration.

### Before the commit exists

CI is the backstop, not the first line. `husky` installs two hooks on `pnpm install`:

| Hook         | Runs                                                                                                                                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` | `lint-staged` — prettier, `shellcheck` and `prisma format` per file, then `pnpm lint` and `pnpm typecheck` across the workspace; then `scripts/check-source.mjs` on the lines the commit adds (one-line comments, no hint repeating its label); the Sonar scan only with `RUN_SONAR=1` |
| `commit-msg` | `commitlint` — conventional commits (`type(scope): subject`)                                                                                                                                                                                                                           |

Formatting is per file because prettier is a per-file tool. Lint and typecheck are not, and cannot be: ESLint's flat config resolves from the working directory rather than per file, and this repo has one config per package and none at the root; `tsc -p` checks a project, not a file list, so a rename that breaks a caller elsewhere is exactly what a per-file check would miss. Both go through turbo, which caches, so the packages you did not touch are a cache hit.

`pnpm deps:check` (syncpack) keeps one version of every shared library across the workspaces and runs in CI. Peer ranges are exempt — `react: ^19.0.0` in a package and `react: 19.2.8` in an app are the same statement made to two different audiences. `pnpm deps:fix` rewrites the mismatches.

Renovate batches updates (`.github/renovate.json`): the lint toolchain, `@nestjs/*`, React and Prisma each move as one PR, because a partial bump of any of those is a broken build rather than a smaller change.

> **TODO — turbo remote cache.** `turbo.json` is ready for it; enabling it needs a Vercel account token and `TURBO_TOKEN`/`TURBO_TEAM` as repository secrets, which only the repo owner can create. Until then every CI run recomputes from cold. Run `pnpm exec turbo login && pnpm exec turbo link`, then add the two secrets to the workflow env.

### Request size limits

Two limits, not one (`BODY_LIMIT_DEFAULT`, `BODY_LIMIT_IMPORT`):

| Path       | Limit     | Why                                                                                                                 |
| ---------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| everything | **256kb** | a login is a few hundred bytes; a single question is tens of KB, because images are S3 URLs and never inline base64 |
| an upload  | **10mb**  | an imported sheet or a question image, multipart, capped per file by multer in the imports and questions modules    |

Raising the global limit to suit the importer would hand every unauthenticated endpoint a cheap way to make the server allocate megabytes per request, so the larger limit is scoped to the path instead. Over-limit requests answer **413** in the normal envelope (`VALIDATION_ERROR`, "The request was too large") and are logged at DEBUG, not ERROR — a client sending too much is not our incident.

Both are env vars: change them without touching code.

### Other scripts

`pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:db` · `pnpm test:coverage` · `pnpm e2e` · `pnpm format` · `pnpm deps:check` · `pnpm deps:fix` · `pnpm env:check` · `pnpm db:generate` · `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:check` · `pnpm db:dbml` · `pnpm db:studio` · `pnpm docs:check` · `pnpm docker:up` · `pnpm docker:down` · `pnpm docker:reset` (wipes volumes)

**Three test tiers, and where a test lives follows what it touches.** `pnpm test` runs the Node test runner (no Jest) over everything that needs no infrastructure: **not Postgres, not Redis, not S3, and not even a `.env`** — `apps/api/test/support/fakes.ts` provides an in-memory Redis with a clock the test advances, so TTLs, OTP expiry and lockout escalation are asserted without sleeping. Anything that reads or writes Postgres is a `*.db.test.ts` under `apps/api/test-db` and runs on the real database through `pnpm test:db`, which migrates `TEST_DATABASE_URL` first and refuses the database `DATABASE_URL` names, any name not ending in `_test`, and a second run while one is going — two runs on one database corrupt each other, so a parallel session needs a `*_test` database of its own. Create it once with `docker exec iace-postgres createdb -U iace iace_test`; `pnpm test:db test-db/x.db.test.ts` runs one file.

`pnpm e2e` (Playwright, `apps/e2e`) builds the API, migrates and seeds its own `iace_e2e` database, starts the API on :3100 and the built exams app on :5183, and sits one paper in Chromium. It needs `pnpm docker:up` and, once per machine, `pnpm --filter @iace/e2e exec playwright install chromium`.

Every backend feature ships with its tests in the same commit (see the guardrail in `CLAUDE.md`): the happy path, plus the failure the feature exists to prevent.

## Notes

- **Ports:** everything is configurable in `.env`. If `5432` is taken by another Postgres, set `POSTGRES_PORT` **and** the port inside `DATABASE_URL`, `SHADOW_DATABASE_URL` and `TEST_DATABASE_URL`.
- **Node 22 is the floor, not a suggestion.** pnpm 11 requires it, the AWS SDK v3 requires it from January 2027, and Node 20 is out of LTS. The API compiles to ES2023 on the strength of it.
