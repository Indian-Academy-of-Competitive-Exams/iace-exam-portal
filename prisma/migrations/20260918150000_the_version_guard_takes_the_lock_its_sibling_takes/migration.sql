-- question_version_sat_guard only ever checked EXISTS(PaperQuestion JOIN Attempt) with no lock.
-- Its sibling, paper_question_sat_guard, takes one first: `PERFORM 1 FROM "Test" WHERE id IN (...)
-- FOR UPDATE` before its own EXISTS, because an Attempt insert takes only a KEY SHARE lock on Test
-- via its FK — a lock that conflicts with nothing an ordinary UPDATE holds.
-- Without a FOR UPDATE of its own, a version rewrite and the first sitting on a paper pinning it
-- can each run their EXISTS check before the other's write is visible, both see "no attempt yet" /
-- "not sat", and both commit: the row a student was marked against changes under them.
--
-- Before this task that race was unreachable from the service — an in-place rewrite required zero
-- pinning PaperQuestion rows, so question_version_sat_guard's EXISTS was always vacuously false on
-- any path the trigger actually had to defend. Revisability now follows reachability instead of
-- status, so a version may be rewritten in place while one or more unreached papers still pin it —
-- the guard's EXISTS is live, and the race it never closed is ours to close.
--
-- The fix takes the same lock its sibling takes, first: every Test a paper pinning this version
-- sits on, FOR UPDATE, before checking whether any of them has been sat. That serializes a version
-- rewrite against the first Attempt insert on any test that pins it, the same way paper edits and
-- first sittings already serialize on the Test row directly.
--
-- Pure DDL: CREATE OR REPLACE FUNCTION only, the trigger definition is untouched, so no data moves
-- and the ordinary gates prove it.

CREATE OR REPLACE FUNCTION question_version_sat_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "Test"
   WHERE "id" IN (SELECT "testId" FROM "PaperQuestion" WHERE "questionVersionId" = OLD."id")
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
