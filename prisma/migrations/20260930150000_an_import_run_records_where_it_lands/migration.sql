-- A question import run records where it was previewed to land, so it is imported only there.
--
-- Before: a run (ImportLog) previewed through the bank's importer could be committed through a
-- section's, and the reverse, by the same admin: the commit checked only who previewed it. After:
-- the preview writes `target` ('bank', or the section as 'testId/baseConfigSectionId') and the
-- commit refuses a run whose target is not the route it comes through.
--
-- Nullable with no default, so adding it rewrites nothing. No backfill: a run previewed before this
-- deploy keeps a null target and commits through either importer, exactly as it did.

ALTER TABLE "ImportLog" ADD COLUMN "target" TEXT;
