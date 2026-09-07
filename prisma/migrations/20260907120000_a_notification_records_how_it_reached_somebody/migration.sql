-- A notification stops being only a row somebody might read, and starts carrying the record of
-- every channel that tried to deliver it.
--
-- Three things Prisma cannot express are written by hand at the bottom of this file:
--
--   1. Exactly one recipient. `studentId` loses NOT NULL so the admin bell can be added later
--      without a second migration over a table that by then has rows in it. Nothing writes
--      `adminId` yet, so every existing and every new row still names a student — the CHECK is
--      what keeps "nullable" from meaning "optional".
--
--   2. The dedupe key, as TWO partial uniques rather than one. It is what makes a redelivered
--      outbox row harmless: the second write hits the constraint and the worker treats the
--      conflict as success. It has to be unique per RECIPIENT, and the recipient lives in one of
--      two columns, so one index cannot cover it. Both are partial on the key being present,
--      because a notification with no natural key (an ad-hoc announcement) must be free to repeat.
--
--   3. No backfill anywhere in here. `isRead` is left exactly as it was: replacing it with a
--      `readAt` instant would have been a data move, and a data move is the one thing neither a
--      from-scratch deploy nor db:check can prove.

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('IN_APP', 'WEB_PUSH', 'EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "actBy" TIMESTAMPTZ(3),
ADD COLUMN     "adminId" TEXT,
ADD COLUMN     "data" JSONB,
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "openedVia" "DeliveryChannel",
ALTER COLUMN "studentId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "skipReason" TEXT,
    "templateId" TEXT,
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "queuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_queuedAt_idx" ON "NotificationDelivery"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_providerMessageId_idx" ON "NotificationDelivery"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_notificationId_channel_key" ON "NotificationDelivery"("notificationId", "channel");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one recipient, never both and never neither.
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_one_recipient_check"
  CHECK (("studentId" IS NOT NULL)::int + ("adminId" IS NOT NULL)::int = 1);

-- One fact, one notification, per recipient. Two indexes because the recipient lives in two columns.
CREATE UNIQUE INDEX "Notification_student_dedupe_key"
  ON "Notification"("studentId", "dedupeKey")
  WHERE "studentId" IS NOT NULL AND "dedupeKey" IS NOT NULL;

CREATE UNIQUE INDEX "Notification_admin_dedupe_key"
  ON "Notification"("adminId", "dedupeKey")
  WHERE "adminId" IS NOT NULL AND "dedupeKey" IS NOT NULL;

-- The bell reads newest-first per student; the escalation job reads what is still unread.
CREATE INDEX "Notification_actBy_idx" ON "Notification"("actBy") WHERE "actBy" IS NOT NULL;
