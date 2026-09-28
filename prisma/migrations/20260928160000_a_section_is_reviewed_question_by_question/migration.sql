-- A section's proof-reader now reviews it question by question: each question is checked, or sent
-- back to the typist with a reason (a spelling mistake, a data correction, no suitable option as the
-- answer) until the typist marks it fixed. QuestionReview holds that verdict, one row per question of
-- a test.
--
-- Both paper sources now take a typist, and a role can pass to somebody else: the old row stays as
-- the record (replacedAt set) and a new one holds the role. So "one row per role per section" becomes
-- "one ACTIVE row per role per section", a partial unique Prisma cannot express.
--
-- A proof-reader's row also records when the section reached them (handedAt): a typist's Done on a
-- typed section, or the test owner's hand-over on a picked one. The backfill keeps every reader
-- reading what they could read before: on a typed section, from the typist's Done; on a picked one,
-- from when they were given it, because until now a picked section reached its reader at once.
-- CreateEnum
CREATE TYPE "SendBackReason" AS ENUM ('SPELLING', 'DATA_CORRECTION', 'ANSWER_OPTION');

-- DropIndex
DROP INDEX "QuestionAssignment_testId_baseConfigSectionId_role_key";

-- AlterTable
ALTER TABLE "QuestionAssignment" ADD COLUMN     "handedAt" TIMESTAMPTZ(3),
ADD COLUMN     "replacedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "QuestionReview" (
    "id" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "baseConfigSectionId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "checkedAt" TIMESTAMPTZ(3),
    "checkedById" UUID,
    "sentBackAt" TIMESTAMPTZ(3),
    "reason" "SendBackReason",
    "note" TEXT,
    "sentBackById" UUID,
    "fixedAt" TIMESTAMPTZ(3),
    "fixedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionReview_testId_baseConfigSectionId_idx" ON "QuestionReview"("testId", "baseConfigSectionId");

-- CreateIndex
CREATE INDEX "QuestionReview_questionId_idx" ON "QuestionReview"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionReview_testId_questionId_key" ON "QuestionReview"("testId", "questionId");

-- CreateIndex
CREATE INDEX "QuestionAssignment_testId_baseConfigSectionId_role_idx" ON "QuestionAssignment"("testId", "baseConfigSectionId", "role");

-- AddForeignKey
ALTER TABLE "QuestionReview" ADD CONSTRAINT "QuestionReview_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionReview" ADD CONSTRAINT "QuestionReview_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One active holder per role per section.
CREATE UNIQUE INDEX "QuestionAssignment_active_role_key" ON "QuestionAssignment"("testId", "baseConfigSectionId", "role") WHERE "replacedAt" IS NULL;

-- Every reader keeps reading what they could read the moment before this migration.
UPDATE "QuestionAssignment" AS reading
SET "handedAt" = typing."finalizedAt"
FROM "QuestionAssignment" AS typing
WHERE reading."role" = 'PROOFREADER'
  AND typing."role" = 'TYPIST'
  AND typing."testId" = reading."testId"
  AND typing."baseConfigSectionId" = reading."baseConfigSectionId"
  AND typing."finalizedAt" IS NOT NULL;

UPDATE "QuestionAssignment" AS reading
SET "handedAt" = reading."createdAt"
FROM "Test" AS test
WHERE reading."role" = 'PROOFREADER'
  AND reading."handedAt" IS NULL
  AND test."id" = reading."testId"
  AND test."paperSource" = 'PICKED';
