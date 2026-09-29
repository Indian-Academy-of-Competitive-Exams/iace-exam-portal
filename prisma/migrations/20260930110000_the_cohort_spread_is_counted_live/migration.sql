-- The cohort's mean, highest and lowest are counted live off the ranked sittings, never stored.
--
-- Both readers already ran the live grouped read for the curve (`cohortCurveOf`, one row per
-- distinct score of the ranked cohort), and then preferred these three stored copies over it, so
-- the admin's spread took its median from live bands and its mean, highest and lowest from a
-- recount that could be a pass behind. The live read carries all four; nothing else read them.
-- `evaluatedCount` and `sumTimeSec` stay: the dashboard and a student's trajectory read the count
-- per test across a series of tests, and the pace index reads the time, without a scan each.
-- No data moves.

ALTER TABLE "TestStat" DROP COLUMN "maxScore",
DROP COLUMN "minScore",
DROP COLUMN "sumScore";
