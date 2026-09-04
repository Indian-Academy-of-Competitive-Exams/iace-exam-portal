-- The old access shape is gone.
--
-- Four plans built the new access shape beside the old one, moved every reader onto it, and
-- proved (by grepping apps/, packages/ and scripts/ for the delegate, both relation names and
-- every type import) that nothing in application code still reaches TestSeriesTest,
-- BranchTestConfig, BranchTestSchedule, StudentSeriesUnlock or SeriesUnlockRequest. This
-- migration is the irreversible step: it recomputes the columns those tables used to feed, one
-- final time, then drops the five tables, the two columns and the one enum value that only they
-- ever gave meaning to.
--
-- STEP 1 — THE FINAL BACKFILL, BEFORE ANYTHING IS DROPPED
--
--   20260903100000 moved every row across once, as a snapshot. Between that snapshot and the
--   write paths actually landing on the new columns, admin screens still writing the OLD tables
--   kept moving -- a branch's schedule edited, a config flipped on or off, a series re-ordered --
--   while Test.testSeriesId/seriesOrder/opensAt/lateEntrySec/extraTimeSec and
--   TestSeries.branchIds sat wherever the snapshot had left them. So the same recompute runs
--   again here, right before the tables it reads go away for good, using the EXACT rules
--   20260903100000 and its correction 20260904100000 established -- not reinvented:
--
--     * Test.testSeriesId / seriesOrder / opensAt <- the one TestSeriesTest row for the test
--       (a preflight refuses to run if a test now belongs to more than one, same as the original).
--     * Test.extraTimeSec <- max(BranchTestSchedule.extraTimeSec) across the test's branches --
--       max() is the safe direction because a null extraTimeSec already reads as zero.
--     * Test.lateEntrySec <- max(BranchTestSchedule.lateEntrySec), EXCEPT the test keeps no cap
--       at all (stays NULL) wherever 20260904100000's corrected uncapped set says so: any branch
--       schedule row with a null cap, any branch the series offers with no finite-cap row of its
--       own, or a grant-holder with no branch, or whose branch carries no finite-cap row. That
--       narrowed grant arm -- not the original migration's blanket "any grant uncaps it" -- is
--       what runs here, because the blanket arm was already proven wrong once and this migration
--       does not get to reintroduce it by copying the earlier file instead of the later one.
--     * TestSeries.branchIds / isEnabled <- array_agg of enabled BranchTestConfig rows, STANDARD
--       kind only. 20260903100000 ran this before its kind conversion existed, so it touched
--       every series and relied on a later statement to reset non-STANDARD rows back to empty;
--       that later statement is not repeated here because the CHECKs 20260904110000 added
--       already guarantee no non-STANDARD row can be sitting there with a branch list, so instead
--       the WHERE clause itself is scoped to STANDARD -- reproducing the same net effect without
--       depending on statements this migration has no reason to re-run (the kind/programCode/
--       eventId conversions, the Event/EventCandidate backfill and the enrolledCourses backfill
--       all read columns already governed by CHECK constraints or already correct, not the five
--       tables this migration drops, so none of them move again here).
--
--   Proved against a scratch database seeded with rows written to TestSeriesTest,
--   BranchTestConfig and BranchTestSchedule AFTER a simulated original backfill (i.e. every new
--   column left at its untouched default), including a grant-holder with no branch at all: the
--   recompute took Test.testSeriesId/seriesOrder/opensAt from null to the join row's values,
--   Test.lateEntrySec from a deliberately-wrong 9999 to NULL (uncapped, via the narrowed grant
--   arm) on one test and to max(1800, 3600) = 3600 (capped) on another, Test.extraTimeSec to
--   max(300, 600) = 600, and TestSeries.branchIds/isEnabled from {}/false to the enabled branch
--   list/true on two STANDARD series while correctly leaving a FREE series' leftover
--   BranchTestConfig row unread. None of that is a no-op re-run of already-correct data.
--
-- STEP 2 — THE ORPHANED NOTIFICATION
--
--   DOMAIN_EVENTS.SERIES_UNLOCKED has had no emitter since the request queue it announced was
--   deleted; this migration is what the code comment next to it has been waiting for. Postgres
--   has no DROP VALUE for an enum, so removing SERIES_UNLOCKED from NotificationType means
--   building a replacement type without it, moving the column, and dropping the old type --
--   which first requires nothing in the column still holding that value. The one existing row
--   (a live IACE database carries exactly one) is REMAPPED to GENERIC rather than deleted: its
--   title, body and testSeriesId deep link are still true statements the row's own student wrote
--   to their bell, and deleting it would erase real notification history to tidy up an enum. A
--   type carrying no meaning of its own past this point, GENERIC, is where it lands.
--
-- STEP 3 — THE DROP
--
--   TestSeriesTest, BranchTestConfig, BranchTestSchedule, StudentSeriesUnlock and
--   SeriesUnlockRequest, plus TestSeries.prerequisiteSeriesId, TestSeries.unlockMode and the
--   UnlockMode enum -- the two columns and the enum only ever meant anything alongside
--   SeriesUnlockRequest's request queue, which is gone, and the CHECK that kept a FREE series
--   from carrying a prerequisite (TestSeries_free_waits_on_nothing) depends on
--   prerequisiteSeriesId, so it goes with the column rather than needing a separate statement.
--   UnlockRequestStatus is dropped alongside SeriesUnlockRequest, the only column that ever used
--   it. The TestSeries.directTests relation is renamed to TestSeries.tests in schema.prisma only
--   -- a Prisma relation name is client-side metadata, not a database object, so nothing here
--   moves for it.

-- ---------------------------------------------------------------------------
-- Step 1a: a test may not belong to more than one series. If the old tables drifted into that
-- shape after the original migration's own preflight ran, this is the last chance to catch it
-- before TestSeriesTest -- the only record of which series a doubly-linked test belonged to --
-- is dropped for good.
-- ---------------------------------------------------------------------------
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg("testId", ', ' ORDER BY "testId") INTO offenders
  FROM (SELECT "testId" FROM "TestSeriesTest" GROUP BY "testId" HAVING count(*) > 1) AS many;

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'These tests belong to more than one series, and TestSeriesTest -- the only record of which -- is about to be dropped. Decide which series keeps each, remove the other link, then re-run: %',
      offenders;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Step 1b: the final recompute.
-- ---------------------------------------------------------------------------
UPDATE "Test" t
SET "testSeriesId" = l."testSeriesId",
    "seriesOrder"  = l."order",
    "opensAt"      = l."unlockAt"
FROM "TestSeriesTest" l
WHERE l."testId" = t.id;

UPDATE "Test" t
SET "extraTimeSec" = s."extraTime"
FROM (
  SELECT "testId", max("extraTimeSec") AS "extraTime"
  FROM "BranchTestSchedule" GROUP BY "testId"
) s
WHERE s."testId" = t.id;

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

UPDATE "TestSeries" ts
SET "branchIds" = b."ids", "isEnabled" = true
FROM (
  SELECT "testSeriesId", array_agg("branchId") AS "ids"
  FROM "BranchTestConfig" WHERE enabled = true GROUP BY "testSeriesId"
) b
WHERE b."testSeriesId" = ts.id AND ts."kind" = 'STANDARD';

-- ---------------------------------------------------------------------------
-- Step 2: remap the one notification type nothing emits any more, then narrow the enum.
-- ---------------------------------------------------------------------------
UPDATE "Notification" SET "type" = 'GENERIC' WHERE "type" = 'SERIES_UNLOCKED';

BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('TEST_ASSIGNED', 'RESULT_READY', 'ENROLLMENT_ADDED', 'GRANT_ADDED', 'GENERIC');
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "NotificationType_old";
COMMIT;

-- ---------------------------------------------------------------------------
-- Step 3: the drop. Dropping TestSeries.prerequisiteSeriesId takes its own FK, its index and the
-- TestSeries_free_waits_on_nothing CHECK with it -- both live only because that column did.
-- ---------------------------------------------------------------------------
ALTER TABLE "TestSeries" DROP CONSTRAINT "TestSeries_prerequisiteSeriesId_fkey";
ALTER TABLE "TestSeriesTest" DROP CONSTRAINT "TestSeriesTest_testSeriesId_fkey";
ALTER TABLE "TestSeriesTest" DROP CONSTRAINT "TestSeriesTest_testId_fkey";
ALTER TABLE "StudentSeriesUnlock" DROP CONSTRAINT "StudentSeriesUnlock_studentId_fkey";
ALTER TABLE "StudentSeriesUnlock" DROP CONSTRAINT "StudentSeriesUnlock_testSeriesId_fkey";
ALTER TABLE "SeriesUnlockRequest" DROP CONSTRAINT "SeriesUnlockRequest_studentId_fkey";
ALTER TABLE "SeriesUnlockRequest" DROP CONSTRAINT "SeriesUnlockRequest_testSeriesId_fkey";
ALTER TABLE "BranchTestConfig" DROP CONSTRAINT "BranchTestConfig_branchId_fkey";
ALTER TABLE "BranchTestConfig" DROP CONSTRAINT "BranchTestConfig_testSeriesId_fkey";
ALTER TABLE "BranchTestSchedule" DROP CONSTRAINT "BranchTestSchedule_branchId_fkey";
ALTER TABLE "BranchTestSchedule" DROP CONSTRAINT "BranchTestSchedule_testId_fkey";

DROP INDEX "TestSeries_prerequisiteSeriesId_idx";

ALTER TABLE "TestSeries" DROP COLUMN "prerequisiteSeriesId",
DROP COLUMN "unlockMode";

DROP TABLE "TestSeriesTest";
DROP TABLE "StudentSeriesUnlock";
DROP TABLE "SeriesUnlockRequest";
DROP TABLE "BranchTestConfig";
DROP TABLE "BranchTestSchedule";

DROP TYPE "UnlockMode";
DROP TYPE "UnlockRequestStatus";
