-- A paper stops being one paper.
--
-- A FIXED test has exactly one, and always will: every row it already holds is
-- variant 0, which is what the column defaults to, so nothing existing moves.
-- A GENERATED test has Test.variantCount of them, drawn when the test is
-- offered rather than per attempt, and each sitting reads the variant its
-- shuffleSeed lands on. Drawing per attempt would have put a pool query and a
-- draw on the path 2,000 students take in the same minute.
--
-- Both uniques have to carry the variant. The same question at the same
-- position in two different variants is correct — it is one question appearing
-- in two of the twenty papers — and the old constraints would have read that as
-- a duplicate and refused the second variant outright.
--
-- The other two uniques on this table are untouched on purpose: they target a
-- ROW (id, ...) as composite-FK anchors for AttemptQuestion, and a row is still
-- unique on its own whatever variant it belongs to.

-- DropIndex
DROP INDEX "PaperQuestion_testId_order_key";

-- DropIndex
DROP INDEX "PaperQuestion_testId_questionId_key";

-- AlterTable
ALTER TABLE "PaperQuestion" ADD COLUMN     "variant" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "variantCount" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "PaperQuestion_testId_variant_questionId_key" ON "PaperQuestion"("testId", "variant", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperQuestion_testId_variant_order_key" ON "PaperQuestion"("testId", "variant", "order");
