-- Test.drawStrategy is dropped, and the DrawStrategy enum with it.
--
-- The column ranked the question pool AFTER it had been shuffled, and a sort undoes a shuffle.
-- Only RANDOM (no rank) left the seed with any effect. NEWEST_FIRST ranked on createdAt, which
-- never ties, so every one of a test's variants took the same top N and a variantCount of 10 held
-- one paper repeated ten times. LEAST_SERVED ranked on fixedUseCount, which ties on a flat bank but
-- splits the moment a batch of questions is imported at zero against a bank sitting at eight: the
-- fresh questions fill the paper exactly and, again, every variant is identical. UNSEEN_FIRST
-- ranked on what a student had already been served, and no student exists when a paper is drawn at
-- finalize, so it was handed an empty set and behaved as RANDOM.
--
-- Nothing frozen moves. drawStrategy was read only inside the finalize draw, and a finalized test
-- already holds its PaperQuestion rows. Unfinalized generated tests carrying a non-RANDOM value
-- simply draw by seeded shuffle from here, which is the behaviour their variantCount always implied.

ALTER TABLE "Test" DROP COLUMN "drawStrategy";

DROP TYPE "DrawStrategy";
