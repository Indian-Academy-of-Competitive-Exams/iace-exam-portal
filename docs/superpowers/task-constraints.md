# Task constraints (binding, stable prefix)

Read this as the binding core for every task. It is intentionally short and **stable** —
do not edit it per task, so it stays a cache hit. Open `CLAUDE.md` only for the section a
task explicitly needs (data model, scaling rules, design system).

## Gates (green before commit)

`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Schema tasks also: `pnpm db:migrate:deploy` from scratch + `pnpm db:check`.
Never `--no-verify`, never `git commit -n`, never `SKIP_SONAR=1`. Sonar pre-commit is real; fix the cause.

## Commit

One commit per task, in its final step. `type(scope): what changed, plain words`; body = why.
No `Co-Authored-By`, no tool attribution. Never `git push`, no branches/PRs. Never `git add -A` blind — stage whole files, prettier first, `git diff --stat` clean.
Node 22 in the committing shell (`source ~/.nvm/nvm.sh && nvm use 22`).

## Data model

`prisma/schema.prisma` wins on any conflict. Target of record: `docs/schema-target.dbml`.
Raw-SQL for what Prisma can't express (composite FKs, partial-uniques, CHECKs, triggers, GIN) goes in the migration by hand.

## Invariants (never break)

- OTP, sessions, device binding live in **Redis**, never the DB.
- Exactly **one S3 upload path** (MinIO locally), never branched by environment.
- No secrets in code; `.env.example` only. First super admin by **pure SQL**, no seed code.
- Mobile editable by **ADMIN only**. Aadhaar/PAN images **not stored** (verified booleans only).
- Feature keys are **code-owned** (`FEATURE_KEYS`), never UI-registered; super admin assigns permissions only.
- Live-test hot path off Postgres: client timer, autosave to Redis, BullMQ scoring, Redis leaderboard.

## API

One envelope. Controllers return data or `throw AppException(ErrorCodes.X, …)`; never build the envelope. React to `error.code`, never a message string. `fieldErrors` feed react-hook-form. `meta.requestId` on every response.

## Code style

Default to no comment (only an external constraint, a genuinely surprising line, or an invariant the types can't carry — 2 lines max, never "what changed"). No magic strings — `SCREAMING_SNAKE_CASE as const`. Design values from `packages/ui` tokens only, never a raw hex. Check `packages/ui` + `packages/app-kit` before writing any UI. Confirm destructive actions with `ConfirmDialog`, naming the consequence + count.

## Tests

`node:test` + `node:assert/strict`, named after the unit, no Postgres/Redis/S3 (extend `apps/api/test/support/fakes.ts`). Written from the task's acceptance criteria, in the same commit. Cover the happy path **and** the failure the change prevents. Do not edit the golden invariant suite.
