-- `TestStat` carried one number three times. `attemptCount`, `evaluatedCount` and `attemptsIncluded`
-- were every one of them written `totals.attempts` -- the count of graded, evaluated sittings -- so
-- the admin screen's "N ranked sittings of M sittings" always read "3 of 3". `evaluatedCount` is the
-- name that describes what the number is, so it is the one that stays; the screen's M becomes a live
-- count of every sitting on the test, which is what it was trying to say.
--
-- `attemptsIncluded` was a watermark for a fold that no longer exists: a recount writes what it read,
-- so there is nothing left to watermark.
--
-- `TestQuestionStat.discrimination` has never had a writer. It needs a top group against a bottom
-- group, which an incremental fold could not do one attempt at a time, and the column was added
-- ahead of a pass that was never built. Every row in it is NULL, so there is nothing to move.

ALTER TABLE "TestStat" DROP COLUMN "attemptCount";
ALTER TABLE "TestStat" DROP COLUMN "attemptsIncluded";
ALTER TABLE "TestQuestionStat" DROP COLUMN "discrimination";
