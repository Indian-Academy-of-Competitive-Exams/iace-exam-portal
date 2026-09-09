-- The support console, and what a student keeps from a question they have sat.
--
-- Purely additive apart from one drop. Nothing here moves data, so a from-scratch apply and
-- `db:check` are sufficient proof: every table is new, every column is nullable, and the one
-- enum variant is appended rather than inserted.
--
-- VOIDING a sitting is an archive, never a delete. `AttemptStatus.VOIDED` plus the three columns
-- on `Attempt` record who did it, when, and why, so a sitting withdrawn after a hall incident
-- keeps its answers and its audit trail while dropping out of every rollup, leaderboard and cohort
-- read. Deleting the row instead would silently change a cohort's history.
--
-- `NotificationPreference` holds only what a student has CHANGED — an absent row is the policy
-- default, and a null `type` means the choice covers every notification type. IN_APP is the floor
-- and is enforced in code rather than by a constraint, because the floor is a product rule that
-- will move and a CHECK would need a migration each time it did.
--
-- `SavedQuestion` carries a kind because the two ways a question is kept are not the same act:
-- BOOKMARK is deliberate, MISTAKE is added for them when they get it wrong. One table rather than
-- two, because the screens that read them differ only by that column.
--
-- `QuestionFlag` is the proof-reading queue. It cascades from the question, since a flag against a
-- question that no longer exists is not a thing anyone can resolve.
--
-- `UnlockState` is dropped: the schema already marked it unused by any column.

-- CreateEnum
CREATE TYPE "SavedQuestionKind" AS ENUM ('BOOKMARK', 'MISTAKE');

-- CreateEnum
CREATE TYPE "QuestionFlagCategory" AS ENUM ('AWKWARD', 'INVALID', 'TOO_DIFFICULT', 'INSUFFICIENT_DATA', 'OTHER');

-- CreateEnum
CREATE TYPE "QuestionFlagStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "AttemptStatus" ADD VALUE 'VOIDED';

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMPTZ(3),
ADD COLUMN     "voidedById" TEXT;

-- DropEnum
DROP TYPE "UnlockState";

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "type" "NotificationType",
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedQuestion" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "kind" "SavedQuestionKind" NOT NULL,
    "attemptId" TEXT,
    "paperQuestionId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionFlag" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "versionId" TEXT,
    "category" "QuestionFlagCategory" NOT NULL,
    "comment" TEXT NOT NULL,
    "status" "QuestionFlagStatus" NOT NULL DEFAULT 'OPEN',
    "raisedById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationPreference_studentId_idx" ON "NotificationPreference"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_studentId_channel_type_key" ON "NotificationPreference"("studentId", "channel", "type");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_studentId_idx" ON "PushSubscription"("studentId");

-- CreateIndex
CREATE INDEX "SavedQuestion_studentId_kind_createdAt_idx" ON "SavedQuestion"("studentId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedQuestion_studentId_questionId_kind_key" ON "SavedQuestion"("studentId", "questionId", "kind");

-- CreateIndex
CREATE INDEX "QuestionFlag_questionId_status_idx" ON "QuestionFlag"("questionId", "status");

-- CreateIndex
CREATE INDEX "QuestionFlag_status_createdAt_idx" ON "QuestionFlag"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedQuestion" ADD CONSTRAINT "SavedQuestion_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedQuestion" ADD CONSTRAINT "SavedQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionFlag" ADD CONSTRAINT "QuestionFlag_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

