-- SavedQuestion.attemptId and .paperQuestionId are provenance -- which sitting and which paper row
-- a bookmark came from -- read by SavedQuestionsService.satContext but never a real foreign key:
-- nothing stopped a value naming a row that had already been cascaded or deleted away, and
-- satContext degraded silently rather than throwing, which is why it went unnoticed. The previous
-- migration's own cleanup (a hard-deleted, unsat test cascading its PaperQuestion rows) is one path
-- that reaches this; there is no reason to believe it is the only one a live database has hit.
--
-- The two UPDATEs below run BEFORE the ADD CONSTRAINT that follows: a value already dangling in a
-- live database would make that ADD CONSTRAINT fail outright, so it has to be nulled first. A fresh
-- database has no rows for either UPDATE to match, which is also why neither gate proves this half
-- of the migration -- see docs/superpowers/task-constraints.md on a migration that moves data.
UPDATE "SavedQuestion" sq
SET "attemptId" = NULL
WHERE sq."attemptId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Attempt" a WHERE a.id = sq."attemptId");

UPDATE "SavedQuestion" sq
SET "paperQuestionId" = NULL
WHERE sq."paperQuestionId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "PaperQuestion" pq WHERE pq.id = sq."paperQuestionId");

-- CreateIndex
CREATE INDEX "SavedQuestion_attemptId_idx" ON "SavedQuestion"("attemptId");

-- CreateIndex
CREATE INDEX "SavedQuestion_paperQuestionId_idx" ON "SavedQuestion"("paperQuestionId");

-- AddForeignKey
ALTER TABLE "SavedQuestion" ADD CONSTRAINT "SavedQuestion_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedQuestion" ADD CONSTRAINT "SavedQuestion_paperQuestionId_fkey" FOREIGN KEY ("paperQuestionId") REFERENCES "PaperQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
