-- A section of a test's paper is assigned to a typist and a proof-reader.
--
-- QuestionAssignment carries both testId and baseConfigId, the same two-column shape
-- PaperQuestion already uses, because BaseConfigSection hangs off BaseConfig and not off Test:
-- a plain baseConfigSectionId would let a section from a different config be assigned to this
-- test. The composite foreign key to BaseConfigSection is what rules that out.
--
-- Question.assignmentId is nullable and ON DELETE SET NULL: deleting an assignment leaves its
-- questions in place, just unassigned.
--
-- Pure DDL: one new enum, one new table, one new nullable column. No data moves.

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('TYPIST', 'PROOFREADER');

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "assignmentId" UUID;

-- CreateTable
CREATE TABLE "QuestionAssignment" (
    "id" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "baseConfigId" UUID NOT NULL,
    "baseConfigSectionId" UUID NOT NULL,
    "assigneeId" UUID NOT NULL,
    "role" "AssignmentRole" NOT NULL,
    "dueAt" TIMESTAMPTZ(3),
    "finalizedAt" TIMESTAMPTZ(3),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionAssignment_assigneeId_finalizedAt_idx" ON "QuestionAssignment"("assigneeId", "finalizedAt");

-- CreateIndex
CREATE INDEX "QuestionAssignment_testId_idx" ON "QuestionAssignment"("testId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionAssignment_testId_baseConfigSectionId_role_key" ON "QuestionAssignment"("testId", "baseConfigSectionId", "role");

-- CreateIndex
CREATE INDEX "Question_assignmentId_idx" ON "Question"("assignmentId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "QuestionAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionAssignment" ADD CONSTRAINT "QuestionAssignment_testId_baseConfigId_fkey" FOREIGN KEY ("testId", "baseConfigId") REFERENCES "Test"("id", "baseConfigId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "QuestionAssignment" ADD CONSTRAINT "QuestionAssignment_baseConfigId_baseConfigSectionId_fkey" FOREIGN KEY ("baseConfigId", "baseConfigSectionId") REFERENCES "BaseConfigSection"("baseConfigId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "QuestionAssignment" ADD CONSTRAINT "QuestionAssignment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
