-- Ranked or practice was a fact about one test. It is really a fact about the series: a series is
-- what a student reaches, and a list mixing a ranked mock with a practice drill under one name is
-- two products wearing one. From here the series declares the mode and its tests inherit it.
--
-- This migration only gives the series the column and fills it from what its tests already say.
-- Test.evaluationMode is untouched; the composite foreign key that ties the two together comes in
-- a later migration, and @@unique([id, evaluationMode]) is added here so it has something to point
-- at. That unique is otherwise redundant -- id is already the primary key -- and exists solely as
-- the target of that FK, which is the idiom BaseConfig @@unique([id, examStageId]) already uses.
--
-- Backfilling is a real data move, so `migrate deploy` from an empty database proves nothing about
-- it. What each series adopts:
--
--   * a series whose tests all carry one mode adopts that mode;
--   * a series holding no tests keeps the RANKED default, because nothing it holds says otherwise
--     and an empty series can still be changed afterwards;
--   * a series holding BOTH modes stops the migration.
--
-- The last one is deliberate. Nothing in the data model says which of the two a mixed series
-- really is, so any winner this file picked would be a guess -- and the losing tests would come
-- out reinterpreted, with sittings already scored under the other rule. There are none today. A
-- migration that halts is read by an operator who can decide; one that guesses is not read at all.
--
-- The guard runs before the UPDATE so the failure is a sentence rather than a cardinality error
-- from the scalar subquery below, which would refuse the same rows for a reason nobody can act on.

-- AlterTable
ALTER TABLE "TestSeries" ADD COLUMN     "evaluationMode" "EvaluationMode" NOT NULL DEFAULT 'RANKED';

DO $$
DECLARE mixed text;
BEGIN
  SELECT string_agg(s."name" || ' (' || s."id" || ')', ', ' ORDER BY s."name")
    INTO mixed
    FROM "TestSeries" s
   WHERE (SELECT count(DISTINCT t."evaluationMode")
            FROM "Test" t
           WHERE t."testSeriesId" = s."id") > 1;

  IF mixed IS NOT NULL THEN
    RAISE EXCEPTION 'These series hold both ranked and practice tests, so neither mode is theirs: %. Split them into one series per mode, then run this migration again.', mixed;
  END IF;
END $$;

UPDATE "TestSeries" s
   SET "evaluationMode" = (SELECT DISTINCT t."evaluationMode"
                             FROM "Test" t
                            WHERE t."testSeriesId" = s."id")
 WHERE EXISTS (SELECT 1 FROM "Test" t WHERE t."testSeriesId" = s."id");

-- CreateIndex
CREATE UNIQUE INDEX "TestSeries_id_evaluationMode_key" ON "TestSeries"("id", "evaluationMode");
