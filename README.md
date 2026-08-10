# IACE Platform

Full-stack learning platform for IACE (government-exam coaching — SSC, Banking, RRB JE, SI/Constable). **V1 delivers the mock-test feature**, replacing the current vendor and fixing its worst friction (slow admin, brittle imports, manual rank/result).

## Start here

- **`CLAUDE.md`** — operating context: locked stack, data-model summary, key decisions, build order (read first).
- **`docs/01-architecture-and-plan.md`** — architecture, live-test scaling design, roadmap.
- **`docs/02-mocktest-feature-spec.md`** — the mock-test feature in detail.
- **`docs/design/design-system.html`** — the living design-system style guide (open in a browser).
- **`prisma/schema.prisma`** — the data model (source of truth).

## Stack

TypeScript monorepo (Turborepo + pnpm) · NestJS API · **Vite + React + TS** for both student & admin SPAs · TanStack Query · **Tailwind + shadcn/ui** design system in `packages/ui` · PostgreSQL + Prisma · Redis (BullMQ, live leaderboards, OTP/sessions) · **S3 via the AWS SDK in every env (MinIO locally)** · self-built JWT + OTP auth (students mobile, admins email) · React Native later. No SSR, no WebSockets. Infra chosen at the end, AWS-leaning.

## Local prerequisites

Node 20+ (Node 22 recommended — see *Notes* below), pnpm 10, Docker Desktop, Git. Local services (Postgres + Redis + MinIO) run via `docker compose up`.

## How to run

```bash
cp .env.example .env       # then edit if a port is already taken locally
corepack enable            # activates the pinned pnpm from package.json
docker compose up -d       # postgres + redis + minio (+ one-shot bucket create)
pnpm install
pnpm db:migrate            # applies prisma/migrations
pnpm db:seed               # creates the bootstrap super admin from .env
pnpm dev                   # api + student + admin, together
```

| What | Where |
|---|---|
| API | http://localhost:3000 |
| Health check | http://localhost:3000/health |
| Student app | http://localhost:5173 |
| Admin app | http://localhost:5174 |
| MinIO console | http://localhost:9001 |

### Signing in

OTP delivery is stubbed in development (`OTP_SENDER=console`): **the code is printed in the API log** and echoed into the login screen, so no SMS or email is sent.

- **Student** — any valid 10-digit Indian mobile at :5173. The account is created on first successful verify.
- **Admin** — the seeded `SEED_SUPER_ADMIN_EMAIL` at :5174. Admins cannot self-register.

### Other scripts

`pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm format` · `pnpm db:generate` · `pnpm db:studio` · `pnpm docker:down` · `pnpm docker:reset` (wipes volumes)

## Status

**Phase 0 (foundation) complete** — monorepo, local infra, design-system package, shared contracts, NestJS API (config/Prisma/Redis/BullMQ/S3/health) and mobile- and email-OTP auth with JWT + rotating refresh. No product features yet; next is the question bank + importer, per the build order in `CLAUDE.md`.

## Notes

- **Node:** the AWS SDK v3 warns that releases after January 2027 will require Node ≥22. Node 22 also unlocks pnpm 11. Nothing is blocked today.
- **Ports:** everything is configurable in `.env`. If `5432` is taken by another Postgres, set `POSTGRES_PORT` **and** the port inside `DATABASE_URL`.
