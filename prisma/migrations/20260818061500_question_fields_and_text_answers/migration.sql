-- Question bank, phase 1: the four fields the bank needs before it can be filled.
--
-- Additive only. Every column has a default or is nullable, so existing rows are
-- untouched and no backfill is needed.
--   isActive   retire a question without deleting it — excluded from future
--              draws and hidden from the bank, papers that hold it unaffected
--   answerKey  TEXT_FIELD only: { mode, answers: { "<lang>": "..." }, tolerance }
--   tags       free-form facets the importer reads from one comma-separated cell
--   source     provenance: { kind: MANUAL | IMPORT, importLogId, line }
--
-- TEXT_FIELD joins the enum here. Postgres 12+ allows ADD VALUE inside the
-- transaction Prisma wraps a migration in, as long as nothing USES the value in
-- the same transaction — nothing here does.

-- AlterEnum
ALTER TYPE "QuestionType" ADD VALUE 'TEXT_FIELD';

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "answerKey" JSONB,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "source" JSONB,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Question_isActive_idx" ON "Question"("isActive");
