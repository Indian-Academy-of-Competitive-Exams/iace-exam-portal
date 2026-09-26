-- The reconciler's sweep stops seq-scanning `Attempt` every 120 s.
--
-- `askAgainForUnscored` has two arms, and neither predicate is led by an existing index:
-- `Attempt` carries (studentId, createdAt), (testId, status), (testId, score), (testId, updatedAt)
-- and the two IN_PROGRESS-only partials -- nothing leads with `status` alone or `submittedAt`.
--
-- Arm 1, `neverScored` (status = 'SUBMITTED' AND score IS NULL AND submittedAt < settled): on
-- 200,000 seeded attempts (300 matching), this was a Parallel Seq Scan -- 9,771 buffers, 12.5 ms.
-- With the partial index below: an Index Scan on the predicate alone -- 85 buffers, 0.09 ms. It also
-- makes `COUNT(*)` over the same predicate an Index Only Scan (2 buffers), which is what lets the
-- sweep and its new backlog gauge share one cheap read instead of adding a second query.
--
-- Arm 2, `staleRescores`, joins `OutboxEvent` to `Attempt` by `aggregateId`, filtered to this
-- event's aggregateType/eventType and `processedAt < settled`. The existing (processedAt, createdAt)
-- index isn't led by the type filter, so it scanned past rows of every OTHER event type on this
-- table too: 202,059 buffers, 29 ms for zero matches. A partial index scoped to this one
-- aggregateType/eventType, covering the join key and the ORDER BY column, turns the OutboxEvent
-- side into an Index Only Scan (0 heap fetches) and cuts total buffers to 151,492 (-25%).
--
-- What this does NOT fix, and no index can: the join still probes `Attempt` once per candidate
-- OutboxEvent row (50,395 of them here), because the selective condition -- "a newer request exists
-- than the attempt's own last evaluation" -- is a cross-table time comparison, not a static
-- predicate either table's index can encode. That probe count is bounded by the platform's total
-- historical processed scoring-request count, not by the live hall, so this arm keeps growing with
-- lifetime volume; closing that needs the outbox row to stop being scanned once it is resolved
-- (delete or mark it on re-evaluation), which is a write-path change, not an index.
--
-- Partial, and by hand because Prisma cannot write a WHERE or an INCLUDE on an index.

CREATE INDEX "Attempt_unscored_idx"
  ON "Attempt" ("submittedAt")
  WHERE "status" = 'SUBMITTED' AND "score" IS NULL;

CREATE INDEX "OutboxEvent_scoring_request_processed_idx"
  ON "OutboxEvent" ("processedAt") INCLUDE ("aggregateId", "createdAt")
  WHERE "aggregateType" = 'Attempt' AND "eventType" = 'attempt.scoring_requested';
