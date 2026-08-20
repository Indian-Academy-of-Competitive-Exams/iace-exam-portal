-- The audit vocabulary follows the model it describes.
--
-- GROUP and TAXONOMY_SUB_TOPIC name tables that no longer exist, and EXAM_TYPE
-- names one that was renamed. What the trail now has to be able to say is
-- "somebody changed the exam catalog", "somebody changed a blueprint" and
-- "somebody changed a series", so EXAM_TAXONOMY, BASE_CONFIG and TEST_SERIES
-- take their place.
--
-- Postgres can rename an enum value in place but cannot drop one, so the type is
-- rebuilt and both columns are carried across. Rows holding a retired value are
-- MOVED to the nearest surviving one rather than deleted: an audit row is the
-- record that something happened, and losing it to a vocabulary change is the
-- one thing this table must never do. A group edit was always an edit to who
-- could reach what, which is a student-shaped change; a sub-topic edit was a
-- taxonomy edit one level down from a topic.
--
-- The CASE lives in the USING clause rather than in an UPDATE before it, because
-- an UPDATE cannot assign a label the OLD type does not have.

CREATE TYPE "AuditFeature_new" AS ENUM (
  'STUDENT',
  'STUDENT_PROFILE',
  'BRANCH',
  'ADMIN',
  'QUESTION',
  'TEST',
  'TEST_SERIES',
  'BASE_CONFIG',
  'EXAM_TAXONOMY',
  'TAXONOMY_SUBJECT',
  'TAXONOMY_TOPIC',
  'FEATURE_PERMISSION'
);

ALTER TABLE "RowActionLog"
  ALTER COLUMN "feature" TYPE "AuditFeature_new"
  USING (
    CASE "feature"::text
      WHEN 'GROUP' THEN 'STUDENT'
      WHEN 'EXAM_TYPE' THEN 'EXAM_TAXONOMY'
      WHEN 'TAXONOMY_SUB_TOPIC' THEN 'TAXONOMY_TOPIC'
      ELSE "feature"::text
    END
  )::"AuditFeature_new";

ALTER TABLE "ImportLog"
  ALTER COLUMN "feature" TYPE "AuditFeature_new"
  USING (
    CASE "feature"::text
      WHEN 'GROUP' THEN 'STUDENT'
      WHEN 'EXAM_TYPE' THEN 'EXAM_TAXONOMY'
      WHEN 'TAXONOMY_SUB_TOPIC' THEN 'TAXONOMY_TOPIC'
      ELSE "feature"::text
    END
  )::"AuditFeature_new";

DROP TYPE "AuditFeature";
ALTER TYPE "AuditFeature_new" RENAME TO "AuditFeature";
