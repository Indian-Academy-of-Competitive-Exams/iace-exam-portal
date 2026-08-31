# Branch configuration screen — implementation plan (piece B)

**Spec:** `docs/superpowers/specs/2026-08-29-branch-level-admin-design.md`, part B.
**Loop:** `docs/superpowers/WORKFLOW.md`. **Binding core:** `docs/superpowers/task-constraints.md`.
**Depends on:** piece A, complete (`ddd5a8a` … `08f924a`). This plan consumes `branchScopeOf`,
`assertBranchInScope` and `EVERY_BRANCH` from `apps/api/src/common/security/branch-scope.ts`.

**Goal:** stand in one branch and see what it runs — its series, its test timings, and its students'
access requests — at `/branches/:branchId/tests`.

**Format note.** The repo's task template, not the generic writing-plans one, for the reason given in
the piece A plan: `WORKFLOW.md`'s cut-list refuses test code in briefs.

## Global constraints

- Permission `BRANCH_TEST_MANAGEMENT` — reserved for exactly this and used by nothing today. READ to
  open, WRITE to change.
- **Every route is `assertBranchInScope` first.** `/branches/:branchId/…` names a branch in the path,
  so a branch outside the caller's scope reads as `NOT_FOUND` before anything else happens.
- **Invoke the `ui-conventions` skill before any screen work** (tasks 3–5). Its rules are binding:
  `TableFrame` owns the tabs, `ListView` per tab, `Combobox` for every dropdown, `FormDialog` for
  editing one row, `TruncatedText` in every cell, `ConfirmDialog` naming the consequence and count.
- A screen names things and does not explain itself. No `description`, no muted prose.
- Both axes write one row, so this screen and `test-series-form.tsx` must invalidate the same query
  keys, or one goes stale behind the other.

**Ownership, decided once.** The path is `/admin/branches/:branchId/…`, but the data is not the
branches module's: `BranchTestConfig` belongs to `access`, `BranchTestSchedule` to `tests`. Two
controllers mount the same prefix from their own modules rather than a third module reaching into
both, which the module-boundary rule would refuse anyway.

---

### Task 1: A branch's series, and switching them on in one write

Risk: **high** · Model: strong · Reviews: **2**
Exemplar: `apps/api/src/access/test-series.service.ts:236` — `branchConfigs`, the series-centric
inverse of this.

**Files**

- Modify `packages/contracts/src/access.ts` — the row shape, the list query, the batch body.
- Modify `apps/api/src/access/test-series.service.ts` — the branch-centric list and the batch write.
- Modify `apps/api/src/access/access.controller.ts` — a controller on `admin/branches/:branchId`.
- Modify `packages/contracts/src/audit.ts` — `AUDIT_FEATURE` gains `BRANCH_TEST_CONFIG`.
- Create `prisma/migrations/20260829130000_a_branch_test_config_is_audited/migration.sql`.
- Test `apps/api/test/access-service.unit.test.ts`.

**Acceptance**

- The list holds EVERY series with this branch's flag, paginated, filtered by search, exam and runs.
- It reads from `TestSeries` with the branch's config included, not from `BranchTestConfig`. A row
  always exists — `createSeries` and `fanOutToBranch` both fan out — but a series that somehow had
  none would VANISH from a config-first list, and showing it switched off is the safe failure.
- The batch write applies exactly the pairs it is given, and nothing else: a pair naming a series
  that does not exist is refused, and no other pair lands.
- Switching a series on or off busts the catalog cache for that series, exactly as the series form's
  own write does.
- A branch outside the caller's scope is missing, before any of the above.
- `RowActionLog.feature` is the Prisma enum `AuditFeature`, so **this task carries the schema
  gates**: `pnpm db:migrate:deploy` from scratch and `pnpm db:check`, on top of the usual five. The
  migration adds an enum value and moves no data.

---

### Task 2: A branch's tests, and the timings it sets on them

Risk: normal · Model: strong · Reviews: 1
Exemplar: `apps/api/src/tests/offering.service.ts:212` — `branchTiming`, the test-centric inverse.

**Files**

- Modify `packages/contracts/src/tests.ts` — the row shape, the list query, the schedule body.
- Modify `apps/api/src/tests/offering.service.ts` — the branch-centric list and the schedule write.
- Modify `apps/api/src/tests/tests.controller.ts` — a controller on `admin/branches/:branchId/tests`.
- Test `apps/api/test/offering.unit.test.ts`.

**Acceptance**

- The list holds the tests reaching this branch through its ENABLED series, with the series that
  carries each, when it unlocks, and this branch's late entry and extra time.
- A test in a series switched off for this branch is not in it.
- Writing both fields null DELETES the row. No row is what the plain rules are, and a row of nulls
  says the same thing twice — the two would drift, and a reader could not tell which won.
- Writing either field creates or updates the row.
- A test that does not reach this branch is missing, and so is a branch out of scope.

---

### Task 3: The screen, and the series tab that changes what students reach

Risk: normal · Model: strong · Reviews: 1
Exemplar: `apps/admin/src/routes/questions.tsx` for a `TableFrame` with `tabs`;
`test-series-form.tsx:605` for the branch list this inverts.

**Files**

- Create `apps/admin/src/routes/branch-tests.tsx`.
- Modify `apps/admin/src/lib/constants.ts` — `ROUTES.BRANCH_TESTS`, its pattern, query keys.
- Modify `apps/admin/src/App.tsx` — the route, beside the other `:id` patterns.

**Acceptance**

- One `TableFrame`, its own `tabs` prop — never hand-built `Tabs` around it — and `PageCrumbs` with
  the branch name as `tail`.
- The Test series tab lists every series with a Runs column, filtered by search, exam and runs.
- **Toggles are a draft, not a live write.** The screen holds the changes as a diff against the
  server, shows the pending count where a collapsed section still shows it, confirms ONCE listing
  every change, and drops the draft after a save either way. Per-row confirmation across forty
  series is what the conventions call absurd; this is the escape they sanction.
- Leaving the tab, or the screen, with a draft unsaved loses it — and says so before it does.
- The failure to prevent: a screen that looks saved and is not, or a confirm whose count disagrees
  with what the request carries.
- A branch the admin does not hold answers `NOT_FOUND`, and the screen says the branch is not theirs
  rather than rendering an empty one — "none match" and "not yours" send a reader to different
  places.

---

### Task 4: The tests tab

Risk: normal · Model: strong · Reviews: 1
Exemplar: `apps/admin/src/routes/test-builder-offering.tsx` — the per-branch timing editor this
inverts.

**Files**

- Modify `apps/admin/src/routes/branch-tests.tsx`.
- Modify `apps/admin/src/lib/constants.ts` if a query key is needed.

**Acceptance**

- Test, its series, when it unlocks, this branch's late entry and extra time. Nothing else — no
  sitting counts, no per-student blockers.
- Editing is a `FormDialog` behind `RowActions`, mounted only while a row is open and keyed by that
  row, or it opens holding the previous row's values.
- Clearing both fields is offered as what it is: the branch goes back to the plain rules.
- Durations are in the label — "Late entry (minutes)" — never a hint saying "in minutes". The API
  speaks seconds; the screen speaks minutes; the conversion lives in one place.

---

### Task 5: The access requests tab, and the way in

Risk: normal · Model: strong · Reviews: 1
Exemplar: `apps/admin/src/routes/access-requests.tsx` — reused, not rebuilt.

**Files**

- Modify `packages/contracts/src/access.ts` — `unlockRequestListQuerySchema` gains `branchId`.
- Modify `apps/api/src/access/unlocks.service.ts:116` — honour it, ANDed with the caller's scope.
- Modify `apps/admin/src/routes/branch-tests.tsx` — the third tab.
- Modify `apps/admin/src/routes/branches.tsx` — a "Configure tests" row action.
- Test `apps/api/test/unlocks.unit.test.ts`.

**Acceptance**

- The tab holds only requests from students at THIS branch, and approve/decline reuse the existing
  flow unchanged.
- The `branchId` filter NARROWS the caller's scope and never widens it: a super admin filtering to
  one branch sees that branch; a branch admin passing another branch's id sees nothing, not
  everything.
- The Branches list opens this screen from one row action behind the existing menu, and the action
  is absent for a branch the admin does not hold — the server refuses anyway, so this is courtesy.
- A branch admin reaches the screen through Branches, which is already in their nav.

---

## Complete — 2026-08-31 (`b6cc734`, `f629b91` … `9312d78`)

All five tasks are built. Task 1 landed on 2026-08-29 as `b6cc734`; tasks 2–5 on 2026-08-31.

Three things the plan did not anticipate, all found by opening the screen:

- **A series older than the fan-out could not be switched at all** (`b0d5d5d`). The list reads from
  `TestSeries` so a series with no `BranchTestConfig` row shows switched OFF, but task 1's write
  demanded a row per pair and refused the whole draft without one — a switch the screen offered and
  the server could only refuse. The write now creates the row the fan-out would have, and the
  all-or-nothing refusal is kept for an id naming no series at all.
- **The route guard is a pinned warning, not a blocker.** The app mounts `BrowserRouter` and
  `useBlocker` needs a data router, so leaving the SCREEN with a draft is warned about rather than
  intercepted; leaving the TAB asks first, because the tab that leaves is unmounted by Radix.
- **The series picker announced "No series yet" as a filter**, where choosing nothing means all of
  them. It takes a placeholder now, keeping the form's wording as its default.

Two shared moves the plan's file lists did not name: `toMinutes`/`toSeconds`/`opensLabel` to
`apps/admin/src/lib/schedule-format.ts`, because two screens now convert between the seconds the API
speaks and the minutes a reader speaks; and `AccessRequestList` out of `access-requests.tsx`, so the
third tab reuses the queue rather than rebuilding it.

Every pair of screens writing one row now busts both keys: the two series editors, and the two
timing editors.

## Not in this plan

- The series form's "enable everywhere" still switches on branches deliberately switched off. Its
  confirm already says so, and it is now visible from two screens rather than one.
- `BRANCH_TEST_MANAGEMENT` is not granted by creating a branch admin — the Permissions screen owns
  granting, as it does for every other key. Creating one who can use this screen is two steps, and
  that is the existing shape rather than something this plan changes.
