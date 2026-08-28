-- A series stops being free-or-not and becomes one of three things it can be.
--
-- `isFree` was documented as pricing, but there is no pricing here: the flag was always saying
-- what KIND of series this is. Two booleans would have let a scholarship series also be free,
-- and a free series is reached by every student enrolled in its exam family — so that pair would
-- have leaked a scholarship intake, built for named candidates, to a whole family of students.
-- An enum cannot be in both states, which is the only reason it is an enum.
--
-- DATA MOVE. Every isFree row becomes FREE and every other row becomes STANDARD. Nothing becomes
-- SCHOLARSHIP: no series was ever marked one, and the intake importer is what creates them from
-- here. Written add -> update -> drop so the old column is still readable while the new one is
-- filled; a drop-then-add would lose which series were free with nothing to recover it from.

CREATE TYPE "TestSeriesKind" AS ENUM ('STANDARD', 'FREE', 'SCHOLARSHIP');

ALTER TABLE "TestSeries" ADD COLUMN "kind" "TestSeriesKind" NOT NULL DEFAULT 'STANDARD';

UPDATE "TestSeries" SET "kind" = 'FREE' WHERE "isFree" = true;

ALTER TABLE "TestSeries" DROP COLUMN "isFree";
