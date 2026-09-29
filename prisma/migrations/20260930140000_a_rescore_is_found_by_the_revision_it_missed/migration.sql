-- A re-score is found by the paper revision a sitting's marks missed, not handed on as outbox rows.
--
-- Before: a drop or a bonus wrote one `attempt.scoring_requested` OutboxEvent row per ended sitting
-- inside the admin's transaction, a relay in the sweeper handed them to BullMQ, a second repair
-- joined OutboxEvent to Attempt to find a request whose re-score never landed, and a nightly prune
-- deleted what the relay had handed on. After: the scorer stamps `scoredRevision` with the
-- `Test.paperRevision` it marked against (in the one statement that already writes the marks), a
-- drop only bumps `paperRevision`, and the sweeper queues every EVALUATED sitting whose stamp is
-- behind its test's, under an id of the sitting and the revision, so a repeat queues once.
--
-- 1. The column arrives with a constant default, so the table is not rewritten under this lock.
--    Zero is every test's revision until its first drop, so a sitting nobody has scored, or one on
--    a test nobody has dropped a question from, is already where it belongs.
-- 2. The backfill stamps only sittings on a test that has moved (paperRevision > 0) and that hold
--    marks. Their marks reflect the current revision UNLESS a scoring request for them is still
--    pending, or was handed on after their last mark (`processedAt` at or past `updatedAt`): that
--    re-score may not have run, so the sitting is left at zero and the sweep re-scores it once.
--    A request handed on but answered before `processedAt` was written reads as unanswered too;
--    the cost is one more re-score landing on the same marks. `updatedAt` is not touched — it is
--    the rollup sweeps' watermark, and moving it would recount every test and every student.
-- 3. The sweep's index: EVALUATED sittings by test and stamp, so the sweep probes only the tests
--    that have moved, and a caught-up test is one probe returning nothing. The predicate is a
--    literal, and the sweep reads it as one (docs/03 §9).
-- 4. Every scoring request goes: the sweep now finds its own work. Every row already handed on
--    goes too: the prune that deleted them is gone. The table itself stays for one release, as the
--    insert target of the build this deploy replaces (it writes scoring requests, and a build
--    before 20260929180000 writes notification requests the trigger still converts). Nothing in
--    this build reads it, so its four indexes go.

ALTER TABLE "Attempt" ADD COLUMN "scoredRevision" INTEGER NOT NULL DEFAULT 0;

UPDATE "Attempt" a
SET "scoredRevision" = t."paperRevision"
FROM "Test" t
WHERE t."id" = a."testId"
  AND t."paperRevision" > 0
  AND a."score" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "OutboxEvent" o
    WHERE o."eventType" = 'attempt.scoring_requested'
      AND o."aggregateId" = a."id"
      AND COALESCE(o."processedAt", 'infinity'::timestamptz) >= a."updatedAt");

CREATE INDEX "Attempt_rescore_idx" ON "Attempt" ("testId", "scoredRevision")
  WHERE "status" = 'EVALUATED';

DELETE FROM "OutboxEvent"
WHERE "eventType" = 'attempt.scoring_requested' OR "processedAt" IS NOT NULL;

DROP INDEX "OutboxEvent_aggregateType_aggregateId_createdAt_idx";
DROP INDEX "OutboxEvent_processedAt_createdAt_idx";
DROP INDEX "OutboxEvent_pending_idx";
DROP INDEX "OutboxEvent_scoring_request_processed_idx";
