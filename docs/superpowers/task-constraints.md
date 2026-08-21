# Task constraints (binding, stable prefix)

Read this as the binding core for every task. It is intentionally short and **stable** —
do not edit it per task, so it stays a cache hit. `CLAUDE.md` imports this file, so a main
session already has it; open the rest of `CLAUDE.md` only for the section a task explicitly
needs (data model, scaling rules, tech stack).

## Gates (green before commit)

`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Schema tasks also: `pnpm db:migrate:deploy` from scratch + `pnpm db:check`.
Never `--no-verify`, never `git commit -n`, never `SKIP_SONAR=1`. Sonar pre-commit is real; fix the cause.
The Sonar procedure is the `sonar-gate` skill — invoke it before every commit. No `// NOSONAR` without asking, and never mark an issue false-positive or won't-fix without asking.

## Commit

Finish the work, get the gates green, then commit — do not ask first.
One commit per coherent change, in its final step; each must build and pass on its own. `type(scope): what changed, plain words` (`feat`, `fix`, `chore`, `docs`, `refactor`); body carries the why, the history and what the change prevents.
No `Co-Authored-By`, no tool attribution. Never `git push`, no branches/PRs — commit on the current branch, and if HEAD is ever on `prod` or `test`, stop and ask.
Never `git add -A` blind — stage whole files, prettier first, `git diff --stat` clean. A partly staged file makes lint-staged stash the rest, and its restore has corrupted `.gitignore` and staged ignored files.
Never rewrite published history: `--amend`, `rebase`, `reset --hard` only on commits made this session.
Node 22 in the committing shell (`source ~/.nvm/nvm.sh && nvm use 22`).

## Data model

`prisma/schema.prisma` is the target of record and wins on any conflict.
Raw-SQL for what Prisma can't express (composite FKs, partial-uniques, CHECKs, triggers, GIN) goes in the migration by hand.

## Invariants (never break)

- OTP, sessions, device binding live in **Redis**, never the DB.
- Exactly **one S3 upload path** (MinIO locally), never branched by environment.
- No secrets in code; `.env.example` only. First super admin by **pure SQL**, no seed code.
- Mobile editable by **ADMIN only**. Aadhaar/PAN images **not stored** (verified booleans only).
- Feature keys are **code-owned** (`FEATURE_KEYS`), never UI-registered; super admin assigns permissions only.
- Live-test hot path off Postgres: client timer, autosave to Redis, BullMQ scoring, Redis leaderboard.

## Dates

**The institute runs on IST. Storage is UTC; every USE of a date is `Asia/Kolkata`.**
An instant (`createdAt`, `startedAt`, `endsAt`) stays `timestamptz` and serialises with
`.toISOString()` — that is correct and needs no helper. A CIVIL date (what day is it, which day
did this fall on, when does a day start and end) is never derived with `getUTC*` or
`toISOString().slice(0, 10)` on a stored instant: UTC is 5.5 hours behind and gets the answer
wrong every night between midnight and 05:30.

Never write a new date helper. There is one of each, and a second one is a bug waiting for the
day the two disagree:

- `packages/contracts` — `INSTITUTE_TIME_ZONE`, `civilDate(at)`, `todayISO()`,
  `instituteWallTime(at)`, `fromInstituteWallTime(wall)`. Intl-based and dependency-free,
  because contracts ships to both SPAs.
- `apps/api/src/common/time/institute-day.ts` — `startOfInstituteDay`, `endOfInstituteDay`,
  `instituteDayOf`, `shiftInstituteDay`, `toDateColumn`, `fromDateColumn`. Uses `date-fns` and
  `@date-fns/tz`, which stay SERVER-ONLY — a date library in contracts lands in every student's
  browser.
- `apps/api/src/common/importing/date-cell.ts` — `toIsoDate` for a spreadsheet cell of unknown
  format. Validate the DATE, never the format.

A date range from a `YYYY-MM-DD` filter uses `startOfInstituteDay`/`endOfInstituteDay`, never a
hand-built `T00:00:00.000Z`. Anything shown to a user passes `timeZone: INSTITUTE_TIME_ZONE`, never
the device's default. A `@db.Date` column is a civil date at UTC midnight — that is a storage
convention, not a timezone, so use `toDateColumn`/`fromDateColumn` and do not "fix" it to IST.
`packages/ui` holds no zone: it is design, so a picker's dates are UTC-built civil dates and an app
that needs a clock passes `min`/`max`.

## API

One envelope (types in `packages/contracts`). Success: `{ success: true, data, meta }`. Failure: `{ success: false, error: { code, message, fieldErrors? }, meta }`.
Controllers return data or `throw AppException(ErrorCodes.X, …)`; never build the envelope — the interceptor wraps, the exception filter maps. Add a new code once to `ErrorCodes` in `packages/contracts/src/envelope.ts`, with its status and default message beside it.
React to `error.code`, never a message string. `fieldErrors` feed react-hook-form. `meta.requestId` on every response; list endpoints add `meta.page/pageSize/total`.
Make the importer forgiving: preview + row-level errors, commit only valid rows.

## Tooling

Fetch the docs with the `context7` MCP before writing third-party library code. Prisma, NestJS, TanStack Query, react-hook-form and shadcn/ui have all moved since training — never write an API surface from memory, and never carry over a deprecated signature.
Read the SonarQube MCP metrics for a file before you change it, not only before the commit. Leave it with fewer smells than you found; the pre-commit gate is the floor, not the target.
Run a rewrite through the `code-simplifier` skill when the replacement branches more than what it replaced. Cognitive complexity is the thing being reduced, not line count.

## Code style

Default to no comment — only an external constraint, a genuinely surprising line, or an invariant the types can't carry. **ONE line. Never two.** If it does not fit on one line, the code needs a better name, not a longer comment. Never "what changed". `scripts/check-comments.mjs` runs in `pre-commit` and fails the commit on any multi-line comment in the lines you add; `-----`/`=====` section banners are exempt, and a file's top block only up to 6 lines — it is a map, not somewhere to move the essay the one-line rule just refused, and comments already in the repo are grandfathered until you touch one. Explaining what the code does is never a reason — rename the thing instead. If you are composing a justification for a comment, that is the signal to delete it, and delete one once its rule lives here or in a test. `prisma/migrations/**/*.sql` is exempt: a migration is a historical record nobody edits again, so explain the data move at the top of the file, in as many lines as it takes.
No magic strings — any string used twice, or that a typo breaks silently, is a `SCREAMING_SNAKE_CASE as const` object with its type derived from it. Cross-app: `packages/contracts` (`ErrorCodes`, `ActorTypes`, `FORM_LEVEL_FIELD`). Server-only: next to its owner (`QUEUE_NAMES`, `NODE_ENVS`, `OTP_SENDERS`, `PRISMA_ERROR_CODES`, `redisKeys`, `AUTH_ROUTES`). Per-SPA: `apps/<app>/src/lib/constants.ts`. Exempt: user-facing copy and log messages.
**Before writing or changing any UI, invoke the `ui-conventions` skill — its rules are binding and admit no deviation** — it carries the binding shared-code and UI-behaviour rules (component placement, list-screen shape, page frames and scrolling, when a card is warranted, the nav, `FormDialog` for creating one entity, `Combobox` for every dropdown, `DatePicker` for every date, row actions behind one menu, `TruncatedText` in every cell, confirm dialogs, loading states, pagination, chips), and it binds subagents too. The floor, with or without it: design values from `packages/ui` tokens only, never a raw hex; check `packages/ui` + `packages/app-kit` before writing any UI; confirm destructive actions with `ConfirmDialog`, naming the consequence + count.
Fewer moving parts beats "best in class". Protect the data model and live-test scaling; iterate freely on UI and copy.

## Tests

`node:test` + `node:assert/strict`, named after the unit (`auth-pin.unit.test.ts`, `envelope.e2e.test.ts`), no Postgres/Redis/S3 (extend `apps/api/test/support/fakes.ts`). Written from the task's acceptance criteria, in the same commit — no `apps/api/test/*.test.ts` (or `packages/contracts/test/*.test.ts`) means not finished. Cover the happy path **and** the failure the change prevents; assert the guarantee, not the implementation. Do not edit the golden invariant suite. `pnpm test` is a release gate and stays green.
