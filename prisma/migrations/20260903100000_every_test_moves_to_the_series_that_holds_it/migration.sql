-- Every test moves to the series that holds it.
--
-- Tasks 1-3 built the new access shape beside the old one: the four series kinds, Event,
-- EventCandidate and TestProgramUnlock, and seven columns that are null or defaulted on every
-- row. Nothing read them, because nothing was in them. This migration carries every existing
-- row across, and it is the only one in the sequence that can lose data -- so it refuses three
-- shapes it cannot move without guessing, before it moves anything at all.
--
-- WHAT MOVES
--
--   1. TestSeriesTest -> Test.testSeriesId / seriesOrder / opensAt. A test belonged to a series
--      through a join row that carried its position and its unlock instant; it now belongs to
--      exactly one series and carries both itself.
--
--   2. BranchTestSchedule -> Test.extraTimeSec, taking the MAXIMUM across branches. Two branches
--      could disagree about how much extra time they gave, and one number has to survive.
--      Shutting a student out of something they were entitled to is the worse failure, so the
--      larger number wins. A null extraTimeSec means zero -- access-resolver.service.ts reads it
--      as `row.extraTimeSec ?? 0` -- so max(), which skips nulls, is already the safe direction.
--
--   3. BranchTestSchedule -> Test.lateEntrySec, which is NOT max(). A null lateEntrySec does not
--      mean "no opinion", it means NO CAP: testWindow() in packages/contracts returns
--      closesAt = null for it, and access-resolver.service.ts says outright that a branch with no
--      row runs the plain rules and the plain rule for late entry is no cap. Null is therefore
--      INFINITY and the true maximum, and max() -- which skips nulls -- would return the largest
--      FINITE cap and lock out every student whose branch had none. So the test keeps a finite
--      cap only when there is nowhere for an uncapped student to come from, which is what the
--      resolver's own computeSchedule() already decides, transcribed here:
--
--        - any BranchTestSchedule row for the test with a null lateEntrySec  -> no cap
--        - any branch offered the test (an enabled BranchTestConfig on its series) with no
--          finite-cap row of its own                                          -> no cap
--        - any StudentGrant on the test's series, because a grant reaches PAST the branch gate
--          and so a granted student's branch may cap nothing at all           -> no cap
--        - otherwise, every branch that can reach it carries a finite cap     -> max()
--
--      Test.lateEntrySec is null on every row already, so the statement only ever WRITES a cap;
--      the no-cap outcome is the column being left alone.
--
--   4. BranchTestConfig -> TestSeries.branchIds / isEnabled, for a STANDARD series. Only rows
--      with enabled = true are carried, so a branch that had a config row saying "off" does not
--      arrive switched on. A STANDARD series with no enabled row keeps isEnabled = false and an
--      empty branchIds, which is what the Task 3 defaults already said.
--
--   5. STANDARD + programCode -> PROGRAM. A programCode set on a series ALREADY means
--      program-only, because the resolver's exam arm insists on programCode IS NULL. Naming
--      that kind PROGRAM preserves reach rather than changing it.
--
--   6. Every non-STANDARD series lands isEnabled = true with an empty branchIds. Only STANDARD
--      reaches through a branch; the other three reach past one, so a branch list means nothing
--      to them -- and if branch gating does not apply, deriving their switch from
--      BranchTestConfig is a pure loss of reach. It would silently switch off exactly the
--      series that need it most: a grant reaches past the branch gate entirely, an EVENT series
--      is grant-only by definition, and creating a series writes a disabled BranchTestConfig row
--      for every branch -- so a live scholarship round with two hundred grant-holders has a full
--      set of config rows with every one of them off. Deriving from those rows would take the
--      round away from all two hundred. This runs AFTER the PROGRAM conversion, so a converted
--      series does not keep the branch list step 4 just handed it either.
--
--   7. EVENT series -> Event + EventCandidate. One event per EVENT-kind series, id 'ev_' + the
--      series id so the pairing is readable in a support ticket, and one candidate per
--      StudentGrant on that series. Grants on any other kind stay grants; only an EVENT
--      series' roster becomes membership.
--
--   8. Student.enrolledExams -> Student.enrolledCourses, for students who have exams but no
--      courses. The course is derived from Exam.course, never invented. A student who already
--      has courses is left alone -- an admin's answer beats a derived one. enrolledExams has no
--      foreign key, so a code matching no Exam row derives nothing and the student keeps an
--      empty enrolledCourses; the commit body carries how many students that is.
--
-- WHY IT REFUSES RATHER THAN GUESSES
--
--   A test in TWO series has no answer under one-test-one-series. Picking one silently takes a
--   paper away from the cohort in the other, and nobody finds out until a student cannot see a
--   test they were promised. Only a human knows which series keeps it.
--
--   A non-FREE series with no exam stage will fail the CHECK (kind = 'FREE' OR examStageId IS
--   NOT NULL) that a later task adds. The migration will not reclassify it to FREE to make it
--   fit: FREE is reached by everyone enrolled in the course, so that would open a paper to the
--   whole institute to avoid an error message.
--
--   A FREE or EVENT series carrying a programCode will fail the CHECK ((kind = 'PROGRAM') =
--   (programCode IS NOT NULL)) that the same later task adds. The migration will not null the
--   programCode to make it fit, because a programCode is part of who reaches the series.
--
--   All three name the offending ids, so the fix is a query away and the re-run is idempotent
--   in the only sense that matters: the migration has not run at all until it runs whole.

-- ---------------------------------------------------------------------------
-- Pre-flight 1: a test may now belong to only one series.
-- ---------------------------------------------------------------------------
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg("testId", ', ' ORDER BY "testId") INTO offenders
  FROM (SELECT "testId" FROM "TestSeriesTest" GROUP BY "testId" HAVING count(*) > 1) AS many;

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'These tests belong to more than one series, and a test may now belong to only one. Decide which series keeps each, remove the other link, then re-run: %',
      offenders;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Pre-flight 2: only a FREE series may go without an exam stage.
-- ---------------------------------------------------------------------------
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(id, ', ' ORDER BY id) INTO offenders
  FROM "TestSeries" WHERE "kind" <> 'FREE' AND "examStageId" IS NULL;

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'These series have no exam stage, and only a FREE series may go without one. Set the stage each belongs to -- do not make them FREE, which would open them to everyone enrolled in the course -- then re-run: %',
      offenders;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Pre-flight 3: a programCode and the PROGRAM kind now imply each other.
--
-- A STANDARD row with a programCode is converted below, so it is not an offender. A FREE or
-- EVENT row with one is, and so is a PROGRAM row without one.
-- ---------------------------------------------------------------------------
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(id, ', ' ORDER BY id) INTO offenders
  FROM "TestSeries"
  WHERE ("kind" IN ('FREE', 'EVENT') AND "programCode" IS NOT NULL)
     OR ("kind" = 'PROGRAM' AND "programCode" IS NULL);

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'These series carry a programCode without being PROGRAM series, or are PROGRAM series without one, and the two now imply each other. Set the kind or clear the programCode by hand -- clearing it here would change who reaches the series -- then re-run: %',
      offenders;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The moves.
-- ---------------------------------------------------------------------------
UPDATE "Test" t
SET "testSeriesId" = l."testSeriesId",
    "seriesOrder"  = l."order",
    "opensAt"      = l."unlockAt"
FROM "TestSeriesTest" l
WHERE l."testId" = t.id;

UPDATE "Test" t
SET "extraTimeSec" = s."extraTime"
FROM (
  SELECT "testId", max("extraTimeSec") AS "extraTime"
  FROM "BranchTestSchedule" GROUP BY "testId"
) s
WHERE s."testId" = t.id;

WITH "uncapped" AS (
  SELECT "testId" FROM "BranchTestSchedule" WHERE "lateEntrySec" IS NULL
  UNION
  SELECT l."testId"
  FROM "TestSeriesTest" l
  JOIN "BranchTestConfig" bc ON bc."testSeriesId" = l."testSeriesId" AND bc.enabled
  WHERE NOT EXISTS (
    SELECT 1 FROM "BranchTestSchedule" bs
    WHERE bs."testId" = l."testId" AND bs."branchId" = bc."branchId" AND bs."lateEntrySec" IS NOT NULL
  )
  UNION
  SELECT l."testId"
  FROM "TestSeriesTest" l
  JOIN "StudentGrant" g ON g."testSeriesId" = l."testSeriesId"
)
UPDATE "Test" t
SET "lateEntrySec" = s."lateEntry"
FROM (
  SELECT "testId", max("lateEntrySec") AS "lateEntry"
  FROM "BranchTestSchedule" GROUP BY "testId"
) s
WHERE s."testId" = t.id
  AND NOT EXISTS (SELECT 1 FROM "uncapped" u WHERE u."testId" = t.id);

UPDATE "TestSeries" ts
SET "branchIds" = b."ids", "isEnabled" = true
FROM (
  SELECT "testSeriesId", array_agg("branchId") AS "ids"
  FROM "BranchTestConfig" WHERE enabled = true GROUP BY "testSeriesId"
) b
WHERE b."testSeriesId" = ts.id;

UPDATE "TestSeries" SET "kind" = 'PROGRAM' WHERE "programCode" IS NOT NULL AND "kind" = 'STANDARD';

UPDATE "TestSeries" SET "branchIds" = '{}', "isEnabled" = true WHERE "kind" <> 'STANDARD';

INSERT INTO "Event" (id, name) SELECT 'ev_' || id, name FROM "TestSeries" WHERE "kind" = 'EVENT';

UPDATE "TestSeries" SET "eventId" = 'ev_' || id WHERE "kind" = 'EVENT';

INSERT INTO "EventCandidate" ("eventId", "studentId")
SELECT 'ev_' || g."testSeriesId", g."studentId"
FROM "StudentGrant" g JOIN "TestSeries" ts ON ts.id = g."testSeriesId"
WHERE ts."kind" = 'EVENT'
ON CONFLICT DO NOTHING;

UPDATE "Student" s
SET "enrolledCourses" = c."courses"
FROM (
  SELECT s2.id, array_agg(DISTINCT e.course) AS "courses"
  FROM "Student" s2 JOIN "Exam" e ON e.code = ANY(s2."enrolledExams")
  WHERE cardinality(s2."enrolledCourses") = 0 GROUP BY s2.id
) c
WHERE c.id = s.id;
