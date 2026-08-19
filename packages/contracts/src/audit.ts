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
  EXAM_TYPE: 'EXAM_TYPE',
  TAXONOMY_SUBJECT: 'TAXONOMY_SUBJECT',
  TAXONOMY_TOPIC: 'TAXONOMY_TOPIC',
  TAXONOMY_SUB_TOPIC: 'TAXONOMY_SUB_TOPIC',
  FEATURE_PERMISSION: 'FEATURE_PERMISSION',
} as const;
export const auditFeatureSchema = z.enum(AUDIT_FEATURE);
export type AuditFeature = z.infer<typeof auditFeatureSchema>;

export const AUDIT_ACTION = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  ACTIVATE: 'ACTIVATE',
  DEACTIVATE: 'DEACTIVATE',
  BLOCK: 'BLOCK',
  UNBLOCK: 'UNBLOCK',
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

export type FieldDiff = Record<string, { from: unknown; to: unknown }>;

/**
 * `JSON.stringify` only sees a value after its own `toJSON` already ran, so it
 * can't be steered with a replacer — this walks the value itself instead.
 */
function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value !== 'object') return value;

  const toJSON = (value as { toJSON?: () => unknown }).toJSON;
  if (typeof toJSON === 'function') {
    const raw = toJSON.call(value);
    return typeof raw === 'string' && raw !== '' && !Number.isNaN(Number(raw))
      ? Number(raw)
      : normalize(raw);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => [key, normalize(entryValue)] as const)
      .sort(byKey),
  );
}

/**
 * UTF-16 code-unit order, not `localeCompare`: this exists to make the serialized form
 * stable, and locale-sensitive ordering would let two machines sort the same keys differently.
 */
function byKey([a]: readonly [string, unknown], [b]: readonly [string, unknown]): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** Structural and key-order-insensitive, so a diff never turns on serialization detail. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** The one definition of "changed". `null` means nothing did, so no diff is stored. */
export function fieldDiff<T extends object>(
  before: T | null | undefined,
  after: T,
  fields: readonly (keyof T)[],
): FieldDiff | null {
  const diff: FieldDiff = {};

  for (const field of fields) {
    const from = before ? before[field] : null;
    const to = after[field];
    if (sameValue(from, to)) continue;
    diff[String(field)] = { from: from ?? null, to: to ?? null };
  }

  return Object.keys(diff).length === 0 ? null : diff;
}
