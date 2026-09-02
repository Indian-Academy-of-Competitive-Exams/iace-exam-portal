-- DPDP, in two additions: what the student agreed to, and what it means to take it back.
--
-- Why StudentConsent is a TABLE and not three columns on Student:
--
--   Consent is not a state, it is a history. The question a regulator asks is not "does this
--   student consent" but "what were they shown, when did they agree to it, and what happened
--   after the notice changed" -- and a column can only ever answer the first. Rows are
--   append-only: a withdrawal is a new row with granted=false, never an UPDATE of the row that
--   granted it, because overwriting the grant destroys the only evidence that it was ever
--   given. The current state is the newest row per (studentId, purpose), which is what the
--   index is shaped for.
--
--   `version` is the notice the student saw, e.g. "2026-09-01". It is deliberately a free
--   string and deliberately not comparable across purposes: two notices are the same notice
--   only if they carry the same text, and only the application knows that.
--
--   ConsentPurpose has one value because V1 has one purpose -- running the platform for them.
--   Analytics, marketing and anything else a purpose could later mean are ENUM VALUES, added
--   without touching this table's shape. Parental consent for a minor is deferred (6A WS3.6):
--   DOB already lives on StudentProfile, so when it lands it is a purpose value plus a
--   guardian column, and nothing here has to move.
--
--   ON DELETE CASCADE looks wrong for an audit trail, and would be, except that a Student is
--   never hard-deleted in this platform. Erasure is anonymisation (below), so the cascade is
--   unreachable by design; it is here so that the constraint says the same thing as
--   StudentProfile's rather than inventing a second convention nobody expects.
--
-- Why anonymizedAt is its own column beside deletedAt:
--
--   They are different facts and they are asked about separately. deletedAt says the account
--   is closed -- it may have been closed for an enrolment ending, a duplicate row, a mistake.
--   anonymizedAt says the personal data is GONE, which is a promise made to one person on one
--   date in answer to one request, and the date is part of the answer. A single flag would
--   force the platform to guess which of the two happened whenever it had to explain itself.
--
--   The row itself stays, and so does every Attempt, score and rollup hanging off it. That is
--   the whole point of anonymising rather than deleting: a cohort's mean and a test's
--   difficulty are facts about a paper, not about a person, and they must not silently change
--   because somebody exercised a right. The FKs that already RESTRICT keep it that way.
--
--   Indexed because the retention sweep that is coming (deferred, 6A WS3.6) will ask "who has
--   NOT been anonymised and should be", and that is a scan of the whole table without it.

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('PLATFORM');

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "anonymizedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "StudentConsent" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentConsent_studentId_purpose_recordedAt_idx" ON "StudentConsent"("studentId", "purpose", "recordedAt");

-- CreateIndex
CREATE INDEX "Student_anonymizedAt_idx" ON "Student"("anonymizedAt");

-- AddForeignKey
ALTER TABLE "StudentConsent" ADD CONSTRAINT "StudentConsent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
