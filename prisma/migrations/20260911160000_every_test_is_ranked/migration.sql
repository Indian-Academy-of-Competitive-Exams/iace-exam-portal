-- Every test is ranked. Practice tests - a second kind of test that was marked but never ranked,
-- with its own series, its own stats and its own screens - are removed so students learn one kind
-- of test and the platform keeps one path through it. Retakes stay: a later sitting of a test is
-- still marked and never ranked, and StudentStat.practiceAttempts, which by now only counts them,
-- becomes retakeCount.
--
-- Nothing is converted. The dev database was wiped of every test on 2026-09-11. A database that
-- still holds a practice series, a practice test or a practice subject tally is refused rather
-- than having its practice sittings silently turned into ranked ones.

DO $$
DECLARE series INTEGER; tests INTEGER; tallies INTEGER;
BEGIN
  SELECT count(*) INTO series  FROM "TestSeries"         WHERE "evaluationMode" = 'PRACTICE';
  SELECT count(*) INTO tests   FROM "Test"               WHERE "evaluationMode" = 'PRACTICE';
  SELECT count(*) INTO tallies FROM "StudentSubjectStat" WHERE "evaluationMode" = 'PRACTICE';
  IF series > 0 OR tests > 0 OR tallies > 0 THEN
    RAISE EXCEPTION 'Refusing to remove practice tests: % practice series, % practice test(s) and % practice subject tally row(s) remain.', series, tests, tallies;
  END IF;
END $$;

ALTER TABLE "Test" DROP CONSTRAINT "Test_testSeriesId_evaluationMode_fkey";
DROP INDEX "TestSeries_id_evaluationMode_key";
ALTER TABLE "StudentSubjectStat" DROP CONSTRAINT "StudentSubjectStat_pkey";

ALTER TABLE "Test" DROP COLUMN "evaluationMode";
ALTER TABLE "TestSeries" DROP COLUMN "evaluationMode";
ALTER TABLE "StudentSubjectStat" DROP COLUMN "evaluationMode",
ADD CONSTRAINT "StudentSubjectStat_pkey" PRIMARY KEY ("studentId", "subjectId", "scope");
ALTER TABLE "StudentStat" RENAME COLUMN "practiceAttempts" TO "retakeCount";

DROP TYPE "EvaluationMode";

ALTER TABLE "Test" ADD CONSTRAINT "Test_testSeriesId_fkey" FOREIGN KEY ("testSeriesId") REFERENCES "TestSeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
