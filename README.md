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
pnpm db:seed               # creates the bootstrap super admin from .env
pnpm dev                   # api + test + admin, together
```

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
- **Admin** (:5174) — the seeded `SEED_SUPER_ADMIN_EMAIL`, email + OTP every time. Admins cannot self-register.

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

| Job            | What it proves                                                                                                                   | Needs                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Verify**     | `format:check` · `lint` · `typecheck` · `test` · `build`                                                                         | nothing — no Postgres, Redis or S3 |
| **Migrations** | every migration applies to an **empty** database, `prisma/migrations` still produces `schema.prisma`, and the seed is idempotent | a Postgres service container       |

The split is the point: the test suite is deliberately infrastructure-free, so the job that gates every PR stays fast, and the one database that CI does start exists only to check the migrations — the one thing that genuinely cannot be verified without one.

Steps in Verify use `if: '!cancelled()'`, so a run reports _every_ failure rather than stopping at the first.

`pnpm db:check` is the drift gate and works locally too — set `SHADOW_DATABASE_URL` to a throwaway database and it exits non-zero when `schema.prisma` has been edited without a migration.

### Other scripts

`pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm format` · `pnpm db:generate` · `pnpm db:check` · `pnpm db:studio` · `pnpm docker:down` · `pnpm docker:reset` (wipes volumes)

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
