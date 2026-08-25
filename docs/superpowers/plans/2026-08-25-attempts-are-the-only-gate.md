# A test is protected by having been SAT, not by being frozen — implementation plan

> **For agentic workers:** the API tasks are high-stakes (the attempt path and a database
> trigger's meaning). Lean loop per `docs/superpowers/WORKFLOW.md`. Steps use checkbox tracking.

**Goal:** A test with no attempts can be edited and deleted, whatever else has happened to it.
Being finalized, being offered, being in a series — none of those are history worth protecting.
Having been SAT is.

## What is wrong today

`testDeletionBlocker` refuses a delete when the test is locked, or offered through any series, or
attempted. Only the last of those is a fact the data model holds:

| Dependent on `Test`                                                                  | On delete                            |
| ------------------------------------------------------------------------------------ | ------------------------------------ |
| `Attempt`                                                                            | **`RESTRICT`** (`migration.sql:982`) |
| `PaperQuestion`, `TestSeriesTest`, `TestStat`, `TestSectionStat`, `TestQuestionStat` | `CASCADE`                            |
| `Notification`                                                                       | `SET NULL` (`migration.sql:1069`)    |

The database already refuses exactly one thing, and the service refuses three. The other two are
policy that was never written down anywhere but the blocker itself.

The same asymmetry shows in the copy. `base-config-rules.ts:22` and `:86` have always told admins
a locked config means "a test built from it has already been sat" — while `finalize.service.ts:61`
tripped that lock at finalize, with no attempt in sight. **Those two strings become true for the
first time in this change.**

## The design

**Attempts are the only gate.** `testDeletionBlocker` takes an attempt count and nothing else.
`locksOutTestEdit` is judged against `_count.attempts` rather than `test.isLocked`.

**A shape edit unfreezes.** A frozen paper that no longer matches its own scope is worse than
either state, so editing anything but the title on a locked test with no attempts sets
`isLocked = false`, `finalizedAt = null` and drops `ACTIVE` back to `DRAFT` — `activationBlocker`
already refuses to offer an unfrozen test. `version` increments, or a finalize still holding the
old one could re-freeze behind the edit. The drawn paper survives as a draft paper, redrawable.

**The config lock moves to the first attempt.** `finalize.service.ts` stops writing it; the
attempt-start transaction writes it instead, guarded by the `locked` it has already loaded, so
the steady state issues no SQL at all:

```ts
if (!test.baseConfig.locked) {
  await tx.baseConfig.updateMany({
    where: { id: test.baseConfigId, locked: false },
    data: { locked: true },
  });
}
```

**The trigger is untouched.** `base_config_guard` (`migration.sql:1323`) raises only when
`OLD."locked"` is already true, so `false → true` was always allowed. The lock stays one-way,
stays enforced in Postgres, and still cannot be released by any code path — it simply trips when
something real depends on the shape rather than when a paper is drawn.

**Deleting a test in a series must tell the access cache.** `offering.service.ts:93` emits
`ACCESS_CATALOG_CHANGED` per linked series on a status change. `tests.service.remove` emits
nothing, because a test in a series could never be deleted. Now it can, so the links have to be
read BEFORE the delete cascades them and an event emitted for each — without it a deleted test
stays reachable in a student's cached catalog.

<hot-path>

The config-lock write lands on the attempt-start path, on a row every student sitting that test
shares. This is deliberate and it is the risk to watch:

- The in-memory `locked` check means zero SQL once the first student has started.
- `where: { locked: false }` makes a racing write a no-op rather than a conflict.
- The opening seconds of a live test can still put several transactions on that one row before
  one commits. Bounded and self-extinguishing.

The alternative — tripping it in the BullMQ scoring worker — is fully off the hot path but leaves
a window where students are mid-attempt and the config is still editable. The window is worse
than the contention.

</hot-path>

## Binding / workflow

Read `docs/superpowers/task-constraints.md` and the `ui-conventions` skill. `prisma/schema.prisma`
does not change and neither does any migration — the trigger's behaviour is already what this
needs. Model: opus throughout.

---

## Tasks

### Task 1: The config lock trips on the first attempt, not the first finalize

**Risk:** HIGH · **Reviews:** 2 · **Model:** opus
**Exemplar:** `apps/api/src/tests/finalize.service.ts` for the transaction it leaves;
`apps/api/src/attempts/attempts.service.ts` `create()` for the one it joins.
**Files:** modify `apps/api/src/tests/finalize.service.ts`,
`apps/api/src/attempts/attempts.service.ts`; extend `apps/api/test/test-builder.unit.test.ts`
and `apps/api/test/attempts-service.unit.test.ts`.

- [ ] Drop the `baseConfig.updateMany` from `finalize`. Finalizing freezes the PAPER; it no
      longer touches the blueprint.
- [ ] Add `locked: true` to `SITTABLE_INCLUDE.baseConfig`'s select — one column on a join that
      already happens.
- [ ] Trip the lock inside `create()`'s existing transaction, guarded by the loaded `locked` so a
      test already under way issues no statement.
      **Acceptance:** finalizing a test leaves its config editable; the first student to start an
      attempt locks it; the second student's start writes nothing; a config already locked is
      never written to again.

### Task 2: Attempts become the only gate on editing and deleting

**Risk:** HIGH · **Reviews:** 2 · **Model:** opus
**Exemplar:** `apps/api/src/access/test-series.service.ts:152` for a delete that emits per link.
**Files:** modify `apps/api/src/tests/test-rules.ts`, `apps/api/src/tests/tests.service.ts`,
`apps/api/src/tests/tests.module.ts`; extend `apps/api/test/tests-service.unit.test.ts`.

- [ ] `testDeletionBlocker` takes `{ attemptCount }` alone. Being locked or offered stops
      refusing a delete.
- [ ] `update` judges `locksOutTestEdit` against `_count.attempts`. Rename `FROZEN_TEST_MESSAGE`
      to say what now refuses it: students have SAT this, not the paper is frozen.
- [ ] A shape edit on a locked, unattempted test unfreezes it in the same update: `isLocked`
      false, `finalizedAt` null, `ACTIVE` back to `DRAFT`, `version` incremented. Add `isLocked`
      to `AUDITED_TEST_FIELDS` so the unfreeze is on the record.
- [ ] `remove` reads the series links before deleting and emits `ACCESS_CATALOG_CHANGED` for
      each. `TestsService` takes `DomainEventBus`.
      **Acceptance:** a finalized test in two series with no attempts deletes, and both series
      are announced as changed; one attempt refuses both the delete and every edit but the title;
      renaming a finalized test does not unfreeze it; editing its scope does, and the test comes
      back as a draft that is no longer offered.

### Task 3: The admin says what is now true

**Risk:** normal · **Reviews:** 0 (caveman — the human reads the diff) · **Model:** opus
**Files:** modify `apps/admin/src/routes/tests.tsx`,
`apps/admin/src/routes/test-builder.tsx`, `apps/admin/src/routes/test-builder-setup.tsx`,
`apps/admin/src/routes/test-builder-paper.tsx`, `apps/admin/src/routes/test-builder-offering.tsx`.

- [ ] `deleteDescription` stops naming finalized and in-a-series as refusals. It names the
      consequence instead: the questions discarded, the series it leaves, and whether students
      are being offered it right now.
- [ ] The builder gates on having been sat rather than on being frozen: `disabled={frozen}`
      becomes `disabled={attempted}`, and the warning alert says students have sat it.
- [ ] A shape edit on a finalized test warns that saving unfreezes the paper and stops offering
      it, before the save rather than after.
      **Acceptance:** a finalized, offered test with no attempts offers Delete and the confirm
      names what it costs; an attempted one still refuses; the builder's controls open up on a
      finalized test and close again once a student has sat it.

---

## Verify on screen

- Deleting a live test removes it from the student's series without a stale entry surviving in
  the cached catalog.
- The unfreeze warning appears only for a shape edit, not for a rename.
