import { z } from 'zod';
import { csvIdQuery, csvQuery, matchModeQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { importLogStatusSchema, importSourceSchema } from './imports';
import { dateOnlySchema } from './students';

// ============================================================================
// The audit trail: one row per data change (`RowActionLog`) and one per import
// run (`ImportLog`). Data CRUD only — an exam interaction is not an audit
// event, it is the attempt itself.
// ============================================================================

/** Which kind of record an audit row is about. Extended as features land. */
export const AUDIT_FEATURE = {
  STUDENT: 'STUDENT',
  STUDENT_PROFILE: 'STUDENT_PROFILE',
  BRANCH: 'BRANCH',
  ADMIN: 'ADMIN',
  QUESTION: 'QUESTION',
  TEST: 'TEST',
  TEST_SERIES: 'TEST_SERIES',
  /** The blueprint, not the test built from it — the two change for different reasons. */
  BASE_CONFIG: 'BASE_CONFIG',
  /** The whole catalog: an exam and its stages. One vocabulary, because they move together. */
  EXAM_TAXONOMY: 'EXAM_TAXONOMY',
  TAXONOMY_SUBJECT: 'TAXONOMY_SUBJECT',
  TAXONOMY_TOPIC: 'TAXONOMY_TOPIC',
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
 * Who did it. The Prisma enum of the same shape is called `ActorType`; the name is taken in
 * contracts by the NARROWER `ActorTypes`, which decides a token's identity table and must never
 * admit SCRIPT or SYSTEM — nothing signs in as either. Two vocabularies, two names, on purpose.
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

// ============================================================================
// Read contracts: what the audit screens fetch and render.
// ============================================================================

/** What the screens promise, and what the archive job enforces. One number, two consumers. */
export const AUDIT_WINDOW_DAYS = 30;

export const rowActionSchema = z.object({
  id: z.string(),
  feature: auditFeatureSchema,
  entityId: z.string(),
  action: auditActionSchema,
  actorType: auditActorTypeSchema,
  actorId: z.string().nullable(),
  /** Resolved server-side — the column is a plain id with no FK. */
  actorName: z.string().nullable(),
  changed: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })).nullable(),
  importLogId: z.string().nullable(),
  createdAt: z.string(),
});
export type RowAction = z.infer<typeof rowActionSchema>;

export const rowActionListQuerySchema = paginationQuerySchema.extend({
  feature: csvQuery(auditFeatureSchema),
  action: csvQuery(auditActionSchema),
  entityId: z.string().optional(),
  /** Ignored for anyone but a super admin — the service forces its own value. */
  actorId: csvIdQuery(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  match: matchModeQuery(),
});
export type RowActionListQuery = z.infer<typeof rowActionListQuerySchema>;
export type RowActionListQueryInput = z.input<typeof rowActionListQuerySchema>;

export const importLogSchema = z.object({
  id: z.string(),
  feature: auditFeatureSchema,
  source: importSourceSchema,
  actorId: z.string().nullable(),
  /** Resolved server-side — the column is a plain id with no FK. */
  actorName: z.string().nullable(),
  total: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  status: importLogStatusSchema,
  /** Whether the sheet that produced this run is still fetchable — the key itself never leaves the server. */
  hasFile: z.boolean(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type ImportLogSummary = z.infer<typeof importLogSchema>;

export const ADMIN_AUDIT_ROUTES = {
  rowActions: '/admin/audit/row-actions',
  imports: '/admin/audit/imports',
  importFile: (id: string) => `/admin/audit/imports/${id}/file`,
} as const;
