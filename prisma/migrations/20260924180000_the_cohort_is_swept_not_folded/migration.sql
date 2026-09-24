-- The cohort's three aggregates stop being folded per sitting and start being recounted per test.
--
-- A fold needed a per-attempt ledger, because a delta added to a total can only be applied once and
-- nothing else in the row says whether it already was. A recount needs none: it reads the sittings
-- and writes the answer outright, so running it twice writes the same numbers. That is what makes
-- `ProcessedRollup` dead rather than merely unused, and why dropping it is safe without a move --
-- there is nothing in it that is not derivable from `Attempt` in one statement.
--
-- The new index is the sweep's watermark. `updatedAt` and not `evaluatedAt` because the two things
-- that move marks already counted -- a dropped question re-scoring every sitting, and a void --
-- both leave `evaluatedAt` exactly where it was, so a sweep keyed on it would never see either.

DROP TABLE "ProcessedRollup";

CREATE INDEX "Attempt_testId_updatedAt_idx" ON "Attempt"("testId", "updatedAt");
