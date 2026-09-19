-- QuestionStatus collapses to ACTIVE | ARCHIVED, and the per-question flag feature goes with it.
--
-- DRAFT was only ever a proxy for two questions that are now answered elsewhere: "is this
-- finished?" is an assignment with a null finalizedAt, and "may a paper draw it?" is
-- DRAWABLE_QUESTION. ARCHIVED stays, because a soft delete is a real human act.
--
-- THIS MIGRATION MOVES DATA. Postgres cannot drop a value from an enum, so the column is retyped
-- through a new type, and the USING cast raises `invalid input value for enum` on the FIRST row
-- still reading DRAFT. The backfill below therefore has to run before the retype, in the same
-- transaction, or the deploy fails halfway on any database that holds a draft. From an empty
-- database the UPDATE matches nothing and the retype passes anyway, which is exactly why the
-- ordinary gates cannot prove this file.
--
-- QuestionFlag is dropped outright: nothing reads it after this release, and an OPEN flag no
-- longer blocks anything now that DRAWABLE_QUESTION has lost its flag clause.

BEGIN;

UPDATE "Question" SET "status" = 'ACTIVE' WHERE "status" = 'DRAFT';

ALTER TABLE "QuestionFlag" DROP CONSTRAINT "QuestionFlag_questionId_fkey";
DROP TABLE "QuestionFlag";
DROP TYPE "QuestionFlagCategory";
DROP TYPE "QuestionFlagStatus";

CREATE TYPE "QuestionStatus_new" AS ENUM ('ACTIVE', 'ARCHIVED');
ALTER TABLE "Question" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Question" ALTER COLUMN "status" TYPE "QuestionStatus_new" USING ("status"::text::"QuestionStatus_new");
ALTER TYPE "QuestionStatus" RENAME TO "QuestionStatus_old";
ALTER TYPE "QuestionStatus_new" RENAME TO "QuestionStatus";
DROP TYPE "QuestionStatus_old";
ALTER TABLE "Question" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

COMMIT;
