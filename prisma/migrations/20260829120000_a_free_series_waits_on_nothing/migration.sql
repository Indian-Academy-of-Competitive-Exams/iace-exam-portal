-- FREE is the kind a student reaches by asking: openToAsk offers them every FREE
-- series they do not already reach, and it checks no prerequisite. needsUnlock, on
-- the other side, holds shut any series that carries one. So a FREE series behind a
-- prerequisite is advertised in the student's browse list and then refused -- the
-- single shape the FREE kind exists to rule out, reachable today from the series
-- form by choosing a kind and a prerequisite in one save.
--
-- The rule is enforced in TestSeriesService for the message an admin can act on.
-- This is the floor underneath it, because a seed, an import or a hand-written UPDATE
-- does not go through the service.
--
-- NO DATA MOVES. A database holding a violating row fails this migration rather than
-- having its prerequisite cleared underneath it: which students reach a series is not
-- a thing to change without somebody deciding it. Before deploying, run
--
--   SELECT id, name FROM "TestSeries" WHERE kind = 'FREE' AND "prerequisiteSeriesId" IS NOT NULL;
--
-- and clear what it returns by hand. Empty is the go-ahead.

ALTER TABLE "TestSeries"
  ADD CONSTRAINT "TestSeries_free_waits_on_nothing"
  CHECK ("kind" <> 'FREE' OR "prerequisiteSeriesId" IS NULL);
