-- Five columns that have never been written or read by any code path. Each was added for a feature
-- that was then built differently, or not built at all, and each has since been read by somebody as
-- a promise the code was keeping:
--
--   BaseConfig.featureFlags             -- no reader, no writer, yet frozen by base_config_guard,
--                                          which made it look load-bearing
--   RowActionLog.entityLabel            -- promised "the label as it was, so the log survives a
--                                          rename"; the audit screen has only ever shown the uuid
--   Notification.openedVia              -- promised the delivery policy would stop assuming; it
--                                          never consults it
--   NotificationDelivery.providerMessageId -- "indexed for the webhook that will"; the index was
--                                          dropped by 20260922100000 and no provider reports back
--   Event.createdById                   -- who made an event is the audit row's actor, which is
--                                          where every screen reads it from
--
-- Verified by grep across apps/, packages/, prisma/ and scripts/ before writing this: four of the
-- five had zero references of any kind. `featureFlags` had three — the clone that copied it, the
-- locked-config trigger's frozen list, and a test of the clone — all removed in the same commit.
--
-- Nothing is backfilled or moved, because there is nothing in any of them to move: no writer has
-- ever existed. A DROP COLUMN is a catalog change in Postgres, not a table rewrite, so this is
-- cheap on Attempt-sized tables too.
--
-- base_config_guard is replaced rather than altered, because Postgres takes a trigger body change
-- no other way. The list is the one from 20261001100000 minus featureFlags; every other column it
-- freezes is unchanged, and a config already locked stays locked on exactly the same terms.

ALTER TABLE "BaseConfig" DROP COLUMN "featureFlags";
ALTER TABLE "RowActionLog" DROP COLUMN "entityLabel";
ALTER TABLE "Notification" DROP COLUMN "openedVia";
ALTER TABLE "NotificationDelivery" DROP COLUMN "providerMessageId";
ALTER TABLE "Event" DROP COLUMN "createdById";

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
    OR NEW."scoringVersion"       IS DISTINCT FROM OLD."scoringVersion"
  ) THEN
    RAISE EXCEPTION 'base config % is locked; clone it to change its shape', OLD."id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
