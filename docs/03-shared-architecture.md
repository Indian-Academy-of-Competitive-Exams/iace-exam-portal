# 03 — Shared Architecture, Module Boundaries & Conventions

**Status:** authoritative. This document is the single source of truth for _what
is shared_, _how modules are bounded_, and _which conventions CI enforces_. New
code is built against this doc; existing code is brought into line with it. On
any conflict, `prisma/schema.prisma` still wins for the data model, and this doc
wins for structure, boundaries, and conventions.

> How to use it: before adding a package, a module, a table, or a cross-module
> call, check the relevant section here. If what you're about to do isn't
> allowed by these rules, either it belongs somewhere else or the rule needs a
> deliberate change (edit this doc in the same PR).

---

## 1. Objectives — what this buys us

**North star.** One integrated platform, built essentially solo, where the
maximum amount of code is shared and standardized across apps and (future)
services — so development is faster and we don't rebuild the same thing twice —
with the backend drawn into clean, bounded modules so that individual pieces
(the **exam** module first, plus the workers) can later become independently
**auto-scaling** services _without a rewrite_. **Deploy few now, design many.**

Four concrete objectives:

1. **Less dev time now** — one home for every reusable thing; apps and modules stay thin.
2. **No rework later** — boundaries are decided before more modules harden on the wrong shape.
3. **Mobile portability** — the shared _logic_ tier is DOM-free so mobile reuses it; web-only code is isolated.
4. **Extraction-readiness** — every backend module is a bounded context that can be lifted into its own auto-scaling service by adding an entrypoint, not rewriting logic.

The meta-goal beneath all four: **enforce this with lint/CI/conventions, not human discipline.** A new module should be _born compliant_; existing code should fail CI the moment it drifts.

**Non-goals (deliberately not doing):** microservices now; premature abstraction; commonizing things that legitimately differ (login flows, dashboards, domain logic); more than ~3 services.

---

## 2. The packaging model — where everything lives

| Layer                 | Package                          | Rule                                                                                                                                                                                      | Mobile reuses? |
| --------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Shapes                | `packages/contracts`             | Every endpoint's request/response zod schema + inferred types, error codes, route maps, shared enums. The wire format for in-process **and** future cross-service calls.                  | ✅ yes         |
| DOM-free logic        | `packages/app-kit`               | React/logic with **zero** `window`/`document`/`localStorage`. API client core, token-store interface, query client, form-error mapping, pagination hooks, auth factory, formatting utils. | ✅ yes         |
| Web UI                | `packages/ui`                    | Tailwind + shadcn components, tokens, presets. **Web-only.** Never imported by mobile.                                                                                                    | ❌ no          |
| Tooling               | `packages/config`                | tsconfig / eslint / tailwind / node presets + the enforcement lint rules below.                                                                                                           | n/a            |
| Backend cross-cutting | `apps/api/src/common` (+ `auth`) | Envelope, filters, request-id, validation pipe, guards, pagination/importer helpers. Linked by every backend module.                                                                      | n/a            |
| App entrypoints       | `apps/*`                         | Thin. Compose shared packages + app-specific screens/flows only.                                                                                                                          | —              |

**The single portability rule:** anything a future mobile app could reuse must
not import the DOM. `app-kit` and `contracts` are DOM-free; `ui` and `index.css`
are web-only. Enforced by lint (§13), not by memory.

---

## 3. Frontend rules

- **`app-kit` is DOM-free.** No `window`, `document`, or `localStorage` anywhere in `app-kit`/`contracts` `src`. Storage and the sign-out signal are **injected adapters**: the browser supplies a `localStorage` token store + a window-event emitter; Expo will supply SecureStore + its own emitter. The `TokenStore` and `SignOutSignal` interfaces are the seam. The browser adapters ship as `@iace/app-kit/browser` — one copy for both SPAs, outside `src/` so the lint rule's scope _is_ the boundary; mobile imports `@iace/app-kit` and never sees them.
- **Shared app scaffolding.** The bootstrap (`main`, providers, query/theme wiring), a generic `createAuth<TIdentity>({ endpoints, tokenStore })`, `<ProtectedRoute>`, and `<AppShell nav={…}/>` (chrome shared, nav injected) live in `app-kit`/`ui`. Apps do not copy these.
- **Shared form + list kits.** A `<Field>`/form-row set in `ui` wires react-hook-form + zod + envelope `fieldErrors`. A `<DataTable>` + `useListQuery` covers the paginated-list-with-filters pattern.
- **Kept app-specific (do not commonize):** login flows (student PIN/OTP vs admin email-OTP genuinely diverge), dashboards, per-app nav config and constants.

---

## 4. Backend module boundaries — the extraction rules

A module is a **bounded context**. Six rules make it extraction-ready:

1. **Public surface only.** A module exposes a facade (its module exports + a public service/interface); siblings import _that_, never a deep sub-path. No `../<sibling>/**/internal` imports.
2. **Own your tables.** Each module owns a set of Prisma models and is the only writer (see §5). Others read via the owner's facade (in-process now → HTTP later) or via events — never by reaching into another module's tables.
3. **Cross-module talk = events (async) or a typed facade (sync).** A _query_ is a sync facade call; a _reaction_ is an event. Reactions must be events, because an event handler relocates to another service trivially and a direct method call does not.
4. **Infra ≠ domain.** `prisma`, `redis`, `queue`, `storage`, `config`, `common`, `contracts` are shared **libraries every service links** — they do _not_ become services. Only _domain_ modules are extraction candidates.
5. **Modules self-compose.** Each module declares its own infra deps in its `imports: []` and assumes nothing that only `app.module` provides. Extraction then = a new thin `apps/<service>/main.ts` that mounts a subset.
6. **Contracts is the wire.** When a module extracts, callers use the same `@iace/contracts` schemas — the in-process typed call becomes an HTTP call with identical types.

**Known seams to clean (existing coupling):**

- `me` → `StudentsService` + `AuthService` — inherent aggregator, and the one to copy: both arrive
  through the module barrels (`../students`, `../auth`), never a reach into a file inside them.
  `imports` was the counter-example (`../auth/pin/pin.service`) and now goes the same way.
- `branches` ↔ `access` — a new branch needs a `BranchTestConfig` row for every series, and a new
  series one for every branch, so each module needs the other. Held open today with `forwardRef`
  plus a deferred `module.require`; the cycle only closes properly once one side reacts to an
  event rather than calling.
- `auth` → `Admin` rows directly (`prisma.admin.findUnique`) for the login and `me` reads. The grant lookup already routes through `AdminsService.permissionsFor`, which is the pattern; the two identity reads predate the split and are the remaining seam.
- `../auth/decorators` (`@Public`) is imported widely — acceptable as shared kernel; consider relocating the decorator to `common` so no module depends on the _auth module_ for a guard.
- `configs` → `Test` through `_count: { select: { tests: true } }` for the base-config deletion
  blocker. `Test` belongs to the tests/builder module, which does not exist yet, so there is no
  facade to ask. Becomes `TestsService.countByBaseConfig` when that module lands.
- `access` → `prisma.student.count` for the program deletion blocker. `Student.programs` holds the
  code as free text with no foreign key, so that count is the only thing between a rename and a
  silent detach across every student. Route it through a `StudentsService` facade method.
- `access` → `Test` / `TestSeriesTest` through `AccessResolverService`, which lists a series' live
  tests by joining the link rows and filtering on `Test.status`. Same shape as the `configs` → `Test`
  entry above: the tests/builder module does not exist yet, so there is no facade to ask. Becomes
  `TestsService.activeTestsInSeries` when that module lands — and that module must then emit
  `access.catalog_changed`, which nothing does for those two tables today.

---

## 5. Table-ownership map

Only the owning module writes these tables. `existing` = module built; `planned` = module to be created (tables currently live under a broader module until then).

| Module          | Owns (Prisma models)                                                       | State    |
| --------------- | -------------------------------------------------------------------------- | -------- |
| admins          | `Admin`, `AdminBranch`, `AdminFeaturePermission`                           | existing |
| students        | `Student`, `StudentProfile`                                                | existing |
| branches        | `Branch`                                                                   | existing |
| access          | `Program`, `TestSeries`, `StudentGrant`, `BranchTestConfig`                | existing |
| unlocks         | `StudentSeriesUnlock`, `SeriesUnlockRequest`                               | existing |
| question-bank   | `Subject`, `Topic`, `Question`, `QuestionVersion`                          | existing |
| configs         | `Exam`, `ExamStage`, `BaseConfig`, `BaseConfigModule`, `BaseConfigSection` | existing |
| audit           | `RowActionLog`, `ImportLog`                                                | existing |
| tests / builder | `Test`, `TestSeriesTest`, `PaperQuestion`                                  | planned  |
| exam (engine)   | `Attempt`, `AttemptQuestion`                                               | planned  |
| notifications   | `Notification`                                                             | existing |

`unlocks` is a service inside `access` rather than a folder of its own: an unlock is not a way to
REACH a series, so every one of its writes has to be checked against the reach predicate that lives
there. It keeps its own row in this table because the tables are still separately owned, and moving
it out later is a folder move rather than a rewrite.

**There is no group table, and access is not a link row.** A student reaches a `TestSeries` by an
exam match, a program match, or an explicit `StudentGrant`, and every one of those is then gated by
the `BranchTestConfig` row for their branch — which `access` owns. Auth sessions, OTP, and device
binding live in **Redis**, never Postgres.

---

## 6. Event catalog (the seam to build)

No event bus exists yet. Introduce Nest `EventEmitter` (or BullMQ for durable
events) and register cross-module reactions here. Seed set:

| Event                                           | Producer                                                                              | Consumers                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------- |
| `attempt.submitted`                             | exam                                                                                  | scoring-worker (enqueue), notifications     |
| `scoring.completed`                             | scoring-worker                                                                        | notifications (result ready), leaderboard   |
| `test.assigned`                                 | access/admin                                                                          | notifications                               |
| `paperQuestion.dropped` / `paperQuestion.bonus` | admin                                                                                 | scoring-worker (recompute)                  |
| `student.pin_reset`                             | auth                                                                                  | (sessions revoked — already handled)        |
| `branch.created`                                | branches                                                                              | access (fan out `BranchTestConfig`)         |
| `student.access_changed`                        | students (enrolments, programs, branch, block, deactivation), access (grant / revoke) | access (bust that student's cached catalog) |
| `access.catalog_changed`                        | access (series edit, delete, branch-config change)                                    | access (bust every cached catalog)          |
| `series.unlocked`                               | access (auto-unlock on resolve, approved request)                                     | notifications                               |
| `series.granted`                                | access (a grant that did not already exist)                                           | notifications                               |
| `student.enrolment_added`                       | students (the exam codes one save ADDED)                                              | notifications                               |

Rule: any cross-module _reaction_ goes through this catalog as an event, not a direct call.

---

## 7. Service scale tiers — deploy few, design many

| Tier                                  | Modules                                                                                                    | Scales on              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Core / admin** (one deployable)     | auth, admins, students, branches, access, imports, question-bank, configs, tests, audit, me, notifications | modest, admin traffic  |
| **Exam service** (autoscale)          | exam (attempt engine only)                                                                                 | concurrent test-takers |
| **Worker service(s)** (autoscale)     | scoring, import processing, leaderboard, drop/bonus recompute                                              | BullMQ queue depth     |
| **Shared libraries** (never services) | prisma, redis, queue, storage, common, config, contracts                                                   | —                      |

Today everything ships as the **core** deployable plus the **worker**. Exam is
the first extraction candidate; its request path is Redis-first (client timer,
server-authoritative `endsAt`, autosave to Redis, submit → BullMQ), so it is
stateless and cheap to autoscale.

**A separate service ≠ a separate database.** Extract a service that still
shares Postgres first; split its data only if load demands it. Service
extraction and data extraction are two decisions.

---

## 8. Autoscaling-readiness checklist

Every autoscale-candidate service must satisfy all of these:

- **Stateless** — no attempt/session/timer state in process memory (state lives in Redis). This is the #1 precondition.
- **Graceful shutdown** — `enableShutdownHooks()` in every entrypoint so scale-in drains in-flight requests and disconnects cleanly.
- **Per-service health/readiness** — the health module travels with each extracted service.
- **DB connection ceiling** — put a pooler (RDS Proxy / PgBouncer) in front of Postgres before autoscaling anything DB-touching; N instances × pool size can exhaust `max_connections`.
- **Idempotent submit** — an idempotency key on the exam submit path (autoscale + retries can deliver a submit twice).
- **Per-service config** — env namespaced so exam scales/deploys without redeploying admin.

---

## 9. Data-model conventions

- **Timestamps on every model:** `createdAt @default(now())` and `updatedAt @updatedAt` on all tables.
- **Soft-delete policy:** `deletedAt DateTime?` where records must be recoverable/auditable (Student, Question, Test, Branch, and other user-facing/domain records); hard delete is acceptable only for pure join/ephemeral rows. Decide per model and record the choice.
  - **`Admin` is the recorded exception — it has no `deletedAt`.** The row is never removed (`createdById` on everything they made points at it) and `isActive` already carries the only state there is. Carrying both gave three auth paths a second flag to read as "this row is gone", which silently denied sign-in to real accounts; in one database the column had also drifted to `DEFAULT CURRENT_TIMESTAMP`, so every new admin was born unreachable. Deactivate, do not delete.
- **IDs:** one strategy across all models (the existing default — do not mix).
- **Money/marks:** `Decimal(6,2)`; one shared decimal/format util so FE and BE render marks identically.
- **Transactions:** a shared Prisma transaction helper for multi-write operations.

---

## 10. Cross-cutting backend to add

- **Event bus** (§6) — Nest `EventEmitter` + BullMQ for durable events.
- **Message/notification sender** — generalize the existing `OtpSender` into one outbound abstraction (SMS/email/in-app) used by OTP + result-ready + reminders.
- **Rate-limit guard** — a shared Redis-backed `@Throttle` decorator + guard for public auth/exam endpoints.
- **Cache helper** — a Redis `getOrSet(key, ttl, fn)` for base-config/leaderboard reads.
- **Request context + structured logger** — `AsyncLocalStorage` carrying `requestId` + actor into every log line; a thin shared logger package (Sentry init in the same package, consumed by api + web + mobile).
- **Idempotency interceptor** — for submit and other at-least-once paths.

---

## 11. DX & repo conventions

- **Git hooks** — husky + lint-staged running format/lint/typecheck on staged files pre-commit (CI is the backstop, not the first line).
- **commitlint** — enforce the conventional-commit style already in use.
- **`.editorconfig` + `.vscode/extensions.json`** — one editor baseline; recommend ESLint, Prettier, Prisma.
- **Dependency alignment** — `syncpack` to keep shared deps (react, zod, tanstack…) on one version across workspaces; Renovate/Dependabot for batched updates.
- **Turbo remote cache** — reuse task outputs across CI and machines.

---

## 12. Governance — what CI mechanically enforces

- **Module-boundary lint rule** — no deep sibling imports (`apps/api/src/<a>` may not import `apps/api/src/<b>/**` except the module's public entry); infra packages importable by all.
- **No-DOM lint rule** — `packages/app-kit` and `packages/contracts` `src` may not reference `window`/`document`/`localStorage`/`sessionStorage`.
- **Existing CI gates** — format → lint → typecheck → test → build, plus the migrations-apply job.
- **Schema convention check** — every model has `createdAt`/`updatedAt` (a lint script or review checklist).

A rule that isn't enforced by CI is a suggestion; prefer adding the check over adding a paragraph.

---

## 13. Explicitly NOT commonized / NOT split

- **Rule of three** — don't abstract below three real uses. `<DataTable>` and the row-importer qualify; a generic "resource CRUD framework" does not.
- **Stays app/module-specific** — login flows, dashboards, per-app nav/constants, and all domain logic (scoring, auto-draw, exam engine, leaderboard math).
- **Service count** — target ~3 services (core + exam + worker) with clean seams so more can peel off _if traffic proves it_ — not eight services on day one.
