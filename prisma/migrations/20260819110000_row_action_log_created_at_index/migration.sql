-- The audit archive job (Task 15) picks its next day with
-- `WHERE "createdAt" < $1 ORDER BY "createdAt" ASC LIMIT 1`, run once per
-- archived day and once more to confirm the backlog is clear. The existing
-- `RowActionLog_feature_entityId_actorId_createdAt_idx` leads with `feature`,
-- so it cannot serve a scan/sort over `createdAt` alone; without this index
-- every one of those calls is a sequential scan and sort over the whole hot
-- table. Additive only — no data changes.

CREATE INDEX "RowActionLog_createdAt_idx" ON "RowActionLog"("createdAt");
