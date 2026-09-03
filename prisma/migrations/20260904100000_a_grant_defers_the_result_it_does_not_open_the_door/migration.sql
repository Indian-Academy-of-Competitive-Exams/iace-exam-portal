-- A grant defers the result; it does not open the door.
--
-- Review of 20260903100000_every_test_moves_to_the_series_that_holds_it found two statements in
-- it that widen reach beyond what the code they were transcribed from actually does. That
-- migration is shipped, so it is not edited; this one re-derives the two columns it got wrong.
--
-- DEFECT A -- a grant is not an entry pass, and Test.lateEntrySec was written as if it were.
--
--   The third uncapping arm read: any StudentGrant on the test's series -> the test keeps no
--   late-entry cap at all. That was copied from computeSchedule() in
--   apps/api/src/access/access-resolver.service.ts, and the copy is faithful -- but that method
--   answers a different question. testSchedule() is the schedule of the test to the WHOLE
--   institute, and its only three callers are attempt-report.service.ts and
--   question-report.service.ts, where it decides when a score stops moving and when the
--   solutions open. It is a FINALITY rule: while anybody anywhere can still be let in, the
--   leaderboard is not final, so a grant -- whose holder reaches past the branch gate and may
--   therefore arrive at any time -- rightly defers the result for everyone.
--
--   ENTRY runs down a different path and never consults it. toResolvedTest() reads
--   branchSchedules[0] -- the row for the STUDENT'S OWN branch, and no other -- into
--   testWindow(), and testIsOpen() decides canStart from the closesAt that comes back. So today
--   a grant on the series does not lift one minute of a branch student's entry cap.
--
--   Test.lateEntrySec is an ENTRY column. Carried across blanket, the grant arm removes caps
--   that bite right now, and because most production series carry at least one grant, most tests
--   would come out of the migration with no entry cap whatsoever. On a RANKED test that is not a
--   loosened rule, it is a broken one: the whole reason a schedule exists is that the cohort
--   sits together, and a rank over students who walked in hours apart measures nothing.
--
--   The kernel of the arm is still real. A grant-holder reaches the series without their branch
--   being offered it, so their branch may be absent from the offers list the second arm walks
--   and may carry no schedule row of its own -- and that student genuinely has no cap today.
--   The arm is therefore narrowed from "any grant" to exactly those students: a grant-holder
--   with no branch at all, or one whose branch carries no finite cap on this test. A
--   grant-holder sitting at a branch that DOES cap this test is capped today and stays capped.
--
--   Because the column already holds what the old arm wrote, patching the values in place cannot
--   work -- a row that should be capped was left null, and null is indistinguishable from a row
--   the migration never reached. So it is cleared and re-derived whole, from the two original
--   arms plus the narrowed third.
--
-- DEFECT B -- "every non-STANDARD series is enabled" publishes series that are parked.
--
--   The last statement of that migration set isEnabled = true on every non-STANDARD series
--   unconditionally. Its reasoning was that branch gating does not apply to those kinds, so
--   deriving their switch from BranchTestConfig can only lose reach -- and for a grant-only
--   round with two hundred disabled config rows, that is exactly right.
--
--   What it misses is that TestSeries has no isActive and no deletedAt. Every config off is the
--   ONLY off switch the model has, and test-series.service.ts writes precisely that on create:
--   one BranchTestConfig row per live branch, every one of them enabled = false. A series
--   drafted and left alone is therefore indistinguishable from a live one, and turning them all
--   on publishes work in progress to students.
--
--   Reach-preserving is the middle: enabled where the series reaches somebody today -- a grant,
--   or an enabled config row -- and off where it reaches nobody. A grant-only EVENT series still
--   lands true, because the grant is what reaches. A FREE draft with no grants and every config
--   off stays off, exactly as it is today.
--
-- Neither statement below depends on the other, and both are derivations rather than edits, so
-- re-running this migration on the same database produces the same rows.

-- ---------------------------------------------------------------------------
-- Defect A: clear the column and re-derive it.
--
-- Nothing has read or written Test.lateEntrySec since 20260903090000 added it -- every
-- lateEntrySec in the TypeScript is BranchTestSchedule's -- so what is cleared here is the
-- previous migration's output and nothing else.
-- ---------------------------------------------------------------------------
UPDATE "Test" SET "lateEntrySec" = NULL WHERE "lateEntrySec" IS NOT NULL;

WITH "uncapped" AS (
  SELECT "testId" FROM "BranchTestSchedule" WHERE "lateEntrySec" IS NULL
  UNION
  SELECT l."testId"
  FROM "TestSeriesTest" l
  JOIN "BranchTestConfig" bc ON bc."testSeriesId" = l."testSeriesId" AND bc.enabled
  WHERE NOT EXISTS (
    SELECT 1 FROM "BranchTestSchedule" bs
    WHERE bs."testId" = l."testId" AND bs."branchId" = bc."branchId" AND bs."lateEntrySec" IS NOT NULL
  )
  UNION
  SELECT l."testId" FROM "TestSeriesTest" l
  JOIN "StudentGrant" g ON g."testSeriesId" = l."testSeriesId"
  JOIN "Student" st ON st.id = g."studentId"
  WHERE st."currentBranchId" IS NULL
     OR NOT EXISTS (SELECT 1 FROM "BranchTestSchedule" bs WHERE bs."testId" = l."testId"
                    AND bs."branchId" = st."currentBranchId" AND bs."lateEntrySec" IS NOT NULL)
)
UPDATE "Test" t
SET "lateEntrySec" = s."lateEntry"
FROM (
  SELECT "testId", max("lateEntrySec") AS "lateEntry"
  FROM "BranchTestSchedule" GROUP BY "testId"
) s
WHERE s."testId" = t.id
  AND NOT EXISTS (SELECT 1 FROM "uncapped" u WHERE u."testId" = t.id);

-- ---------------------------------------------------------------------------
-- Defect B: a non-STANDARD series is enabled only where it reaches somebody today.
-- ---------------------------------------------------------------------------
UPDATE "TestSeries" ts SET
  "isEnabled" = EXISTS (SELECT 1 FROM "StudentGrant" g WHERE g."testSeriesId" = ts.id)
             OR EXISTS (SELECT 1 FROM "BranchTestConfig" bc WHERE bc."testSeriesId" = ts.id AND bc.enabled)
WHERE ts."kind" <> 'STANDARD';
