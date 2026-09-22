-- Index-only change: four dropped, one merged. No column, constraint or data change.
--
-- Sizing the production database turned up indexes no query in apps/api reaches:
--
-- 1. "Notification_actBy_idx", "NotificationDelivery_providerMessageId_idx" and
--    "NotificationDelivery_status_queuedAt_idx" have no reader. actBy is written and never
--    filtered on; providerMessageId waits for a delivery-report webhook that does not exist;
--    status is only ever read through a notification's own id. Each of them is still an entry
--    written on every insert, and a notification row is created per scored sitting.
--
-- 2. [studentId, isRead] and [studentId, createdAt] both start with studentId, and the bell
--    reads one student's rows newest first, optionally unread only. One index over
--    [studentId, createdAt, isRead] serves both, and lets the unread count be answered from
--    the index without touching the table.
--
-- 3. "StudentSubjectStat_subjectId_idx" exists for a subject-wide read nothing performs, and
--    for the foreign key to Subject, whose rows this codebase never deletes.

DROP INDEX "Notification_actBy_idx";
DROP INDEX "NotificationDelivery_providerMessageId_idx";
DROP INDEX "NotificationDelivery_status_queuedAt_idx";
DROP INDEX "StudentSubjectStat_subjectId_idx";

DROP INDEX "Notification_studentId_isRead_idx";
DROP INDEX "Notification_studentId_createdAt_idx";
CREATE INDEX "Notification_studentId_createdAt_isRead_idx" ON "Notification"("studentId", "createdAt", "isRead");
