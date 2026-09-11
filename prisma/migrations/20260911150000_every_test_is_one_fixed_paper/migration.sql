-- A test is one fixed paper. Generated papers - several drawn for a test when it was offered, one
-- dealt to each sitting by its seed - were only ever allowed on practice tests, which are being
-- removed, and a rank only means something when everybody sat the same questions.
--
-- Nothing is converted. The dev database was wiped of every test on 2026-09-11. A database that
-- still holds a generated test, or a paper row past the first variant, is refused rather than cut
-- down to its first paper, which would silently change what its sittings were served.

DO $$
DECLARE generated INTEGER; variants INTEGER;
BEGIN
  SELECT count(*) INTO generated FROM "Test" WHERE "paperBinding" <> 'FIXED' OR "variantCount" <> 1;
  SELECT count(*) INTO variants  FROM "PaperQuestion" WHERE "variant" <> 0;
  IF generated > 0 OR variants > 0 THEN
    RAISE EXCEPTION 'Refusing to remove generated papers: % generated test(s) and % paper row(s) past the first variant remain.', generated, variants;
  END IF;
END $$;

ALTER TABLE "Test" DROP CONSTRAINT "Test_ranked_requires_fixed_check";

DROP INDEX "PaperQuestion_testId_variant_questionId_key";
DROP INDEX "PaperQuestion_testId_variant_order_key";

ALTER TABLE "PaperQuestion" DROP COLUMN "variant";
ALTER TABLE "Test" DROP COLUMN "paperBinding",
DROP COLUMN "variantCount";

DROP TYPE "PaperBinding";

CREATE UNIQUE INDEX "PaperQuestion_testId_questionId_key" ON "PaperQuestion"("testId", "questionId");
CREATE UNIQUE INDEX "PaperQuestion_testId_order_key" ON "PaperQuestion"("testId", "order");
