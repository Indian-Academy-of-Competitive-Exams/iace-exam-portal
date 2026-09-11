-- Rank and percentile are about to be counted live from Postgres instead of a Redis sorted set, so the
-- facts a count needs live on the row and in one function.
--
-- timeTakenSec is what ranking reads for "less time wins": the seconds between start and submit,
-- rounded, never below zero, capped at 24 hours, and 24 hours for a sitting never submitted - the
-- rule leaderboard-score.ts has always applied. Every marked sitting is backfilled with it.
--
-- sitting_percentile is the one copy of the percentile formula: ties on marks count as half, and a
-- field of one is its own top. The partial index serves every cohort count and board.

ALTER TABLE "Attempt" ADD COLUMN "timeTakenSec" INTEGER;

UPDATE "Attempt"
   SET "timeTakenSec" = CASE
     WHEN "submittedAt" IS NULL THEN 86400
     ELSE LEAST(GREATEST(ROUND(EXTRACT(EPOCH FROM ("submittedAt" - "startedAt")))::int, 0), 86400)
   END
 WHERE "status" = 'EVALUATED';

CREATE FUNCTION sitting_percentile(outscored bigint, tied bigint, cohort bigint)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN cohort <= 1 THEN 100::numeric ELSE
    ROUND(LEAST(
      (LEAST(GREATEST(outscored, 0), cohort)
        + LEAST(GREATEST(tied, 1), GREATEST(cohort - LEAST(GREATEST(outscored, 0), cohort), 1)) / 2.0
      ) / cohort,
      1) * 100, 2)
  END
$$;

CREATE INDEX "Attempt_ranking_idx" ON "Attempt" ("testId", "score" DESC, "timeTakenSec", "id")
  WHERE "isGraded" AND "status" = 'EVALUATED' AND "score" IS NOT NULL;
