-- A revocable public link onto ONE student's own performance report.
--
-- Everything else in this platform is behind the global JWT guard. This table is the one
-- exception: a row here is a door that anybody holding the URL may open, so the table
-- itself carries the whole of the refusal rule and nothing about the report.
--
-- Why "token" is its own column and not the primary key:
--
--   The id is a cuid, which is time-ordered and therefore walkable -- given one id you can
--   guess the ones minted around it. The token is 32 bytes from a cryptographic RNG,
--   base64url-encoded, and it is the ONLY thing standing between the public internet and a
--   student's result. Keeping them apart means the id can be shown to the owner (it is what
--   a Revoke button addresses) while the token never leaves the link.
--
-- Why the attempt FK is ON DELETE RESTRICT:
--
--   A share is a promise about a specific sitting. If the sitting could be deleted out from
--   under it the row would survive as a token pointing at nothing, and the next person to
--   reuse that id -- or the next bug in a lookup -- would decide what the link opens. CASCADE
--   is worse than it looks here for the opposite reason: it would let a delete elsewhere in
--   the system silently retract a link the student believes is live, with no record that it
--   ever existed. RESTRICT makes the order explicit: revoke the shares, then delete the
--   attempt. The same reasoning applies to createdByAdminId -- an admin who published a link
--   cannot be erased while the link is still standing, because the audit trail of who opened
--   this door is part of what makes it safe to have opened.
--
-- revokedAt and expiresAt are both nullable and both read on EVERY request, server-side, on
-- the same request that serves the payload. NULL revokedAt means live; NULL expiresAt means a
-- deliberately permanent link, which is why expiry could not be NOT NULL with a default. A
-- share created without an explicit expiry is given 30 days by the service, not by the column:
-- a default here would silently re-date a row somebody meant to be permanent.
--
-- NO DATA MOVES. This creates one empty table and two foreign keys; nothing is read, rewritten
-- or relocated, so a from-scratch `prisma migrate deploy` exercises every statement in it.

-- CreateTable
CREATE TABLE "PerformanceShare" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "createdByAdminId" TEXT,
    "expiresAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceShare_token_key" ON "PerformanceShare"("token");

-- CreateIndex
CREATE INDEX "PerformanceShare_attemptId_idx" ON "PerformanceShare"("attemptId");

-- CreateIndex
CREATE INDEX "PerformanceShare_createdByAdminId_idx" ON "PerformanceShare"("createdByAdminId");

-- AddForeignKey
ALTER TABLE "PerformanceShare" ADD CONSTRAINT "PerformanceShare_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceShare" ADD CONSTRAINT "PerformanceShare_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
