-- Test.lateEntrySec, Test.extraTimeSec and TestProgramUnlock rows were settable on any test,
-- ranked or practice. All three answer to a rank and to nothing else: a cutoff exists so a
-- cohort sits together, an allowance exists so a candidate who needs longer is not ranked as
-- if they did not, and a per-program stagger puts one cohort ahead of another.
--
-- A practice attempt is never graded (Attempt.isGraded requires RANKED), enters no leaderboard
-- and no cohort rollup, so none of the three compensates for or separates anything there. The
-- answer-key gate already ignores the pair for practice — solutionsOpening returns NOW before
-- it reads a window — which left them doing exactly one thing on a practice test: quietly
-- lengthening or shutting a clock for a reason the model no longer had.
--
-- From here a practice test just opens. Test.opensAt is the whole of its schedule: one instant
-- for the whole institute, and nothing that shuts it or moves it for one program.
--
-- The clean-up has to come first, because a CHECK is validated against every existing row and
-- one survivor fails the whole ALTER. No row carries either value today, so the UPDATE is
-- expected to match nothing — but "expected to" is not what Postgres accepts, and a value left
-- by a seed, a restored dump or a hand-run script would surface only at deploy time.
--
-- NULL is the right landing place rather than a guess: both columns are already nullable, and
-- null is precisely what "this test has no cutoff and no allowance" has always meant.
--
-- The stagger rows are DELETED rather than constrained. The rule spans two tables and a CHECK
-- only ever sees its own row, so nothing on TestProgramUnlock can state it; a trigger could,
-- but the other cross-table rule on this table (a program opens a test earlier, never later)
-- is already enforced in OfferingService alone, and splitting two rules on one table across
-- two mechanisms buys less than it costs. TestsService.update deletes these on the same flip.

UPDATE "Test"
   SET "lateEntrySec" = NULL,
       "extraTimeSec" = NULL
 WHERE "evaluationMode" <> 'RANKED'
   AND ("lateEntrySec" IS NOT NULL OR "extraTimeSec" IS NOT NULL);

DELETE FROM "TestProgramUnlock"
 WHERE "testId" IN (SELECT "id" FROM "Test" WHERE "evaluationMode" <> 'RANKED');

-- AddCheckConstraint
ALTER TABLE "Test" ADD CONSTRAINT "Test_practice_has_no_window_check"
  CHECK ("evaluationMode" = 'RANKED' OR ("lateEntrySec" IS NULL AND "extraTimeSec" IS NULL));
