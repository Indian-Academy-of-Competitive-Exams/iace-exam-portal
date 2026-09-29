-- The topper is the board's rank 1, read live, never a copy the recount stored.
--
-- `topperAttemptId` was already written as rank 1 (score, then time, then id). Every reader —
-- the admin's analytics, the workbook's Topper line (off the analytics summary), and the topper
-- times on a student's question and performance reports — now asks for rank 1 directly:
-- `ORDER BY` the board's order `LIMIT 1` is an Index Only Scan of Attempt_ranking_idx, one probe,
-- where the stored copy was a TestStat primary-key read that could be a pass behind the board.
-- No data moves.

ALTER TABLE "TestStat" DROP CONSTRAINT "TestStat_topperAttemptId_fkey";

DROP INDEX "TestStat_topperAttemptId_idx";

ALTER TABLE "TestStat" DROP COLUMN "topperAttemptId";
