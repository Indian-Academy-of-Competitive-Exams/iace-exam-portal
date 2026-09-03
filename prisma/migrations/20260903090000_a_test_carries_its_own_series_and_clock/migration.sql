-- A test carries its own series and its own clock.
--
-- Scheduling lived on TestSeriesTest -- one join row per (series, test) -- and on
-- BranchTestSchedule, per (branch, test). That let the same test sit at two different
-- unlockAt times in two different series, which breaks the leaderboard it feeds: a rank
-- means nothing if the people in it did not all sit the same window. A test belongs to
-- exactly one series going forward, so its clock (opensAt, lateEntrySec, extraTimeSec)
-- and its position (seriesOrder) move onto the test itself, one of each, full stop.
--
-- These five Test columns and the two TestSeries columns are pure additions -- nullable,
-- unindexed by anything downstream, nothing narrowed. TestSeriesTest and BranchTestSchedule
-- are untouched and keep serving every existing read. TestSeries.isEnabled defaults to
-- false so a series does not go live the instant the column exists; a later task turns it
-- on only where a BranchTestConfig row already says so. Nothing reads any of these seven
-- columns yet.

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "extraTimeSec" INTEGER,
ADD COLUMN     "lateEntrySec" INTEGER,
ADD COLUMN     "opensAt" TIMESTAMPTZ(3),
ADD COLUMN     "seriesOrder" INTEGER,
ADD COLUMN     "testSeriesId" TEXT;

-- AlterTable
ALTER TABLE "TestSeries" ADD COLUMN     "branchIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "isEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Test_testSeriesId_idx" ON "Test"("testSeriesId");

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_testSeriesId_fkey" FOREIGN KEY ("testSeriesId") REFERENCES "TestSeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
