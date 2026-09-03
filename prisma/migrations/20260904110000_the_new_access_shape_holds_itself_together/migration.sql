-- The new access shape holds itself together.
--
-- Tasks 1-3 added the columns, 20260903100000 filled them and 20260904100000 corrected two of
-- the fills. Only now can the rules be declared, because a CHECK is validated against every
-- existing row the moment it is added -- declared any earlier, each of these would have refused
-- the migration that was on its way to satisfying it.
--
-- Four rules and one index. Each CHECK exists because the shape it guards is read WITHOUT a
-- second look: the resolver that follows this phase switches on kind and trusts what the kind
-- implies. A row that contradicts its own kind does not raise an error there, it silently
-- resolves to the wrong set of students, which is the failure nobody notices until a paper
-- reaches somebody it should not have.
--
--   TestSeries_branches_are_standard_only -- only a STANDARD series reaches through a branch.
--   The other three reach past the branch gate entirely, so a branch list on one is not a
--   narrower reach, it is a list nothing consults. Left writable it becomes a lie an admin
--   screen will eventually render and an admin will eventually believe: a FREE series showing
--   two branches while reaching every student enrolled in the course.
--
--   TestSeries_only_free_spans_no_stage -- every kind but FREE hangs off an exam stage, because
--   the stage is what a series IS about. FREE is the one kind whose reach is the course rather
--   than the stage, so it alone may span none. Without this a STANDARD series can lose its
--   stage and stop matching any enrolment at all -- reaching nobody, while still listed and
--   still enabled, and looking entirely healthy in the admin table.
--
--   TestSeries_program_kind_names_its_program -- an equality, not an implication, and it is the
--   equality that matters. A PROGRAM series without a programCode reaches nobody; a series that
--   carries a programCode without being PROGRAM is the older and worse half, because the old
--   resolver's exam arm insisted on programCode IS NULL and so the code silently converted the
--   series into a program-only one. That conversion is now written into the kind, and this
--   refuses the ambiguous row that made it necessary.
--
--   TestSeries_event_kind_names_its_event -- the same equality for events. An EVENT series is
--   reached by its Event's candidates and by nothing else, so one without an eventId reaches
--   nobody. The other direction keeps an event's roster from quietly gating a series of some
--   other kind, where nothing would ever consult it.
--
-- The GIN index is not an optimisation, it is what makes the STANDARD arm affordable. Reach for
-- a STANDARD series is now `branchIds @> ARRAY[<the student's branch>]`, evaluated for every
-- series in the institute on every catalog read -- and the catalog is read on every student
-- landing, by every student, at the front of the test-day rush. A btree cannot answer array
-- containment, so without GIN that arm is a sequential scan of TestSeries per read. The old
-- shape had a BranchTestConfig row and an index to seek into; the array replaced the table, and
-- the index has to replace the seek with it or the read gets slower as the institute grows.
--
-- Every CHECK is NOT VALID-free on purpose: they are validated now, against the migrated rows,
-- so a row that would have contradicted its kind fails here rather than at some later write.

ALTER TABLE "TestSeries" ADD CONSTRAINT "TestSeries_branches_are_standard_only"
  CHECK (kind = 'STANDARD' OR cardinality("branchIds") = 0);

ALTER TABLE "TestSeries" ADD CONSTRAINT "TestSeries_only_free_spans_no_stage"
  CHECK (kind = 'FREE' OR "examStageId" IS NOT NULL);

ALTER TABLE "TestSeries" ADD CONSTRAINT "TestSeries_program_kind_names_its_program"
  CHECK ((kind = 'PROGRAM') = ("programCode" IS NOT NULL));

ALTER TABLE "TestSeries" ADD CONSTRAINT "TestSeries_event_kind_names_its_event"
  CHECK ((kind = 'EVENT') = ("eventId" IS NOT NULL));

CREATE INDEX "TestSeries_branchIds_idx" ON "TestSeries" USING GIN ("branchIds");
