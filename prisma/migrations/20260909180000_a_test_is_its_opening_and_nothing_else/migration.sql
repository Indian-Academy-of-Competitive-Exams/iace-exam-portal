-- `maxRetakes` and `extraTimeSec` both go, and with them the last thing a Test carried besides its
-- paper and its opening. A test is now: what it covers, how it is judged, and when it opens.
--
-- WHY maxRetakes. A cap assumed a student would grind one paper. They will not -- the series keeps
-- giving them new ones, and attention moves to the next test rather than the last. The cap was
-- answering a problem the catalog already solves, and `attemptNo` still records which sitting was
-- which, so nothing about ranking depends on it: the FIRST sitting is the graded one either way.
--
-- WHY extraTimeSec. An allowance belongs to a STUDENT, not to a paper -- it is granted because of
-- who is sitting, not because of what they are sitting. Per-test it could only be all-or-nothing
-- for everyone, which is the one thing an allowance must never be. It comes back at student level
-- with live exam management, against the sitting rather than the test.
--
-- WHAT THIS DISCARDS. Any cap and any allowance an admin set. Both are one-way; the guard below
-- reports what it is about to lose rather than dropping it in silence. The previous migration
-- (20260909170000) already cleared both on every practice test, so a non-zero count here is a
-- ranked test an admin configured deliberately.
--
-- The CHECK goes rather than shrinking: it existed to keep these two RANKED-only, and with both
-- columns gone it constrains nothing. Ranked and practice now differ in what is GRADED and in
-- whether a paper may be drawn per attempt -- both of which answer to a rank, which is the point.

DO $$
DECLARE capped INTEGER; allowed INTEGER;
BEGIN
  SELECT count(*) INTO capped  FROM "Test" WHERE "maxRetakes"   IS NOT NULL;
  SELECT count(*) INTO allowed FROM "Test" WHERE "extraTimeSec" IS NOT NULL;
  IF capped > 0 THEN
    RAISE NOTICE 'Dropping a retake cap from % test(s); they may now be sat any number of times.', capped;
  END IF;
  IF allowed > 0 THEN
    RAISE NOTICE 'Dropping an extra-time allowance from % test(s); every sitting now runs its own duration.', allowed;
  END IF;
END $$;

ALTER TABLE "Test" DROP CONSTRAINT IF EXISTS "Test_practice_has_no_window_check";

ALTER TABLE "Test" DROP COLUMN "maxRetakes";
ALTER TABLE "Test" DROP COLUMN "extraTimeSec";
