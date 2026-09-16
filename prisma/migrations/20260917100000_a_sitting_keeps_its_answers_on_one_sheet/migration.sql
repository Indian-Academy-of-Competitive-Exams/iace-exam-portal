-- A sitting's answers move from one AttemptQuestion row per served question to one AttemptSheet
-- row per sitting. `answers` is a jsonb array with a slot per paper row in PaperQuestion.order:
-- [stateIndex, option, timeSpentSec, firstActionSec, answeredSec, typedAnswer?], or null for a
-- question never touched. stateIndex indexes NOT_VISITED, NOT_ANSWERED, ANSWERED, MARKED_REVIEW,
-- ANSWERED_MARKED. option is a position into PaperQuestion.optionIds, or the raw id when the row does
-- not hold it. Times are whole seconds after Attempt.startedAt. `verdicts` is a parallel array of
-- [isCorrect, marksAwarded], present once the sitting was scored.
--
-- Positions only mean something while a paper cannot move, so this also freezes a sat paper in the
-- database (the composite foreign keys AttemptQuestion held did that job) and copies each pinned
-- version's option ids onto its paper row, so decoding an option never loads a question version.
--
-- The backfill refuses to run if any answer row names a question that is no longer on its sitting's
-- paper: such a row has no slot, and silently dropping an answer is worse than a failed deploy.
-- AttemptQuestion itself is dropped by the next migration, which ships with this one.

-- AlterTable
ALTER TABLE "PaperQuestion" ADD COLUMN     "optionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "AttemptSheet" (
    "attemptId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "verdicts" JSONB,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttemptSheet_pkey" PRIMARY KEY ("attemptId")
);

-- AddForeignKey
ALTER TABLE "AttemptSheet" ADD CONSTRAINT "AttemptSheet_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttemptSheet" SET (fillfactor = 50);

-- The pinned version's option ids, in stored order, onto every paper row.
CREATE FUNCTION paper_question_option_ids() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."optionIds" := ARRAY(
    SELECT listed.option->>'id'
    FROM "QuestionVersion" version,
         jsonb_array_elements(
           CASE WHEN jsonb_typeof(version."options") = 'array' THEN version."options" ELSE '[]'::jsonb END
         ) WITH ORDINALITY AS listed(option, position)
    WHERE version."id" = NEW."questionVersionId"
    ORDER BY listed.position
  );
  RETURN NEW;
END $$;

CREATE TRIGGER paper_question_option_ids
  BEFORE INSERT OR UPDATE OF "questionVersionId" ON "PaperQuestion"
  FOR EACH ROW EXECUTE FUNCTION paper_question_option_ids();

UPDATE "PaperQuestion" SET "questionVersionId" = "questionVersionId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AttemptQuestion" answer
    JOIN "Attempt" sitting ON sitting."id" = answer."attemptId"
    WHERE NOT EXISTS (
      SELECT 1 FROM "PaperQuestion" paper
      WHERE paper."testId" = sitting."testId" AND paper."questionId" = answer."questionId"
    )
  ) THEN
    RAISE EXCEPTION 'AttemptQuestion rows name questions no longer on their paper; resolve them before moving answers';
  END IF;
END $$;

INSERT INTO "AttemptSheet" ("attemptId", "answers", "verdicts")
SELECT
  sitting."id",
  jsonb_agg(
    CASE
      WHEN answer."attemptId" IS NULL THEN NULL
      WHEN answer."state" = 'NOT_VISITED' AND answer."timeSpentSec" = 0
        AND answer."firstActionAt" IS NULL AND answer."answeredAt" IS NULL
        AND answer."selectedOptionId" IS NULL AND answer."typedAnswer" IS NULL THEN NULL
      ELSE jsonb_build_array(
             array_position(
               ARRAY['NOT_VISITED', 'NOT_ANSWERED', 'ANSWERED', 'MARKED_REVIEW', 'ANSWERED_MARKED'],
               answer."state"::text
             ) - 1,
             CASE
               WHEN answer."selectedOptionId" IS NULL THEN NULL
               WHEN array_position(paper."optionIds", answer."selectedOptionId") IS NULL
                 THEN to_jsonb(answer."selectedOptionId")
               ELSE to_jsonb(array_position(paper."optionIds", answer."selectedOptionId") - 1)
             END,
             answer."timeSpentSec",
             floor(extract(epoch FROM answer."firstActionAt" - sitting."startedAt"))::int,
             floor(extract(epoch FROM answer."answeredAt" - sitting."startedAt"))::int
           )
           || CASE WHEN answer."typedAnswer" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(answer."typedAnswer") END
    END
    ORDER BY paper."order"
  ),
  CASE
    WHEN bool_or(answer."isCorrect" IS NOT NULL OR answer."marksAwarded" IS NOT NULL)
      THEN jsonb_agg(jsonb_build_array(answer."isCorrect", COALESCE(answer."marksAwarded", 0)) ORDER BY paper."order")
  END
FROM "Attempt" sitting
JOIN "PaperQuestion" paper ON paper."testId" = sitting."testId"
LEFT JOIN "AttemptQuestion" answer
  ON answer."attemptId" = sitting."id" AND answer."questionId" = paper."questionId"
GROUP BY sitting."id";

INSERT INTO "AttemptSheet" ("attemptId", "answers")
SELECT sitting."id", '[]'::jsonb
FROM "Attempt" sitting
WHERE NOT EXISTS (SELECT 1 FROM "AttemptSheet" sheet WHERE sheet."attemptId" = sitting."id");

-- Once anyone has sat a test, its paper rows may only change status.
CREATE FUNCTION paper_question_sat_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Attempt" WHERE "testId" IN (NEW."testId", OLD."testId")) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND
     (NEW."testId", NEW."baseConfigId", NEW."baseConfigSectionId", NEW."questionId", NEW."questionVersionId",
      NEW."order", NEW."marks", NEW."negativeMarks", NEW."optionIds")
     IS NOT DISTINCT FROM
     (OLD."testId", OLD."baseConfigId", OLD."baseConfigSectionId", OLD."questionId", OLD."questionVersionId",
      OLD."order", OLD."marks", OLD."negativeMarks", OLD."optionIds") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A paper somebody has sat cannot change: only a question''s status may move'
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER paper_question_sat_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "PaperQuestion"
  FOR EACH ROW EXECUTE FUNCTION paper_question_sat_guard();

-- For support and ad-hoc SQL: one row per slot, decoded.
CREATE VIEW "AttemptSheetAnswer" AS
SELECT
  sheet."attemptId",
  paper."id" AS "paperQuestionId",
  paper."questionId",
  slot.position::int AS "slot",
  COALESCE(
    (ARRAY['NOT_VISITED', 'NOT_ANSWERED', 'ANSWERED', 'MARKED_REVIEW', 'ANSWERED_MARKED'])[(slot.value->>0)::int + 1],
    'NOT_VISITED'
  ) AS "state",
  CASE jsonb_typeof(slot.value->1)
    WHEN 'number' THEN paper."optionIds"[(slot.value->>1)::int + 1]
    WHEN 'string' THEN slot.value->>1
  END AS "selectedOptionId",
  slot.value->>5 AS "typedAnswer",
  COALESCE((slot.value->>2)::int, 0) AS "timeSpentSec",
  sitting."startedAt" + make_interval(secs => (slot.value->>3)::int) AS "firstActionAt",
  sitting."startedAt" + make_interval(secs => (slot.value->>4)::int) AS "answeredAt",
  (sheet."verdicts"->(slot.position::int - 1)->>0)::boolean AS "isCorrect",
  (sheet."verdicts"->(slot.position::int - 1)->>1)::numeric AS "marksAwarded"
FROM "AttemptSheet" sheet
JOIN "Attempt" sitting ON sitting."id" = sheet."attemptId"
CROSS JOIN LATERAL jsonb_array_elements(sheet."answers") WITH ORDINALITY AS slot(value, position)
JOIN LATERAL (
  SELECT row_on_paper."id", row_on_paper."questionId", row_on_paper."optionIds",
         row_number() OVER (ORDER BY row_on_paper."order") AS position
  FROM "PaperQuestion" row_on_paper
  WHERE row_on_paper."testId" = sitting."testId"
) paper ON paper.position = slot.position;
