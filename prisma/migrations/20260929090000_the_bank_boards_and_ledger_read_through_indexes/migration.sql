-- Five reads that sorted or scanned a whole table for want of an index. No data moves.
--
-- Question (createdAt, id): the bank lists newest first, `createdAt DESC, id DESC` with OFFSET, and
-- its default filter (not ARCHIVED) matches nearly every row, so every page sorted the whole bank.
-- Student already carries the same pair for the same reason.
--
-- SavedQuestion (questionId): the FK to Question is RESTRICT, and no index led with questionId, so
-- every hard delete of a question scanned the bookmarks table to prove nothing still pointed at it.
--
-- EventCandidate (eventId, createdAt): a candidate list is one event's rows in the order they were
-- added, paged with OFFSET; only the (eventId, studentId) key existed, so each page sorted the roster.
--
-- NotificationDelivery ("queuedAt") WHERE settled: the nightly prune pages the ledger oldest first
-- over everything but PENDING. 20260922100000 dropped (status, queuedAt) as having no reader; the
-- prune was that reader. Partial, so it holds what the prune reads and leaves the PENDING rows to
-- NotificationDelivery_pending_idx; the prune now asks for exactly this predicate.
--
-- Attempt_ranking_idx gains INCLUDE (studentId, submittedAt): every board reads those two per
-- sitting beside the key columns, and without them each ranked row went back to the heap.

CREATE INDEX "Question_createdAt_id_idx" ON "Question" ("createdAt", "id");

CREATE INDEX "SavedQuestion_questionId_idx" ON "SavedQuestion" ("questionId");

CREATE INDEX "EventCandidate_eventId_createdAt_idx" ON "EventCandidate" ("eventId", "createdAt");

CREATE INDEX "NotificationDelivery_settled_idx"
  ON "NotificationDelivery" ("queuedAt")
  WHERE "status" <> 'PENDING';

DROP INDEX "Attempt_ranking_idx";
CREATE INDEX "Attempt_ranking_idx" ON "Attempt" ("testId", "score" DESC, "timeTakenSec", "id")
  INCLUDE ("studentId", "submittedAt")
  WHERE "isGraded" AND "status" = 'EVALUATED' AND "score" IS NOT NULL;
