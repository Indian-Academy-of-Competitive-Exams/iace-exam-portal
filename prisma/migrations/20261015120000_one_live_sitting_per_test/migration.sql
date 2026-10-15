-- One sitting in progress per student per test, held by the database and not only by the start.
--
-- The start already resumes a live sitting rather than opening a second, and the unique on
-- (testId, studentId, attemptNo) turns a race into a read-back. Nothing at the database level said
-- two IN_PROGRESS rows for one paper could not exist, so a future path that inserts one (a reset, an
-- import, a hand fix) would leave the autosave, the submit and the sweeper each choosing a different
-- row. The start's existing unique-violation catch reads the live row back, so it needs no change.
--
-- No data moves. If a pair of live sittings already exists this fails and the deploy stops, which is
-- the point: such a pair is a bug to look at, not one to resolve here by guessing which row wins.

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_one_live_per_test_key" ON "Attempt"("testId", "studentId")
WHERE "status" = 'IN_PROGRESS';
