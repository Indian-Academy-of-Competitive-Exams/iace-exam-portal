-- A test's paper is frozen because it has been OFFERED, not because a flag says so.
--
-- `isLocked` and `finalizedAt` were only ever written together: finalize set both, and the thaw
-- every paper edit ran cleared both. So on a healthy row the two already agree, and the boolean
-- carries nothing `"finalizedAt" IS NOT NULL` does not. The flag goes; the watermark stays,
-- because it is what stops `offer` incrementing `Question.fixedUseCount` a second time when a
-- retired test is offered again.
--
-- The two statements below are for a row where they somehow disagree, which no code path writes
-- but nothing in the schema forbade either. They are deliberately asymmetric:
--   * locked with no watermark would, after the drop, read as a draft — and a later offer would
--     then count its questions for a second time. Its own last write is the closest instant we
--     still hold, so it becomes the watermark.
--   * unlocked WITH a watermark would, after the drop, read as frozen — a half-built paper the
--     admin could no longer edit and the student screens would show as finalized. The watermark
--     is the wrong one of the two, so it goes.
-- Both are no-ops on a database whose rows agree, which is every database we have.

UPDATE "Test" SET "finalizedAt" = "updatedAt" WHERE "isLocked" = true AND "finalizedAt" IS NULL;

UPDATE "Test" SET "finalizedAt" = NULL WHERE "isLocked" = false AND "finalizedAt" IS NOT NULL;

ALTER TABLE "Test" DROP COLUMN "isLocked";
