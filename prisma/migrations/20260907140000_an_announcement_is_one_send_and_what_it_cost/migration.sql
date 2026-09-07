-- What an admin said to a cohort, and what reaching them was expected to cost.
--
-- Purely additive: a new table, one nullable column on Notification, and the FK that was
-- deliberately left out when the ledger landed because the table it points at did not exist yet.
-- Every existing notification keeps announcementId NULL, which is what a system-produced one is.
--
-- `audience` holds the STUDENT FILTER as written rather than a frozen list of ids. That makes
-- "who was this sent to" answerable and re-runnable in the vocabulary an admin already uses on the
-- Students screen. It is a record of the QUESTION asked, not of the answer: a student who changes
-- branch tomorrow would fall out of a re-run, and the Notification rows are the durable answer.
--
-- recipientCount and estimatedCostPaise are frozen at send. Deriving them later from today's rates
-- would misreport what last month actually cost, and paise are integers because money is not a float.

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "announcementId" TEXT;

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "paidChannels" "DeliveryChannel"[],
    "recipientCount" INTEGER NOT NULL,
    "estimatedCostPaise" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_createdAt_idx" ON "Announcement"("createdAt");

-- CreateIndex
CREATE INDEX "Announcement_createdById_idx" ON "Announcement"("createdById");

-- CreateIndex
CREATE INDEX "Notification_announcementId_idx" ON "Notification"("announcementId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
