# 03 — Conventions: boundaries, ownership, events

Where code goes, which module owns which table, and what events exist.

The data model is `prisma/schema.prisma` and is not restated here — no columns, no table
definitions. Stack, scaling and deployment are `docs/01-architecture.md`; the rules the domain
enforces are `docs/02-domain-rules.md`. On conflict the schema wins for data, this doc for structure.

> **The section numbers are an interface.** Source comments cite them as `docs/03 §N`, sub-sections
> resolve against the numbered rules under a section, and `pnpm docs:check` fails on a citation that
> lands nowhere. Renumbering is a breaking change; adding at the end is not.

---

## 1. What the structure buys

One developer with agents. The leverage is in not building anything twice, and in not having to
unpick a boundary after ten modules have hardened on it.

- **One home per reusable thing.** Apps and modules stay thin.
- **Boundaries before hardening.** A module drawn as a bounded context becomes a service by gaining
  an entrypoint, not by being rewritten.
- **A DOM-free logic tier.** A future Expo app reuses the logic packages untouched.
- **Enforcement over discipline.** A rule lands as a lint rule or a CI step, or it does not land.

**Rule of three.** Nothing is abstracted below three real uses. Deliberately not doing:
microservices now, a generic resource-CRUD framework, more than ~3 services, or commonizing things
that legitimately differ — login flows, dashboards, per-app nav and constants, domain logic.

---

## 2. Packaging — where a thing lives

| Layer                 | Package                          | Holds                                                                                                                                                                                | Mobile reuses |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Shapes                | `packages/contracts`             | Per-endpoint zod schemas and inferred types, the envelope and error codes, canonical naming, shared enums, the typed client.                                                         | yes           |
| DOM-free logic        | `packages/app-kit`               | React and logic with zero `window`/`document`/`localStorage`: API client, token-store interface, query client, form-error mapping, list and pagination hooks, the auth factory, nav. | yes           |
| Web UI                | `packages/ui`                    | Tailwind + shadcn components, design tokens, charts, the Tailwind preset. Web-only.                                                                                                  | no            |
| Tooling               | `packages/config`                | tsconfig, eslint and node presets, plus the enforcement lint rules of §12.                                                                                                           | n/a           |
| Backend cross-cutting | `apps/api/src/common` (+ `auth`) | Envelope interceptor, exception filter, request id, zod pipe, guards, throttling, messaging, metrics, the event bus, institute time, importer helpers.                               | n/a           |
| App entrypoints       | `apps/*`                         | Thin. Routes, nav, storage keys, login screen, dashboard — what genuinely differs.                                                                                                   | —             |

**The portability rule:** anything a future mobile app could reuse must not touch the DOM.
`contracts` and `app-kit/src` are DOM-free; `ui` is web-only and mobile never imports it.

---

## 3. Frontend rules

- **`app-kit` is DOM-free.** No `window`, `document`, `localStorage` or `sessionStorage` anywhere in
  the `src` of `app-kit` or `contracts`, enforced by lint (§12). Storage and the sign-out signal are
  injected adapters: `TokenStore` and `SignOutSignal` are the seam, the browser supplies a
  `localStorage`-backed store and a window-event emitter, Expo will supply SecureStore and its own.
  The browser adapters ship as `@iace/app-kit/browser` — one copy for both SPAs, outside `src/` so
  the lint rule's scope _is_ the boundary.
- **Scaffolding is shared, not copied.** The bootstrap and providers, `createAuth`,
  `ProtectedRoute`, and `AppShell` (chrome shared, nav injected) live in `app-kit` and `ui`.
- **Form and list kits are shared.** The field/form set wires react-hook-form + zod + the envelope's
  `fieldErrors`; `useListQuery` and the list components cover paginated-list-with-filters. The
  binding placement and behaviour rules are the `ui-conventions` skill, not this doc.
- **Server data is TanStack Query over the typed client.** Zustand only where Query does not fit.

---

## 4. Backend module boundaries — the extraction rules

A module is a **bounded context**. Six rules make it extraction-ready:

1. **Public surface only.** A module exposes a facade — its `index.ts` barrel and the services it
   names. Siblings import _that_ barrel, never a path inside another module. Deep sibling imports
   fail lint (§12).
2. **Own your tables.** Each module owns a set of Prisma models and is the only writer (§5). Others
   read through the owner's facade or react to an event — never by reaching into another module's
   tables.
3. **Cross-module talk is an event (async) or a typed facade (sync).** A _query_ is a facade call; a
   _reaction_ is an event. Reactions must be events, because an event handler relocates to another
   service trivially and a direct method call does not.
4. **Infra is not domain.** `prisma`, `redis`, `queue`, `storage`, `config`, `common` and
   `contracts` are shared libraries that every service links and none of them becomes. Only domain
   modules are extraction candidates.
5. **Modules self-compose.** Each module declares its own infra in its `imports: []` and assumes
   nothing that only `app.module` provides. Extraction is then a new thin entrypoint mounting a
   subset, not a rewiring.
6. **Contracts is the wire.** When a module extracts, callers keep the same `@iace/contracts`
   schemas — the in-process typed call becomes an HTTP call with identical types.

**Live seams.** Each is a known crossing, named so it is not mistaken for the pattern:

- `students` ↔ `access` and `students` ↔ `configs` are true cycles, held open with `forwardRef`
  plus a deferred `module.require`. A student's programs and enrolments are validated against
  catalogs those modules own, and both catalogs must refuse a delete a student still depends on. The
  cycle closes only when one direction becomes an event.
- `auth` reads `Admin` rows directly for the login and `me` paths. The grant lookup already routes
  through `AdminsService`, which is the pattern; the two identity reads predate the split.
- `configs` counts a stage's and a base config's `Test` rows through `_count` to block a delete.
  `tests` exists, so this is a read that belongs behind a `TestsService` facade.
- `access` counts students carrying a program to block its delete. `Student.programs` is free text
  with no foreign key, so that count is the only thing between a rename and a silent detach across
  every student — route it through `StudentsService`.
- `access` reads `Test` to resolve a student's catalog and to block deleting a series that still
  holds tests. `tests` is the only writer, and it emits `access.catalog_changed` on every offering
  write, so the cache cannot go stale behind it; the read is what still wants a facade.
- `me` aggregates `students`, `auth`, `access` and `notifications`. This is the one to copy —
  everything arrives through a module barrel.

---

## 5. Table-ownership map

Only the owning module writes these tables. Every model in `prisma/schema.prisma` appears here: a
model with no owner is a model any module may quietly start writing, which is how the boundary
erodes.

| Module        | Owns (Prisma models)                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| admins        | `Admin`, `AdminFeaturePermission`                                                                                                                                          |
| students      | `Student`, `StudentProfile`, `StudentConsent`                                                                                                                              |
| branches      | `Branch`                                                                                                                                                                   |
| access        | `Program`, `TestSeries`, `StudentGrant`                                                                                                                                    |
| events        | `Event`, `EventCandidate`                                                                                                                                                  |
| questions     | `Subject`, `Topic`, `Question`, `QuestionVersion`                                                                                                                          |
| configs       | `Exam`, `ExamStage`, `BaseConfig`, `BaseConfigModule`, `BaseConfigSection`                                                                                                 |
| tests         | `Test`, `PaperQuestion`, `TestProgramUnlock`                                                                                                                               |
| attempts      | `Attempt`, `AttemptQuestion`, `PerformanceShare`, `OutboxEvent`, `ProcessedRollup`, `StudentStat`, `StudentSubjectStat`, `TestStat`, `TestSectionStat`, `TestQuestionStat` |
| audit         | `RowActionLog`, `ImportLog`                                                                                                                                                |
| notifications | `Notification`                                                                                                                                                             |

`auth`, `imports`, `me` and `health` own no table. The rollups belong to `attempts` because the
scoring path is what writes them — every aggregate is derived from a sitting, so the module that
owns the sitting owns the derivation.

**Writes that cross the map**, each one a rule-2 exception with a reason:

- `auth` and `imports` both create `Student` — signup and the roster import. Both borrow the
  students module's rules (the starting PIN, the pre-test-ready check) but issue the write directly.
- `imports` and `questions` create `ImportLog`; `audit` only reads it back for the log viewer.
- `attempts` sets a `BaseConfig` locked on the first sitting. The lock is an attempt's effect and
  `configs` has no way to learn that a paper was sat.
- `tests` moves a `Question` in-use counter on finalize and on thaw. Being depended on is what
  freezes a question, and only the freeze knows.
- the outbox prune worker in `apps/api/src/common/events` deletes relayed `OutboxEvent` rows. It is
  the one crossing that is infra rather than domain: retention is a property of the buffer, not of
  the module that fills it, and a pruner that lived in `attempts` would not travel with the queue.

**`PerformanceShare` is the one unauthenticated route to student data in the platform.** A row is a
revocable public link onto one sitting's curated report, addressed by a random token rather than by
its cuid id, which is time-ordered and walkable. `GET /public/reports/:token` is the only
unauthenticated route outside auth, health and the token-gated metrics scrape; minting and revoking
both need a signed-in identity, and either the student or an admin holding `STUDENT_PERFORMANCE` may
revoke. Revocation and expiry are read on the same request that would have served the payload, and
every refusal — unknown, revoked, expired, sitting gone — answers in identical words, so nothing is
learnt from being told no. The payload is a whitelist in `packages/contracts/src/shares.ts`: the
shared student's own name, branch, marks, standing, an anonymous cohort distribution and section
scores. Never an answer key, never per-question correctness, never a second student — the
leaderboard's named rows stay signed-in-only. The attempt foreign key restricts deletion, so a link
can never outlive what it opens.

**There is no group table and access is not a link row.** A series' `kind` decides who reaches it:
FREE reaches everyone; STANDARD reaches a student whose current branch is on the series' branch list
_and_ whose enrolled COURSE matches the series' stage; PROGRAM reaches a program the student
carries; EVENT reaches the candidates on its event. **The branch gate belongs to STANDARD alone** —
the other three kinds and a `StudentGrant` carry no branch condition. A grant overrides every kind,
and the series' own enabled switch gates all of them. There is no unlock, no prerequisite, no queue
to ask in. Sessions, OTP and device binding live in **Redis**, never Postgres.

---

## 6. Event catalog

**The bus is `DomainEventBus` over Nest's event emitter**, with every name declared once in
`apps/api/src/common/events/event-catalog.ts` as `DOMAIN_EVENTS`, typed against a payload map so a
producer cannot publish the wrong shape and a handler cannot claim one that is never sent. That
constant is the catalog; this table is its prose, and the two are edited together.

**Wired** means something emits it and something reacts. **Declared** means the name and the payload
type exist and nothing yet does either — no producer, no `@OnEvent`. A declared name is a reserved
shape, not a half-built path. **Announced** means something emits it and nothing subscribes, by
design: the work the name describes has already been done inline by the producer, and the event is
there for whatever wants to hear about it later.

| Event                                           | Producer                                                                                                      | Consumers                                    | State     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------- |
| `audit.row_action`                              | the audit interceptor, on every write carrying `@Audit`                                                       | audit (writes `RowActionLog`)                | wired     |
| `student.signed_up`                             | auth, on the signup that created the row                                                                      | students (records the platform consent)      | wired     |
| `student.pin_reset`                             | auth, both reset paths                                                                                        | —                                            | announced |
| `student.access_changed`                        | students (enrolments, programs, branch, block, deactivation), access (grant / revoke), events (roster change) | access (busts that student's cached catalog) | wired     |
| `access.catalog_changed`                        | access (series write), tests (finalize and every offering write)                                              | access (busts every cached catalog)          | wired     |
| `student.enrolment_added`                       | students, carrying only the exam codes one save ADDED                                                         | notifications                                | wired     |
| `series.granted`                                | access, on a grant that did not already exist                                                                 | notifications                                | wired     |
| `scoring.completed`                             | the scoring worker                                                                                            | notifications (result ready)                 | wired     |
| `attempt.submitted`                             | —                                                                                                             | —                                            | declared  |
| `test.assigned`                                 | —                                                                                                             | —                                            | declared  |
| `paperQuestion.dropped` / `paperQuestion.bonus` | —                                                                                                             | —                                            | declared  |

Submit and scoring do not go through the bus: they go through `OutboxEvent` and the BullMQ scoring
queue, which is the durable path and the right one for a write that must not be lost. The rollup
fold rides one of those outbox rows, and the row's type string reuses the `scoring.completed` name —
same words, different mechanism, and the bus never sees it. The declared names are reserved for the
reactions that would layer on top of the durable path: a notification on submit, a notification when
a test is assigned, a rescore when a paper question is dropped or made a bonus.

Rule: any cross-module _reaction_ goes through this catalog as an event, not a direct call.

---

## 7. Service tiers — deploy few, design many

| Tier                                  | Modules                                                                                                        | Scales on              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Core / admin** (one deployable)     | auth, admins, students, branches, access, events, imports, questions, configs, tests, audit, me, notifications | admin traffic, modest  |
| **Exam service** (autoscale)          | attempts — the sitting engine only                                                                             | concurrent test-takers |
| **Worker service(s)** (autoscale)     | scoring, rollups, import processing, leaderboard, drop/bonus recompute                                         | BullMQ queue depth     |
| **Shared libraries** (never services) | prisma, redis, queue, storage, common, config, contracts                                                       | —                      |

Today everything ships as core plus the worker. Attempts is the first extraction candidate: its
request path is Redis-first, so it is stateless and cheap to autoscale.

**A separate service is not a separate database.** Extract a service that still shares Postgres
first; split its data only if load demands it. The two are independent decisions.

---

## 8. Autoscaling readiness

Every autoscale candidate must satisfy all of these:

- **Stateless** — no sitting, session or timer state in process memory. It lives in Redis. This is
  the precondition everything else assumes.
- **Graceful shutdown** — `enableShutdownHooks()` in every entrypoint, so scale-in drains in-flight
  requests and disconnects Prisma and Redis cleanly.
- **Its own health and readiness** — the health module travels with each extracted service and
  wires the infra it reports on itself, rather than assuming a composed root.
- **A connection ceiling** — a pooler in front of Postgres before anything DB-touching autoscales.
  N instances times pool size exhausts `max_connections` long before the database is busy.
- **Idempotent writes on the hot path** — start, finalize and submit each re-derive the same row on
  a second call, because autoscale plus retries will deliver one twice.
- **Namespaced config** — env scoped per service, so exam scales without redeploying admin.

---

## 9. Conventions for a new model

Rules for what you write next; what already exists is in the schema.

- **Timestamps on every model** — `createdAt` and `updatedAt`.
- **Soft delete where a record must be recoverable or auditable**, hard delete only for pure join
  and ephemeral rows. Decide per model, and record the choice in the schema comment.
  - **`Admin` is the recorded exception.** It has no soft delete: the row is never removed because
    every created-by column points at it, and the active flag already carries the only state there
    is. Carrying both gave three auth paths a second flag to read as "gone", which silently denied
    sign-in to real accounts. Deactivate, do not delete.
- **One id strategy** across all models — the existing default; never mix.
- **Marks and money are one decimal shape**, rendered through one shared formatter so the API and
  both SPAs cannot disagree.
- **Institute time.** Instants are stored UTC and serialised as ISO; every civil date is
  `Asia/Kolkata` through the existing helpers. Never add a second date helper.
- **What Prisma cannot express** — composite foreign keys, partial uniques, checks, triggers, GIN —
  is hand-written SQL in the migration.
- **Canonical names.** Branch names and exam codes are canonical (`canonicalName` in
  `packages/contracts/src/naming.ts`): UPPERCASE, letters and digits, single-spaced. Normalise the
  input, never reject it — a name typed in lower case is the same branch, not a validation error.

---

## 10. Cross-cutting backend

Built and in use. Reach for these rather than adding a second of any of them.

- **One outbound abstraction.** `MessageSender` in `apps/api/src/common/messaging` is everything the
  platform sends outward: a channel (SMS, email, in-app), a kind, a recipient, and template data.
  Providers implement it — console in development, SMS and email in production — and a router picks
  one per channel, so a caller names the message and never the transport. Each kind maps to a
  template id in env; a kind with nothing configured simply does not send. OTP, the starting PIN a
  roster import issues, and result-ready are wired; test-assigned and test-reminder exist as kinds
  with no producer, because the event and the scheduled job behind them do not exist yet.
- **Rate limiting** is a Redis-backed throttler storage plus named limits carried by a decorator on
  the route, so moving a route cannot leave its limit behind — auth counted per address, the sitting
  path per student, a public share link per address.
- **Request context** is `AsyncLocalStorage` in the audit module, carrying the request id, the actor
  and the field diff into the audit record without threading them through every signature.
- **Metrics and errors** — a token-gated Prometheus scrape, and Sentry initialised before anything
  else loads so it can patch what it instruments.
- **Idempotence is a property of the write, not an interceptor.** Start resumes a live sitting,
  finalize reports the first finalize's outcome, submit recomputes off held state. A generic
  interceptor would hide which writes actually hold that guarantee.
- **Caching** is explicit: a JSON value under a versioned Redis key, busted by a counter that an
  event increments. There is no read-through helper, and a cache nobody can bust is worse than none.

---

## 11. Repo conventions

The pre-commit hook is the first line and CI is the backstop: a red pipeline ten minutes after a
push is a worse version of a check that takes five seconds before the commit exists.

- **lint-staged** formats per file, then runs lint and typecheck across the workspace through turbo.
  Neither is per-file by nature — eslint's flat config resolves from the working directory, and a
  project's types are a property of the whole project — and turbo's cache makes the untouched
  packages free.
- **Shell and Prisma get their own formatters**, being the two things prettier does not parse.
- **commitlint** on the message: the history is a changelog and a bisect target, and both stop
  working when the subject line stops saying what changed.
- **The script gates** run after lint-staged — one-line comments, screen copy that does not explain
  itself, and a real SonarQube scan with its quality gate. Never bypass one.
- **syncpack** (`pnpm deps:check`) keeps one version of a library across every workspace.

---

## 12. Governance — what is mechanically enforced

- **Module boundaries** — `packages/config/eslint-rules/api-module-boundaries.js`: a module may not
  import a path inside a sibling, only its barrel. Infra packages are importable by all.
- **No DOM** — `packages/config/eslint.no-dom.js`: the `src` of `app-kit` and `contracts` may not
  reference `window`, `document`, `localStorage` or `sessionStorage`.
- **Hot-path writes** — `no-hot-path-db-write.js`: the live sitting path may not write Postgres.
- **Destructive actions and screen prose** — `confirm-destructive.js`, `no-narration.js` and
  `react-conventions.js` hold the UI rules that types cannot.
- **CI gates** — format → deps:check → lint → typecheck → test → build, each running even if an
  earlier one failed, so one push reports every problem. A second job applies every migration to a
  scratch database from scratch and then checks the result still matches `schema.prisma`.
- **Doc drift** — `pnpm docs:check`: a name a doc backticks must exist in the schema or the
  TypeScript source, and a `docs/03 §N` citation must land on a section that exists. It is the one
  item here that is **not** a gate: it runs on a weekly schedule and blocks no commit and no push,
  deliberately, because prose lags a rename by hours and a doc nobody has caught up with yet is not
  a reason to refuse working code. It reports; a human clears the report.

A rule that isn't enforced by CI is a suggestion; prefer adding the check over adding a paragraph.
