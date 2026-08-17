import { z } from 'zod';

// ============================================================================
// The audit trail: one row per data change (`RowActionLog`) and one per import
// run (`ImportLog`). Data CRUD only — an exam interaction is not an audit
// event, it is the attempt itself.
// ============================================================================

/** Which kind of record an audit row is about. Extended as features land. */
export const AUDIT_FEATURE = {
  STUDENT: 'STUDENT',
  STUDENT_PROFILE: 'STUDENT_PROFILE',
  GROUP: 'GROUP',
  BRANCH: 'BRANCH',
  ADMIN: 'ADMIN',
  QUESTION: 'QUESTION',
  TEST: 'TEST',
} as const;
export const auditFeatureSchema = z.enum(AUDIT_FEATURE);
export type AuditFeature = z.infer<typeof auditFeatureSchema>;

export const AUDIT_ACTION = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  ACTIVATE: 'ACTIVATE',
  DEACTIVATE: 'DEACTIVATE',
  IMPORT: 'IMPORT',
} as const;
export const auditActionSchema = z.enum(AUDIT_ACTION);
export type AuditAction = z.infer<typeof auditActionSchema>;

/**
 * Who did it. Wider than `ActorTypes`, which decides a token's identity table
 * and must never admit SCRIPT or SYSTEM — nothing signs in as either.
 */
export const AUDIT_ACTOR_TYPE = {
  ADMIN: 'ADMIN',
  STUDENT: 'STUDENT',
  SCRIPT: 'SCRIPT',
  SYSTEM: 'SYSTEM',
} as const;
export const auditActorTypeSchema = z.enum(AUDIT_ACTOR_TYPE);
export type AuditActorType = z.infer<typeof auditActorTypeSchema>;
