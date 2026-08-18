-- Exam types become writable: every row carries a canonical `code`, and the
-- catalog gains the two state columns the screen needs.
--
-- `code` is nullable today and no code has ever written it, so it is backfilled
-- from the name, VERIFIED, and only then constrained. The verification is the
-- point: a silent backfill can write a value `examTypeCodeSchema` rejects on
-- every later PATCH, producing a row that can never be edited again.

UPDATE "ExamType" SET "code" = upper(regexp_replace(trim("name"), '\s+', ' ', 'g')) WHERE "code" IS NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "ExamType" WHERE "code" !~ '^[A-Z0-9]+( [A-Z0-9]+)*$') THEN
    RAISE EXCEPTION 'ExamType.code cannot be made canonical automatically — fix these rows by hand first';
  END IF;
  IF EXISTS (SELECT 1 FROM "ExamType" GROUP BY "code" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'two exam types canonicalise to the same code';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "ExamType" ALTER COLUMN "code" SET NOT NULL;

-- AlterTable
ALTER TABLE "ExamType" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;
