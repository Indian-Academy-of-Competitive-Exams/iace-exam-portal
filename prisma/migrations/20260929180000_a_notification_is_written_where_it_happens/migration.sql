-- A notification is written by its producer, in the producer's own transaction, and pushed by a
-- sweep that claims the rows nobody has pushed yet. Before this, a producer wrote a
-- `notification.requested` row to OutboxEvent and a relay turned it into the Notification row a
-- minute later, so the bell lagged the fact it told of.
--
-- 1. `pushedAt` arrives with a fast default, so every existing row reads as already pushed
--    without the table being rewritten under this migration's lock — the first sweep must not
--    ring every phone for the whole history. Dropping the default leaves new rows NULL.
-- 2. One mapping from a request's payload to its row, as a function: a request naming a test,
--    series or announcement that is gone keeps what still exists; one whose student is gone,
--    whose payload has no title, or whose type this build no longer has is dropped, as the relay
--    would have failed or skipped it. The dedupe key makes a request the relay had already
--    written land nowhere; a KEYLESS one it wrote but had not yet marked lands twice (accepted:
--    the window is one relay pass, and only a PIN-changed notice is keyless).
-- 3. A trigger converts any request still inserted after this commits — `docs/04` §14 runs
--    this while the previous build still serves, and its producers keep writing requests until
--    their containers are replaced. It is created before the backlog is taken: its lock waits out
--    in-flight inserts, so every request is either in the backlog below or passes the trigger.
--    Nothing in this build writes that event type, so once no older build runs it never fires.
-- 4. The backlog is claimed and converted in one statement, so no request committed in between
--    is marked processed without being converted.

ALTER TABLE "Notification" ADD COLUMN "pushedAt" TIMESTAMPTZ(3) DEFAULT now();
ALTER TABLE "Notification" ALTER COLUMN "pushedAt" DROP DEFAULT;

CREATE INDEX "Notification_unpushed_idx" ON "Notification"("createdAt") WHERE "pushedAt" IS NULL;

CREATE FUNCTION "uuid_or_null"(value text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN value::uuid
  END
$$;

CREATE FUNCTION "notification_from_request"(payload jsonb, requested_at timestamptz)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO "Notification" (
    "id", "studentId", "type", "title", "body", "data", "dedupeKey",
    "announcementId", "actBy", "testId", "testSeriesId", "createdAt"
  )
  SELECT
    gen_random_uuid(), s."id", (payload->>'type')::"NotificationType", payload->>'title',
    payload->>'body', payload->'data', payload->>'dedupeKey',
    a."id", (payload->>'actBy')::timestamptz, t."id", ts."id", requested_at
  FROM "Student" s
  LEFT JOIN "Announcement" a ON a."id" = "uuid_or_null"(payload->>'announcementId')
  LEFT JOIN "Test" t ON t."id" = "uuid_or_null"(payload->>'testId')
  LEFT JOIN "TestSeries" ts ON ts."id" = "uuid_or_null"(payload->>'testSeriesId')
  WHERE s."id" = "uuid_or_null"(payload->>'studentId')
    AND payload->>'title' IS NOT NULL
    AND payload->>'type' = ANY (enum_range(NULL::"NotificationType")::text[])
  ON CONFLICT DO NOTHING
$$;

CREATE FUNCTION "notification_request_written"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "notification_from_request"(NEW."payload", NEW."createdAt");
  NEW."processedAt" := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER "OutboxEvent_notification_request"
  BEFORE INSERT ON "OutboxEvent"
  FOR EACH ROW WHEN (NEW."eventType" = 'notification.requested')
  EXECUTE FUNCTION "notification_request_written"();

WITH taken AS (
  UPDATE "OutboxEvent" SET "processedAt" = now()
  WHERE "eventType" = 'notification.requested' AND "processedAt" IS NULL
  RETURNING "payload", "createdAt"
)
SELECT "notification_from_request"("payload", "createdAt") FROM taken;
