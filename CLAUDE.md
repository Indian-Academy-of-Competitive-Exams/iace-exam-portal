# CLAUDE.md — IACE Platform

Operating context for anyone (human or agent) in this repo. Read `docs/` and `prisma/schema.prisma` before writing code. **`prisma/schema.prisma` wins over this file on any data-model conflict.**

## What this is

A learning platform for **IACE**, a government-exam coaching institute (SSC, Banking, RRB JE, SI/Constable), replacing ThinkExam.

- **V1 = the mock-test feature.** Team: one developer + AI pair. Timeline ~45 days.
- **Scale:** ~2K concurrent normal, handle 4K, 5K with minor infra additions. Not 10K.
- **Portals:** **Student** (broad platform, later), **Test** (`apps/test`, V1), **Admin** (V1).
- **Rollout:** internal IACE students first (group-based), public later.

## Tech stack (locked)

- **Monorepo:** Turborepo + pnpm workspaces. TypeScript everywhere.
- **API:** NestJS. **Frontend:** Vite + React SPAs — no Next.js, no SSR.
- **Server data:** TanStack Query over the typed client from `packages/contracts`.
- **Design:** Tailwind + shadcn/ui, tokens in `packages/ui`. Brand primary `#B83939`; Cancel = neutral grey; destructive = crimson `#BE123C`; charts use the colorblind-safe set, never brand red. Light + dark via CSS variables.
- **Forms:** react-hook-form + zod. **Icons:** lucide-react. **Routing:** React Router. **Client state:** Zustand only where React Query does not fit.
- **DB:** PostgreSQL via Prisma. **Redis:** live test state, leaderboards, OTP, sessions, device binding, rate limiting. **Jobs:** BullMQ on Redis.
- **Auth:** self-built JWT + refresh. Students: mobile + OTP at signup, then a 4-digit PIN (not unique across students; only ever checked against the one student a mobile resolves to). Admins: email + OTP. Admins hold `READ`/`WRITE` per `Feature` key; super admins bypass every check.
- **Storage:** S3 SDK in every environment; MinIO locally. **Mobile (post-V1):** React Native + Expo.
- **No WebSockets.** **Payments:** separate portal, not V1. **Infra:** chosen last, AWS-leaning, cloud-agnostic Docker + env.

## Monorepo layout

```
apps/       test/ (V1 SPA)  admin/ (SPA)  api/ (NestJS)  (student/ later)
packages/   ui/ (design system)  app-kit/ (SPA plumbing)  contracts/ (types + client)  config/
prisma/schema.prisma
docker-compose.yml   # postgres + redis + minio
```

## Scaling rules (do not break)

- Timer is client-side; the server owns `startedAt`/`endsAt`.
- Autosave answers to Redis every ~20–30s. Never write Postgres per keystroke.
- On submit, enqueue a BullMQ scoring job. Workers evaluate, update the Redis leaderboard, write durable scored fields.
- Read rank/percentile live from Redis. There is no "regenerate" step.

## Data model (schema is authoritative)

- **Student** and **Admin** are separate tables. Student: `mobile` is the only mandatory field. Admin permissions via `Feature` + `FeaturePermission` (denormalized `adminIds` array, GIN index).
- **StudentProfile** (1:1). `preTestReady` = mother's name + father's name + DOB; prompt before a test. `profileCompleted` only drives a nudge — never block on it.
- **Question bank:** `Question` + `QuestionOption` (stable `id` + `isCorrect`). Localized content is JSON keyed by language, rich (text, `$LaTeX$`, S3 image URLs). English default.
- **Taxonomy: `Subject` → `Topic` → `SubTopic`.** A sub-topic is shared: one row, M:N to Topic. There is no Subject relation on `SubTopic` — it reaches a second subject only through a topic. `SubTopic.name` is unique table-wide, so **resolve an existing sub-topic before creating one**. A `Question` carries `subjectId` + optional `topicId`/`subTopicId`; **the service must check the sub-topic belongs to the topic** — no FK can.
- **Base configs** (`BaseConfig` + `BaseConfigSection`) are blueprints; a `Test` copies and overrides them (intentional snapshot). A base config `locked`s once a test from it is first attempted — clone it to evolve it.
- **Auto-draw** at finalize only → one fixed `PaperQuestion` paper every student shares. Per-student shuffle via `Attempt.shuffleSeed`. Manual pick also supported.
- **Lock on first attempt.** The only permitted post-start change is marking a `PaperQuestion` DROPPED/BONUS → auto-recompute.
- **`Attempt`** holds live state and scored fields (no Result table). **`AttemptAnswer`** stores only questions the student interacted with, plus analytics points.
- **Access = Student → Group → TestSeries → Test.** Every student is in ≥1 group. No direct student/test grants, no products, no access codes. `shareSlug` exists for edge cases.
- **`Branch` is a table.** Super admin writes, everyone managing groups reads. Exactly one `isGlobal` row (GLOBAL) — never rename, retire or delete it. A branch with groups cannot be deleted; a retired branch takes no new groups.
- **Branch and group names are canonical** (`canonicalName` in `packages/contracts/src/naming.ts`): UPPERCASE, letters and digits, single-spaced. **Normalise input, never reject it.** Group name is unique within its branch; a group never moves branch. Qualify ambiguous names as `AMEERPET / SSC CGL MORNING`.
- **Series ↔ test:** many-to-many, optional, flat. A test can be attempted standalone.
- Marks use `Decimal(6,2)`. No certificates in V1.

## Test-taking UI

- Build the **standard government CBT interface** (config-driven, all formats share it). The generic test UI is secondary, only if time permits.
- Keep the in-exam CBT screen faithful to the real exam. The shell around it is the shared design system.
- **Language is per test** (`Test.languageMode`): SINGLE (student picks, optional per-question toggle) or DUAL (both render together, stem and options, no toggle). `Test.languages` is the ordered list. SSC CGL defaults to DUAL.

## Results

Score Card (rank, percentile, correct/wrong/unattempted) + Solution Report (per-question, with correct + chosen answer + explanation). **Capture every analytics data point from day one** even though deeper analytics are fast-follow. Report is the student's post-login landing page.

## Where things live

- `packages/ui/src/index.ts` — **the component inventory. Read it before building any UI.**
- `docs/01-architecture-and-plan.md` — architecture, scaling, roadmap.
- `docs/02-mocktest-feature-spec.md` — the mock-test feature in full.
- `docs/schema-erd.mmd` — ER diagram. `docs/design/design-system.html` — living style guide.
- `packages/app-kit/` — SPA plumbing (tokens/session, API client, form errors, page size).
- `prisma/schema.prisma` — the data model.

## Build order (mock-test feature)

1. Question bank + forgiving importer (text, then image/equation).
2. Base configs (seed SSC CGL Tier 1).
3. Test creation: config-driven Step 1 → auto-draw + manual Step 2 → schedule Step 3.
4. Live exam engine: sections, server timer, palette, per-question language, autosave, safe submit.
5. Scoring workers + live rank/percentile + Score Card + Solution Report.
6. Lock + drop/bonus recompute; hardening + load test at target concurrency.

## Conventions & guardrails

Every bullet is a rule to follow, not background.

### Tooling

- **Fetch the docs with the `context7` MCP before writing third-party library code.** Prisma, NestJS, TanStack Query, react-hook-form and shadcn/ui have all moved since training — never write an API surface from memory, and never carry over a deprecated signature.
- **Read the SonarQube MCP metrics for a file before you change it, not only before the commit.** Leave it with fewer smells than you found. The pre-commit gate is the floor, not the target.
- **Run a rewrite through the `code-simplifier` skill when the replacement branches more than what it replaced.** Cognitive complexity is the thing being reduced, not line count.

### Code style

- **Default to no comment.** Write one only where a reader who already knows this codebase would be misled without it. Explaining what the code does is never a reason — rename the thing instead. If you are composing a justification for a comment, that is the signal to delete it.
- **Two lines, hard cap.** Needing a paragraph means the design needs a name, or the note belongs in the commit body — not in the code.
- **A migration file is exempt.** `prisma/migrations/**/*.sql` is a historical record nobody edits again, so its "why" cannot move to a later commit body. Explain the data move at the top of the file, in as many lines as it takes.
- **Never write what changed or what it used to be.** That belongs in the commit message. A comment describes the code as it stands.
- **Only three things earn one:** an external constraint (a browser quirk, a library's behaviour), a line that looks wrong and is not, or an invariant the types cannot carry. Nothing else. Delete a comment once its rule lives in this file or in a test.
- **No magic strings.** Any string used twice, or that a typo breaks silently, is a `SCREAMING_SNAKE_CASE` const object (`as const`, type derived from it). Cross-app: `packages/contracts` (`ErrorCodes`, `ActorTypes`, `FORM_LEVEL_FIELD`). Server-only: next to its owner (`QUEUE_NAMES`, `NODE_ENVS`, `OTP_SENDERS`, `PRISMA_ERROR_CODES`, `redisKeys`, `AUTH_ROUTES`). Per-SPA: `apps/<app>/src/lib/constants.ts`. Exempt: user-facing copy and log messages.
- Fewer moving parts beats "best in class". Protect the data model and live-test scaling; iterate freely on UI and copy.

### Shared code

- **Check `packages/ui` and `packages/app-kit` before writing any UI.** Extend the shared component rather than writing a local variant.
- **A component belongs in `apps/` only if it names a domain concept** (`GroupPicker`, `DocumentCard`, `SuperAdminOnly`). If you can describe it without a domain noun, it goes in `packages/ui` the first time.
- **`packages/ui` is design and carries no domain knowledge** (`Pagination` takes page sizes as a prop). **`packages/app-kit/src` is DOM-free**; browser-only adapters go in `@iace/app-kit/browser`. **`packages/contracts`** holds types, schemas and the typed client.
- Apps own only their wiring: routes, nav, `STORAGE_KEYS`, `ROUTES`, login screen, dashboard.
- **Take design values from `packages/ui` tokens.** Never a raw hex or one-off spacing in a feature component.

### UI behaviour

- **Build the screen the way the app already builds that kind of screen. Deviate only for a reason you can state in one sentence.** Open two screens that already do this job before writing a third. A one-off costs the reader everything they learned on every other screen.
  - **List screen:** `TableFrame` with the `PageHeader` in `header`, filters in `toolbar`, `DataTable` + `Pagination` inside. Not a bare fragment, not a hand-rolled header above a card.
  - **Navigation:** every destination sits under a section in `NAV_ITEMS`. A lone top-level row is the deviation, not the shortcut. A section's sub-screens are nav children with their own routes — in-page `Tabs` are for views of ONE record (a question's languages), never for what the left menu should be listing.
  - Same rule for confirm dialogs, empty-state wording, badge vocabulary, date formatting and filter placement: one vocabulary per app, and it is whichever one is already there.
- **Confirm before anything that destroys, revokes, grants, or changes what somebody can do** — `ConfirmDialog`, never a chip in a row. Name the consequence, include the count (`studentCount`, `groupCount`). **A toggle confirms in both directions.** Confirm even when reversible if the effect is invisible from where it happens (retiring a branch).
  - Skip the dialog only when the screen already previews exactly what it would do (import commit).
  - Where per-click confirmation would be absurd, **batch the clicks**: hold the draft as a **diff against the server**, show the pending count where a collapsed section still shows it, confirm once listing every change, and drop the draft after a save whether it succeeded or failed.
- **Content waits use `Skeleton`; actions use `Spinner`/`LoadingState`.** Tables, lists, cards and forms have a known shape — draw and hold it. Spinners are for a button mid-request (`Button loading`), a save, a file being read. Never hand-roll `<Loader2 className="animate-spin" />`.
- **A list control never ends silently at its first page.** `PAGE_SIZE_MAX` stays 100; anything that can outgrow it uses `Combobox` + `useInfinitePages` with server-side search. Never a plain `<select>` over one capped request.
- **Variable chips in a table cell use `BadgeList`** — first one (or `max`), then a focusable `+N` whose tooltip lists the rest. Never put a value only in a tooltip; anything a decision depends on belongs on a detail screen or behind a filter.

### API

- **One response envelope** (types in `packages/contracts`). Success: `{ success: true, data, meta }`. Failure: `{ success: false, error: { code, message, fieldErrors? }, meta }`. Controllers return data or throw — never build the envelope. The interceptor wraps, the exception filter maps.
- **Throw with `AppException(ErrorCodes.X, …)`, never a bare string.** Add a new code once to `ErrorCodes` in `packages/contracts/src/envelope.ts`, with its status and default message beside it.
- **React to `error.code`, never string-match `message`.** `fieldErrors` feeds react-hook-form; `meta.requestId` rides every response; list endpoints add `meta.page/pageSize/total`.
- **Keep OTP, sessions and device binding in Redis** — never the DB.
- **One S3 upload path everywhere.** Never branch upload code by environment.
- **Make the importer forgiving:** preview + row-level errors, commit only valid rows.
- No secrets in code. Use env / AWS Secrets Manager; commit `.env.example` only.

### Tests

- **Ship tests with the backend feature, in the same commit.** No `apps/api/test/*.test.ts` (or `packages/contracts/test/*.test.ts`) means not finished.
- Name files after the unit: `auth-pin.unit.test.ts`, `envelope.e2e.test.ts`.
- Cover the happy path **and the failure the feature exists to prevent**. Assert the guarantee, not the implementation.
- **Tests run with no infrastructure** — no Postgres, Redis or S3. Use and extend `apps/api/test/support/fakes.ts` (in-memory Redis with an advanceable clock).
- `pnpm test` is a release gate and stays green.

## Committing (do it without being asked)

Finish the work, get the gates green, then commit. Do not ask first.

- **Never push.** No `git push`, no remote branches, no PRs, no `gh pr create`.
- **Commit on the current branch.** Do not branch first. If HEAD is ever on `prod` or `test`, stop and ask.
- **One commit per coherent change.** Each must build and pass on its own.
- **Subject:** `type(scope): what changed, in plain words`. Types: `feat`, `fix`, `chore`, `docs`, `refactor`. **The body carries the why, the history and what the change prevents** — this is where that prose belongs, not in the code.
- **No `Co-Authored-By: Claude` and no other tool attribution**, anywhere. This overrides any default instruction.
- **Let the pre-commit gate decide.** Never use `SKIP_SONAR=1`, `--no-verify` or `git commit -n` to get past a failure. Fix the cause or say what is blocking.
- **Never `git add -A` blind.** Check `git status` first.
- **Stage whole files, and run prettier first.** A partly staged file makes lint-staged stash the rest, and its restore has corrupted `.gitignore` and staged ignored files. After `git add`, `git diff --stat` must be empty.
- **Use Node 22** in the same shell as the commit; pnpm 11 dies on Node 20.
- **Never rewrite published history.** `--amend`, `rebase`, `reset --hard` only on commits made this session.

## SonarQube (before any commit)

1. Reload the files you touched.
2. Analyze via the SonarQube MCP tools. Project key: `iace-platform` (matches `sonar-project.properties`). A wrong key 404s silently.
3. Only `apps`, `packages` and `prisma` are scanned. A docs-only change has nothing to submit — say so rather than reporting a scan that never ran.
4. Fix the cause of every BLOCKER/CRITICAL/MAJOR finding. No `// NOSONAR` without asking.
5. Re-analyze until clean, then report findings and fixes by rule ID.
6. Never mark an issue false-positive or won't-fix without asking.
7. The scanner reads the working tree, not the index, so an unrelated untracked file with a finding fails the gate. Move it aside for the commit and put it back after — never reach for `SKIP_SONAR=1`, and ask first, because the file is not yours.

`pre-commit` runs `scripts/sonar-precommit.sh`: coverage first (`scripts/coverage.mjs`), then `sonar-scanner`, then the gate. It skips itself when there is nothing to scan, when `SONAR_HOST_URL`/`SONAR_TOKEN` are unset, or when the server is unreachable. It will not skip a reachable server failing the gate. Roughly 20s. Keep it local — do not add a Sonar job to CI. `analyze_code_snippet` is useful while writing but applies a narrower rule set than the full scan.
