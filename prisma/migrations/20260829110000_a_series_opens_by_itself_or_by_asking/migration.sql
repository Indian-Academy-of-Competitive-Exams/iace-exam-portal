-- UnlockMode.ADMIN promised "an admin grants it and nothing else does", and nothing
-- did. The value was referenced nowhere outside its own definition: needsUnlock
-- returned true for it so the series began LOCKED, applyAutoUnlocks only ever
-- considered AUTO, the sole other writer of StudentSeriesUnlock was the approval of
-- a request, and a request could not be raised for it because assertRequestable
-- demanded REQUEST. canRequestUnlock was false too, so the student could not even
-- ask. Choosing it locked a series shut for everyone, permanently, from a dropdown.
--
-- Any row still on ADMIN becomes REQUEST rather than AUTO. Both were shut; REQUEST
-- keeps the intent an admin expressed when they picked it -- somebody has to say yes
-- -- whereas AUTO would fling open, without warning, every series an admin believed
-- they had closed.
--
-- Postgres cannot drop a label from an enum, so the type is rebuilt around the two
-- that remain. The default is dropped and restored across the retype because a
-- column default is parsed against the OLD type and blocks the ALTER otherwise.
--
-- No data moves for the other half of this change: what a prerequisite MEANS is
-- decided in code, and it now reads the attempts rather than the unlock rows.

UPDATE "TestSeries" SET "unlockMode" = 'REQUEST' WHERE "unlockMode" = 'ADMIN';

ALTER TYPE "UnlockMode" RENAME TO "UnlockMode_old";
CREATE TYPE "UnlockMode" AS ENUM ('AUTO', 'REQUEST');

ALTER TABLE "TestSeries"
  ALTER COLUMN "unlockMode" DROP DEFAULT,
  ALTER COLUMN "unlockMode" TYPE "UnlockMode" USING ("unlockMode"::text::"UnlockMode"),
  ALTER COLUMN "unlockMode" SET DEFAULT 'AUTO';

DROP TYPE "UnlockMode_old";
