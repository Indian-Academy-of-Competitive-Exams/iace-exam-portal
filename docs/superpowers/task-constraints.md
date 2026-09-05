# Task constraints (binding, stable prefix)

The binding core for every task. Intentionally short and **stable** — do not edit it per task, so
it stays a cache hit. `CLAUDE.md` imports this file, so a main session already has it; open the
rest of `CLAUDE.md` only for the section a task explicitly needs.

<gates>

Green before commit:

`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`

Schema tasks also: `pnpm db:migrate:deploy` from scratch + `pnpm db:check`.

**A migration that MOVES data is not proved by either.** From scratch the table is empty, so the
statement matches no rows and never runs — it passes on a migration that cannot work. Seed a
scratch database at the PREVIOUS revision, reproduce what makes the move hard (a locked row, a
trigger, a constraint the real data trips), apply it there, and check what moved AND that whatever
you stood down came back.

Never `--no-verify`, never `git commit -n`, never `SKIP_SONAR=1`. Sonar pre-commit is real; fix the
cause. The procedure is the `sonar-gate` skill — invoke it before every commit. No `// NOSONAR`
without asking, and never mark an issue false-positive or won't-fix without asking.

</gates>

<commit>

Finish the work, get the gates green, then commit — do not ask first.

One commit per coherent change, in its final step; each must build and pass on its own.
`type(scope): what changed, plain words` (`feat`, `fix`, `chore`, `docs`, `refactor`); the body
carries the why, the history, and what the change prevents.

No `Co-Authored-By`, no tool attribution. Never `git push`, no branches/PRs — commit on the current
branch, and if HEAD is ever on `prod` or `test`, stop and ask.

Never `git add -A` blind — stage whole files, prettier first, `git diff --stat` clean. A partly
staged file makes lint-staged stash the rest, and its restore has corrupted tracked files before.

Never rewrite published history: `--amend`, `rebase`, `reset --hard` only on commits made this
session. Node 22 in the committing shell (`source ~/.nvm/nvm.sh && nvm use 22`).

</commit>

<docs>

**A plan is not a deliverable.** Implementation plans, task briefs, the specs behind them, research
notes and status reports are scaffolding for one piece of work; they go stale the day it lands, and
a repo full of them buries the handful of documents somebody actually has to read. Write them under
`docs/superpowers/plans/` or `docs/superpowers/specs/` — both **gitignored**. Never `git add -f`
one, and never move one somewhere tracked to get it committed.

**What survives the task goes in the commit body, or into an architectural doc.** A decision worth
keeping is worth putting where it will be found: `CLAUDE.md`, `docs/0*.md`, `docs/design/`, or this
file. "It is written down in the plan" is not written down.

Tracked under `docs/` and staying that way: `01-architecture`, `02-domain-rules`, `03-conventions`,
`design/design-system.html`, `local-setup`, `seed-exam-catalog`, `WORKFLOW.md` and this file. Adding
a document beside them is a deliberate change, not a side effect of finishing a task — ask first.

</docs>

## Data model

`prisma/schema.prisma` is the target of record and wins on any conflict. Raw SQL for what Prisma
cannot express (composite FKs, partial-uniques, CHECKs, triggers, GIN) goes in the migration by hand.

<invariants>

Never break these:

- OTP, sessions, device binding live in **Redis**, never the DB.
- Exactly **one S3 upload path** (MinIO locally), never branched by environment.
- No secrets in code; `.env.example` only. First super admin by **pure SQL**, no seed code.
- Mobile editable by **ADMIN only**. Aadhaar/PAN images **not stored** (verified booleans only).
- Feature keys are **code-owned** (`FEATURE_KEYS`), never UI-registered; super admin assigns
  permissions only.
- Live-test hot path off Postgres: client timer, autosave to Redis, BullMQ scoring, Redis leaderboard.

</invariants>

## Dates

**The institute runs on IST. Storage is UTC; every USE of a date is `Asia/Kolkata`.**

An instant (`createdAt`, `startedAt`, `endsAt`) stays `timestamptz` and serialises with
`.toISOString()` — correct, no helper needed. A CIVIL date (what day is it, which day did this fall
on, when does a day start and end) is never derived with `getUTC*` or `toISOString().slice(0, 10)`
on a stored instant: UTC is 5.5 hours behind, so it is wrong every night between midnight and 05:30.

**Never write a new date helper.** There is one of each, and a second is a bug waiting for the day
the two disagree:

- `packages/contracts` — `INSTITUTE_TIME_ZONE`, `civilDate(at)`, `todayISO()`,
  `instituteWallTime(at)`, `fromInstituteWallTime(wall)`. Intl-based and dependency-free, because
  contracts ships to both SPAs.
- `apps/api/src/common/time/institute-day.ts` — `startOfInstituteDay`, `endOfInstituteDay`,
  `instituteDayOf`, `shiftInstituteDay`, `toDateColumn`, `fromDateColumn`. Uses `date-fns` and
  `@date-fns/tz`, which stay SERVER-ONLY — a date library in contracts lands in every student's browser.
- `apps/api/src/common/importing/date-cell.ts` — `toIsoDate` for a spreadsheet cell of unknown
  format. Validate the DATE, never the format.

A date range from a `YYYY-MM-DD` filter uses `startOfInstituteDay`/`endOfInstituteDay`, never a
hand-built `T00:00:00.000Z`. Anything shown to a user passes `timeZone: INSTITUTE_TIME_ZONE`, never
the device's default. A `@db.Date` column is a civil date at UTC midnight — a storage convention,
not a timezone, so use `toDateColumn`/`fromDateColumn` and do not "fix" it to IST. `packages/ui`
holds no zone: it is design, so a picker's dates are UTC-built civil dates and an app that needs a
clock passes `min`/`max`.

## API

One envelope (types in `packages/contracts`). Success: `{ success: true, data, meta }`. Failure:
`{ success: false, error: { code, message, fieldErrors? }, meta }`.

Controllers return data or `throw AppException(ErrorCodes.X, …)`; never build the envelope — the
interceptor wraps, the exception filter maps. Add a new code once to `ErrorCodes` in
`packages/contracts/src/envelope.ts`, with its status and default message beside it.

React to `error.code`, never a message string. `fieldErrors` feed react-hook-form.
`meta.requestId` on every response; list endpoints add `meta.page/pageSize/total`. Make the importer
forgiving: preview + row-level errors, commit only valid rows.

## Tooling

Fetch the docs with the `context7` MCP before writing third-party library code. Prisma, NestJS,
TanStack Query, react-hook-form and shadcn/ui have all moved since training — never write an API
surface from memory, and never carry over a deprecated signature.

Read the SonarQube MCP metrics for a file before you change it, not only before the commit. Leave it
with fewer smells than you found; the pre-commit gate is the floor, not the target.

Run a rewrite through the `code-simplifier` skill when the replacement branches more than what it
replaced. Cognitive complexity is the thing being reduced, not line count.

`graft` holds this repo's TypeScript and JavaScript as a wiring graph — every symbol with its exact
span and its call edges. **Query it before you grep or open a file.** `graft grep "<symbol>"` is
exhaustive and ranked by coupling where a ranked `ask` is only top-N; `graft callers <sym> --depth
2` is the blast radius to read BEFORE a rename or a signature change, and `--depth all` before a
multi-file refactor; `graft skeleton <file>` is a file's API for a tenth of the cost of reading it.
One call replaces a search subagent — a sweep for every use of `enrolledExams` is 170 hits across 33
files for ~4k tokens instead of ~127k. Prefer those three: they read the graph and are exact. `ask`
is prose retrieval and is only as good as the concept layer `graft build --deep` writes.

**It parses TypeScript and JavaScript and nothing else.** `prisma/schema.prisma`, the hand-written
SQL under `prisma/migrations/`, and everything in `docs/` are invisible to it — and the schema is the
target of record, so read those directly and never take graft's silence for absence. `graft/` is a
local cache: git-ignored, rebuilt by `graft build`, never committed, and its cards lag a same-turn
edit even though the tools do not.

## Code style

<comments>

Default to no comment — only an external constraint, a genuinely surprising line, or an invariant
the types cannot carry. **ONE line. Never two.** If it does not fit on one line, the code needs a
better name, not a longer comment. Never "what changed".

`scripts/check-comments.mjs` runs in `pre-commit` and fails the commit on any multi-line comment in
the lines you add; `-----`/`=====` section banners are exempt, and a file's top block only up to 6
lines — it is a map, not somewhere to move the essay the one-line rule just refused. Comments
already in the repo are grandfathered until you touch one.

Explaining what the code does is never a reason — rename the thing instead. If you are composing a
justification for a comment, that is the signal to delete it; delete one once its rule lives here or
in a test. `prisma/migrations/**/*.sql` is exempt: a migration is a historical record nobody edits
again, so explain the data move at the top of the file, in as many lines as it takes.

</comments>

No magic strings — any string used twice, or that a typo breaks silently, is a
`SCREAMING_SNAKE_CASE as const` object with its type derived from it. Cross-app:
`packages/contracts` (`ErrorCodes`, `ActorTypes`, `FORM_LEVEL_FIELD`). Server-only: next to its
owner (`QUEUE_NAMES`, `NODE_ENVS`, `OTP_SENDERS`, `PRISMA_ERROR_CODES`, `redisKeys`, `AUTH_ROUTES`).
Per-SPA: `apps/<app>/src/lib/constants.ts`. Exempt: user-facing copy and log messages.

**A screen names things; it does not explain itself.** `PageHeader` and `FormSection` have NO
`description` prop — they take `meta`, for a value the record carries. Prose there is a type error
as you write it, not a gate you meet later. A `hint` is a real string, so
`scripts/check-ui-copy.mjs` in `pre-commit` is the backstop for the one case types cannot see: a
hint whose words are already in its label.

<ui-work>

**Before writing or changing any UI, invoke the `ui-conventions` skill — its rules are binding and
admit no deviation.** It carries the shared-code and UI-behaviour rules (component placement,
list-screen shape, page frames and scrolling, when a card is warranted, the nav, `ListView` and the
filter spec, `FormDialog` for creating one entity, `Combobox` for every dropdown, `DatePicker` for
every date, row actions behind one menu, `TruncatedText` in every cell, confirm dialogs, loading
states, pagination, chips), and it binds subagents too.

The floor, with or without it: design values from `packages/ui` tokens only, never a raw hex; check
`packages/ui` + `packages/app-kit` before writing any UI; confirm destructive actions with
`ConfirmDialog`, naming the consequence + count.

</ui-work>

Fewer moving parts beats "best in class". Protect the data model and live-test scaling; iterate
freely on UI and copy.

## Tests

`node:test` + `node:assert/strict`, named after the unit (`auth-pin.unit.test.ts`,
`envelope.e2e.test.ts`), no Postgres/Redis/S3 (extend `apps/api/test/support/fakes.ts`).

**Tests are for FEATURES and the invariants above — not for every fix.** A feature, a rule the data
model depends on, or logic with branches worth naming gets a test in the same commit, covering the
happy path **and** the failure the change prevents. Anything else — a spacing or colour change, a
copy edit, a build or config repair, a date formatting tweak — gets no test. **Say what to verify on
screen and let the reviewer verify it.** An untested minor fix is finished; the missing test is not
a gap to apologise for.

<not-a-test>

Never assert an implementation the types or the eye already cover. A test that `readFileSync`s a
component to look for a Tailwind class, greps `apps/` to prove nobody hand-rolled a widget, or pins
a string in `tokens.css` is not a test — it is a lint rule wearing a test's clothes: it fails on
harmless refactors and passes while the screen is broken. A rule worth enforcing mechanically
belongs in ESLint or the type system.

</not-a-test>

Assert the guarantee, not the implementation. Do not edit the golden invariant suite. `pnpm test` is
a release gate and stays green.
