# Branch scoping — implementation plan (piece A)

**Spec:** `docs/superpowers/specs/2026-08-29-branch-level-admin-design.md`, part A.
**Loop:** `docs/superpowers/WORKFLOW.md`. **Binding core:** `docs/superpowers/task-constraints.md`.

**Goal:** a branch admin sees their own branches and nothing else — their students, their trail,
their configuration.

**Format note.** This plan uses the repo's task template, not the generic writing-plans one:
`CLAUDE.md` points every task at `WORKFLOW.md`, whose cut-list names "test code in briefs" as a cost
to stop paying and requires acceptance criteria to be behaviours the human owns. The implementer
writes the tests once, from the criteria.

## Global constraints

- A branch admin is `!isSuperAdmin && !allBranches`. **Derived, never stored** — no `role` column.
- Out of scope reads as **`NOT_FOUND`**, never `FORBIDDEN`.
- **Nav gating is presentation, never the boundary.** Every endpoint enforces on its own.
- Until every task here is done, this **is not a permission boundary** and must not be called one
  in a commit message, a comment or a report.
- Super admins bypass; `allBranches: true` bypasses.
- No new date helper; instants stay instants (`task-constraints.md`, Dates).
- **No backfill migration, and here is why.** `Admin.allBranches` defaults to false and the branch
  multi-select does not exist until Task 2, so every non-super admin in a database today has no
  branches and would see an empty roster the moment Task 3 lands. This deployment has only super
  admins, who bypass, so nobody is affected — confirmed 2026-08-29. **If a non-super admin exists
  before this ships, they are locked out and a backfill is needed first.**

---

### Task 1: Branch scope reaches the request, and one resolver answers it

Risk: **high** · Model: strong · Reviews: **2**
Exemplar: `apps/api/src/auth/guards/feature-permission.guard.ts` — the shape a scope check mirrors.

**Files**

- Modify `packages/contracts/src/auth.ts` — `adminIdentitySchema` gains `allBranches: boolean` and
  `branchIds: string[]`.
- Modify `apps/api/src/auth/token.service.ts` — mint both as claims, beside `permissions`.
- Modify `apps/api/src/auth/auth.service.ts:235` and `:376` — both places that build an admin
  identity.
- Modify `apps/api/src/admins/admins.service.ts:83` — a reader beside `permissionsFor`, off the
  `ADMIN_INCLUDE` that already selects `branches: { select: { branchId: true } }`.
- Modify `apps/api/src/common/security/authenticated-user.ts` and `.../security/index.ts`.
- Modify `apps/api/src/auth/guards/jwt-auth.guard.ts:35-44` — read the new claims, defaulting the
  way `isActive` already does for a token minted before they existed.
- Create `apps/api/src/common/security/branch-scope.ts` — the resolver and the `NOT_FOUND` refusal.
- Test `apps/api/test/branch-scope.unit.test.ts`.

**Acceptance**

- A super admin and an `allBranches` admin are both unnarrowed.
- A branch admin resolves to exactly the branch ids they hold.
- An admin with `allBranches: false` and no branches resolves to none — **never to all**. This is
  the failure `allBranches` exists to prevent, and its comment says so.
- Asking the resolver about a branch outside scope refuses as missing, not as forbidden.
- An access token minted before this task still works, and reads as reaching NO branch — never as
  unnarrowed. Fail closed: "none given" read as "all of them" is the hole this task exists to close.
  The cost is that an `allBranches` admin holding a pre-deploy token sees an empty roster once Task 3
  lands, for at most one `JWT_ACCESS_TTL`. Super admins are unaffected: `isSuperAdmin` is already in
  the old claims.

**Decision the reviewer must confirm.** Scope rides the JWT, exactly as `permissions` and
`isSuperAdmin` already do, so removing a branch from an admin takes effect when their access token
next turns over rather than instantly. The alternative is a Postgres read on every admin request.
The window is the access-token TTL and it is the same window a revoked permission already has —
but it is a security property, so it is stated here rather than discovered.

---

### Task 2: An admin is given branches on the screen that creates them

Risk: normal · Model: strong · Reviews: 1
Exemplar: `apps/admin/src/routes/permissions.tsx` for the card-per-record shape;
`ui-conventions` for `Combobox` and `FormDialog`.

**Files**

- Modify `apps/admin/src/routes/admins.tsx` — the branch multi-select and the role preset.
- Modify `apps/admin/src/lib/constants.ts` if a label or query key is needed.

**Acceptance**

- Creating an admin offers "Every branch", and the branch multi-select it reveals when unticked.
  `createAdminSchema` already takes `allBranches` and `branchIds`; no contract changes.
- It grants no permissions. `createAdminSchema` takes none, deliberately — the Permissions screen
  owns granting and the create confirm already points there.
- The Role column names what is derived: Super admin, Branch admin, Admin.
- An existing admin's branches are editable, or they could only ever be set once.
- Choosing "every branch" and choosing branches are mutually exclusive on screen.
- Saving an admin with `allBranches: false` and no branches is allowed and says what it means —
  they reach nothing — in an `Alert`, not muted prose.
- Every dropdown is `Combobox`. No native `<select>`.

This comes second so the rest can be checked against a real branch admin rather than hand-written
`AdminBranch` rows.

---

### Task 3: The student roster is the admin's own branches

Risk: **high** · Model: strong · Reviews: **2**
Exemplar: `apps/api/src/students/student-query.ts` — `studentWhere` is the one place a roster
narrows, and the count, the search and the pager all read it.

**Files**

- Modify `apps/api/src/students/student-query.ts:7` — `studentWhere` takes the scope.
- Modify `apps/api/src/students/students.service.ts:94` (list), `:119` (detail), `:196` (create) and
  the update path — a branch they do not hold is refused by name on `currentBranchId`.
- Modify `apps/api/src/students/students.controller.ts` — pass the caller's scope.
- Test `apps/api/test/student-query.unit.test.ts`, `apps/api/test/students-service.unit.test.ts`.

**Acceptance**

- A branch admin's roster holds only students whose `currentBranchId` is one of theirs, and the
  total, the search and the pagination agree with it — because they come off one `where`.
- A student at another branch reads as missing, from the detail route and from every route keyed by
  a student id.
- Creating or moving a student into a branch they do not hold is refused, naming the branch, on the
  `currentBranchId` field.
- An `allBranches` admin and a super admin see the whole roster.
- An admin with no branches sees an empty roster and is told why.

**Invariant tests it must not break:** the existing student list, filter and match-mode tests. A
scoped `where` must compose with `match=any`, not replace it — a set-valued filter choosing nothing
still means all of them.

---

### Task 4: An import cannot put a student in someone else's branch

Risk: **high** · Model: strong · Reviews: **2**
Exemplar: `apps/api/src/imports/student-import.ts:205` — `readBranch`, which already returns a
row-level error the preview renders.

**Files**

- Modify `apps/api/src/imports/student-import.ts:205-229` — `readBranch` refuses a branch outside
  the importing admin's scope.
- Modify `apps/api/src/imports/imports.service.ts:60,68` — preview and commit carry the scope into
  the import context.
- Modify `apps/api/src/imports/imports.controller.ts`.
- Test `apps/api/test/imports.unit.test.ts`.

**Acceptance**

- A row naming a branch the admin does not hold fails **that row**, with a reason that says it is
  not one of their branches — not that the branch does not exist, which would be untrue and would
  send them looking in the wrong place.
- Every other row in the same file still commits. The importer stays forgiving.
- The refusal is applied on **commit** as well as preview: a preview is not a permission check, and
  the file can change between the two.
- A super admin and an `allBranches` admin import exactly as they do today.

**One accepted disclosure, deliberate rather than discovered.** The scope check runs AFTER "there is
no active branch called X" and after the student-type pairing check, so a branch admin can learn
every active branch's name, and its type, with a probe file. That contradicts the global "out of
scope reads as missing" — and it is what this task's own criterion demands, because telling somebody
their own roster names a branch that does not exist would be a lie. Branch names are on the students
they already manage; the ids are not disclosed.

This is the task where a rule that lets one row through undoes the whole boundary, which is why it
carries two rounds despite being small.

---

### Task 5: A branch admin's trail is their own actions

Risk: normal · Model: strong · Reviews: 1
Exemplar: `apps/api/src/audit/audit.service.ts:102` — `listRowActions`, which already filters by
`actorId`.

**Files**

- Modify `apps/api/src/audit/audit.service.ts:102` and `apps/api/src/audit/audit.controller.ts`.
- Test `apps/api/test/audit-read.unit.test.ts`.

**Acceptance**

- A branch admin's audit list is forced to their own `actorId`, whatever the query asks for.
- A super admin and an `allBranches` admin are unaffected.
- The list is **not** scoped by branch, and a comment says why once: `RowActionLog` records an
  entity id and a label and no branch, so a row whose entity has since been deleted could never be
  resolved to one. Their own actions is both what was asked for and all the table can answer.

---

### Task 6: The nav shows a branch admin only what is theirs

Risk: normal · Model: strong · Reviews: 1
Exemplar: `apps/admin/src/components/super-admin-only.tsx` — including its comment that it is not
the security boundary.

**Files**

- Modify `apps/admin/src/lib/constants.ts:340` — `NAV_ITEMS` filtered by identity.
- Modify `apps/admin/src/components/app-shell.tsx` — filter where `NAV_ITEMS` is rendered, not the
  constant itself: `PageCrumbs` derives every breadcrumb from `NAV_ITEMS`, so narrowing the catalog
  would leave a reachable page with no trail.
- Modify `apps/admin/src/providers/auth.tsx` — expose the new identity fields.
- Modify `apps/api/src/branches/branches.controller.ts:43` — the branch list narrows to the caller's
  scope.
- Test `apps/api/test/branches-service.unit.test.ts`.

**Acceptance**

- A branch admin's nav is Students (All students, Import students), Branches, Audit. Nothing else.
- Their Branches list holds only their branches, and it is the server that decides that — hiding a
  row is a courtesy, never the reason a request is refused.
- Branch writes stay super-admin only, as they are today.
- A super admin's nav is unchanged.

---

### Task 7: A branch admin decides only their own students' requests

Risk: normal · Model: strong · Reviews: 1
Exemplar: `apps/api/src/access/unlocks.service.ts:116` — `listRequests`, already paginated and
filtered.

**Files**

- Modify `apps/api/src/access/unlocks.service.ts:116` (list) and `:140` (`decide`).
- Modify `apps/api/src/access/access.controller.ts:177-199` — the requests controller.
- Test `apps/api/test/unlocks.unit.test.ts`.

**Acceptance**

- A branch admin's request list holds only requests from students at their branches.
- Deciding a request from a student at another branch reads as missing.
- A super admin and an `allBranches` admin decide any request, as they do today.
- A branch admin has no Access requests nav row after Task 6, and this still holds — which is the
  point: the row being absent is not what refuses the request.

---

## After this plan

Task 7 is what part B's Access requests tab later reads through, so B inherits it rather than
repeating it.

Piece B — the branch configuration screen — is planned separately once this is done and reviewed,
because it is only worth building on a boundary that is finished.

Only when every task above is green may this be described as a permission boundary.
