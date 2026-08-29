-- Which series a branch runs decides what its students reach, and every other change of that kind
-- is already audited: a student's enrolment, a series, a test, the config underneath it. Switching
-- a branch on or off was the one write of that weight with nowhere to land in the trail.
--
-- The branch configuration screen is what makes this urgent rather than tidy. Until now the switch
-- moved from one screen, under one pair of eyes; it is about to move from two, one of them belonging
-- to the branch manager whose students it decides for.
--
-- NO DATA MOVES. Postgres appends an enum label in place, and no existing RowActionLog row can
-- carry the new one, so there is nothing to backfill and nothing to put back.

ALTER TYPE "AuditFeature" ADD VALUE 'BRANCH_TEST_CONFIG';
