-- Storage parameters only. No column, constraint or index changes, and no data moves.
--
-- Postgres never updates a row in place: an UPDATE writes a NEW version of it. If that version
-- fits in the SAME page and no INDEXED column changed, it is chained to the old one and the
-- indexes are left alone -- a HOT (heap-only tuple) update. If it does not fit, the version lands
-- on another page and EVERY index on the table must be rewritten to point at it.
--
-- fillfactor is how full a page is packed on insert. The default of 100 packs it solid, so there
-- is nowhere for a later version to go and HOT can never happen. That default is right for a table
-- that is written once and read forever, which is most of them. It is wrong for these four.
--
-- All four are updated many times per row on columns that carry NO index, so they qualify for HOT
-- on the criterion that matters and are blocked only by page space:
--
--   TestStat          one row per test, folded once per evaluated sitting -- ~5,000 versions of a
--                     SINGLE row for a 5K cohort. Only topperAttemptId is indexed, and it moves
--                     about log(n) times, so nearly every update is HOT-eligible.
--   TestQuestionStat  one row per question per test, folded on the same schedule. None of its
--                     counters are indexed.
--   TestSectionStat   as above, a handful of rows absorbing the whole cohort.
--   AttemptQuestion   500,000 rows for a 5K sitting, each rewritten ~30 times by the autosave
--                     flush. The flush touches selectedOptionId, typedAnswer, state, timeSpentSec
--                     and answeredAt -- not one of them indexed.
--
-- The three rollup tables are tiny, so reserving 40% of a page costs nothing measurable and the
-- update ratio is extreme. AttemptQuestion is large, so it gets a moderate 80: the heap grows
-- ~20% and the indexes shrink, which is the trade worth making on the table that carries the
-- most write volume in the system.
--
-- Attempt and OutboxEvent are deliberately NOT here. Attempt indexes [testId, status] and
-- [testId, score] and updates both; OutboxEvent indexes [processedAt, createdAt] and processedAt
-- is the only column it ever updates. Their updates touch an indexed column, so HOT is impossible
-- for them at any fillfactor and reserving space would only waste it.
--
-- This does not rewrite existing pages -- it changes how pages are filled from here on. No
-- backfill is needed: the rows that get updated are always freshly inserted by a new sitting, and
-- rows belonging to finished sittings are never updated again.
--
-- A single row taking thousands of versions makes dead tuples faster than the default autovacuum
-- will collect them, and an uncollected HOT chain stops the next update being HOT. The three
-- rollup tables therefore also get a flat threshold instead of a percentage: on a table of one
-- row, a scale factor never triggers anything. They are small enough that vacuuming them
-- unthrottled is free.

ALTER TABLE "TestStat" SET (fillfactor = 60);
ALTER TABLE "TestQuestionStat" SET (fillfactor = 60);
ALTER TABLE "TestSectionStat" SET (fillfactor = 60);
ALTER TABLE "AttemptQuestion" SET (fillfactor = 80);

ALTER TABLE "TestStat" SET (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 50,
  autovacuum_vacuum_cost_delay = 0
);
ALTER TABLE "TestQuestionStat" SET (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 50,
  autovacuum_vacuum_cost_delay = 0
);
ALTER TABLE "TestSectionStat" SET (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 50,
  autovacuum_vacuum_cost_delay = 0
);
