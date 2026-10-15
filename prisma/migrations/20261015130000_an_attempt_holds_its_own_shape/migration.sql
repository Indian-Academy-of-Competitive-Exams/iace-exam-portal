-- Three rules every writer of "Attempt" already keeps, stated where a future writer cannot skip them.
--
--   Attempt_evaluated_is_scored  An EVALUATED sitting carries its score and its evaluatedAt. The
--                                scoring processor's mark() is the only statement that writes
--                                EVALUATED, and it writes both in the same SET. The void keeps the
--                                score it had and moves the status off EVALUATED.
--   Attempt_ends_after_start     endsAt is never before startedAt. The start writes startedAt plus a
--                                duration that is never negative (a section clock may be 0, so this
--                                is >= and not >); the resume credit adds a non-negative interval;
--                                the support extend sets GREATEST(endsAt, now) plus at least a minute.
--   Attempt_counts_not_negative  attemptNo starts at 1 (slotsAfter is ended.length + 1); the three
--                                question counts are counts; timeTakenSec is elapsedSeconds, floored
--                                at 0. A null still passes: an unscored sitting has none of them.
--
-- NOT VALID, and deliberately not validated here: Postgres checks every row written from now on and
-- skips the rows already there, so this deploy cannot fail on old data. Once production has been read
-- and this returns no rows:
--
--   SELECT "id", "status", "score", "evaluatedAt", "startedAt", "endsAt", "attemptNo",
--          "correctCount", "wrongCount", "unattemptedCount", "timeTakenSec"
--   FROM "Attempt"
--   WHERE ("status" = 'EVALUATED' AND ("score" IS NULL OR "evaluatedAt" IS NULL))
--      OR "endsAt" < "startedAt"
--      OR "attemptNo" < 1
--      OR "correctCount" < 0 OR "wrongCount" < 0 OR "unattemptedCount" < 0 OR "timeTakenSec" < 0;
--
-- run, outside a deploy (each takes only a SHARE UPDATE EXCLUSIVE lock, so sittings keep writing):
--
--   ALTER TABLE "Attempt" VALIDATE CONSTRAINT "Attempt_evaluated_is_scored";
--   ALTER TABLE "Attempt" VALIDATE CONSTRAINT "Attempt_ends_after_start";
--   ALTER TABLE "Attempt" VALIDATE CONSTRAINT "Attempt_counts_not_negative";
--
-- Until then an UPDATE to an old row that breaks a rule is refused like any new one; no writer
-- leaves a row in a broken state, so only a row that is already broken could trip it.

ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_evaluated_is_scored"
  CHECK ("status" <> 'EVALUATED' OR ("score" IS NOT NULL AND "evaluatedAt" IS NOT NULL)) NOT VALID;

ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_ends_after_start"
  CHECK ("endsAt" >= "startedAt") NOT VALID;

ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_counts_not_negative"
  CHECK (
    "attemptNo" >= 1
    AND "correctCount" >= 0 AND "wrongCount" >= 0 AND "unattemptedCount" >= 0
    AND "timeTakenSec" >= 0
  ) NOT VALID;
