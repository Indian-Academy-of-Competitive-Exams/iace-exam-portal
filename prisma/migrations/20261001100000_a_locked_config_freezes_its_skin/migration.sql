-- `base_config_guard` freezes the shape of a config once a paper built from it has been sat, and it
-- has listed its frozen columns by name since the baseline. `examTemplate` was added to BaseConfig
-- eight days later by 20260828090000_a_paper_carries_its_skin and never added to the list, so
--
--   UPDATE "BaseConfig" SET "examTemplate" = 'SSC_RAILWAYS' WHERE "locked";
--
-- was accepted by the database — re-skinning a paper somebody had already sat, which is exactly the
-- class of change the guard exists to refuse. The API path was never exposed: `locksOutEdit` admits
-- only name, isDefault and isActive on a locked config. This closes the hole a script, a worker or a
-- psql session could still walk through.
--
-- The function is replaced whole rather than patched, because that is the only way Postgres takes a
-- change to a trigger body. The trigger binding itself is untouched, so no row is re-validated and
-- nothing is rewritten: this is DDL only, and a config already carrying a non-default skin keeps it.
-- The column list below is the one from 20260918120000_every_id_is_a_uuid, which recreated this
-- function for the uuid parameter types, plus `examTemplate`.

CREATE OR REPLACE FUNCTION base_config_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."locked" THEN
      RAISE EXCEPTION 'base config % is locked; it cannot be deleted', OLD."id";
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."locked" AND (
       NEW."examStageId"          IS DISTINCT FROM OLD."examStageId"
    OR NEW."clonedFromId"         IS DISTINCT FROM OLD."clonedFromId"
    OR NEW."version"              IS DISTINCT FROM OLD."version"
    OR NEW."locked"               IS DISTINCT FROM OLD."locked"
    OR NEW."totalQuestions"       IS DISTINCT FROM OLD."totalQuestions"
    OR NEW."totalMarks"           IS DISTINCT FROM OLD."totalMarks"
    OR NEW."durationSec"          IS DISTINCT FROM OLD."durationSec"
    OR NEW."timerTemplate"        IS DISTINCT FROM OLD."timerTemplate"
    OR NEW."navigation"           IS DISTINCT FROM OLD."navigation"
    OR NEW."optionalSectionCount" IS DISTINCT FROM OLD."optionalSectionCount"
    OR NEW."defaultTestUi"        IS DISTINCT FROM OLD."defaultTestUi"
    OR NEW."examTemplate"         IS DISTINCT FROM OLD."examTemplate"
    OR NEW."languageMode"         IS DISTINCT FROM OLD."languageMode"
    OR NEW."languages"            IS DISTINCT FROM OLD."languages"
    OR NEW."shuffleQuestions"     IS DISTINCT FROM OLD."shuffleQuestions"
    OR NEW."shuffleOptions"       IS DISTINCT FROM OLD."shuffleOptions"
    OR NEW."calculatorEnabled"    IS DISTINCT FROM OLD."calculatorEnabled"
    OR NEW."featureFlags"         IS DISTINCT FROM OLD."featureFlags"
    OR NEW."scoringVersion"       IS DISTINCT FROM OLD."scoringVersion"
  ) THEN
    RAISE EXCEPTION 'base config % is locked; clone it to change its shape', OLD."id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
