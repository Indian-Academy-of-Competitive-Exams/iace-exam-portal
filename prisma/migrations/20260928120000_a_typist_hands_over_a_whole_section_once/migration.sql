-- A typist no longer releases a section a few questions at a time. They press Done once, choosing
-- exactly the section's questions, and that choice IS the section's paper — so the per-question
-- release stamp has nothing left to record and goes.
--
-- The data move: under the old flow a typist could be done while the test owner had not yet drawn
-- the section from what they typed. Under the new one, done means the paper holds the typist's
-- choice. So a typist who is done on a section that nobody has read yet, on a test not yet offered,
-- whose paper does not hold exactly the section's count, is put back to typing: they press Done
-- again and choose. A section already read, or a test already offered, is history and is left alone.
UPDATE "QuestionAssignment" AS typing
SET "finalizedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
FROM "Test" AS test, "BaseConfigSection" AS section
WHERE typing."role" = 'TYPIST'
  AND typing."finalizedAt" IS NOT NULL
  AND test."id" = typing."testId"
  AND test."finalizedAt" IS NULL
  AND section."id" = typing."baseConfigSectionId"
  AND NOT EXISTS (
    SELECT 1 FROM "QuestionAssignment" AS reading
    WHERE reading."testId" = typing."testId"
      AND reading."baseConfigSectionId" = typing."baseConfigSectionId"
      AND reading."role" = 'PROOFREADER'
      AND reading."finalizedAt" IS NOT NULL
  )
  AND (
    SELECT count(*) FROM "PaperQuestion" AS paper
    WHERE paper."testId" = typing."testId"
      AND paper."baseConfigSectionId" = typing."baseConfigSectionId"
  ) <> section."questionCount";

ALTER TABLE "Question" DROP COLUMN "releasedAt";
