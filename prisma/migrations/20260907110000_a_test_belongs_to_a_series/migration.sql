-- A test reaches a student only through a series: activationBlocker refuses to make a seriesless
-- test ACTIVE, and the student catalog walks series -> tests, so one in no series is invisible.
-- That is a state with no valid ending, and the previous migration gave the series the mode its
-- tests inherit. This one says both facts in the table: the link is required, and the mode on a
-- test is the mode of the series carrying it, enforced by a composite foreign key rather than by
-- whichever service happened to write the row.
--
-- ON UPDATE NO ACTION IS THE POINT OF THIS FILE, not boilerplate. Prisma's default for a relation
-- is ON UPDATE CASCADE, and cascading here was measured on a throwaway database rewriting every
-- test in a series from PRACTICE to RANKED the moment the series' mode was edited -- silently
-- reinterpreting sittings that were already scored under the other rule. NO ACTION turns "a
-- series' mode cannot change once it holds a test" into something Postgres refuses. It matches the
-- ON DELETE RESTRICT ON UPDATE NO ACTION that Test's other composite keys already carry.
--
-- Test.evaluationMode loses its DEFAULT 'RANKED' deliberately. With the key in place, a create
-- that fell through to the default would try to put a RANKED row inside a PRACTICE series and die
-- on a constraint error instead of being derived. Removing the default makes "the server reads the
-- mode off the series" structural rather than remembered.
--
-- The NOT NULL is a real data move, so `migrate deploy` from an empty database proves nothing
-- about it: there are no rows to refuse. A test in no series therefore stops this migration by
-- name. It is not placed anywhere: nothing in the data model says which series a loose test
-- belongs to, and a migration that picked one would hand a paper to a cohort nobody chose. An
-- operator reads the ids, puts each test in a series or deletes it, and runs this again.

DO $$
DECLARE loose text;
BEGIN
  SELECT string_agg(coalesce(t."title", '(untitled)') || ' (' || t."id" || ')', ', ' ORDER BY t."id")
    INTO loose
    FROM "Test" t
   WHERE t."testSeriesId" IS NULL;

  IF loose IS NOT NULL THEN
    RAISE EXCEPTION 'These tests are in no series, and a test reaches a student only through one: %. Put each of them in a series, or delete it, then run this migration again.', loose;
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "Test" DROP CONSTRAINT "Test_testSeriesId_fkey";

-- AlterTable
ALTER TABLE "Test" ALTER COLUMN "evaluationMode" DROP DEFAULT,
ALTER COLUMN "testSeriesId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_testSeriesId_evaluationMode_fkey" FOREIGN KEY ("testSeriesId", "evaluationMode") REFERENCES "TestSeries"("id", "evaluationMode") ON DELETE RESTRICT ON UPDATE NO ACTION;
