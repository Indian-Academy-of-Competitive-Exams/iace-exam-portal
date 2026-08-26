-- Timing moves from the series to the test.
--
-- Until now the only schedule in the platform was BranchTestConfig.startAt/endAt: a window per
-- branch per SERIES, which the access resolver turned into UPCOMING / ACTIVE / ENDED and copied
-- onto every test the series held. A branch could not open one exam at ten and the next at two,
-- and an institute holding a mock at a fixed hour had nowhere to say so.
--
-- Those two columns are DROPPED, not migrated. A series window cannot be turned into a test time:
-- it says when a branch could reach a batch of exams, not when any one of them was sat, and every
-- test in the series shared it. A branch now runs a series indefinitely (enabled, or not), and
-- what is scheduled is the test:
--
--   TestSeriesTest.unlockAt   -- when this test opens inside this series, one time for everyone
--   BranchTestSchedule        -- per branch per test: how late a student may join, how much
--                                longer they get. No row means the plain rules.
--
-- lateEntrySec is a DURATION from unlockAt rather than an instant, so it cannot contradict the
-- unlock and survives the exam being moved. Both durations are CHECKed non-negative here: the
-- window arithmetic in @iace/contracts trusts them, and Prisma cannot express the constraint.

ALTER TABLE "BranchTestConfig" DROP COLUMN "startAt";
ALTER TABLE "BranchTestConfig" DROP COLUMN "endAt";

ALTER TABLE "TestSeriesTest" ADD COLUMN "unlockAt" TIMESTAMPTZ(3);

CREATE TABLE "BranchTestSchedule" (
    "branchId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "lateEntrySec" INTEGER,
    "extraTimeSec" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BranchTestSchedule_pkey" PRIMARY KEY ("branchId","testId"),
    CONSTRAINT "BranchTestSchedule_lateEntrySec_check" CHECK ("lateEntrySec" IS NULL OR "lateEntrySec" >= 0),
    CONSTRAINT "BranchTestSchedule_extraTimeSec_check" CHECK ("extraTimeSec" IS NULL OR "extraTimeSec" >= 0)
);

CREATE INDEX "BranchTestSchedule_testId_idx" ON "BranchTestSchedule"("testId");

ALTER TABLE "BranchTestSchedule" ADD CONSTRAINT "BranchTestSchedule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BranchTestSchedule" ADD CONSTRAINT "BranchTestSchedule_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;
