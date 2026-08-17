import { z } from 'zod';
import { paginationQuerySchema } from './envelope';

// ============================================================================
// Feature-level access control: an admin holds a LEVEL on a FEATURE key.
// No roles, no per-route grants, no hierarchy — every feature is a peer, and
// several screens may share one key. Levels are fixed here; keys grow at runtime.
// ============================================================================

/** WRITE is create + update + delete, and always implies READ. There is no DELETE level. */
export const PERMISSION_LEVELS = {
  READ: 'READ',
  WRITE: 'WRITE',
} as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[keyof typeof PERMISSION_LEVELS];
export const permissionLevelSchema = z.enum(PERMISSION_LEVELS);

/**
 * The keys code already references, named so a controller need not retype one.
 * NOT a tier — `featureKeySchema` is open, and nothing is seeded.
 */
export const FEATURE_KEYS = {
  STUDENT_MANAGEMENT: 'STUDENT_MANAGEMENT',
  QUESTION_MANAGEMENT: 'QUESTION_MANAGEMENT',
  TEST_MANAGEMENT: 'TEST_MANAGEMENT',
  BRANCH_TEST_MANAGEMENT: 'BRANCH_TEST_MANAGEMENT',
} as const;

/**
 * Any canonical key. A string, not a union: the set is open at runtime, and a closed
 * enum would reject rows the API had just created.
 */

const FEATURE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** Normalised, not rejected: "student management" becomes STUDENT_MANAGEMENT. */
export function canonicalFeatureKey(value: string): string {
  return (
    value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      // No quantifier: the replace above leaves at most one underscore at each end,
      // and `_+$` would backtrack through every run.
      .replace(/^_/, '')
      .replace(/_$/, '')
  );
}

/**
 * The same normalisation while the key is being TYPED: a trailing underscore survives,
 * or the separator is eaten on each keystroke. The schema tidies it on submit.
 */
export function featureKeyDraft(value: string): string {
  return (
    value
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      // Single `_`, for the same reason as canonicalFeatureKey above.
      .replace(/^_/, '')
  );
}

export const featureKeySchema = z
  .string()
  .transform(canonicalFeatureKey)
  .pipe(
    z
      .string()
      .min(2, 'Give the feature a key')
      .max(60, 'A feature key cannot be longer than 60 characters')
      .regex(FEATURE_KEY_PATTERN, 'Use capital letters, numbers and underscores'),
  );

/**
 * What an admin may do, by feature. An absent key means no access, so the map is partial.
 * A plain-string key: the set is open, and an enum key would make this exhaustive in Zod 4.
 */
export const adminPermissionsSchema = z.record(z.string(), permissionLevelSchema);
export type AdminPermissions = z.infer<typeof adminPermissionsSchema>;

/** Does `granted` satisfy `required`? Shared, so the guard and the UI cannot disagree. */
export function satisfiesLevel(
  granted: PermissionLevel | undefined,
  required: PermissionLevel,
): boolean {
  if (granted === undefined) return false;
  if (required === PERMISSION_LEVELS.READ) return true;
  return granted === PERMISSION_LEVELS.WRITE;
}

// ============================================================================
// Admins
// ============================================================================

export const adminSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string().nullable(),
  isSuperAdmin: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
  /** What this admin has been granted. Empty for a super admin — they bypass. */
  permissions: adminPermissionsSchema,
});
export type Admin = z.infer<typeof adminSchema>;

export const adminListQuerySchema = paginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  /** The list shows deactivated admins too; this narrows it. */
  activeOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;
export type AdminListQueryInput = z.input<typeof adminListQuerySchema>;

/** Lowercased on the way in: an email that differs only by case is the same
 *  person, and OTP login looks the row up by exact match. */
export const adminEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  // Piped into z.email(): the method form is deprecated, and normalising must come first.
  .pipe(z.email('Enter a valid email address').max(254));

export const createAdminSchema = z.object({
  email: adminEmailSchema,
  fullName: z.string().trim().min(1).max(120).optional(),
  /** A super admin may create another super admin. Nothing else may. */
  isSuperAdmin: z.boolean().default(false),
});
export type CreateAdminInput = z.input<typeof createAdminSchema>;
export type CreateAdminBody = z.infer<typeof createAdminSchema>;

/** On or off through one endpoint, matching `setStudentActiveSchema`. */
export const setAdminActiveSchema = z.object({ isActive: z.boolean() });
export type SetAdminActiveInput = z.input<typeof setAdminActiveSchema>;
export type SetAdminActiveBody = z.infer<typeof setAdminActiveSchema>;

export const updateAdminSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  isSuperAdmin: z.boolean().optional(),
});
export type UpdateAdminInput = z.input<typeof updateAdminSchema>;
export type UpdateAdminBody = z.infer<typeof updateAdminSchema>;

// ============================================================================
// Features + grants
// ============================================================================

export const featureSchema = z.object({
  id: z.string(),
  /** A plain string on the way out: the stored value is already canonical. */
  key: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  /** Exhaustive on purpose: both rows are created with the feature, so a missing one is a bug. */
  grants: z.record(permissionLevelSchema, z.array(z.string())),
});
export type Feature = z.infer<typeof featureSchema>;

/** The key IS the name — there is no separate label to keep in step. */
export const createFeatureSchema = z.object({
  key: featureKeySchema,
  description: z.string().trim().max(500).optional(),
});
export type CreateFeatureInput = z.input<typeof createFeatureSchema>;
export type CreateFeatureBody = z.infer<typeof createFeatureSchema>;

/** Grant and revoke are the same shape — the verb is the HTTP method. */
export const permissionGrantSchema = z.object({
  featureKey: featureKeySchema,
  level: permissionLevelSchema,
  adminId: z.string().min(1),
});
export type PermissionGrantInput = z.input<typeof permissionGrantSchema>;
export type PermissionGrantBody = z.infer<typeof permissionGrantSchema>;

// ============================================================================
// Student sync (stub)
// ============================================================================

/** The shape the trigger answers with. The service body is the only unfinished part. */
export const studentSyncResultSchema = z.object({
  startedAt: z.string(),
  /** Null while the sync is a stub — there is nothing to count yet. */
  syncedCount: z.number().int().nullable(),
  status: z.enum(['NOT_IMPLEMENTED', 'COMPLETED']),
  message: z.string(),
});
export type StudentSyncResult = z.infer<typeof studentSyncResultSchema>;

export const ADMIN_ADMIN_ROUTES = {
  list: '/admin/admins',
  create: '/admin/admins',
  update: (id: string) => `/admin/admins/${id}`,
  /** One route both ways. A PATCH, not a DELETE: the row survives, `createdById` points at it. */
  setActive: (id: string) => `/admin/admins/${id}/active`,
} as const;

export const ADMIN_FEATURE_ROUTES = {
  list: '/admin/features',
  create: '/admin/features',
  grant: '/admin/features/permissions',
  /** In the path, not a body: proxies drop a DELETE body, and a silent no-op revoke is the worst case. */
  revoke: (featureKey: string, level: PermissionLevel, adminId: string) =>
    `/admin/features/${featureKey}/permissions/${level}/${adminId}`,
} as const;

export const ADMIN_SYNC_ROUTES = {
  students: '/admin/sync/students',
} as const;
