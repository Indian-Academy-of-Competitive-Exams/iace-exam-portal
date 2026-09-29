-- A rollup keeps no column that is a sum of its own siblings, nor an average.
--
-- StudentStat."testsAttempted" was always "testsEvaluated" + "retakeCount" (every evaluated sitting
-- is one or the other), and "totalAnswered" was always "totalCorrect" + "totalWrong"; both are
-- summed on read. TestQuestionStat."attemptedCount" was "correctCount" + "wrongCount", and
-- "pValue" an average of them, which docs/02 §9 already says no rollup holds; both are derived on
-- read. StudentSubjectStat."wrong" had no reader at all; "attempted" stays, being what the
-- subject report reads, so the row keeps one count and not two that must agree.
-- No data moves: every dropped figure is recomputed from columns that stay.

ALTER TABLE "StudentStat" DROP COLUMN "testsAttempted",
DROP COLUMN "totalAnswered";

ALTER TABLE "StudentSubjectStat" DROP COLUMN "wrong";

ALTER TABLE "TestQuestionStat" DROP COLUMN "attemptedCount",
DROP COLUMN "pValue";
