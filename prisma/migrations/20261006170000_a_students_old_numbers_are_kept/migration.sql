-- The numbers a student used to sign in with.
--
-- Nothing could change a student's mobile at all: the rule said an admin may, and no route did.
-- A student who lost a SIM had no way back in, and once a change exists the institute's own records
-- still carry the old number, so the next person searching the roster by it finds nobody.
--
-- One row per number a student has moved OFF, written in the same transaction as the move.
-- `createdAt` is when it stopped being theirs. The row is for finding a student, never for signing
-- one in: operators recycle numbers, and the next owner of an old one is a stranger who must get an
-- account of their own. So there is no unique here, and the live-unique index stays on
-- "Student"."mobile" alone.
--
-- `changedById` carries no foreign key, as on QuestionReview: the record outlives whoever made the
-- change. The student key cascades, though nothing hard-deletes a student; an erasure deletes these
-- rows itself, because a number names a person as surely as a name does.
--
-- A new table, so there is nothing to backfill and nothing to move.

CREATE TABLE "StudentMobileHistory" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "mobile" TEXT NOT NULL,
    "changedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentMobileHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentMobileHistory_studentId_idx" ON "StudentMobileHistory"("studentId");

CREATE INDEX "StudentMobileHistory_mobile_idx" ON "StudentMobileHistory"("mobile");

ALTER TABLE "StudentMobileHistory" ADD CONSTRAINT "StudentMobileHistory_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
