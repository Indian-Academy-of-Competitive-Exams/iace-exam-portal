-- Audit vocabulary grows to cover the writes that had no value, and to stop one
-- pair of actions standing for two different switches.
--
-- EXAM_TYPE, TAXONOMY_SUBJECT, TAXONOMY_TOPIC, TAXONOMY_SUB_TOPIC and
-- FEATURE_PERMISSION are features with full CRUD and no AuditFeature value.
-- BLOCK/UNBLOCK exist because ACTIVATE/DEACTIVATE was being asked to mean both
-- "can sign in" and "may sit a test", which are separate columns and separate
-- admin actions.
--
-- TAXONOMY was originally one value for all three taxonomy levels. Split into
-- TAXONOMY_SUBJECT/TAXONOMY_TOPIC/TAXONOMY_SUB_TOPIC before this migration
-- ever ran anywhere, so this edits the ALTER TYPE list in place rather than
-- landing a follow-up migration that would leave a dead value behind —
-- Postgres has no DROP VALUE, so an enum value can be added but never
-- retracted once a migration carrying it has actually run. A single TAXONOMY
-- value left every RowActionLog row for a subject, topic or sub-topic edit
-- indistinguishable by entityId alone; three values make a row self-describing
-- with no query at all, including a DELETE row, where the id it names no
-- longer resolves against any table.
--
-- Additive only. Both tables are empty, so there is nothing to backfill.

ALTER TYPE "AuditFeature" ADD VALUE 'EXAM_TYPE';
ALTER TYPE "AuditFeature" ADD VALUE 'TAXONOMY_SUBJECT';
ALTER TYPE "AuditFeature" ADD VALUE 'TAXONOMY_TOPIC';
ALTER TYPE "AuditFeature" ADD VALUE 'TAXONOMY_SUB_TOPIC';
ALTER TYPE "AuditFeature" ADD VALUE 'FEATURE_PERMISSION';

-- BEFORE 'IMPORT', not appended: Postgres orders an enum by physical declaration
-- order, and `schema.prisma` declares these two ahead of IMPORT. Appending would
-- leave any future ORDER BY on this column disagreeing with the schema file.
ALTER TYPE "AuditAction" ADD VALUE 'BLOCK' BEFORE 'IMPORT';
ALTER TYPE "AuditAction" ADD VALUE 'UNBLOCK' BEFORE 'IMPORT';
