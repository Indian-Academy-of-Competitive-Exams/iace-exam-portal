-- A section's thread becomes a conversation rather than a log: a comment can carry
-- images, and its author can reword it.
--
-- The earlier wording is kept on the comment itself, in `revisions`, oldest first
-- and never including the current body. A separate table was the obvious shape and
-- the wrong one: a message and its own history are one row's worth of fact, and two
-- tables means every read of a thread joins to find out whether a line was edited.
--
-- Nothing moves. Every existing comment was written once and never edited, so an
-- empty array and a null `editedAt` are true of all of them, and the defaults say so
-- without a backfill.

ALTER TABLE "SectionComment"
  ADD COLUMN "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "revisions" JSONB[] NOT NULL DEFAULT ARRAY[]::JSONB[],
  ADD COLUMN "editedAt" TIMESTAMPTZ(3);
