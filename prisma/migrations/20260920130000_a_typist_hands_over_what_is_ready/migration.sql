-- A typist hands the proof-reader what is ready, rather than every keystroke as it lands.
--
-- Until now a question was in the reader's list the moment it was saved, so a reader
-- opening a section mid-morning was reading half-finished work and had no way to tell
-- which half. `releasedAt` is the watermark: the reader sees what has been handed over,
-- and the typist keeps editing it afterwards, so a fix still reaches the reader.
--
-- Only questions written under an assignment are gated. A question picked from the bank
-- onto a paper has no typist and nothing to wait for, so a PICKED section reads exactly
-- as it always did.
--
-- Nothing moves, and that is deliberate rather than an oversight: every question written
-- before this column existed was already visible to its reader, and backfilling NULL
-- would take it away from them mid-review. The backfill below hands over everything that
-- was already handed over, using the row's own creation time so the order still reads.

ALTER TABLE "Question" ADD COLUMN "releasedAt" TIMESTAMPTZ(3);

UPDATE "Question" SET "releasedAt" = "createdAt" WHERE "assignmentId" IS NOT NULL;
