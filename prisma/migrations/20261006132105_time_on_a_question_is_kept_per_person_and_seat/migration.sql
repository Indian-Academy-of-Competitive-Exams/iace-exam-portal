-- How long a typist and a proof-reader each spend on one question of one test.
--
-- Nothing recorded it. A section came back done or released and the only measure of the work in it
-- was a count of questions, so nobody could say which questions were slow to type or slow to read,
-- or how the time split between the two seats.
--
-- One row per (test, question, admin, seat), holding a running total in seconds. The authoring page
-- counts while a question is the one on screen in a visible tab and adds to the total in batches;
-- there is no row per visit, because nothing reads a history of it and the page would write one
-- every half minute. `role` is part of the key: a super admin can sit in either seat of the same
-- section, and the two kinds of time must not merge.
--
-- `adminId` carries no foreign key, as on QuestionReview: the time outlives whoever spent it. Both
-- real keys cascade, so a typist's discarded draft takes its time with it and a deleted test leaves
-- nothing behind.
--
-- A new table, so there is nothing to backfill and nothing to move.

CREATE TABLE "QuestionWorkTime" (
    "id" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "baseConfigSectionId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "role" "AssignmentRole" NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionWorkTime_pkey" PRIMARY KEY ("id"),
    -- A total only ever grows; a negative one is a caller subtracting time.
    CONSTRAINT "QuestionWorkTime_seconds_check" CHECK ("seconds" >= 0)
);

CREATE INDEX "QuestionWorkTime_testId_baseConfigSectionId_idx" ON "QuestionWorkTime"("testId", "baseConfigSectionId");

CREATE INDEX "QuestionWorkTime_questionId_idx" ON "QuestionWorkTime"("questionId");

CREATE UNIQUE INDEX "QuestionWorkTime_testId_questionId_adminId_role_key" ON "QuestionWorkTime"("testId", "questionId", "adminId", "role");

ALTER TABLE "QuestionWorkTime" ADD CONSTRAINT "QuestionWorkTime_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionWorkTime" ADD CONSTRAINT "QuestionWorkTime_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
