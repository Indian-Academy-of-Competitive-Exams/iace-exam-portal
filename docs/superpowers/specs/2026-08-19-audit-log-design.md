# Audit Log — Design

**Date:** 2026-08-19
**Status:** implemented — see the git history from `88c89ec`. Sections below marked **As built** record where the shipped code deliberately differs from the original design.
**Supersedes nothing.** Implements `docs/archive/04-students-groups-access-model.md` §8 and resolves the retention policy that section leaves open.

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

### The diff a service contributes

**As built:** the design had services attach a `before` snapshot for the interceptor to diff. The shipped code has each service compute the diff itself with `fieldDiff` and contribute the result. Only the service holds both the row it read and the DTO shape it returns; an interceptor diffing one against the other would have to guess how they map. `fieldDiff` still lives in `packages/contracts` exactly as designed.

### Where the snapshot comes from

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
- `TAXONOMY_SUBJECT`, `TAXONOMY_TOPIC`, `TAXONOMY_SUB_TOPIC` — one per level. **As built:** the design named a single `TAXONOMY` value. That could not identify a row once its entity was deleted, and `DELETE` is an audited action, so the value was split before anything shipped.
- `FEATURE_PERMISSION` — `POST features/permissions` and `DELETE features/:key/permissions/:level/:adminId` are how an admin gains or loses the right to do everything else; this is the one write where a wrong answer is a security question

`AuditAction` gains `BLOCK` and `UNBLOCK`.

**Why:** `ACTIVATE`/`DEACTIVATE` is one pair for two different switches. Without the new pair, `PATCH :id/active` and `PATCH :id/test-blocked` both land as `DEACTIVATE`, merging the two states that commits `84d7d54` and `1272e33` exist to keep apart. `changed` would disambiguate them, but then the `action` column is misleading on its own — which is exactly how someone answers "who deactivated this student" wrongly.

`docs/04:17` marks `AUDIT_FEATURE` "(extensible)", so this is using the design, not fighting it.

### Coverage

- **Admin:** every CRUD write across students, groups, branches, exam types, questions, taxonomy, admins and feature permissions.
- **Student:** `PATCH /me` and document uploads only, as `STUDENT_PROFILE / UPDATE` with `actorType: STUDENT`.
- **Script:** `POST admins/sync/students` writes student rows without a signed-in admin. It logs with `actorType: SCRIPT` and a null `actorId`, under `ImportSource.SCRIPT`, reusing the import path below rather than the request path — there is no interceptor on a job that no one called.

`AuditActorType` already carries `ADMIN`, `STUDENT`, `SCRIPT` and `SYSTEM`. `SYSTEM` is used by the archive job (see Retention).

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

## Retention: 30 days hot, then archived to S3

§8 says "+ retention policy" and stops. Resolved:

- **`RowActionLog`: 30 days in Postgres.** Older rows are written to S3 and deleted from the table.
- **`ImportLog`: kept indefinitely.** One row per run, and it is the index into the import files — losing it would orphan objects nothing can name.
- **Import files in S3: indefinite**, for the same reason: for import-sourced rows the sheet is the only record of what was overwritten.

At 30 days the archive job is not optional and not a follow-up — it is the only thing standing between this design and a table that silently loses history. It ships with the feature.

### What the archive is

One gzipped NDJSON object per **closed UTC day**:

```
audit/row-actions/YYYY/MM/DD.ndjson.gz
```

One JSON object per line, exactly the columns of `RowActionLog` with actor display names resolved at archive time — names are resolvable now and may not be later, and an archive nobody can read without a live database is not an archive.

NDJSON because it needs no library to read, streams line by line at any size, and survives a schema addition: a new column is a new key, not a broken file.

### The job

A daily repeatable BullMQ job on the existing queue infrastructure (`QUEUE_NAMES` gains `AUDIT_ARCHIVE`), running as `actorType: SYSTEM` — the first user of that value.

Order matters and is the whole safety argument:

1. Select every row for one closed day older than the 30-day window.
2. Write the object to S3.
3. **Verify it landed** (HEAD, and byte count against what was written).
4. Only then delete that day's rows, bounded by the same `createdAt` window.

A failure at any step leaves the rows in Postgres and retries the next day. Rows are never deleted on the strength of an S3 write that was not confirmed. Re-running a day overwrites the same key and deletes the same bounded window, so the job is idempotent and safe to replay after an outage.

It processes one day per run and never touches the current day, so a partially-written day cannot be archived and flushed underneath a request that is still adding to it.

### What this costs, stated plainly

A question asked more than 30 days after the fact — "who blocked this student last term" — is no longer answerable from a screen. It is answerable from an object in S3, by someone who goes and reads it.

The design does two things so that is a path rather than a dead end:

- The `/audit` screen and the embedded History section **state their window**: "Showing the last 30 days. Older activity is archived — see `audit/row-actions/`." A History section that silently renders empty for an old student would be read as "nothing ever happened to them", which is worse than no feature.
- The archive key is derived from the date alone, so finding the right object needs no index and no tool.

Restoring an archived day into Postgres is **not** built in V1. The objects are plain NDJSON; if it is ever needed often enough to automate, that is a follow-up with a real requirement behind it.

## Testing

Per repo rules, tests ship in the same commit and run with no infrastructure.

- `fieldDiff` — pure unit tests: added key, removed key, unchanged value produces no entry, null vs undefined, nested profile object.
- `AuditInterceptor` — emits on success; emits **nothing** on a thrown request; resolves `entityId` from param and from response body.
- `AuditListener` — writes the row; a throwing write is swallowed and does not reach the producer.
- Self-scoping — a normal admin's request carrying another admin's `actorId` still returns only their own rows. This is the failure the feature exists to prevent, so it is asserted at the service, not the controller.
- Per-feature: one test each asserting the row lands **with a populated diff**, which is what catches a forgotten `before` contribution.
- Archive job — the failure it exists to prevent: **a failed or unverified S3 write deletes nothing.** Assert rows survive when the upload throws, and when the verification step disagrees with what was written. Also: the current day is never archived; a replayed day is idempotent; an empty day writes no object and deletes nothing.

The archive tests use the in-memory fakes in `apps/api/test/support/fakes.ts` with a fake storage adapter, so they run with no S3 and no Postgres, per the repo rule.

## Build order

1. Enum extensions migration + `fieldDiff` in contracts, with tests.
2. The seam: decorator, interceptor, listener, request context. Wired to students first, end to end.
3. Remaining admin features: groups, branches, exam types, questions, taxonomy, admins, feature permissions.
4. Student side: `PATCH /me` and document uploads.
5. Imports: student and group-member importers gain the `ImportLog` lifecycle; per-row thin entries with `importLogId`.
6. Read API with server-side scoping, then the `/audit` screen, then the embedded History section — both stating the 30-day window.
7. The archive job: S3 writer, verification, bounded delete, daily schedule.

Steps 1–2 are the slice that proves the design. Nothing after step 2 changes its shape.

Step 7 must not ship later than step 5. Imports are what make this table grow, and 30-day retention with no archive is data loss on a schedule.

## As built — decisions taken during implementation

- **Feature registration is not audited.** `POST admin/features` creates a `Feature` row. It was briefly audited under `FEATURE_PERMISSION`, which filed a Feature id in a column where every other row holds an Admin id. Minting a new `AuditFeature` value for it was rejected because a Postgres enum value can never be retracted, and this section names only two permission routes. Grant and revoke remain audited against the admin they concern, so the "who can do what" trail is complete — a feature that exists but has no grant confers nothing.
- **A `CREATE` row's `changed` is not a snapshot.** Fields that are null both before and after are omitted, so a create records only the fields that received a value.
- **The archive's trailing newline is load-bearing.** The job compresses each 1000-row page separately and concatenates the gzip members; the trailing newline is what stops a page boundary falling mid-record. It is not merely POSIX convention.
- **A day is archived under a Redis lock keyed on that day**, held across select → write → verify → delete. Without it, two workers could overwrite a complete object with a partial one after the complete rows were deleted.
- **The archive resolves actor names at write time**, so an object stays readable without a live database.

## Known gaps at handover

- **A deactivated admin keeps access until their token expires.** `isActive` is enforced inside `FeaturePermissionGuard` and `SuperAdminGuard`; a route carrying neither never checks it. The audit routes are always-on and so carry neither — `AuditService` checks the flag itself. The general gap remains: `ActorGuard` does not check it, and `AdminsService.setActive` does not revoke Redis sessions, so the window is the JWT TTL. Fixing it properly is a platform change, not an audit one.
- **`AuditFeature.TEST` has no producer.** No attempts module exists — the exam engine is step 4 of the mock-test build order. The value is declared and unused.

## Open questions

None. The PIN-change exclusion under "Explicitly not logged" is a decision, not an open question, and is recorded there so it can be revisited deliberately.
