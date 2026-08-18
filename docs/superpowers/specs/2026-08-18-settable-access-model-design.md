# Making the students/groups/access model settable

**Date:** 2026-08-18
**Scope:** `prisma`, `packages/contracts`, `packages/ui`, `apps/api`, `apps/admin`, `apps/test`
**Status:** approved, awaiting implementation plan

## Problem

The schema slice (commits `c4ae099`, `aee63b4`) landed the target model from `docs/04` and nothing
writes it. `enrolledExams` is empty for every student, no group has an `examType`, `studentType` is
hardcoded `ONLINE` in all three create paths, and there is no exam-type catalog to validate any of it
against — `ExamType` has never been written by any code in the repo. Access therefore resolves to
nothing for everyone, and the resolver slice has no data to resolve.

Two rules also became wrong the moment membership rows disappeared, and both are load-bearing:

- `studentCount` counts `directGroupIds` only, so an EXAM group thousands of students reach reports
  **0**. `groupDeletionBlocker` then permits a hard delete, and the confirm dialog affirmatively tells
  the admin "The group is empty, so nobody loses access."
- `canRemoveFromGroup` still refuses to strip a student's last entry in an array that now holds only
  scholarship and non-IACE grants, blocking a revoke that takes nothing away.

## Decisions

Made against a nine-agent survey of the codebase (43 findings, 30 high-severity).

- **`ExamType` lives in a new `configs` module**, which `docs/03` §5 already assigns it to, rather than
  a standalone `exam-types` module that would make the binding ownership map wrong on day one.
- **`Group.isActive` is added now** and the Groups screen offers retire, closing the disagreement
  between `docs/04` §4/§10 and the schema while the table is already being migrated. Rejected:
  deferring it and leaving the doc promising a column that does not exist.
- **Deactivate repoints to `isTestBlocked` and is made visible in the same slice** — renamed control,
  rewritten dialog copy, a roster state, and a banner in the student portal. Rejected: repointing
  quietly, which produces a success toast and a byte-identical student experience, since nothing
  enforces the flag until the attempt-start guard ships.
- **The GLOBAL group and the VIRTUAL branch are seeded** by data-only migrations, with protection
  rules shipped alongside. The VIRTUAL branch is already protected by `branch-rules.ts` and created by
  nothing, so this closes an existing gap rather than opening a new one.
- **`Group.type` is create-only.** Retyping silently moves who reaches a group, and immutability also
  removes any path to retype the GLOBAL singleton.
- **No grandfathering.** The dev database is throwaway, so `prisma migrate reset` is step one and the
  new rules are strict. Every group currently in the database is `{type: EXAM, examType: null}` and
  every direct grant points at one, which no rule set can accept and no automatic retype can decide.

## Prerequisite

`pnpm exec prisma migrate reset` against the dev database before the first commit. This is a stated
step, not a side effect: the migrations themselves delete no rows, and both must run clean on an empty
database (the CI migrations job) and on a reset developer database.

## Design

### 1. Migrations — two, one per commit that needs one

Each commit must build and pass on its own, so the schema change rides with the code that reads it.

**A — exam types** (commit 1). `code` is nullable today and unwritten, so it is backfilled, verified,
and only then constrained. The verification is the point: a silent backfill can write values
`examTypeCodeSchema` rejects on every later PATCH, producing a row that can never be edited again.

```sql
UPDATE "ExamType" SET "code" = upper(regexp_replace(trim("name"), '\s+', ' ', 'g')) WHERE "code" IS NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "ExamType" WHERE "code" !~ '^[A-Z0-9]+( [A-Z0-9]+)*$') THEN
    RAISE EXCEPTION 'ExamType.code cannot be made canonical automatically — fix these rows by hand first';
  END IF;
  IF EXISTS (SELECT 1 FROM "ExamType" GROUP BY "code" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'two exam types canonicalise to the same code';
  END IF;
END $$;

ALTER TABLE "ExamType" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "ExamType" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
```

**No `deletedAt`.** The schema's convention block already records the decision — "ExamType, BaseConfig,
TestSeries — retired by a flag or by cloning" — and until now `ExamType` had no flag to retire it with.
Adding `isActive` makes that sentence true; adding `deletedAt` would contradict it and give the table a
column nothing writes.

**B — group state and the two singletons** (commit 2). `Group.isActive BOOLEAN NOT NULL DEFAULT true`,
then two idempotent seeds:

```sql
INSERT INTO "Group" ("id","name","type","isActive","createdAt","updatedAt")
SELECT 'grpglobal00000000000000', 'ALL STUDENTS', 'GLOBAL', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Group" WHERE "type" = 'GLOBAL');

INSERT INTO "Branch" ("id","name","type","isActive","createdAt","updatedAt")
SELECT 'brnchonline000000000000', 'ONLINE', 'VIRTUAL', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Branch" WHERE "type" = 'VIRTUAL');
```

Fixed ids, in the style of the existing `brnchglobal000000000000` seed. `README` gains a line beside
the super-admin bootstrap: these two rows come from migrations, and there is still no seed script.

### 2. The `configs` module

`apps/api/src/configs/` — `configs.module.ts`, `configs.controller.ts` (`admin/exam-types`),
`exam-types.service.ts`, `exam-type-rules.ts`, `index.ts`. It is the only writer of `ExamType`.
`docs/03` §5 already lists `ExamType`, `BaseConfig` and `BaseConfigSection` under `configs`; the other
two follow in a later slice.

Its public surface is the module plus:

- `assertUsable(codes: string[], fieldKey: string)` — mirrors `BranchesService.assertUsable`, but takes
  the field key rather than hardcoding it. Branches hardcodes `fieldErrors.branchId`, and
  `applyFieldErrors` silently drops a key the receiving form does not own; the group form's field is
  `examType` and the student form's is `enrolledExams`.
- `list`/`create`/`update`/`remove`.

Callers: `GroupsService.create`/`update` validate `examType`; `StudentsService.create`/`update`
validate `enrolledExams`. Blocker counts cross module boundaries, so they arrive through facades —
`GroupsService.countByExamType(code)` and `StudentsService.countEnrolledIn(code)` — never
`prisma.group` from inside `configs` (`docs/03` §4 rule 2).

### 3. Rules — pure, prisma-free, one file per module

`configs/exam-type-rules.ts`:

- `examTypeDeletionBlocker({ groupCount, studentCount, baseConfigCount, testCount })`. All four are
  needed: `BaseConfig.examTypeId` CASCADEs and `BaseConfigSection` cascades again, so one delete
  destroys every blueprint under an exam type; `Test.examTypeId` and `Test.baseConfigId` both SET NULL,
  so tests reachable only through a config are invisible to a naive count. Tests are counted as
  `{ OR: [{ examTypeId: id }, { baseConfig: { examTypeId: id } }] }`.
- `examTypeEditBlocker(usage, changes)` — **refuses a `code` change once anything references it.**
  `Group.examType` and `Student.enrolledExams` store the code as free text with no foreign key, so a
  rename detaches every group and every enrolment with no error and no rows changed. Branches has no
  analogue (`branchEditBlocker` only guards a singleton), so this cannot be copied — it must be
  written. `name` stays freely editable; retire stays allowed.

`groups/group-rules.ts`:

- `groupDeletionBlocker` takes the type-aware count (§4) and gains a GLOBAL branch.
- `groupEditBlocker` — new, protecting the GLOBAL singleton from rename, retire and delete. Note
  `branchEditBlocker` deliberately permits a no-op patch on its protected row; copying it verbatim
  would allow a PATCH on GLOBAL.
- `canRemoveFromGroup` and `LAST_GROUP_MESSAGE` are **deleted**, along with the mirror check in
  `StudentsService.update` and the copy in `student-detail.tsx` that states the rule. Under this model
  there is no floor to protect. `apps/api/test/groups.unit.test.ts:80-123` pins the old behaviour and
  is rewritten in the same commit, not loosened.

Shared invariants live in `packages/contracts` so the form and the API run one rule:

- a `superRefine` on the group bodies: EXAM and PROGRAM require `examType` and at least one branch;
  SCHOLARSHIP, NON_IACE and GLOBAL forbid `examType`; GLOBAL is not creatable through the API at all.
- `GROUP_TYPES_ACCEPTING_GRANTS = [SCHOLARSHIP, NON_IACE]`, consumed by the API, the importer's group
  load, the picker query and the "Add students" link.

### 4. Counting

`studentCount` becomes type-aware, and the same number feeds the column, the deletion blocker and the
confirm dialog:

| Group type            | Count                                                 |
| --------------------- | ----------------------------------------------------- |
| EXAM, PROGRAM         | `student.count({ enrolledExams: { has: examType } })` |
| GLOBAL                | `student.count({ deletedAt: null })`                  |
| SCHOLARSHIP, NON_IACE | `student.count({ directGroupIds: { has: id } })`      |

`studentWhere`'s `groupId` filter resolves the group's type first and filters the same way, so the
Groups screen's click-the-name-to-see-members link stops landing on a blank roster for every EXAM
group. That is one group lookup in the caller before the where-clause is built.

### 5. Contracts

**New `exam-types.ts`**, shaped like `branches.ts`: `EXAM_TYPE_NAME_MAX`, `EXAM_TYPE_CODE_MAX`,
`examTypeCodeSchema` (via `canonicalNameSchema`), `examTypeSchema`,
`examTypeListQuerySchema` (paginated, with `q` and the `activeOnly` flag `branchListQuerySchema`
carries), create/update bodies, `ADMIN_EXAM_TYPE_ROUTES`, plus `client.ts` entries and
the `index.ts` line. The list row carries `groupCount` only — one `groupBy` over `Group.examType` for
the page. The other three usage counts key on ids and codes with no relation, so four per-row counts
would be eighty queries a page; the full usage is computed when a delete or a code change is attempted,
which is where the blocker needs it.

**`groups.ts`**: `branchId` becomes `branchIds`; `updateGroupSchema` is re-derived rather than
`omit`-ing a branch that is now reassignable (the "half of its uniqueness" comment is false since
uniqueness moved to `[examType, name]`); `groupSummarySchema` gains `isActive`. `type` is absent from
the update body — create-only.

**`students.ts`**: `studentType` (required, no default), `enrolledExams`, `program`, `currentBranchId`
on both create and update; `isTestBlocked` and `studentType` on `studentSummarySchema`;
`isTestBlocked` on `studentListQuerySchema`; a `setStudentTestBlockedSchema` and its route.
`setStudentActive` stays and becomes super-admin-only.

### 6. Shared UI

**`MultiCombobox`** in `packages/ui` — server-searched, paged, chips for the selection, mirroring
`ComboboxProps` with `value: readonly string[]` and `onChange(next: string[])`. `Combobox` is
single-value and the only multi-select in the repo is the domain-specific `GroupPicker`. Two consumers
here (group branches, student enrolments), and `packages/ui/test/shared-components.test.ts` enforces
that a component two screens need lives in the design system, so it lands before either.

### 7. Screens

**Exam types** (`apps/admin/src/routes/exam-types.tsx`) — a mirror of `branches.tsx`: PageHeader,
inline create card, DataTable, row actions, two ConfirmDialogs. Plus `ROUTES.EXAM_TYPES`, a nav entry
under the Students group, the `App.tsx` route, and a `use-exam-types.ts` cache hook in the shape of
`use-branches.ts`, taking the same `{ activeOnly }` option — the group form offers active exam types
only, the exam-types screen shows all. A code change is refused server-side; the form says so before it is attempted when
`groupCount > 0`.

**Groups** — `type` and `exam` columns; branches as a `BadgeList`; a retire action and its dialog; a
create form whose type select reveals `examType` (Combobox over active exam types) and `branchIds`
(MultiCombobox over active branches). The "Add students" link renders only for grant-accepting types.
The delete dialog draws its sentence from the type-aware count.

**New student card** (on the roster) gains `studentType`, which is required with no default, and
enrolments. Without it the one screen that creates a student cannot satisfy the create body.

**Student detail** — a new Access card: `studentType` select, `enrolledExams` MultiCombobox, `program`
input (free text, 120 characters), current branch Combobox. Threaded through all five places the form contract lives (`FormValues`,
`FORM_FIELDS`, `toFormValues`, `defaultValues`, the mutation body), with `enrolledExams` carrying its
own dirty guard in the shape of the existing `groupIds` one, so a save cannot overwrite the server with
values the form merely rendered. The Groups card description stops claiming a student must stay in at
least one group and says what the grants now are; its picker narrows to grant-accepting types, and its
empty state is reworded — it now means "no scholarship group exists", not "no group exists".

**Roster** — `STATUS_QUERY` gains a blocked entry, with its matching query field, `studentWhere`
clause, `ALL_FILTERS` key and query-object entry. `SignInStatus` keeps reading `isActive`; test-blocked
gets its own badge, because it is not a sign-in state. The amber "No group" badge and filter retarget
to the real condition — no enrolments **and** no grants — instead of firing on every correctly
enrolled student.

**Student portal** — a banner in `apps/test/src/components/app-shell.tsx` keyed on
`identity.isTestBlocked`, beside the existing default-PIN gate.

### 8. The four grant paths

All four close in commit 2, and the type gate applies **only to ids being added**, diffed against the
stored array the way `assertMayJoinGroups` already does, so a stale grant can always be removed:

1. `GroupsService.addMembers` / `removeMember` — no SPA caller today, still gated.
2. `StudentsService.update` — the live path from the detail form.
3. The group-member sheet — `type` is added to the group select and to `GroupMemberContext`, and the
   refusal lands in `fileErrors`, not per row: the group is fixed for the whole upload, so a row error
   would print two hundred identical red lines and a misleading invalid count.
4. The roster sheet's Groups column — `resolveGroup` matches any group by canonical name today. A
   `where` clause on the group load at `imports.service.ts` makes ineligible groups simply not resolve,
   and the existing "No group called X" row error covers it. Its ambiguity message also stops
   interpolating a null `examType`.

### 9. The `isActive` / `isTestBlocked` split

The "a deactivated student gains no new group" rule is enforced in four separate places, each reading
`isActive` independently (`students.service.ts`, `groups.service.ts` ×2, the two import planners). All
flip in one commit. `isActive` keeps its four sign-in refusals in `auth.service.ts` untouched. The only UI writing it is a
"Suspend sign-in" control on the student detail screen, rendered only for a super admin — gated the way
`branches.tsx` gates its row actions (an `isSuperAdmin` flag from `useAuth`), not with the whole-page
`SuperAdminOnly` wrapper, which is for screens.

Both directions of the student-detail ConfirmDialog are rewritten: the current copy promises "They can
no longer sign in", which becomes false. `docs/04` §10 makes the token behaviour deliberate — a blocked
student's live session is not revoked — and the copy says so.

## Testing

- `exam-type-rules.unit.test.ts` — both blockers, including the rename refusal, which is the failure
  the edit blocker exists to prevent.
- `exam-types-service.unit.test.ts` — list/create/update/remove through `FakePrisma`, grouped by verb
  like `branches-service.unit.test.ts`.
- `groups-service.unit.test.ts` — the create/update rules and the type-aware counts. These are
  currently untestable: `prisma.group` in the fakes has no `create`, `update` or `delete`.
- **Fakes**: `FakeGroup` gains `type`, `branches` and `isActive`; `prisma.group` gains create/update/
  delete; `examTypes` goes in as the **fifth positional** parameter of `FakePrisma` (inserting it
  anywhere else silently rebinds arrays across six files with no type error); `branch.findMany` starts
  honouring its `where`.
- `group-membership.unit.test.ts` — the `deactivated()` fixture sets **only** `isTestBlocked`, and a
  new case asserts a student with `isActive: false, isTestBlocked: false` is still addable. Without
  that change the file passes against a half-flipped codebase, which is exactly what it was written to
  catch.
- `student-query.unit.test.ts` — the two hard-coded condition counts are updated, never relaxed, and
  `isTestBlocked` joins the three-state loop.
- `confirm-destructive.test.ts` — `NEEDS_CONFIRMING` gains `setTestBlocked`, `addMembers` and
  `removeMember`; the toggle map gains exam types and group retire; its `onClick={() => setActive.mutate(`
  assertion widens to `\w+\.mutate\(`, which is keyed to an identifier this slice renames.
- `groups.unit.test.ts` — the two assertions that invert (`requires a branch`, `refuses to move a group
between branches`) are rewritten, not deleted.

## Commit order

1. `configs` module + migration A + the exam-type feature end to end + `MultiCombobox`.
2. Group write path (`type`, `examType`, `branchIds`, `isActive`) + migration B + type-aware counts +
   both blockers + the grant restriction across all four paths + deletion of the last-group rule.
3. Student Access card + the `isTestBlocked` repoint + roster state + portal banner.

## Out of scope

The access resolver and its Redis cache; the attempt-start server refusal that gives `isTestBlocked`
teeth; anything writing `ImportLog` or `RowActionLog`; branch-scope enforcement from `Admin.branchIds`;
the `BranchTestConfig` screen; the roster importer rewrite (`docs/04` §11); notifications.

## Risks accepted

- **Duplicate SCHOLARSHIP/NON_IACE names are app-enforced only.** `unique(examType, name)` is inert
  while `examType` is null, and the partial unique index that would fix it cannot be expressed in
  `schema.prisma`, so CI's `db:check` drift job would fail on it. Two concurrent creates can both pass
  `assertNameFree`.
- **`studentCount` is one query per row inside a `$transaction`** — twenty index counts per page. Left
  as is while the page stays at twenty; a `groupBy` replaces it if the list grows.
- **`directGroupIds` is not pruned when a group is deleted.** The schema comment claiming it is gets
  corrected to say the ids are deliberately left dangling and `namesOf` hides them, rather than
  asserting an invariant no code enforces.
