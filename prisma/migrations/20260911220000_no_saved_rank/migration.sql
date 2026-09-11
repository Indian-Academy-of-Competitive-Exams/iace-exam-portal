-- Rank and percentile are counted live from Postgres (the previous migration and the code with it), so
-- the values saved at scoring - a sitting's lastRank and lastPercentile, a student's percentile sum
-- and best - are read by nothing and would only drift. Nothing moves; the columns go.
--
-- A worker still running the code from before the previous migration scores a sitting without
-- timeTakenSec, so every marked sitting still missing it is filled again, by the same rule, before
-- ranking has to read it.

UPDATE "Attempt"
   SET "timeTakenSec" = CASE
     WHEN "submittedAt" IS NULL THEN 86400
     ELSE LEAST(GREATEST(ROUND(EXTRACT(EPOCH FROM ("submittedAt" - "startedAt")))::int, 0), 86400)
   END
 WHERE "status" = 'EVALUATED' AND "timeTakenSec" IS NULL;

ALTER TABLE "Attempt" DROP COLUMN "lastRank",
DROP COLUMN "lastPercentile";

ALTER TABLE "StudentStat" DROP COLUMN "sumPercentile",
DROP COLUMN "bestPercentile";
