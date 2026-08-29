# Branch test configuration — design

Date: 2026-08-29 · Status: approved, not built

One screen that answers "what does THIS branch run, and who is waiting to be let in?". The domain
is already built; what is missing is the branch's own view of it, and the scoping that makes that
view mean something.

## Why it does not exist yet

Every piece of this is reachable today, from the wrong end:

| The row                    | Edited from                                | Axis                 |
| -------------------------- | ------------------------------------------ | -------------------- |
| `BranchTestConfig.enabled` | `test-series-form.tsx`, "Branches" section | series → branches    |
| `BranchTestSchedule`       | `test-builder-offering.tsx`                | test → branches      |
| `SeriesUnlockRequest`      | `access-requests.tsx`                      | every branch at once |

A branch manager has no screen. `FEATURE_KEYS.BRANCH_TEST_MANAGEMENT` — "Branch scheduling: which
series a branch runs, and when" — was reserved for this and is used by nothing.

## Decisions taken

- **Both audiences, one screen.** An `allBranches` admin reaches any branch; a scoped admin is
  pinned to theirs.
- **Scoping lands on these routes only.** Students, imports and audit keep behaving as they do
  today.
- **The branch owns its own rows.** Toggle which series it runs, set its late entry and extra time,
  decide its students' requests.
- **The branch is a route, not a picker**: `/branches/:branchId/tests`.
- **The Tests tab is schedule only.** Sitting counts and per-student blockers are not in it.

## Branch scope

`Admin.allBranches` and `AdminBranch` are stored, editable on the admins screen, and read by
nothing. This is where they start being read.

- A resolver answers, for one admin: every branch, or this set of ids. `isSuperAdmin` bypasses,
  as it does for every feature check.
- It guards the new `/admin/branches/:branchId/…` routes and the `branchId` filter on the request
  list. Nothing else.
- A branch outside an admin's scope answers `NOT_FOUND`, never `FORBIDDEN` — the convention the
  attempt and student lookups already follow, because an id is not a thing to confirm the
  existence of.
- It sits beside `feature-permission.guard.ts`, which is the shape it mirrors.

**Until every branch-keyed query uses it, this is not a permission boundary and must not be
described as one.** A scoped admin can still list every branch's students. Making it real is its
own piece of work, and this design does not pretend otherwise.

## Screen

`/branches/:branchId/tests`, one `TableFrame`, its own `tabs` prop, `PageCrumbs` carrying the
branch name as `tail`. Permission: `BRANCH_TEST_MANAGEMENT`, READ to open, WRITE to change.

### Test series

Every series, with this branch's flag. A row always exists — `createSeries` fans out `enabled:
false` to every live branch and `fanOutToBranch` does the same for a new branch — so the column is
a boolean, never a third "not configured" state.

Filters: search, exam, runs.

Toggling changes what students can reach, which the conventions say confirms both ways. Per-row
confirmation across forty series is the case those same conventions call absurd, so this takes the
sanctioned escape: hold the changes as a draft diff against the server, show the pending count,
confirm once listing every change, and drop the draft after a save either way.

### Tests

The tests reaching this branch through its enabled series: the test, the series carrying it, when
it unlocks, and this branch's late entry and extra time. Editing is a `FormDialog` behind
`RowActions`. Clearing both fields removes the row and returns the branch to the plain rules.

### Access requests

The existing queue, filtered to this branch's students. Approve and decline reuse the flow in
`access-requests.tsx` unchanged.

### Reaching it

`adminIdentitySchema` carries `isSuperAdmin` and `permissions` and nothing about branches, so it
gains `allBranches: boolean` and `branchIds: string[]`. Without them the client cannot tell which
branch is its own, and neither entry point below can be built.

- A "Configure tests" row action on the Branches list, shown only for a branch the admin's identity
  says they hold. The Branches list itself stays unscoped by the decision above, so an admin does
  see rows they cannot open — hiding the action is what stops them walking into a `NOT_FOUND`. The
  server refuses regardless; this is the courtesy, not the guard.
- A nav row under Tests for an admin holding exactly one branch, routing straight to it.

## API

```
GET   /admin/branches/:branchId/test-series               paginated; search, exam, runs
PATCH /admin/branches/:branchId/test-series               batch [{ testSeriesId, enabled }]
GET   /admin/branches/:branchId/tests                     paginated
PUT   /admin/branches/:branchId/tests/:testId/schedule    both fields null deletes the row
GET   /admin/unlock-requests?branchId=…                   new filter; the decide route is unchanged
```

The batch PATCH exists because the screen batches: one confirm, one request, one cache bust. It
applies exactly the pairs it is given and reports what changed.

A schedule of two nulls deletes the row rather than storing them, because no row is what the plain
rules are — a row of nulls is the same thing said twice, and the two would drift.

`AUDIT_FEATURE` gains `BRANCH_TEST_CONFIG`: which series a branch runs is a change to what students
can reach, and every other change of that kind is audited. **`RowActionLog.feature` is the Prisma
enum `AuditFeature`, so this is a migration, and this task carries the schema gates** —
`pnpm db:migrate:deploy` from scratch plus `pnpm db:check` — on top of the usual five.

Both axes write one row, so the series form and this screen must invalidate the same query keys.

## Accepted, not fixed

The series form's "enable everywhere" still switches on branches deliberately switched off. It is
now visible from two screens rather than one, which makes it easier to notice rather than more
dangerous, and its confirm copy already says what it does. Changing it is a separate conversation.

## Testing

- An admin outside a branch's scope gets `NOT_FOUND`; an `allBranches` admin reaches it; a super
  admin bypasses.
- The batch toggle applies exactly the changes it confirmed, and none it did not.
- Clearing both schedule fields returns the branch to the plain rules rather than storing zeros.
- A request from another branch's student never appears in the filtered list.
- A series with no row for this branch cannot arise, and the list renders every series regardless.

## Shape of the work

Five commit-sized pieces:

1. Contracts: the identity fields, the new query and body schemas, and the scope resolver.
2. The two read endpoints.
3. The two write endpoints, the audit feature and its migration.
4. The screen's Test series and Tests tabs.
5. The Access requests tab and both entry points.

The scope resolver is high-risk and takes two review rounds; so does the migration in step 3.
The rest are normal features at one round.
