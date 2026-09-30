-- A re-score sweep pages along its own index instead of sorting every sitting it matched.
--
-- Before: the sweep read `ORDER BY a."id"` against Attempt_rescore_idx ("testId", "scoredRevision")
-- WHERE "status" = 'EVALUATED', and the id is not in that index — so every page sorted the WHOLE
-- matched set to find its thousand. A drop on a paper 6,000 students had sat sorted 6,000 rows six
-- times over, once per page, on the worker that is also scoring them.
--
-- After: the index carries "id" as a third column and the sweep orders and pages on all three, so a
-- page is an index range scan starting from the last row it saw and no sort runs at all.
--
-- The id has to be a NAMED column, not just the heap pointer the entry already carries: 6,000
-- sittings of one test share one "scoredRevision", so a keyset on ("testId", "scoredRevision")
-- alone is not strict — the second page would skip every remaining row of the group. The cost is
-- 16 bytes a row, and only on EVALUATED sittings, which is what the partial predicate holds.
--
-- Rows: none move. This replaces an index with a wider one covering the same rows.

DROP INDEX "Attempt_rescore_idx";

CREATE INDEX "Attempt_rescore_idx" ON "Attempt" ("testId", "scoredRevision", "id")
  WHERE "status" = 'EVALUATED';
