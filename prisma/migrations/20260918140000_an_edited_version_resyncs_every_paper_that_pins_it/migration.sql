-- PaperQuestion."optionIds" is a copy of the pinned version's option ids, in stored order, and an
-- answer sheet stores a POSITION into it. paper_question_option_ids keeps it true, but it fires on
-- PaperQuestion, so editing a QuestionVersion in place never recomputed it.
--
-- That was safe only while an in-place rewrite required zero pinning paper rows. Once a version may
-- be rewritten while unopened tests pin it, every one of those papers would keep a stale array and
-- decode a student's stored position to the wrong option.
--
-- The fan-out re-assigns "optionIds" to itself on every pinning row. That names the column in the
-- SET clause, which is what fires the existing BEFORE trigger, which rebuilds the array from the
-- version. Same pattern as the backfill in 20260917100000. No second copy of the array-building SQL.
--
-- It cannot fire on a sat paper: question_version_sat_guard refuses the QuestionVersion UPDATE
-- first when any pinning paper belongs to a test with an Attempt, so this AFTER trigger never runs.
--
-- The UPDATE this issues also leans on trigger firing order, not just its name: Postgres runs a
-- table's same-event BEFORE triggers alphabetically, so paper_question_option_ids ('o') recomputes
-- NEW."optionIds" before paper_question_sat_guard ('s') compares NEW to OLD. That's what makes the
-- self-assignment a real change by the time sat_guard sees it, so sat_guard takes its full
-- FOR-UPDATE-and-check-Attempt path rather than the status-only fast path meant for a no-op update.
-- Harmless only because question_version_sat_guard already refused this above for any sat row;
-- renaming either PaperQuestion trigger would reverse that order and drop sat_guard's own check
-- silently.

CREATE FUNCTION question_version_option_ids_fanout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "PaperQuestion"
     SET "optionIds" = "optionIds"
   WHERE "questionVersionId" = NEW."id";
  RETURN NULL;
END $$;

CREATE TRIGGER question_version_option_ids_fanout
  AFTER UPDATE OF "options" ON "QuestionVersion"
  FOR EACH ROW
  WHEN (OLD."options" IS DISTINCT FROM NEW."options")
  EXECUTE FUNCTION question_version_option_ids_fanout();
