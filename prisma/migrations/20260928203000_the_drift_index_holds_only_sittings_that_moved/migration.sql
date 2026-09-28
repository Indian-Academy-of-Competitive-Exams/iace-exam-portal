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
-- rows the sweep can return: the sittings re-scored or voided since their first evaluation, which
-- grows with each dropped question or void but stays a small slice of the table. Its
-- predicate compares two columns of the row, so the query's own `updatedAt > evaluatedAt` proves
-- it with no parameter involved.
--
-- No data moves. Prisma applies this in one transaction, so DROP INDEX holds an ACCESS EXCLUSIVE
-- lock on "Attempt" through the rebuild: reads wait as well as writes, for one pass over the table.
-- The release runbook already keeps a release out of an event window (docs/04 §14).

DROP INDEX "Attempt_student_drift_idx";

CREATE INDEX "Attempt_student_drift_idx"
  ON "Attempt" ("studentId", "updatedAt")
  WHERE "status" IN ('EVALUATED', 'VOIDED') AND "updatedAt" > "evaluatedAt";
