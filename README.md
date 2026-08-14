# IACE Platform

Full-stack learning platform for IACE (government-exam coaching — SSC, Banking, RRB JE, SI/Constable). **V1 delivers the mock-test feature**, replacing the current vendor and fixing its worst friction (slow admin, brittle imports, manual rank/result).

## Start here

- **`CLAUDE.md`** — operating context: locked stack, data-model summary, key decisions, build order (read first).
- **`docs/01-architecture-and-plan.md`** — architecture, live-test scaling design, roadmap.
- **`docs/02-mocktest-feature-spec.md`** — the mock-test feature in detail.
- **`docs/design/design-system.html`** — the living design-system style guide (open in a browser).
- **`prisma/schema.prisma`** — the data model (source of truth).

## Stack

TypeScript monorepo (Turborepo + pnpm) · NestJS API · **Vite + React + TS** for both the test & admin SPAs · TanStack Query · **Tailwind + shadcn/ui** design system in `packages/ui` · PostgreSQL + Prisma · Redis (BullMQ, live leaderboards, OTP/PIN/sessions) · **S3 via the AWS SDK in every env (MinIO locally)** · self-built JWT auth (students: signup OTP then a 4-digit PIN; admins: email OTP) · React Native later. No SSR, no WebSockets. Infra chosen at the end, AWS-leaning.

`apps/test` is the test-taking portal (test player + report). The broader student platform — courses, performance — becomes a separate `apps/student` later.

Both SPAs are thin by construction: the bootstrap, the session, the route guard and the chrome all come from `@iace/app-kit`, and the form and table kits from `@iace/ui`. What an app owns is its routes, its nav, its storage keys, its login screen and its dashboard — the things that genuinely differ. See `docs/03-shared-architecture.md` §2–§3.

## Local prerequisites

**Node 22 LTS** (pinned in `.nvmrc`; `nvm use` picks it up), pnpm 11 via corepack, Docker Desktop, Git. Local services (Postgres + Redis + MinIO) run via `docker compose up`.

`engine-strict` is on, so an older Node fails immediately with a clear message instead of part-way through a build.

## How to run

```bash
cp .env.example .env       # then edit if a port is already taken locally
nvm use                    # Node 22 LTS, from .nvmrc
corepack enable            # activates the pinned pnpm from package.json
docker compose up -d       # postgres + redis + minio (+ one-shot bucket create)
pnpm install
pnpm db:migrate            # applies prisma/migrations
pnpm dev                   # api + test + admin, together
```

Then create the first super admin — see [Bootstrapping the first admin](#bootstrapping-the-first-admin).

| What          | Where                        |
| ------------- | ---------------------------- |
| API           | http://localhost:3000        |
| Health check  | http://localhost:3000/health |
| Test app      | http://localhost:5173        |
| Admin app     | http://localhost:5174        |
| MinIO console | http://localhost:9001        |

### Signing in

OTP delivery is stubbed in development (`OTP_SENDER=console`): **the code is printed in the API log** and echoed into the login screen, so no SMS or email is sent.

- **Student** (:5173) — _Create an account_ with any valid 10-digit Indian mobile → enter the code from the API log → choose a 4-digit PIN. That signs you in and creates the account. Every login after that is **mobile + PIN**; _Forgot PIN?_ runs the same OTP flow again. Five wrong PINs lock the number, and each repeat lockout lasts longer — 15 minutes, then an hour, then a day (`PIN_LOCKOUT_STEPS_SEC`). Signing in or resetting the PIN clears the ladder.
- **Admin** (:5174) — email + OTP every time. Admins cannot self-register, and **there is no code path anywhere in this repo that creates one** — the first row goes in by hand (below), and every admin after that is created by a super admin in the admin app.

### Bootstrapping the first admin

Admins cannot sign up, so an empty `Admin` table means nobody can reach the admin app. There is deliberately no seed script: a command that mints a super admin is a command that can be run against production by accident, and it tends to be run by CI, by a container entrypoint, and eventually by someone debugging. One SQL statement, run once, by a person who meant it:

```sql
INSERT INTO "Admin" (id, email, "fullName", "isSuperAdmin", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,   -- any unique string; the app generates cuids, this only has to be distinct
  'you@iace.co.in',          -- lowercase: login looks the row up by exact match
  'Super Admin',
  true,
  true,
  now(),
  now()
);
```

Locally: `docker compose exec -T postgres psql -U postgres -d iace -c "<the statement above>"`.

That account bypasses every feature check, so it can immediately register `Feature` rows and grant them. Everything after the first row is done in the UI.

**Feature rows are not seeded either.** A super admin registers each one from the Features screen using a key from `FEATURE_KEYS` in `@iace/contracts`. A key with no row grants nobody anything, which is the safe direction to fail.

### The API response envelope

Every response has one of two shapes, and no endpoint can produce a third:

```jsonc
{ "success": true,  "data": { … }, "meta": { "requestId": "…" } }          // 2xx
{ "success": false, "error": { "code": "PIN_LOCKED", "message": "…" },      // 4xx/5xx
  "meta": { "requestId": "…" } }
```

Controllers return plain data (or `{ items, page, pageSize, total }` for a list, whose counts move into `meta`) and throw `AppException`; a global interceptor wraps the returns and a global exception filter converts everything thrown. Types live in `packages/contracts/src/envelope.ts`.

- **Branch on `error.code`, never on `message`** — the codes are the contract, the wording is not.
- **Throw with the constant**: `throw new AppException(ErrorCodes.PIN_LOCKED, '…')`. A bare `'PIN_LOCKED'` also compiles, but survives a rename silently and cannot be found by "go to references". A new code is added once, to `ErrorCodes`, where its status and default message sit beside it.
- `fieldErrors` (`{ field: [messages] }`) feeds react-hook-form directly.
- `meta.requestId` is also the `X-Request-Id` header and the id in the server log line for that request.
- The typed client unwraps `data` and throws `AppException`, so React Query sees plain data or one error type.

### CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request, in two jobs:

| Job            | What it proves                                                                                          | Needs                              |
| -------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Verify**     | `format:check` · `deps:check` · `lint` · `typecheck` · `test` · `build`                                 | nothing — no Postgres, Redis or S3 |
| **Migrations** | every migration applies to an **empty** database and `prisma/migrations` still produces `schema.prisma` | a Postgres service container       |

The split is the point: the test suite is deliberately infrastructure-free, so the job that gates every PR stays fast, and the one database that CI does start exists only to check the migrations — the one thing that genuinely cannot be verified without one.

Steps in Verify use `if: '!cancelled()'`, so a run reports _every_ failure rather than stopping at the first.

`pnpm db:check` is the drift gate and works locally too — set `SHADOW_DATABASE_URL` to a throwaway database and it exits non-zero when `schema.prisma` has been edited without a migration.

### Before the commit exists

CI is the backstop, not the first line. `husky` installs two hooks on `pnpm install`:

| Hook         | Runs                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| `pre-commit` | `lint-staged` — prettier + `prisma format` per file, then `pnpm lint` and `pnpm typecheck` across the workspace |
| `commit-msg` | `commitlint` — conventional commits (`type(scope): subject`)                                                    |

Formatting is per file because prettier is a per-file tool. Lint and typecheck are not, and cannot be: ESLint's flat config resolves from the working directory rather than per file, and this repo has one config per package and none at the root; `tsc -p` checks a project, not a file list, so a rename that breaks a caller elsewhere is exactly what a per-file check would miss. Both go through turbo, which caches, so the packages you did not touch are a cache hit.

`pnpm deps:check` (syncpack) keeps one version of every shared library across the workspaces and runs in CI. Peer ranges are exempt — `react: ^19.0.0` in a package and `react: 19.2.8` in an app are the same statement made to two different audiences. `pnpm deps:fix` rewrites the mismatches.

Renovate batches updates (`.github/renovate.json`): the lint toolchain, `@nestjs/*`, React and Prisma each move as one PR, because a partial bump of any of those is a broken build rather than a smaller change.

> **TODO — turbo remote cache.** `turbo.json` is ready for it; enabling it needs a Vercel account token and `TURBO_TOKEN`/`TURBO_TEAM` as repository secrets, which only the repo owner can create. Until then every CI run recomputes from cold. Run `pnpm exec turbo login && pnpm exec turbo link`, then add the two secrets to the workflow env.

### Request size limits

Two limits, not one (`BODY_LIMIT_DEFAULT`, `BODY_LIMIT_IMPORT`):

| Path         | Limit     | Why                                                                                                                 |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------------- |
| everything   | **256kb** | a login is a few hundred bytes; a single question is tens of KB, because images are S3 URLs and never inline base64 |
| `/imports/*` | **10mb**  | the question importer is the one endpoint that legitimately receives a large payload                                |

Raising the global limit to suit the importer would hand every unauthenticated endpoint a cheap way to make the server allocate megabytes per request, so the larger limit is scoped to the path instead. Over-limit requests answer **413** in the normal envelope (`VALIDATION_ERROR`, "The request was too large") and are logged at DEBUG, not ERROR — a client sending too much is not our incident.

Both are env vars: change them without touching code.

### Other scripts

`pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm format` · `pnpm deps:check` · `pnpm deps:fix` · `pnpm db:generate` · `pnpm db:check` · `pnpm db:studio` · `pnpm docker:down` · `pnpm docker:reset` (wipes volumes)

`pnpm test` runs the Node test runner (no Jest). **Nothing in the suite needs Postgres, Redis or S3** — `apps/api/test/support/fakes.ts` provides an in-memory Redis with a clock the test advances, so TTLs, OTP expiry and lockout escalation are asserted without sleeping. That is what makes the suite safe as a CI gate.

Every backend feature ships with its tests in the same commit (see the guardrail in `CLAUDE.md`): the happy path, plus the failure the feature exists to prevent.

## Status

**Phase 0 (foundation) complete** — monorepo, local infra, design-system package, shared contracts, NestJS API (config/Prisma/Redis/BullMQ/S3/health), and auth: student signup-OTP + 4-digit PIN, admin email OTP, JWT with rotating refresh. No product features yet; next is the question bank + importer, per the build order in `CLAUDE.md`.

The data model is ahead of the code in three places, deliberately — the columns exist and are migrated, but nothing enforces them until the feature that owns them is built. Grep `TODO(pre-test gate)` and `TODO(access)` for the hook points.

| In the schema                       | Enforced when                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Student.preTestReady`              | the test engine lands — a prompt for mother's/father's name + DOB on the way into a test, never a hard block       |
| Student → Group → TestSeries → Test | the test list and attempt-start endpoints exist; there are no direct grants to check                               |
| `BaseConfig.locked`                 | base-config editing exists — a config freezes at the first attempt on a test built from it, and evolves by cloning |

## Notes

- **Ports:** everything is configurable in `.env`. If `5432` is taken by another Postgres, set `POSTGRES_PORT` **and** the port inside `DATABASE_URL`.
- **Node 22 is the floor, not a suggestion.** pnpm 11 requires it, the AWS SDK v3 requires it from January 2027, and Node 20 is out of LTS. The API compiles to ES2023 on the strength of it.
