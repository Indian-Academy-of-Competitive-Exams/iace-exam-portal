-- Five facts the platform already knew and never said: a test opened, a re-score moved marks a
-- student had been shown, their PIN changed, and they signed up. Three need a NotificationType of
-- their own; TEST_ASSIGNED already existed and had no producer.
--
-- ADD VALUE rather than the recreate-and-swap dance in 20260904130000: that one NARROWED the enum
-- and had to rewrite the column to drop a value. Adding is additive, and Postgres 12+ takes it
-- inside a transaction as long as the new values are not used in the same one. They are not.
--
-- `Test.announcedAt` is the open-sweep's watermark, and the BACKFILL below is the whole reason it
-- can be switched on safely. Every ACTIVE test that is already open would otherwise look unannounced
-- to the first sweep, and every student who reaches one would be told about a paper that has been
-- sitting in their catalog for weeks. Stamping them now means the sweep only ever speaks about a
-- test that opens from here on. A test still in DRAFT is left null on purpose: it has not opened,
-- so it is not something the sweep has missed -- it is something it has yet to reach.

ALTER TYPE "NotificationType" ADD VALUE 'RESULT_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'PIN_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'WELCOME';

ALTER TABLE "Test" ADD COLUMN "announcedAt" TIMESTAMPTZ(3);

UPDATE "Test"
   SET "announcedAt" = now()
 WHERE "status" = 'ACTIVE'
   AND ("opensAt" IS NULL OR "opensAt" <= now());
