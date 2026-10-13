-- Descriptive papers: an essay, a letter, a précis, written free in the sitting.
--
-- QuestionType gains DESCRIPTIVE. Its stem is the prompt and it has no options. Its answer key
-- holds what it is marked against: the key points an answer should make, one a line, and a rubric
-- of format and word limits. Nobody reads the writing — the scorer checks it by rule and pays part
-- marks, and every result says it was not an examiner.
--
-- BaseConfigSection.descriptive marks a section of such questions. A section is answered, typed or
-- written, and its paper draws only the kind it is, so this flag is what keeps an essay out of a
-- reasoning section and a choice question out of a writing one. False on every existing section.
--
-- A new enum value and a column with a default. No row is moved, and the guard that freezes a
-- locked configuration's sections refuses any write to them, so it covers this column.

-- AlterEnum
ALTER TYPE "QuestionType" ADD VALUE 'DESCRIPTIVE';

-- AlterTable
ALTER TABLE "BaseConfigSection" ADD COLUMN     "descriptive" BOOLEAN NOT NULL DEFAULT false;

