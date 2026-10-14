-- A broadcast is no longer copied into one Notification row per student. An in-app announcement
-- (no paid channel) and a test opening are each ONE row already — the Announcement, the Test with
-- its announcedAt — and the bell resolves who they reach when it is read. Only a read is written
-- per student, here, keyed by the broadcast's own id (the announcement's or the test's).
--
-- Copies written before this stay as they are: the bell skips a broadcast the student already
-- holds a copy of, so nothing is moved or deleted.

-- CreateTable
CREATE TABLE "BroadcastRead" (
    "studentId" UUID NOT NULL,
    "broadcastId" UUID NOT NULL,
    "readAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastRead_pkey" PRIMARY KEY ("studentId","broadcastId")
);

-- CreateIndex
CREATE INDEX "BroadcastRead_broadcastId_idx" ON "BroadcastRead"("broadcastId");

-- AddForeignKey
ALTER TABLE "BroadcastRead" ADD CONSTRAINT "BroadcastRead_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
