-- A test series can now say that it is a graded ramp: each paper harder than the one
-- before it, so a student's raw score is expected to fall even while they improve.
-- The Performance screen reads this column and nothing else to decide whether to draw
-- the climb-against-the-ramp view and the per-subject mastery sparklines; a flat series
-- gets neither, because over a flat series they would be a line with no ramp under it.
--
-- Why this is NOT sequentialTests, which already exists two columns above it:
--
--   sequentialTests is about ORDER -- must these tests be sat one after another, in the
--   order TestSeriesTest.order gives, or may a student pick any of them at any time.
--   It says nothing about the papers themselves.
--
--   progressive is about DIFFICULTY -- do the papers get harder as the sequence runs.
--
-- The two are independent in both directions, which is why neither can be derived from
-- the other. A revision series may be strictly ordered and uniformly easy (sequential,
-- flat). A drop-in "grade yourself" ladder may let a student start anywhere while its
-- papers still climb (not sequential, progressive). Folding them into one flag would
-- put the ramp view on every ordered series and hide it on every unordered ladder.
--
-- NO DATA MOVES. This adds one boolean with a default, so every existing series lands
-- on false -- flat, the shape they all have today, and nobody's screen changes until an
-- admin says a particular series is a ramp. The column is NOT NULL because "we do not
-- know whether this climbs" is not a state the screen could draw anything for.

ALTER TABLE "TestSeries"
  ADD COLUMN "progressive" BOOLEAN NOT NULL DEFAULT false;
