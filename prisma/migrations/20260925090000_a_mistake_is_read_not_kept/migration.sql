-- `SavedQuestion` stops being two lists and goes back to being the one it was named for.
--
-- MISTAKE rows were written by the scorer for every wrong answer, and every one of them is already
-- in the sheet that produced it: `AttemptSheet.verdicts` records `isCorrect` per slot, and the
-- question report filters on exactly that. So the rows were a second copy of a fact the platform
-- keeps anyway, and the only thing they bought was a CROSS-TEST view of it. That view is withdrawn;
-- per-test, a student reads the same thing from their report's Incorrect filter.
--
-- THIS MIGRATION DELETES ROWS, and the order below is load-bearing. The old unique was
-- (studentId, questionId, kind), so one student could hold the same question twice -- once starred,
-- once got wrong. Narrowing the unique to (studentId, questionId) with both rows still present would
-- fail on exactly those students, and they are the engaged ones: somebody who stars a question they
-- got wrong is the likeliest person in the table to have a pair. The MISTAKE rows therefore go
-- FIRST, while `kind` still exists to tell them apart, and only then does the constraint narrow.
--
-- What comes back if this is ever reverted: nothing. A mistake is derivable from the sheet, so the
-- rows can be regenerated from `AttemptSheet.verdicts` for any sitting still held.

DELETE FROM "SavedQuestion" WHERE "kind" = 'MISTAKE';

-- Both old indexes name `kind`, so Postgres drops them with the column; no name to get wrong here.
ALTER TABLE "SavedQuestion" DROP COLUMN "kind";
DROP TYPE "SavedQuestionKind";

CREATE UNIQUE INDEX "SavedQuestion_studentId_questionId_key" ON "SavedQuestion"("studentId", "questionId");
CREATE INDEX "SavedQuestion_studentId_createdAt_idx" ON "SavedQuestion"("studentId", "createdAt");
