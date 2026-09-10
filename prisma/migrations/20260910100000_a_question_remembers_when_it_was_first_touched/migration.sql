-- Time on a question was only ever banked when the student ANSWERED it, so a question read
-- carefully and left blank recorded nothing at all -- neither the seconds nor the visit. The
-- screen now banks the seconds when a question is LEFT, which fixes `timeSpentSec` on its own.
--
-- What it cannot fix is WHEN the student first engaged. `answeredAt` is the last answer given,
-- so a student who answers at 40s, changes their mind at 200s and settles at 260s reads as one
-- data point at 260s. Time-to-first-response -- how long a question takes to get a reaction at
-- all -- is the interesting figure for an item analysis, and nothing held it.
--
-- Nullable and NOT backfilled, deliberately. Every attempt before this migration genuinely does
-- not have the fact; inventing one from `answeredAt` would put a number in the column that says
-- "first touch" while meaning "last answer", and every average computed over it afterwards would
-- be quietly wrong. A NULL reads as "we did not measure this sitting", which is the truth.
--
-- No index: it is read per attempt alongside the rest of the row, never filtered or sorted on.

ALTER TABLE "AttemptQuestion" ADD COLUMN "firstActionAt" TIMESTAMPTZ(3);
