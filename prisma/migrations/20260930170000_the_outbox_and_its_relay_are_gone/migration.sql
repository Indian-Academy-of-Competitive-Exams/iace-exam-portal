-- The transactional outbox is gone, along with the last thing that read from it.
--
-- Two migrations emptied it in turn. 20260929180000 moved notifications to their producer's own
-- transaction, leaving a BEFORE INSERT trigger to convert any `notification.requested` row an
-- older build still wrote. 20260930140000 moved re-scores onto `Attempt.scoredRevision` and dropped
-- the table's four indexes, keeping the table itself as the insert target of the build that deploy
-- replaced. Nothing in this build reads or writes it.
--
-- That "one release" caution has nothing left to protect: V1 has not been released, so there is no
-- older build serving anywhere that could insert a row here. If that changes -- if this is ever
-- applied to a box already running a build older than 20260930140000 -- roll it forward only after
-- that build's containers are replaced, because its producers would then insert into a table that
-- is not there and fail the transaction they were part of.
--
-- DROP TABLE takes the trigger with it. The three functions 20260929180000 created exist only to
-- serve that trigger: `notification_request_written` is its body, `notification_from_request` is
-- what the body calls, and `uuid_or_null` is used by nothing else in the schema.

DROP TABLE "OutboxEvent";

DROP FUNCTION "notification_request_written"();
DROP FUNCTION "notification_from_request"(jsonb, timestamptz);
DROP FUNCTION "uuid_or_null"(text);
