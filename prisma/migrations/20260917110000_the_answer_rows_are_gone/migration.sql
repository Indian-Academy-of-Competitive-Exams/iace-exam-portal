-- The per-question answer rows are gone: 20260917100000 moved every answer onto AttemptSheet and the
-- application no longer reads or writes AttemptQuestion. The two PaperQuestion uniques dropped here
-- existed only as anchors for its composite foreign keys; paper_question_sat_guard now does their job.
-- Both migrations ship together, between exams, with no sitting in progress.

-- DropForeignKey
ALTER TABLE "AttemptQuestion" DROP CONSTRAINT "AttemptQuestion_attemptId_fkey";

-- DropForeignKey
ALTER TABLE "AttemptQuestion" DROP CONSTRAINT "AttemptQuestion_baseConfigSectionId_fkey";

-- DropForeignKey
ALTER TABLE "AttemptQuestion" DROP CONSTRAINT "AttemptQuestion_paperQuestionId_baseConfigSectionId_fkey";

-- DropForeignKey
ALTER TABLE "AttemptQuestion" DROP CONSTRAINT "AttemptQuestion_paperQuestionId_questionId_questionVersion_fkey";

-- DropForeignKey
ALTER TABLE "AttemptQuestion" DROP CONSTRAINT "AttemptQuestion_questionId_fkey";

-- DropForeignKey
ALTER TABLE "AttemptQuestion" DROP CONSTRAINT "AttemptQuestion_questionId_questionVersionId_fkey";

-- DropIndex
DROP INDEX "PaperQuestion_id_baseConfigSectionId_key";

-- DropIndex
DROP INDEX "PaperQuestion_id_questionId_questionVersionId_key";

-- DropTable
DROP TABLE "AttemptQuestion";
