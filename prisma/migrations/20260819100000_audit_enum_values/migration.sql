-- Audit vocabulary grows to cover the writes that had no value, and to stop one
-- pair of actions standing for two different switches.
--
-- EXAM_TYPE, TAXONOMY and FEATURE_PERMISSION are features with full CRUD and no
-- AuditFeature value. BLOCK/UNBLOCK exist because ACTIVATE/DEACTIVATE was being
-- asked to mean both "can sign in" and "may sit a test", which are separate
-- columns and separate admin actions.
--
-- Additive only. Both tables are empty, so there is nothing to backfill.

ALTER TYPE "AuditFeature" ADD VALUE 'EXAM_TYPE';
ALTER TYPE "AuditFeature" ADD VALUE 'TAXONOMY';
ALTER TYPE "AuditFeature" ADD VALUE 'FEATURE_PERMISSION';

-- BEFORE 'IMPORT', not appended: Postgres orders an enum by physical declaration
-- order, and `schema.prisma` declares these two ahead of IMPORT. Appending would
-- leave any future ORDER BY on this column disagreeing with the schema file.
ALTER TYPE "AuditAction" ADD VALUE 'BLOCK' BEFORE 'IMPORT';
ALTER TYPE "AuditAction" ADD VALUE 'UNBLOCK' BEFORE 'IMPORT';
