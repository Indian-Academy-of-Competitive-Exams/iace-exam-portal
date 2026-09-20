-- A proof-reader finalizes a SECTION, and the offer gate accepted that as proof the PAPER
-- had been read. It is not: the paper can change after the reading. A question written and
-- handed over after "mark read", or a bank question added to the paper after it, reached a
-- student having been read by nobody, and the gate passed because the assignment row said
-- finalized.
--
-- Deciding that needs to know when a row joined the paper, which nothing recorded.
--
-- The backfill uses the TEST's own creation time rather than now(). A paper question cannot
-- predate its test, so the value is defensible; now() would be AFTER every existing reading
-- and would fail the gate on every test already built, which is the opposite of true. Rows
-- whose test somehow cannot be read fall back to epoch, which reads as "before any reading"
-- and so also leaves existing work alone.

ALTER TABLE "PaperQuestion" ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now();

UPDATE "PaperQuestion" AS pq
   SET "createdAt" = COALESCE(t."createdAt", TIMESTAMPTZ 'epoch')
  FROM "Test" AS t
 WHERE t.id = pq."testId";
