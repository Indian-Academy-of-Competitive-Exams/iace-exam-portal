-- Retires the public report link: the PerformanceShare table goes, with its indexes and both
-- foreign keys (to Attempt and to Admin), which DROP TABLE takes with it.
--
-- The feature was never used. No link was ever minted, so the table holds no rows and nothing
-- moves; a from-scratch `prisma migrate deploy` exercises every statement here. Its code, its
-- routes, its rate limit and its Redis keys leave in the same commit.

-- DropTable
DROP TABLE "PerformanceShare";
