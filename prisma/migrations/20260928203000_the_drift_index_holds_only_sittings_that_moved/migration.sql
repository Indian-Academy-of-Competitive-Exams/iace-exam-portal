-- The student drift sweep now asks only about sittings that moved after their first evaluation.
--
-- A first evaluation writes `evaluatedAt` and `updatedAt` from the same instant and folds the
-- student's totals in the same transaction, so it can never be drift. The sweep used to treat it
-- as drift anyway: every student with a scored sitting was replayed on every pass. It now asks
-- for `updatedAt > evaluatedAt` -- a re-score, or a void -- and a void counts, because a lost
-- rebuild after one would otherwise leave the voided sitting in the student's totals for ever.
--
-- The old partial index held every EVALUATED sitting and could not answer the new comparison
-- without a heap fetch per row, which is the cost 20260926100000 removed. This one holds only the
-- rows the sweep can return: a handful after a dropped question or a void, nothing otherwise. Its
-- predicate compares two columns of the row, so the query's own `updatedAt > evaluatedAt` proves
-- it with no parameter involved.
--
-- No data moves. The index is rebuilt from the table; the build takes a write lock on "Attempt"
-- for as long as one pass over it takes, which the release runbook already keeps out of an event window (docs/04 §14).

DROP INDEX "Attempt_student_drift_idx";

CREATE INDEX "Attempt_student_drift_idx"
  ON "Attempt" ("studentId", "updatedAt")
  WHERE "status" IN ('EVALUATED', 'VOIDED') AND "updatedAt" > "evaluatedAt";
