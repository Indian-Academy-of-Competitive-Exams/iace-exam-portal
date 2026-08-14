import { z } from 'zod';
import { paginationQuerySchema } from './envelope';

// ============================================================================
// Feature-level access control.
//
// An admin is granted a LEVEL on a FEATURE. That is the whole model: no roles,
// no per-route grants, no inheritance. Roles were the obvious alternative and
// the wrong one here — the institute's admins do not fall into tidy job titles,
// and every role system ends up with a "Manager (but not branches)" role that
// exists for one person.
//
// The keys and levels live HERE because three places have to agree on them
// exactly: the Prisma enum, the controllers that require them, and the admin
// app that hides a section without them. A typo in any one of those is a screen
// that silently never appears, which is the kind of bug nobody reports because
// it looks like the feature was never built.
// ============================================================================

/**
 * WRITE means create + update + delete. There is no separate DELETE level: an
 * admin who can edit a student can also remove one, and pretending otherwise
 * invites a permission matrix nobody can hold in their head.
 *
 * READ is satisfied by either level — WRITE implies READ, always. Granting
 * someone the ability to change a thing they cannot see is not a state worth
 * being able to express.
 */
export const PERMISSION_LEVELS = {
  READ: 'READ',
  WRITE: 'WRITE',
} as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[keyof typeof PERMISSION_LEVELS];
export const permissionLevelSchema = z.enum(PERMISSION_LEVELS);

/**
 * The sectors of the product an admin is granted, or not.
 *
 * Nothing seeds these. A `Feature` row has to be registered by a super admin
 * with a key from this list, and a key with no row grants nobody anything —
 * which is the safe direction to fail.
 *
 * Adding a sector is adding a constant here and registering the row; the guard
 * and the UI pick it up without further changes. Groups and branches
 * deliberately sit under STUDENT_MANAGEMENT rather than getting a key of their
 * own: a group exists to give students access to tests, so the people who
 * manage one manage the other.
 */
export const FEATURE_KEYS = {
  STUDENT_MANAGEMENT: 'STUDENT_MANAGEMENT',
  QUESTION_MANAGEMENT: 'QUESTION_MANAGEMENT',
  TEST_MANAGEMENT: 'TEST_MANAGEMENT',
  BRANCH_TEST_MANAGEMENT: 'BRANCH_TEST_MANAGEMENT',
} as const;
export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS];
export const featureKeySchema = z.enum(FEATURE_KEYS);

/** Every key, for the screens that list them. Ordered as an admin reads them. */
export const FEATURE_KEY_VALUES = Object.values(FEATURE_KEYS) as readonly FeatureKey[];

/**
 * What an admin may do, by feature. Absent key = no access at all.
 *
 * A map rather than a list of (key, level) pairs because every consumer asks
 * the same question — "what is my level for X" — and a list makes each of them
 * write the same find().
 *
 * partialRecord, NOT record: in Zod 4 a record over an enum is EXHAUSTIVE, so
 * `z.record(featureKeySchema, …)` would demand all four keys on every admin and
 * reject the identity of anyone granted fewer — which is everyone, including a
 * super admin, whose map is empty. Partial is also the honest shape: an absent
 * key means no access, and that is a different fact from a key set to READ.
 */
export const adminPermissionsSchema = z.partialRecord(featureKeySchema, permissionLevelSchema);
export type AdminPermissions = z.infer<typeof adminPermissionsSchema>;

/**
 * Does `granted` satisfy `required`?
 *
 * Shared rather than reimplemented on each side, because the guard and the UI
 * disagreeing about this is precisely the bug that shows a button the API then
 * refuses. WRITE satisfies READ; nothing satisfies WRITE but WRITE.
 */
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
  .email('Enter a valid email address')
  .max(254);

export const createAdminSchema = z.object({
  email: adminEmailSchema,
  fullName: z.string().trim().min(1).max(120).optional(),
  /** A super admin may create another super admin. Nothing else may. */
  isSuperAdmin: z.boolean().default(false),
});
export type CreateAdminInput = z.input<typeof createAdminSchema>;
export type CreateAdminBody = z.infer<typeof createAdminSchema>;

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
  key: featureKeySchema,
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  /** Who holds each level. Both entries always exist once the feature does. */
  grants: z.record(permissionLevelSchema, z.array(z.string())),
});
export type Feature = z.infer<typeof featureSchema>;

export const createFeatureSchema = z.object({
  /** Constrained to the canonical list — a free-text key is a key nothing
   *  checks, and a feature nothing gates is worse than no feature. */
  key: featureKeySchema,
  name: z.string().trim().min(1).max(120),
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

/**
 * The shape the trigger answers with, defined now so the button, the client and
 * the controller are all finished code around an unfinished service. When the
 * fetch lands, only the service body changes.
 */
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
  deactivate: (id: string) => `/admin/admins/${id}`,
} as const;

export const ADMIN_FEATURE_ROUTES = {
  list: '/admin/features',
  create: '/admin/features',
  grant: '/admin/features/permissions',
  /**
   * The tuple travels in the path, not a body. A DELETE may carry one, but
   * proxies and some fetch stacks quietly drop it, and a revoke that silently
   * becomes a no-op is the worst possible failure for this particular verb.
   */
  revoke: (featureKey: FeatureKey, level: PermissionLevel, adminId: string) =>
    `/admin/features/${featureKey}/permissions/${level}/${adminId}`,
} as const;

export const ADMIN_SYNC_ROUTES = {
  students: '/admin/sync/students',
} as const;
