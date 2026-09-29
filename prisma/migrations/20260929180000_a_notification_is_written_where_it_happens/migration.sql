-- A notification is written by its producer, in the producer's own transaction, and pushed by a
-- sweep that claims the rows nobody has pushed yet. Before this, a producer wrote a
-- `notification.requested` row to OutboxEvent and a relay turned it into the Notification row a
-- minute later, so the bell lagged the fact it told of.
--
-- The data move, in three parts:
--   1. Every row already written has had its one push, so it is stamped as pushed: the sweep
--      must not ring every student's phone for the whole history on the first pass.
--   2. Requests still waiting in the outbox at deploy become the rows they asked for, unpushed,
--      so the sweep pushes them and books any paid channel their announcement chose. A request
--      naming a test, series or announcement that is gone keeps what still exists. One whose
--      student is gone, whose payload has no title, or whose type this build no longer has is
--      dropped, as the relay would have failed or skipped it. The dedupe key makes a request the
--      relay had already written (a crash before it marked the row) land nowhere.
--   3. Those requests are marked processed, so the outbox prune retires them.

ALTER TABLE "Notification" ADD COLUMN "pushedAt" TIMESTAMPTZ(3);

UPDATE "Notification" SET "pushedAt" = "createdAt";

CREATE INDEX "Notification_unpushed_idx" ON "Notification"("createdAt") WHERE "pushedAt" IS NULL;

INSERT INTO "Notification" (
  "id", "studentId", "type", "title", "body", "data", "dedupeKey",
  "announcementId", "actBy", "testId", "testSeriesId", "createdAt"
)
SELECT
  gen_random_uuid(),
  s."id",
  (e."payload"->>'type')::"NotificationType",
  e."payload"->>'title',
  e."payload"->>'body',
  e."payload"->'data',
  e."payload"->>'dedupeKey',
  (SELECT a."id" FROM "Announcement" a WHERE a."id"::text = e."payload"->>'announcementId'),
  (e."payload"->>'actBy')::timestamptz,
  (SELECT t."id" FROM "Test" t WHERE t."id"::text = e."payload"->>'testId'),
  (SELECT ts."id" FROM "TestSeries" ts WHERE ts."id"::text = e."payload"->>'testSeriesId'),
  e."createdAt"
FROM "OutboxEvent" e
JOIN "Student" s ON s."id"::text = e."payload"->>'studentId'
WHERE e."eventType" = 'notification.requested'
  AND e."processedAt" IS NULL
  AND e."payload"->>'title' IS NOT NULL
  AND e."payload"->>'type' IN (SELECT unnest(enum_range(NULL::"NotificationType"))::text)
ON CONFLICT DO NOTHING;

UPDATE "OutboxEvent" SET "processedAt" = now()
WHERE "eventType" = 'notification.requested' AND "processedAt" IS NULL;
