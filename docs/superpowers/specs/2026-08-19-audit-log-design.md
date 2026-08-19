# Audit Log — Design

**Date:** 2026-08-19
**Status:** approved design, not yet planned
**Supersedes nothing.** Implements `docs/04-students-groups-access-model.md` §8 and resolves the retention policy that section leaves open.

## Goal

Answer "who changed this row, when, and what did it replace" for every admin write, and for a student's own profile edits. Never at the cost of a slower response.

## What already exists

Checked against the tree, not assumed:

- `ImportLog` and `RowActionLog` both exist in `prisma/schema.prisma:845-887`, created by migration `20260817120000_students_groups_access_model`.
- `AuditFeature`, `AuditAction` and `AuditActorType` exist (`schema.prisma:169-195`).
- `ImportLog` has one working producer: the question importer (`apps/api/src/questions/question-import.service.ts`). A run goes `PREVIEWED → COMMITTED | FAILED`, the uploaded sheet is kept in S3 under `importFileKey`, and the admin UI round-trips `importLogId` between preview and commit.
- `RowActionLog` has **no** writers. This is the gap.
- The student and group-member importers do not write `ImportLog` at all.
- `DomainEventBus` (`apps/api/src/common/events/domain-event-bus.ts`) is a typed, in-process, fire-and-forget bus, documented as "a producer publishes a fact that already happened, so a failing listener must not fail the request".
- Lightweight provenance columns (`createdVia`, `createdById`) exist on `Student`, `Admin` and two other models. They record who made a row, never who changed one.

## The seam

An audit entry is produced by three parts, each with one job. Services are edited in one place only — where they already hold the pre-write row.

### `@Audit(feature, action)`

Controller-method metadata declaring what the route means in `AuditFeature` / `AuditAction` terms. No logic.

A toggle route cannot name its action statically — `PATCH :id/active` is `ACTIVATE` or `DEACTIVATE` depending on the body. For those, the decorator takes a resolver: `@Audit(AuditFeature.STUDENT, (body) => body.isActive ? ACTIVATE : DEACTIVATE)`. The resolver is pure and reads only the validated body, so it is unit-testable and cannot query anything.

### `AuditInterceptor`

On a **successful** response only:

- actor type and id from `common/security/authenticated-user.ts`
- `requestId` from `common/request-id.ts`
- `entityId` from the route param, falling back to the response body's `id`
- emits one `AUDIT_ROW_ACTION` event on `DomainEventBus`

The event is declared in `common/events/event-catalog.ts` alongside the others, with a typed payload — the catalog is the one place cross-module events are named (`docs/03 §6`), and an event that skips it is invisible to everyone reading that file.

It never touches the database, so it cannot slow or fail a response. A request that throws emits nothing: a refused write is not a change.

### `AuditListener`

Subscribes to `AUDIT_ROW_ACTION` and writes the `RowActionLog` row. Failure is logged and never propagated — the bus already guarantees the producer is unaffected.

**No BullMQ queue.** The bus is the transport. Audit writes are small and low-volume (admin CRUD), and the durability a queue would add is not worth a second moving part. If a compliance requirement later demands no-loss-on-crash, the listener is the single place that changes.

### The `before` snapshot

A request-scoped context object the service fills where it already has the row:

- `StudentsService.update` holds `student` from its opening `findUnique`
- `GroupsService.update` and `BranchesService.update` likewise
- `ExamTypesService.update` likewise

One line each. **No extra query** — these services already read before they write, because their blockers need the current row.

Where a service contributes nothing, the row still lands with actor, feature, action, entity and timestamp; only `changed` is null. The failure mode is a thin entry, never a missing one.

### `fieldDiff`

The diff is computed by a pure function in `packages/contracts`:

```ts
fieldDiff(before, after, fields) -> { [field]: { from, to } } | null
```

Unit-testable with no infrastructure, and one definition of "changed" shared by every writer.

### Why not a Prisma client extension

Rejected after checking the code:

1. **It cannot see the profile change.** `StudentsService.update` writes the profile as a nested upsert inside `student.update` (`students.service.ts:240-265`). An extension sees one `student.update` operation with the profile change buried in `args.data.profile.upsert`, so `STUDENT_PROFILE` — its own `AuditFeature` value — would never be emitted separately without special-casing nested write args. That is domain knowledge in the layer whose whole appeal was having none.
2. **It would double-read.** The services already hold the `before` row; the extension would re-fetch it on every write.

## What gets logged

### Actions

| Route shape              | Action                                   |
| ------------------------ | ---------------------------------------- |
| `POST`                   | `CREATE`                                 |
| `PATCH`                  | `UPDATE`                                 |
| `DELETE`                 | `DELETE`                                 |
| `PATCH :id/active`       | `ACTIVATE` / `DEACTIVATE` (sign-in only) |
| `PATCH :id/test-blocked` | `BLOCK` / `UNBLOCK`                      |
| import commit            | `IMPORT`                                 |

### Enum extensions (one additive migration, no backfill — the tables are empty)

`AuditFeature` gains:

- `EXAM_TYPE` — `configs` has full CRUD and no feature value
- `TAXONOMY` — subject, topic and sub-topic writes
- `FEATURE_PERMISSION` — `POST features/permissions` and `DELETE features/:key/permissions/:level/:adminId` are how an admin gains or loses the right to do everything else; this is the one write where a wrong answer is a security question

`AuditAction` gains `BLOCK` and `UNBLOCK`.

**Why:** `ACTIVATE`/`DEACTIVATE` is one pair for two different switches. Without the new pair, `PATCH :id/active` and `PATCH :id/test-blocked` both land as `DEACTIVATE`, merging the two states that commits `84d7d54` and `1272e33` exist to keep apart. `changed` would disambiguate them, but then the `action` column is misleading on its own — which is exactly how someone answers "who deactivated this student" wrongly.

`docs/04:17` marks `AUDIT_FEATURE` "(extensible)", so this is using the design, not fighting it.

### Coverage

- **Admin:** every CRUD write across students, groups, branches, exam types, questions, taxonomy, admins and feature permissions.
- **Student:** `PATCH /me` and document uploads only, as `STUDENT_PROFILE / UPDATE` with `actorType: STUDENT`.
- **Script:** `POST admins/sync/students` writes student rows without a signed-in admin. It logs with `actorType: SCRIPT` and a null `actorId`, under `ImportSource.SCRIPT`, reusing the import path below rather than the request path — there is no interceptor on a job that no one called.

`AuditActorType` already carries `ADMIN`, `STUDENT`, `SCRIPT` and `SYSTEM`. `SYSTEM` stays unused until something writes rows on its own schedule; the retention purge, when built, is its first user.

### Imports

An import emits one `RowActionLog` per touched row carrying feature, `entityId`, action and `importLogId` — **`changed` stays null**.

A thousand-row roster writes a thousand thin rows rather than a thousand JSON diffs. This keeps "which import touched this student, and did it create or update them" and gives up "what exactly it overwrote" — which the stored sheet in S3 still answers.

The student and group-member importers gain the `ImportLog` lifecycle the question importer already has.

### Explicitly not logged

- **All of `auth.controller`** — sign-in, OTP, refresh, logout. §8 scopes this to data CRUD and imports; sessions live in Redis by design.
- **PIN changes.** `STUDENT_PIN_RESET` is already emitted on the bus and wired, so logging it would be nearly free, and "who reset this student's PIN" is a question someone will eventually ask. It is not a profile update, so it is out of scope under the agreed student rule. Flagged here so the decision is visible rather than forgotten.
- **Preview endpoints** — they write nothing. Question preview already creates its own `ImportLog` row, which is the record of that step.
- **Exam interactions.** §8 stands as written: everything about a test lives in `Attempt` and `AttemptAnswer`, which already capture every analytics point. There is no student audit seam in the exam engine.

## Reading it back

### Endpoints

- `GET /admin/audit/row-actions` — paged; filters: feature, action, `entityId`, actor, date range
- `GET /admin/audit/imports` — `ImportLog` runs with counts and status

### Scoping

Audit Logs is **always-on**, not a `Feature` key: every admin reaches it, and no permission row grants it.

A super admin sees everything. A normal admin has `actorId = their own id` forced onto the `where` clause **by the service**, whatever the request asks for. The `actorId` filter appears in the UI only for a super admin, but the server never trusts that — a filter the client can widen is not a scope.

### Names

`actorId` is a plain string with no FK, deliberately (`schema.prisma:26`). The service batch-loads the admins and students named on the current page and attaches display names: one `findMany` per page, not one per row. Names always resolve — an `Admin` row is never removed (`schema.prisma:269`).

### Screens

A `DataTable` at `/audit`: when, who, feature, action, entity, diff. The diff cell renders `{ field: { from, to } }` as a compact from→to list; import-sourced rows have no diff and link to their `ImportLog` run instead.

Following the repo's UI rules: `Combobox` + `useInfinitePages` for the actor picker rather than a capped `<select>`; `Skeleton` for the table while it loads; `BadgeList` where a row carries several changed fields.

**The embedded view is where this gets used.** "Who un-blocked this student" is not answered by opening a global screen and filtering — it is asked while looking at the student. The same endpoint, filtered to `feature=STUDENT&entityId=<id>`, renders as a History section on the student detail page, and later on group and branch detail. This is the read path the existing `@@index([feature, entityId, actorId, createdAt])` was built for.

No `ConfirmDialog` anywhere: the feature is read-only. No one edits or deletes an audit row, super admin included. That property is what makes the log worth keeping.

## Retention

§8 says "+ retention policy" and stops. Resolved:

- **`RowActionLog`: 24 months.**
- **`ImportLog`: kept indefinitely** — it is one row per run, and its `fileS3Key` is the evidence a row-level diff was traded away for.
- **Import files in S3: 24 months**, matching the row actions they explain.

**Enforcement is deferred, deliberately, and this is not a TBD.** Estimated volume: admin CRUD across ~2K students is a few thousand rows a year; a weekly thousand-row import adds ~50K. Well under a million rows a year, on a table whose read path is a covered index. A purge job would be a scheduled process protecting nothing for several years.

The policy is stated so the decision exists; the job is a follow-up, to be built when the table passes ~5M rows or when a compliance requirement names a shorter window. What must **not** happen is a purge that silently deletes without the policy being written down first.

## Testing

Per repo rules, tests ship in the same commit and run with no infrastructure.

- `fieldDiff` — pure unit tests: added key, removed key, unchanged value produces no entry, null vs undefined, nested profile object.
- `AuditInterceptor` — emits on success; emits **nothing** on a thrown request; resolves `entityId` from param and from response body.
- `AuditListener` — writes the row; a throwing write is swallowed and does not reach the producer.
- Self-scoping — a normal admin's request carrying another admin's `actorId` still returns only their own rows. This is the failure the feature exists to prevent, so it is asserted at the service, not the controller.
- Per-feature: one test each asserting the row lands **with a populated diff**, which is what catches a forgotten `before` contribution.

## Build order

1. Enum extensions migration + `fieldDiff` in contracts, with tests.
2. The seam: decorator, interceptor, listener, request context. Wired to students first, end to end.
3. Remaining admin features: groups, branches, exam types, questions, taxonomy, admins, feature permissions.
4. Student side: `PATCH /me` and document uploads.
5. Imports: student and group-member importers gain the `ImportLog` lifecycle; per-row thin entries with `importLogId`.
6. Read API with server-side scoping, then the `/audit` screen, then the embedded History section.

Steps 1–2 are the slice that proves the design. Nothing after step 2 changes its shape.

## Open questions

None. The PIN-change exclusion under "Explicitly not logged" is a decision, not an open question, and is recorded there so it can be revisited deliberately.
