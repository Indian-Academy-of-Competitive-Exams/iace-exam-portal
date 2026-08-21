# 04 — Students, Groups, Branches & Access — Target Model (draft for approval)

Consolidates the Students‑section design — **approved**; this is `docs/04`. Drives
the migration + build. Prisma sketches are
field‑level; `→` notes are behaviour. Enums are shared constants in
`packages/contracts` (SCREAMING_SNAKE), mirrored by Prisma.

---

## 1. Enums (contracts)

```
STUDENT_TYPE   = ONLINE | OFFLINE | NON_IACE
GROUP_TYPE     = GLOBAL | EXAM | PROGRAM | SCHOLARSHIP | NON_IACE
BRANCH_TYPE    = PHYSICAL | VIRTUAL
IMPORT_SOURCE  = INDIVIDUAL | SHEET | SCRIPT | SELF_SIGNUP
AUDIT_FEATURE  = STUDENT | STUDENT_PROFILE | GROUP | BRANCH | ADMIN | QUESTION | TEST  (extensible)
AUDIT_ACTION   = CREATE | UPDATE | DELETE | ACTIVATE | DEACTIVATE | IMPORT
ACTOR_TYPE     = ADMIN | STUDENT | SCRIPT | SYSTEM
```

`ExamType` stays a table; `enrolledExams` stores its codes.

---

## 2. Student

```
Student
  id
  mobile            @unique           // editable by ADMIN only, never the student
  externalRef       String?  @unique  // main-portal id — idempotent re-sync + reconciliation
  studentType       STUDENT_TYPE       // import-mandatory
  enrolledExams     String[]           // ExamType codes; GIN index; validate vs ExamType
  program           String?            // offline richer-variant marker (nullable)  [CONFIRM name/shape]
  directGroupIds    String[]           // scholarship + non-iace direct grants; GIN; validate
                                       // REPLACES the old implicit Student⇄Group join
  baseBranchId      String?            // initial branch (history)
  currentBranchId   String?            // active branch — access/scheduling uses THIS
  // --- account state (two separate concepts) ---
  isActive          Boolean @default(true)   // can LOG IN and view history/performance
  isTestBlocked     Boolean @default(false)  // the admin "deactivate": locked from starting/attempting tests
                                             //   [CONFIRM name — this is your "deactivation"]
  deletedAt         DateTime?          // full soft-delete (cannot log in) — distinct from isTestBlocked
  // --- existing ---
  pinHash?  pinIsDefault  fullName?  preTestReady  profileCompleted
  // --- provenance (lightweight audit cols) ---
  createdVia        IMPORT_SOURCE
  createdById       String?            // admin id, or null for SELF_SIGNUP / SCRIPT
  createdAt updatedAt

  profile StudentProfile?
```

- **Auth change required:** login is allowed while `isActive && deletedAt == null`; `isTestBlocked` only gates the attempt‑start guard. (Today `isActive == false` blocks login — must be decoupled.)
- Uploads (photo/Aadhaar/PAN) excluded from import & add — added later by the student.
- `StudentProfile` unchanged in shape; import writes Student + Profile in **one transaction** and recomputes `preTestReady` / `profileCompleted`.

## 3. Branch

```
Branch
  id
  name        @unique     // UPPERCASE, single-spaced
  type        BRANCH_TYPE  // PHYSICAL | VIRTUAL
  isActive    Boolean @default(true)   // inactive = no NEW tags/students/series; existing untouched
  createdAt updatedAt deletedAt
  groups      Group[]      // M:N — the exams this branch offers (catalog)
```

- Drop `isGlobal` (global is a group type now).
- All online students share one VIRTUAL "Online" branch for now.
- Row‑level audit only (central `RowActionLog`), plus the lightweight cols.

## 4. Group

```
Group
  id
  name        // UPPERCASE
  type        GROUP_TYPE
  examType    String?      // ExamType code — set for EXAM & PROGRAM; null otherwise
  isActive    Boolean @default(true)   // write-freeze only (existing access retained)
  branches    Branch[]     // M:N catalog (EXAM/PROGRAM) — replaces the old single branchId
  testSeries  TestSeries[] // M:N (existing)
  createdAt updatedAt deletedAt
  @@unique([examType, name])   // per exam type
```

- **GLOBAL**: singleton, implicit membership (everyone) — no rows stored. Free series are manually linked here.
- **EXAM / PROGRAM**: access via `enrolledExams` match; tagged to branches (catalog).
- **SCHOLARSHIP / NON_IACE**: direct — referenced from `Student.directGroupIds`.

## 5. TestSeries (unchanged shape)

`tests TestSeries` M:N and `groups Group[]` M:N as today. A series can belong to
several groups; "free" = linked to the GLOBAL group. No new field.

## 6. BranchTestConfig (new — "separate configuration at branches")

**Access is granted at series level; scheduling defaults here and is extensible to
test level without touching access.**

```
BranchTestConfig            // access + default (series-level) schedule
  id
  branchId
  testSeriesId
  enabled     Boolean       // this branch's students get this series
  startAt     DateTime?      // default availability window for the whole series
  endAt       DateTime?
  createdAt updatedAt
  @@unique([branchId, testSeriesId])
```

- **Access stays at series level** — a branch enabling a series grants its students that series.
- **Scheduling can move to test level soon**, additively, with no access change:

```
BranchTestSchedule          // FUTURE seam — per-test window override
  id  branchId  testId  startAt?  endAt?
  @@unique([branchId, testId])
```

The resolver uses the series‑level window by default and prefers a matching
per‑test override once present. Changes rarely; gated by `BRANCH_TEST_MANAGEMENT`.

## 7. Admin ↔ Branch seam (phased)

```
Admin.branchIds  String[]   // branches a branch-scoped admin may manage; empty/null = all
```

Build the seam now; enforcement/UI (the "branch permission panel") is a later
phase. A branch‑scoped admin's writes on branch features filter to these.

## 8. Central audit (two tables only)

```
ImportLog
  id  feature AUDIT_FEATURE  source IMPORT_SOURCE  actorId
  fileS3Key String?        // uploaded sheet — OR a snapshot of the SCRIPT-sync payload
  total  created  updated  skipped  failed
  status  startedAt  finishedAt  errors Json

RowActionLog
  id  feature AUDIT_FEATURE  entityId  action AUDIT_ACTION
  actorType ACTOR_TYPE  actorId
  changed Json           // { field: { from, to } } — the clear "what changed"
  importLogId String?    // set when this row came from an import
  createdAt
  @@index([feature, entityId, actorId, createdAt])   // + retention policy
```

Scope = data CRUD + imports only (never exam interactions — those stay in
`AttemptAnswer`). Audit Logs is an always‑on, self‑scoped feature (super admin =
all; normal admin = own actions).

---

## 9. The access / schedule resolver (the linchpin)

```
resolveAccess(student) →
  series =
      GLOBAL group series                                              // everyone, implicit
    ∪ EXAM/PROGRAM group series WHERE group.examType ∈ student.enrolledExams   // the WHAT
    ∪ series of groups in student.directGroupIds                       // scholarship + non-iace
  // NOTE: inactive groups are NOT subtracted — inactive only blocks NEW links.
  live = for each series, apply student.currentBranch → BranchTestConfig (enabled + window)  // the WHEN

  gating:
    - cannot resolve for login purposes unless isActive && !deletedAt
    - if isTestBlocked → series are VIEW-ONLY (history/performance visible; attempt-start denied)
```

- One function, both callers: the dashboard list **and** the attempt‑start guard.
- **Cached in Redis**, invalidated on the (infrequent) events that move access:
  enrollment edit, `currentBranch` change, branch↔group tag, `BranchTestConfig`
  change, group/branch active toggle, direct‑grant change. Because these are
  rare, simple key‑bust invalidation is enough — no realtime machinery.

## 10. Lifecycle rules

- **Deactivate student** → `isTestBlocked = true`: logs in, views records, cannot take tests. (Not a logout, not a session revoke.)
- **Inactive group / branch** → write‑freeze: no new students/series/branch tags; existing access retained.
- **In‑progress attempt during an access change** → relaxed: let it complete; changes apply to future access only.
- **Soft‑delete** (`deletedAt`) → full removal (cannot log in) — separate from deactivation.

## 11. Import (one validation function: add / sheet / script)

- **Mandatory:** `mobile` · `studentType` · `enrolledExams` (iace, ≥1) · `branch` (offline).
- **Rules:** non‑iace → `currentBranch` null, `enrolledExams` may be empty, direct groups instead; online → the Online branch; offline → a physical branch. Each `enrolledExams` entry ∈ the branch's offered exams (offline); Online offers the full set.
- Default PIN seeded (`pinIsDefault`); `externalRef` set for SCRIPT sync; every import writes an `ImportLog` (+ file/payload in S3). No uploads in import.

## 12. Notifications

In‑app `Notification` (web) now + mobile **push** later via the outbound‑sender
seam. Triggers: a `BranchTestConfig` making a test live, an enrollment added, a
direct/scholarship grant added.

---

## Confirmed

1. Test‑lock field = **`isTestBlocked`** (login stays on `isActive`); program marker = `program`.
2. `BranchTestConfig` at **series** level now — access stays series‑level, scheduling extensible to test level via the `BranchTestSchedule` seam above.
3. **`Admin.branchIds` array** — no join table.
