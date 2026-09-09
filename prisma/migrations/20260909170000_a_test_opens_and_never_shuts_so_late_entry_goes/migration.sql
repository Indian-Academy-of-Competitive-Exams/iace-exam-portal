-- Late entry is gone. Every test -- ranked and practice alike -- now has an unlock instant and
-- nothing else: it opens at `opensAt` and never shuts, so a student may sit it whenever they get
-- to it. `Test.lateEntrySec` was the only cutoff in the model, and with it go every `closesAt`
-- derived from it, the entry window on the student's screens, and the solution gate that waited
-- for the last possible sitting to end.
--
-- WHAT THIS DISCARDS. `lateEntrySec` is a duration in seconds counted from `opensAt`; dropping the
-- column drops any cutoff an admin had set. That is the point of the change, but it is a one-way
-- door, so the guard below reports what it is about to lose rather than discarding it silently.
-- Migration 20260904100000 already nulled every value the old BranchTestSchedule era left behind,
-- and 20260907090000 nulled it on every practice test, so a non-zero count here means a cutoff an
-- admin set deliberately on a ranked test. Read the notice, then let it run.
--
-- The CHECK is rebuilt rather than edited: a constraint cannot be altered in place, and it still
-- has work to do -- `extraTimeSec` stays RANKED-only, because an allowance answers to a rank.
--
-- A PRACTICE test also loses its retake cap. Practice exists to be sat again, so a limit on it was
-- a limit on the only thing it is for; the cap now belongs to RANKED alone, where it bounds how
-- many unranked retakes may follow the one sitting that counts. Any cap an admin set on a practice
-- test is cleared, and the same CHECK keeps it that way.

DO $$
DECLARE capped INTEGER;
BEGIN
  SELECT count(*) INTO capped FROM "Test" WHERE "lateEntrySec" IS NOT NULL;
  IF capped > 0 THEN
    RAISE NOTICE 'Dropping a late-entry cutoff from % test(s); they now open and never shut.', capped;
  END IF;
END $$;

ALTER TABLE "Test" DROP CONSTRAINT IF EXISTS "Test_practice_has_no_window_check";

ALTER TABLE "Test" DROP COLUMN "lateEntrySec";

UPDATE "Test"
   SET "maxRetakes" = NULL
 WHERE "evaluationMode" <> 'RANKED'
   AND "maxRetakes" IS NOT NULL;

ALTER TABLE "Test" ADD CONSTRAINT "Test_practice_has_no_window_check"
  CHECK ("evaluationMode" = 'RANKED' OR ("extraTimeSec" IS NULL AND "maxRetakes" IS NULL));
