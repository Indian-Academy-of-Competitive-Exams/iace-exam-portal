-- The delivery repair stops reading the whole ledger every minute.
--
-- `repairStalled` runs on the notification sweep -- every sixty seconds -- and looks for paid
-- deliveries still PENDING past their window. `NotificationDelivery` carried exactly one index, the
-- `(notificationId, channel)` unique, and none of the three columns that query names. So it was a
-- parallel sequential scan of the table plus a sort, fourteen hundred times a day, and in the normal
-- case it finds nothing.
--
-- Measured on 200,000 deliveries with none pending: 2,131 buffers and 7.3 ms become 1 buffer and
-- 0.3 ms, a Seq Scan and a quicksort become a single index scan.
--
-- Nothing prunes this table -- a row per notification per channel, kept for ever -- so that 2,131 is
-- this term's figure rather than the steady state. The index is what makes the growth stop mattering:
-- every other access is by `id`, or by `notificationId` through the unique above.
--
-- PENDING only, so the index holds what the sweep is looking for and nothing else. A settled
-- delivery is the great majority of the table and never appears in this query; keeping it out is
-- what makes the index a handful of pages instead of a copy of the ledger. Partial, so it is written
-- by hand: Prisma has no way to put a WHERE on an index.

CREATE INDEX "NotificationDelivery_pending_idx"
  ON "NotificationDelivery" ("queuedAt")
  WHERE "status" = 'PENDING';
