# When a test opens: timing moves from the series to the test — implementation plan

> **Done** — landed as five commits rather than nine tasks: dropping a column meant contracts,
> schema, resolver, attempts and the series screen could not each be green alone, so Tasks 1-4
> shipped together.
>
> **For agentic workers:** T2 is a migration that DROPS columns and T3/T4 are the access and
> attempt paths — all three high-stakes. T6 is an accessibility-sensitive control. Lean loop per
> `docs/superpowers/WORKFLOW.md`; invoke the `ui-conventions` skill before any screen work.

**Goal:** A branch is given a test series indefinitely, and _when_ an exam happens stops being a
property of the series and becomes a property of the test — one unlock time inside the series, and
per branch, how late a student may join and how much longer they get. A test nobody has sat can be
taken back out of a series.

## What is there today

- **`BranchTestConfig(branchId, testSeriesId)` carries `enabled`, `startAt`, `endAt`.** The two
  dates are the ONLY timing in the system: `availabilityAt()` in `access-resolver.service.ts:277`
  turns them into `UPCOMING`/`ACTIVE`/`ENDED`, and `project()` copies one `canStart` onto every
  test in the series. A test has no time of its own.
- **`TestSeriesTest(testSeriesId, testId, order)`** is the join. `order` is presentation only.
- **`TestSeries.sequentialTests` and `unlockMode`** — `unlockMode` is enforced through
  `StudentSeriesUnlock`; `sequentialTests` is **carried to the client and enforced nowhere**. It is
  a flag the server reads back out and nothing else.
- **Nothing implements late entry or extra time.** No columns, no code. §4 of the mock-test spec
  lists extra time under "fold into extra-time" and it was never built.
- **`Attempt` records `testId` and `studentId` — never a series.** "Attempted in this series" is
  not a question the data can answer.
- **`setSeries` deletes every link and rebuilds it** (`offering.service.ts:50`), so unticking a
  series in the test builder detaches a test students have already sat, silently.
  `assertStillReachable` only stops an ACTIVE test losing its last series.
- **`apps/test` reads none of the catalog yet** — the student portal has login, dashboard, account
  and profile. Changing `StudentCatalogSeries` costs the API, contracts and their tests, nothing else.
- The resolved catalog is cached in Redis under a key that already carries a `CATALOG_SHAPE`
  (`access-resolver.service.ts:29`), put there for exactly this kind of change.

## The design

**A branch either runs a series or it does not.** `BranchTestConfig` keeps `enabled` and loses both
dates. There is no series window, so `SeriesAvailability` is deleted rather than left always-ACTIVE:
a field that can only say one thing teaches a reader the wrong model.

**`TestSeriesTest.unlockAt`** — when this test opens inside this series, one time for everyone. It
is the extension of `sequentialTests` and `unlockMode`, which are already one setting for every
branch. Null means what today means: open as soon as the series is reachable. A ranked mock is only
a rank if the cohort sat it together, which is why this is not per branch.

**`BranchTestSchedule(branchId, testId)`** — `lateEntrySec` and `extraTimeSec`, both null, the row
created only when a branch sets something. `BranchTestConfig` is created eagerly for every branch
when a series is created; a row per branch per TEST would be thousands of rows of nulls, so absence
is the default rather than a row full of them.

<late-entry-is-a-duration>

**Late entry is measured FROM the unlock, not from the wall clock.** `lateEntrySec` is "how long
after this test opens a student may still begin", so it cannot contradict `unlockAt`, it survives
the exam being moved, and it is what an institute says out loud — "entry closes thirty minutes
after start". A cutoff with `unlockAt` null has nothing to count from and is therefore not a
cutoff: `closesAt` is null unless both halves exist.

</late-entry-is-a-duration>

**The window lands on the TEST in the student's catalog.** `StudentCatalogTest` gains `opensAt` and
`closesAt` beside `canStart`; `StudentCatalogSeries` loses `availability`, `startAt` and `endAt`.
Two timestamps are enough for a student screen to say "opens at 10:00" or "entry closed" — a third
enum would only restate what the clock and those two already carry.

**Both ride the cache that already exists.** `opensAt`, `closesAt` and `extraTimeSec` are resolved
into `ResolvedCatalog`, so `assertCanStart` and the deadline read them from the same Redis entry
the catalog already builds. The start path gains no query and the live-test scaling rules are
untouched. `CATALOG_SHAPE` bumps to `v2` — the epochs survive a deploy, so without it an entry the
previous build wrote is read back as the new shape and every test reads as always-open.

**Extra time is added where the deadline is computed, once.** `deadlineFrom(startedAt, durationSec)`
is the server's only deadline; the branch's `extraTimeSec` is added to the duration handed to it,
not layered on afterwards, so there is still exactly one expression of when a sitting ends.

**A link is not droppable from under an attempt.** The guard is "this test has any attempt", which
is the honest reading of a table that never recorded a series. Adding `testSeriesId` to `Attempt`
would make the wording literally true at the cost of the live-test hot path, and buys nothing an
institute would notice: a test that has been sat should not be quietly detached from anywhere.

## Tasks

### Task 1: The rules, and the shapes that carry them

**Risk:** normal · **Reviews:** 1 · **Model:** opus
**Files:** modify `packages/contracts/src/access.ts`; extend `packages/contracts/test/access.test.ts`.

- [x] `testWindow({ unlockAt, lateEntrySec })` → `{ opensAt, closesAt }`. `closesAt` is null unless
      both halves exist, and is never earlier than `opensAt`.
- [x] `testIsOpen(window, now)` — open at exactly `opensAt`, closed at exactly `closesAt`, matching
      the `endAt <= now` boundary the series window used.
- [x] `studentCatalogTestSchema` gains `opensAt` and `closesAt`.
- [x] Delete `SERIES_AVAILABILITY`, `seriesAvailabilitySchema`, `SERIES_AVAILABILITIES`, and
      `availability`/`startAt`/`endAt` from `studentCatalogSeriesSchema`.
- [x] `branchTestConfigSchema` and `updateBranchTestConfigSchema` lose both dates and the refine
      that ordered them; `branchTestScheduleSchema` + its update body arrive, seconds nullable.
      **Acceptance:** a test with no unlock is open at any instant; one with an unlock is shut a
      millisecond before it and open at it; a cutoff with no unlock is no cutoff; at exactly the
      cutoff a test is shut.

### Task 2: The schema, and a migration that drops two columns

**Risk:** HIGH · **Reviews:** 2 · **Model:** opus
**Files:** modify `prisma/schema.prisma`; create the migration by hand.

- [x] `TestSeriesTest.unlockAt DateTime? @db.Timestamptz(3)`.
- [x] `model BranchTestSchedule` — `branchId`, `testId`, `lateEntrySec Int?`, `extraTimeSec Int?`,
      timestamps, `@@id([branchId, testId])`, `@@index([testId])`, both FKs `onDelete: Cascade`.
- [x] `BranchTestConfig` drops `startAt` and `endAt`.
- [x] The migration explains the data move at its top: branch windows are DISCARDED, not migrated,
      because timing is now a property of a test and no branch window can be turned into one.
      **Acceptance:** `pnpm db:migrate:deploy` from scratch and `pnpm db:check` both pass; a seeded
      catalog still loads.

### Task 3: The resolver serves a window per test

**Risk:** HIGH · **Reviews:** 2 · **Model:** opus
**Files:** modify `apps/api/src/access/access-resolver.service.ts`; extend
`apps/api/test/access-resolver.unit.test.ts`.

- [x] `catalogInclude` reads `unlockAt` off the join and the student's own `BranchTestSchedule`
      rows; `ResolvedTest` carries `opensAt`, `closesAt` and `extraTimeSec`.
- [x] `canStart` is computed per test — permitted student, unlocked series, and the test's own
      window — instead of one series flag copied across every test.
- [x] `availabilityAt` and every series-window field are deleted.
- [x] `CATALOG_SHAPE` bumps to `v2`.
      **Acceptance:** a test before its unlock is listed and not startable; the same test after it
      is startable; a branch cutoff shuts it again; a series with no unlock times behaves exactly
      as it does today.

### Task 4: Extra time reaches the deadline, and late entry reaches the gate

**Risk:** HIGH · **Reviews:** 2 · **Model:** opus
**Files:** modify `apps/api/src/attempts/attempts.service.ts`,
`apps/api/src/access/access-resolver.service.ts`; extend
`apps/api/test/attempts-service.unit.test.ts`.

- [x] `assertCanStart` refuses a test outside its window, with a message that says whether it has
      not opened or has closed.
- [x] The branch's `extraTimeSec` is added to `durationSec` before `deadlineFrom`, never after it.
- [x] Resume is untouched: the gate asks whether a sitting may BEGIN, and a resumed one already has.
      **Acceptance:** a branch with ten minutes extra gets an `endsAt` ten minutes later than a
      branch with none on the same test; a start before the unlock and a start after the cutoff are
      both FORBIDDEN; a live attempt still resumes after the cutoff.

### Task 5: A test that has been sat cannot be unlinked

**Risk:** normal · **Reviews:** 1 · **Model:** opus
**Files:** modify `apps/api/src/tests/offering.service.ts`,
`apps/api/src/access/test-series.service.ts` and its controller;
`packages/contracts/src/access.ts` (`ADMIN_SERIES_ROUTES`); extend
`apps/api/test/offering.unit.test.ts`.

- [x] `setSeries` refuses to drop a link whose test has any attempt — `CONFLICT`, naming the series
      and the attempt count, before anything is deleted.
- [x] `ADMIN_SERIES_ROUTES.test(id, testId)` — `DELETE /admin/test-series/:id/tests/:testId`
      removes one link under the same guard, beside the `branches` pair already there.
      **Acceptance:** a link with attempts refuses and the row survives; a link with none is gone;
      the refusal names the series and the count.

### Task 6: A date and a time, chosen once

**Risk:** normal · **Reviews:** 1 · **Model:** opus
**Files:** create `packages/ui/src/components/ui/date-time-picker.tsx`; modify
`packages/ui/src/index.ts`; create `packages/ui/test/date-time-picker.dom.test.tsx`.

- [x] `DateTimePicker` — `DatePicker` beside a time field, speaking ONE `YYYY-MM-DDTHH:mm` WALL
      TIME string, exactly as `DatePicker` speaks `YYYY-MM-DD`.
- [x] `packages/ui` holds no zone, so the component never sees an instant: the ADMIN app converts
      with `instituteWallTime` on the way in and `fromInstituteWallTime` on the way out, which is
      also the only place a new zone bug could be introduced.
      **Acceptance:** the component round-trips a wall-time string untouched and clears to empty
      rather than midnight when either half is blank; the admin screen shows `2026-09-01T04:30:00Z`
      as 1 Sep 10:00 and sends that instant back.

### Task 7: The series says which tests it holds, and when each opens

**Risk:** normal · **Reviews:** 1 · **Model:** opus
**Files:** modify `apps/admin/src/routes/test-series-form.tsx`; modify
`packages/contracts/src/client.ts`.

- [x] "How it opens" grows the list the series has never had: its tests in order, an `Opens` column
      on `DateTimePicker`, and Remove behind `RowActions` with a confirm naming the test and the
      series.
- [x] "Where it runs" loses both date columns and becomes branches and a switch.
      **Acceptance:** setting an opening time and reloading shows the same instant in IST; removing
      a sat test refuses with the server's words; removing an unsat one drops it from the list.

### Task 8: A branch lets its students in late, and gives them longer

**Risk:** normal · **Reviews:** 1 · **Model:** opus
**Files:** modify `apps/admin/src/routes/test-builder-offering.tsx`; modify
`packages/contracts/src/client.ts`.

- [x] The Offer step grows "Branch timing": every branch that reaches this test, with late entry
      and extra time in MINUTES, blank meaning none.
- [x] Held as a draft against the server and saved in one confirm listing what changed, the way the
      branch schedule already batches — never a write per keystroke.
      **Acceptance:** blank stays blank rather than saving zero; thirty minutes round-trips as
      1800 seconds; the confirm names how many branches changed.

### Task 9: The docs say what shipped

**Risk:** normal · **Reviews:** 1 · **Model:** opus
**Files:** modify `docs/02-mocktest-feature-spec.md`, `CLAUDE.md`.

- [x] §3 rewritten to the flow that exists: no per-test override of a config's shape, no test-wide
      difficulty default, no batch/group access, FIXED hand-picked vs GENERATED drawn, Offer rather
      than Schedule, and the base config's `difficultyMix` named for the workbook note it is.
- [x] §4 moves extra time out of Drop and into Keep, beside late entry.
- [x] §7 rewritten: a branch is given a series indefinitely; timing is the test's; a sat test cannot
      be unlinked.
- [x] §8's data-model additions carry `unlockAt` and `BranchTestSchedule`, and CLAUDE.md's access
      bullet drops the window.
      **Acceptance:** every claim in the touched sections is true of `prisma/schema.prisma` and the
      services as merged — checked against the file, not against this plan.

## Verify on screen

1. A series: set one test to open tomorrow at 10:00, reload — the same instant in IST, not five and
   a half hours out.
2. Its branch list has a switch and no dates; a branch stays on with no expiry.
3. On the test's Offer step, give one branch thirty minutes' late entry and ten minutes' extra
   time; leave another blank; save once and reopen — blanks are still blank.
4. Remove an unsat test from the series: gone. Remove one with an attempt: refused, naming it.
