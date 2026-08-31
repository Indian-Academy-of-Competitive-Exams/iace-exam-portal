# The branch-level admin — design

Date: 2026-08-29 · Status: approved, not built

A branch admin signs in and sees their own branches and nothing else: their students, their
configuration, their own trail. Today nothing in the platform reads a branch off an admin.

## Three pieces, in this order

|       | Piece                                           | Depends on |
| ----- | ----------------------------------------------- | ---------- |
| **C** | A FREE series may not sit behind a prerequisite | nothing    |
| **A** | Branch scoping — the boundary                   | nothing    |
| **B** | The branch configuration screen                 | A          |

**C is unrelated to the other two** and is built first because it is small and independent. **A is
a security boundary and must be finished before it is described as one** — a half-scoped list looks
enforced, which is worse than a list nobody trusts. **B is pointless without A**: a screen scoped to
branches, for admins who are not.

---

# C · A FREE series may not sit behind a prerequisite

`openToAsk` offers a student every FREE series they do not already reach, and checks no
prerequisite. `needsUnlock` holds shut any series carrying one. So a FREE series with a
prerequisite is advertised in the browse list and then refused — the one shape the FREE kind exists
to rule out.

- `kind = FREE` implies `prerequisiteSeriesId IS NULL`.
- The service refuses **both** directions and names the series in the way: setting `kind` to FREE
  while a prerequisite is held, and setting a prerequisite on a series already FREE. It never
  clears the prerequisite on the admin's behalf — that would change who reaches the series with
  nobody deciding it.
- The migration adds only `CHECK (kind <> 'FREE' OR "prerequisiteSeriesId" IS NULL)`. **It moves no
  data**, so a deploy against a database holding a violating row stops, by choice. Before deploying,
  run:

  ```sql
  SELECT id, name FROM "TestSeries" WHERE kind = 'FREE' AND "prerequisiteSeriesId" IS NOT NULL;
  ```

  Empty is the go-ahead. Anything else is fixed by hand first.

Tests: a FREE series refuses a prerequisite; a series holding one refuses becoming FREE, naming it;
a STANDARD series with a prerequisite is untouched.

---

# A · Branch scoping

## The role is derived, never stored

A branch admin is `!isSuperAdmin && !allBranches`. Nothing else defines one.

`Admin.allBranches` and `AdminBranch` already carry this, and `allBranches`' own comment forbids
inferring it elsewhere — _"an admin who has been given no branch yet reaches none, and reading that
as 'all of them' is the failure this column exists to prevent."_ A stored `role` column would be a
second answer to a question that already has one, free to disagree with it.

What the create form gains is the **scope**, not a role field: an "Every branch" box, and the branch
multi-select it reveals when unticked. The role is shown, derived, in the Role column — Super admin,
Branch admin, Admin — and the server has never heard of one.

**It does not grant permissions**, though an earlier draft of this spec said it would.
`createAdminSchema` takes no permissions, deliberately: granting is the Permissions screen's job and
the create confirm already sends the admin there. Adding grants to create would be a second write
path for the same rows to serve one screen's convenience.

`createAdminSchema` and `updateAdminSchema` already accept `allBranches` and `branchIds`, and
`Admin` returns both. Only the multi-select is missing.

**An admin with `allBranches: false` and no branches reaches nothing.** That is a real state the
contract names, so their screens say so in an `Alert` rather than showing an empty table that reads
as "no students yet".

## The resolver

One function answers, for an authenticated admin: every branch, or this set of ids. `isSuperAdmin`
bypasses and `allBranches` bypasses; everyone else gets their set. It sits beside
`feature-permission.guard.ts`, whose shape it mirrors.

`adminIdentitySchema` gains `allBranches: boolean` and `branchIds: string[]`. It carries
`isSuperAdmin` and `permissions` and nothing about branches today, and without these the nav cannot
decide what to render.

**Out of scope reads as missing, never as refused** — `NOT_FOUND`, the convention the attempt and
student lookups already follow, because an id is not a thing to confirm the existence of.

## Where it is enforced

- **Student list** — narrowed by `currentBranchId`. The count, the search and the pagination all
  agree, because they all come off the same `where`.
- **Student detail** — a student at another branch is missing.
- **Student writes** — creating or editing a student into a branch the admin does not hold is a
  validation error naming the branch, not a silent rewrite.
- **Student import** — the roster carries a `Branch Name` column per row. A row naming a branch
  outside scope fails **that row** with a reason and the rest still commit, which is how every other
  import error already behaves.
- **Branches list** — narrowed to theirs. This is also how a branch admin holding several picks one
  for part B, so no picker is invented.
- **Audit** — a branch admin's list is forced to `actorId = self`. `RowActionLog` stores an entity
  id and a label and **no branch**, so branch-scoped audit would mean resolving every entity to a
  branch, which is impossible for a row since deleted. Their own actions is both what was asked for
  and the only thing the table can answer.
- **Unlock requests** — narrowed to their branches' students.

## Complete — 2026-08-29 (`ddd5a8a` … `08f924a`)

Every admin-reachable route keyed by a student, a branch, or a request from one narrows. Three of
the holes were not in the plan when it was written: the four routes under
`admin/students/:studentId/*`, both importers writing by mobile, and the series filter that answered
what a student at another branch already reaches.

It is a permission boundary for students, branches and requests. It is NOT one for questions, tests
or configs — those are institute-wide by design and hidden from a branch admin's nav rather than
scoped, and hiding is a courtesy.

Three edges that stay true:

- A student at NO branch is in nobody's scope, so self-signups and scholarship intakes are visible
  to super admins alone until somebody gives them a branch.
- Scope rides the JWT, so removing a branch lands when the access token turns over — the same
  window a revoked permission already has.
- The importer says a branch is "not one of yours" rather than that it does not exist, so branch
  NAMES are discoverable by probe. The alternative was lying to an admin about their own roster.

## Navigation

A branch admin's nav: Students (All students, Import students), Branches, Audit. Everything else is
absent.

**Branch configuration IS a nav row — three of them**, revised 2026-08-31 and built the same day.
The original decision below was made for a reader who visits the screen occasionally; the people who
actually live here are branch admins, for whom every visit was Students → Branches → find your own
row → menu → Configure tests. That is not a click, it is a hunt, and it repeats all day.

So: a **Branch tests** section — Test series, Tests, Access requests — gated on
`BRANCH_TEST_MANAGEMENT` and named in the branch admin's route allow-list.

What this costs, stated rather than hidden:

- **The branch is a picker now, not a path.** A nav row's `to` is a fixed string, so it cannot carry
  a branch. The branch rides the URL as `?branchId=`, defaults to the viewer's first, and is
  remembered in `STORAGE_KEYS.BRANCH` so moving between the three keeps it. An admin holding ONE
  branch — the case this is for — never sees the picker at all.
- **Three of the four names collide with the Tests section.** A branch admin sees only these, so
  there is no collision for them; a super admin sees both, and the section name is what separates
  them.
- **A pending draft can no longer be intercepted on the way out.** Under one screen with tabs, the
  tab change was ours to guard; three routes means the nav is the router's, and `useBlocker` needs a
  data router this app does not mount. Changing branch still asks, and a pinned warning names the
  count for as long as a draft is held.

The original reasoning, kept because it is still why the branch is not in the path:

> It opens from a row on the Branches list, which is what makes the branch a route rather than a
> picker. An admin holding one branch pays one click for that; inventing a second, shape-shifting
> destination to save it costs more than it saves.

The Branches row action stays — it is how a super admin jumps to a branch they picked off the full
list, and it now carries `?branchId=` into the same screens.

Branch writes stay super-admin only, as they are today: `BranchesController` reads under
`STUDENT_MANAGEMENT` and creates, updates and deletes under `RequiresSuperAdmin`. A branch admin
reads the list and configures a branch's tests; they never create or retire one.

**Nav gating is presentation, not the boundary.** `SuperAdminOnly` already says this of itself and
is right to: every endpoint behind every hidden row enforces on its own. A row disappearing is a
courtesy to the reader, never the reason a request is refused.

## Tests

- A branch admin sees only their branches' students; one at another branch is `NOT_FOUND`.
- Moving a student to a branch they do not hold is refused, naming the branch.
- An import naming an out-of-scope branch fails that row and commits the others.
- An `allBranches` admin and a super admin are both unnarrowed.
- An admin with no branches gets an empty list and is told why.
- Audit shows a branch admin their own actions and nobody else's.

---

# B · The branch configuration screen

`/branches/:branchId/tests`. One `TableFrame`, its own `tabs` prop, `PageCrumbs` carrying the branch
name as `tail`. Permission `BRANCH_TEST_MANAGEMENT` — reserved for this and used by nothing today —
READ to open, WRITE to change. Reached from the Branches list row action.

## Test series

Every series, with this branch's flag. A row always exists: `createSeries` fans out `enabled: false`
to every live branch and `fanOutToBranch` does the same for a new branch. So the column is a
boolean, never a third "not configured" state. Filters: search, exam, runs.

Toggling changes what students reach, which the conventions say confirms both ways — and per-row
confirmation across forty series is what those same conventions call absurd. So it takes the
sanctioned escape: hold the changes as a draft diff, show the pending count, confirm once listing
every change, drop the draft after a save either way. The toggles are not live until saved.

## Tests

The tests reaching this branch through its enabled series: the test, its series, when it unlocks,
and this branch's late entry and extra time. Editing is a `FormDialog` behind `RowActions`. Schedule
only — no sitting counts, no per-student blockers.

## Access requests

The existing queue, narrowed to this branch's students. Approve and decline reuse the flow in
`access-requests.tsx` unchanged.

## API

```
GET   /admin/branches/:branchId/test-series               paginated; search, exam, runs
PATCH /admin/branches/:branchId/test-series               batch [{ testSeriesId, enabled }]
GET   /admin/branches/:branchId/tests                     paginated
PUT   /admin/branches/:branchId/tests/:testId/schedule    both fields null deletes the row
GET   /admin/unlock-requests?branchId=…                   new filter; the decide route is unchanged
```

The batch PATCH exists because the screen batches: one confirm, one request, one cache bust. A
schedule of two nulls deletes the row rather than storing them, because no row **is** the plain
rules — a row of nulls says it twice and the two would drift.

`AUDIT_FEATURE` gains `BRANCH_TEST_CONFIG`: which series a branch runs is a change to what students
reach, and every other change of that kind is audited. `RowActionLog.feature` is the Prisma enum
`AuditFeature`, so this is a migration and this task carries the schema gates.

Both axes write one row, so the series form and this screen invalidate the same query keys.

## Accepted, not fixed

The series form's "enable everywhere" still switches on branches deliberately switched off. It is
now visible from two screens rather than one, which makes it easier to notice rather than more
dangerous, and its confirm copy already says what it does.

**A series draft is lost on navigation, decided 2026-08-31.** Once the tabs became three nav rows,
leaving by the sidebar, a link, or a reload discards a pending draft without asking — only changing
branch still asks. Catching the rest means `useBlocker`, which needs a data router the app does not
mount, and converting it for this alone is not worth it. Nothing was written, so a lost draft leaves
the server exactly as it was, and the pinned warning names the count for as long as one is held.
This is not a bug to fix; revisit it only if the app moves to a data router for other reasons.

## Tests

- The batch toggle applies exactly the changes it confirmed and none it did not.
- Clearing both schedule fields returns the branch to the plain rules rather than storing zeros.
- A request from another branch's student never appears.

---

---

## Built

**C** — `20260829120000_a_free_series_waits_on_nothing`. **A** — complete, see above. **B** —
complete on 2026-08-31 (`b6cc734`, `f629b91` … `9312d78`); what the build found that this spec did
not anticipate is in the plan's own completion note.

## Shape of the work

Roughly thirteen commit-sized tasks across three plans, one per piece.

**C — one task.** The rule, the constraint, the migration, the tests. Two review rounds: it carries
a migration.

**A — seven.** Identity fields and the scope resolver; the student list and detail; student writes;
the importer; audit; the admin form's preset and multi-select; the nav and the scoped Branches list.
The resolver takes two review rounds, and so does the importer — a row-level rule that lets the
wrong row through is the whole boundary gone.

**B — five.** The two read endpoints; the two writes plus the audit feature and its migration; the
Test series tab; the Tests tab; the Access requests tab and the entry point.

Each piece gets its own implementation plan when it is reached, not now.
