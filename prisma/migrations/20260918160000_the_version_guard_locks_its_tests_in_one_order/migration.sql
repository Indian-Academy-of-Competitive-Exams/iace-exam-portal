-- 20260918150000 gave question_version_sat_guard the FOR UPDATE its sibling already took, but on an
-- unordered set: `WHERE "id" IN (SELECT "testId" FROM "PaperQuestion" ...) FOR UPDATE`. Postgres
-- locks those rows in whatever order the plan happens to emit them, and the plan for a set of two
-- or more may differ between two backends running the same statement — different join order, a seq
-- scan on one side and an index scan on the other, or simply a different physical row order.
--
-- One question version pinned by two unreached tests is enough: two proofreaders each rewrite a
-- version pinned by tests A and B, one backend locks A then B, the other B then A, and they wait on
-- each other until the deadlock detector kills one with a 40P01 the admin reads as a random save
-- failure. Adding ORDER BY "id" makes every backend take the same tests in the same sequence, so
-- the second one queues behind the first instead of crossing it.
--
-- ORDER BY with FOR UPDATE is a documented ordering of the lock acquisition, not just of the output
-- rows, because the locking happens as rows come off the sort. Its sibling paper_question_sat_guard
-- locks at most two ids named inline, which is already deterministic, so it needs no equivalent.
--
-- Pure DDL: CREATE OR REPLACE FUNCTION only, the trigger definition and every other line of the
-- body are untouched, so no data moves and the ordinary gates prove it.

CREATE OR REPLACE FUNCTION question_version_sat_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "Test"
   WHERE "id" IN (SELECT "testId" FROM "PaperQuestion" WHERE "questionVersionId" = OLD."id")
   ORDER BY "id"
   FOR UPDATE;
  IF EXISTS (
    SELECT 1
    FROM "PaperQuestion" paper
    JOIN "Attempt" sitting ON sitting."testId" = paper."testId"
    WHERE paper."questionVersionId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'A question version on a paper somebody has sat cannot change its options, key or content'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
