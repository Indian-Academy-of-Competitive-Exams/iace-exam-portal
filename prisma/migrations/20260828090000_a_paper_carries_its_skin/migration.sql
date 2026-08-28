-- Which skin the exam screen wears becomes configuration rather than the one screen there was.
--
-- The stage's blueprint carries the default (BaseConfig.examTemplate) and a test copies it at
-- creation (Test.examTemplate), so changing a config's default never re-skins a paper students
-- have already sat. Nothing here touches what is scored: both templates run the same engine, the
-- same clock and the same state machine, and the paper is identical in either.
--
-- No data move. Every existing row takes COMFORTABLE, which is the screen they already had —
-- the single --exam-* palette that shipped with the engine is the one the comfortable skin keeps.

CREATE TYPE "ExamTemplate" AS ENUM ('COMFORTABLE', 'STRICT');

ALTER TABLE "BaseConfig" ADD COLUMN "examTemplate" "ExamTemplate" NOT NULL DEFAULT 'COMFORTABLE';

ALTER TABLE "Test" ADD COLUMN "examTemplate" "ExamTemplate" NOT NULL DEFAULT 'COMFORTABLE';
