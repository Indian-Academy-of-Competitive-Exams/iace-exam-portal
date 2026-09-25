-- `Question.fixedUseCount` had exactly one writer -- FinalizeService.freeze incremented it once per
-- served question at offer time -- and no reader anywhere in the repo. `DrawStrategy.LEAST_SERVED`,
-- the strategy comment in apps/api/test-db/finalize.db.test.ts named as its intended consumer, was
-- never implemented; the enum value exists and nothing reads it either.
--
-- It was also wrong in a way nothing could catch: an offered-but-unsat test can still be
-- hard-deleted (PaperQuestion cascades away with it, per the ON DELETE CASCADE added in
-- 20260918120000), and nothing ever decremented the count that delete made stale.
--
-- Dropping the column is strictly better than keeping a counter already capable of drifting high
-- with no way back down. The number it tried to cache is always available correctly, the day
-- anything needs "how many finalized papers has this question been on":
--
--   SELECT "questionId", count(DISTINCT "Test"."id")
--   FROM "PaperQuestion"
--   JOIN "Test" ON "Test"."id" = "PaperQuestion"."testId" AND "Test"."finalizedAt" IS NOT NULL
--   GROUP BY "questionId";
--
-- That query is correct by construction and cannot drift, which a stored counter already had.
DROP INDEX "Question_fixedUseCount_idx";

ALTER TABLE "Question" DROP COLUMN "fixedUseCount";
