-- Typing and data-entry skill tests. A passage to be typed is a QUESTION: it is written in the same
-- editor, goes through the same checks, and is kept in the bank like any other.
--
-- QuestionType gains TYPING. Its stem is the passage; it has no options and no answer key.
--
-- TypingPractice is one finished session in the practice area, where a student picks a standard
-- (SSC CHSL typing, SSC CGL DEST, RRB NTPC typing…) and types a TYPING question from the bank
-- against it. The figures are the ones the server computed from what was typed; the typed text is
-- not kept. presetKey is a TYPING_PRESETS key in @iace/contracts: the standards are code-owned, so
-- it is text and no enum has to be migrated when a board changes one.
--
-- Both foreign keys cascade. A practice row is only a student's own history, so it must never be
-- what stops a passage being deleted from the bank — the question's lifecycle does not count it.
--
-- A new enum value and a new table. No row is moved.

-- AlterEnum
ALTER TYPE "QuestionType" ADD VALUE 'TYPING';

-- CreateTable
CREATE TABLE "TypingPractice" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "presetKey" TEXT NOT NULL,
    "keyDepressions" INTEGER NOT NULL,
    "wordsTyped" INTEGER NOT NULL,
    "fullMistakes" INTEGER NOT NULL,
    "halfMistakes" INTEGER NOT NULL,
    "errorPct" DECIMAL(6,2) NOT NULL,
    "grossWpm" DECIMAL(7,2) NOT NULL,
    "netWpm" DECIMAL(7,2) NOT NULL,
    "qualified" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TypingPractice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TypingPractice_studentId_createdAt_idx" ON "TypingPractice"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "TypingPractice_questionId_idx" ON "TypingPractice"("questionId");

-- AddForeignKey
ALTER TABLE "TypingPractice" ADD CONSTRAINT "TypingPractice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TypingPractice" ADD CONSTRAINT "TypingPractice_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

