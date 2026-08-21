# Local Development Setup

Everything a new developer needs to run the IACE platform locally. Follow it top
to bottom; it takes ~10 minutes on a clean machine.

## What you're running

A **Turborepo + pnpm** monorepo:

```
apps/
  api/      NestJS API            → http://localhost:3000   (health: /health)
  test/     Vite + React (student/test portal) → http://localhost:5173
  admin/    Vite + React (admin panel)         → http://localhost:5174
packages/
  contracts/  shared types + zod schemas + typed API client
  app-kit/    DOM-free shared logic (auth, api client, query client, hooks)
  ui/         design tokens + shadcn components
  config/     shared tsconfig / eslint / tailwind presets
prisma/       schema.prisma + migrations
docker-compose.yml   Postgres + Redis + MinIO (local infra)
docs/         architecture & design docs (read 01–04 + CLAUDE.md)
```

Local infra runs in Docker: **PostgreSQL** (data), **Redis** (OTP, sessions,
device binding, rate limiting, BullMQ), **MinIO** (S3‑compatible object storage).

---

## 1. Prerequisites

| Tool                    | Version                                                   | Notes                                                          |
| ----------------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| Node.js                 | **22.23.2** (see `.nvmrc`; engine floor is 22.13)         | `nvm install && nvm use`                                       |
| pnpm                    | **11.21.0** (pinned in `package.json` → `packageManager`) | Get it via Corepack — see below                                |
| Docker + Docker Compose | any recent                                                | for Postgres/Redis/MinIO                                       |
| Git                     | any                                                       |                                                                |
| SonarQube               | optional                                                  | only if you want the pre‑commit scan; it skips itself if unset |

Enable the pinned pnpm with Corepack (don't `npm i -g pnpm` — you'll drift off the pinned version):

```bash
corepack enable
corepack prepare pnpm@11.21.0 --activate   # optional; install also self-corrects
```

## 2. Clone & install

```bash
git clone <repo-url> iace && cd iace
nvm use                       # picks up .nvmrc (22.23.2)
pnpm install --frozen-lockfile
```

Two things pnpm 11 does that can surprise you, both already configured in `pnpm-workspace.yaml`:

- **Build allow‑list** — only listed packages (prisma, esbuild, argon2, …) may run install scripts.
- **Minimum release age** — very new package versions are held back as supply‑chain protection; the versions we pinned are explicitly allowed. If you add a brand‑new dependency and install "hangs" on it, add it to `minimumReleaseAgeExclude`.

`pnpm install` also installs the **Husky** git hooks (via the `prepare` script).

## 3. Environment

```bash
cp .env.example .env
```

The defaults in `.env.example` are wired to the docker‑compose services, so **it runs as‑is locally** — you don't have to change anything to start. Worth knowing:

- **Database / Redis / MinIO** point at `localhost` on the compose ports (5432 / 6379 / 9000). `DATABASE_URL` is what Prisma reads.
- **JWT secrets & `PIN_PEPPER`** ship as `dev_only_…` placeholders (min length 24). Fine for solo local work; generate real ones with `openssl rand -base64 48` for anything shared.
- **OTP delivery is `console`** — in dev, OTP codes are **printed to the API log**, not sent by SMS/email. That's how you log in locally (see §6).
- **MSG91 / SMTP** are blank (real SMS/email providers — leave empty locally).
- **`SONAR_*`** blank → the pre‑commit Sonar scan skips itself. Set them only if you run a local SonarQube.
- **`VITE_API_URL`** is the only var the frontends read (`http://localhost:3000`).

## 4. Start the infrastructure

```bash
pnpm docker:up
```

Brings up:

| Service     | Port                        | Notes                                                 |
| ----------- | --------------------------- | ----------------------------------------------------- |
| Postgres 16 | 5432                        | user/pass/db = `iace` / `iace_dev_password` / `iace`  |
| Redis 7     | 6379                        |                                                       |
| MinIO       | 9000 (API) / 9001 (console) | login = `iace_minio_user` / `iace_minio_password`     |
| minio‑init  | —                           | one‑shot: creates the `iace-local` bucket, then exits |

Check: `docker ps` shows `iace-postgres`, `iace-redis`, `iace-minio` healthy. The MinIO console is at http://localhost:9001.

## 5. Set up the database

On a new device, one command does all of it — generate the client, apply every migration, then
insert the static rows the application cannot start without:

```bash
pnpm db:setup
```

That is `db:generate && db:migrate:deploy && db:seed`. It is safe to re-run: migrations already
applied are skipped and every seed insert is guarded, so a second run changes nothing.

The three steps separately, when you want one of them on its own:

```bash
pnpm db:generate      # generate the Prisma client (needed before typecheck/build)
pnpm db:migrate       # apply all migrations to your local DB (dev flow — prompts, creates)
pnpm db:seed          # the static rows (§6)
```

Optional GUI: `pnpm db:studio` (Prisma Studio, opens in the browser).

> `db:seed` stays a separate command, not prisma's seed hook, so a `migrate reset` never quietly recreates rows you meant to be rid of. (`db:check` compares the migrations against the schema and needs `SHADOW_DATABASE_URL` — see `.env.example`.)

## 6. Seed the first super admin, the branches and the exam catalog

```bash
pnpm db:seed
```

That inserts the super admin (`developer@iace.co.in`), the eleven branches, the SSC CGL
exam and its two tiers, and the SSC CGL Tier 1 default base config with its four
sections. It is idempotent — every insert is guarded, so running it twice changes nothing.

The ONLINE branch is not optional. A student's branch is what `AccessResolver` reads to
decide what they can reach, so a student without one resolves to an empty catalog however
many exams they are enrolled on — and the admin screens lock every ONLINE student's branch
to that row. It is a singleton the API refuses to duplicate, rename, retire or delete, so
seeding it is the only comfortable way to bring it into being. Physical centres are added
on the admin **Branches** screen.

Admins can't self‑register and nothing in the application creates one, so without this
row there is no way into the admin app at all. To use a different address, edit
`prisma/seed.sql` before running it, or add yourself afterwards:

```sql
INSERT INTO "Admin" (id, email, "isSuperAdmin", "isActive", "allBranches")
VALUES (gen_random_uuid()::text, 'you@iace.co.in', true, true, true);
```

Then sign in at the **admin app** (http://localhost:5174) with that email. The **login OTP prints to the API log** (because `OTP_SENDER=console`).

## 7. Run the apps

```bash
pnpm dev          # Turborepo runs api + test + admin together
```

| App                   | URL                                                                |
| --------------------- | ------------------------------------------------------------------ |
| API                   | http://localhost:3000 (health check: http://localhost:3000/health) |
| Test / student portal | http://localhost:5173                                              |
| Admin panel           | http://localhost:5174                                              |

To run just one: `pnpm --filter @iace/api dev` (or `@iace/test`, `@iace/admin`).

**How login works locally:** a _student_ signs up with a mobile number → gets an OTP (printed to the API log) → sets a 6‑digit PIN → logs in with mobile + PIN thereafter. An _admin_ enters their email → gets an OTP (API log). All OTP/session/device state lives in Redis, never Postgres.

## 8. Everyday commands

| Command                                           | What it does                                |
| ------------------------------------------------- | ------------------------------------------- |
| `pnpm dev`                                        | run all apps (watch mode)                   |
| `pnpm build`                                      | build everything                            |
| `pnpm typecheck`                                  | TS typecheck across the monorepo            |
| `pnpm lint`                                       | ESLint across the monorepo                  |
| `pnpm test`                                       | run all package/app tests                   |
| `pnpm test:coverage`                              | tests with coverage                         |
| `pnpm format` / `pnpm format:check`               | Prettier write / check                      |
| `pnpm deps:check` / `pnpm deps:fix`               | syncpack — keep shared dep versions aligned |
| `pnpm db:setup`                                   | new device: generate + migrate + seed       |
| `pnpm db:migrate` / `db:generate` / `db:studio`   | Prisma workflows                            |
| `pnpm docker:up` / `docker:down` / `docker:reset` | infra up / stop / stop+wipe volumes         |

Before committing, the Husky pre‑commit hook runs format + lint + typecheck (and the Sonar scan if configured). Commits follow the conventional‑commit style.

## 9. Troubleshooting

- **`pnpm: command not found`** → `corepack enable` (don't install pnpm globally).
- **Wrong Node version / weird build errors** → `nvm use` (must be 22.13+; `.nvmrc` pins 22.23.2).
- **TablePlus/psql can't connect to Postgres** → is `pnpm docker:up` running? Host is `localhost`, port `5432`, db/user/pass = `iace` / `iace` / `iace_dev_password`.
- **Prisma "engine download" errors** → you're offline; Prisma needs network on first `db:generate`.
- **`pnpm install` stalls on a new dependency** → pnpm 11's minimum‑release‑age hold; add the exact version to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`.
- **MinIO bucket missing / S3 upload fails** → re‑run `pnpm docker:up` (the `minio-init` one‑shot recreates the `iace-local` bucket); check the console at :9001.
- **Port already in use** (3000 / 5173 / 5174 / 5432 / 6379 / 9000 / 9001) → free the process or change the port in `.env`.
- **Pre‑commit hook fails** → run `pnpm format && pnpm lint && pnpm typecheck` and fix what it reports; leave `SONAR_*` unset to skip the Sonar scan.
- **Admin OTP never arrives** → it doesn't; read it from the **API log** (dev uses the console OTP sender).
- **Start completely fresh** → `pnpm docker:reset` (wipes DB/Redis/MinIO volumes), then `pnpm docker:up && pnpm db:setup` (§5).

## 10. Where to read next

- `CLAUDE.md` — the operating manual (stack, scaling rules, conventions).
- `docs/01-architecture-and-plan.md` — architecture & roadmap.
- `docs/02-mocktest-feature-spec.md` — the mock‑test feature.
- `docs/03-shared-architecture.md` — what's shared, module boundaries, conventions.
- `docs/04-students-groups-access-model.md` — students/groups/branches/access.
- `prisma/schema.prisma` — the data model (source of truth).
