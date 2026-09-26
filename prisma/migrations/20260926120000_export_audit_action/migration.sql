-- Admin exports: every download of a list is one audited row action.
-- EXPORT is the action; ANNOUNCEMENT and AUDIT_LOG are the two exported lists that had no feature
-- of their own to be recorded under. ADD VALUE only appends, so no existing row is touched.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'EXPORT';

-- AlterEnum
ALTER TYPE "AuditFeature" ADD VALUE 'ANNOUNCEMENT';
ALTER TYPE "AuditFeature" ADD VALUE 'AUDIT_LOG';
