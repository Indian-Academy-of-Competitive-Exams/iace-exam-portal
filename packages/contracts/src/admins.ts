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
// A FEATURE is just a key. There is no hierarchy — no categories, no
// sub-features — so every feature is a peer of every other, and one an admin
// registers at runtime is indistinguishable from STUDENT_MANAGEMENT to the
// schema, the guard and the token. Several screens can share one key (Students,
// Groups and Branches all sit on STUDENT_MANAGEMENT); a screen never splits
// across two.
//
// The LEVEL vocabulary lives here because it is genuinely fixed and three
// places must agree on it exactly: the Prisma enum, the guard, and the admin
// app. The KEY vocabulary does not, because the set grows at runtime — what
// lives here is only the subset code already references, and a typo in one of
// THOSE is a screen that silently never appears, which nobody reports because
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
 * Features that already have a screen wired to them, named here so a controller
 * can reference one without retyping the string.
 *
 * These are NOT a tier. Every feature is a peer: the key IS the feature, there
 * are no categories and no sub-features, and one an admin registers today sits
 * at exactly the same level as STUDENT_MANAGEMENT — same row, same two
 * permission levels, same treatment by the guard. The only difference is
 * whether code happens to reference it yet, which is a fact about what has been
 * built, not about rank. Hence `featureKeySchema` below is open.
 *
 * Nothing is seeded. A key with no Feature row grants nobody anything, which is
 * the safe direction to fail. Groups and branches sit under STUDENT_MANAGEMENT
 * rather than taking a key of their own: a group exists to give students access
 * to tests, so the people who manage one manage the other.
 */
export const FEATURE_KEYS = {
  STUDENT_MANAGEMENT: 'STUDENT_MANAGEMENT',
  QUESTION_MANAGEMENT: 'QUESTION_MANAGEMENT',
  TEST_MANAGEMENT: 'TEST_MANAGEMENT',
  BRANCH_TEST_MANAGEMENT: 'BRANCH_TEST_MANAGEMENT',
} as const;

/**
 * Any canonical key, not just the four above.
 *
 * A string rather than a union because the set is OPEN at runtime: an admin
 * registers new sectors as the product grows, and a closed enum would make the
 * API reject rows it had itself just created — which is exactly the
 * "unexpected response shape" a closed schema produces on the client.
 *
 * `FeatureKey` stays a distinct alias so intent is readable at call sites, but
 * it is a string: the type cannot police a value the database learns at
 * runtime, and pretending otherwise only moves the failure to parse time.
 */
export type FeatureKey = string;

const FEATURE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * SCREAMING_SNAKE_CASE, normalised rather than rejected — "student management"
 * becomes STUDENT_MANAGEMENT — so a key that differs only in case or spacing is
 * impossible rather than merely reported. Same bargain as branch and group
 * names (see naming.ts).
 */
export function canonicalFeatureKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * The same normalisation, applied WHILE the key is being typed.
 *
 * Differs from `canonicalFeatureKey` in exactly one way: a trailing underscore
 * survives. That single difference is what makes a multi-word key typeable —
 * the space between "student" and "management" becomes the separator, and
 * stripping it on every keystroke means the next letter lands as STUDENTM and
 * the reader can never get an underscore in at all.
 *
 * It also does not trim, for the same reason: a trailing space IS the
 * separator being typed. The submitted value still goes through
 * `canonicalFeatureKey` in the schema, which tidies the trailing underscore
 * away — so the draft can be permissive without the stored key ever being.
 */
export function featureKeyDraft(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+/, '');
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
 * What an admin may do, by feature. Absent key = no access at all.
 *
 * A map rather than a list of (key, level) pairs because every consumer asks
 * the same question — "what is my level for X" — and a list makes each of them
 * write the same find().
 *
 * Keyed by a plain string, because the key set is open — an admin may register
 * a sector the code has never heard of, and its grants must still round-trip.
 * An enum key would also make this EXHAUSTIVE in Zod 4, demanding every key on
 * every admin and rejecting the identity of anyone holding fewer.
 *
 * An absent key means no access, which is a different fact from a key set to
 * READ, so the map is partial by construction rather than filled with blanks.
 */
export const adminPermissionsSchema = z.record(z.string(), permissionLevelSchema);
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
  /**
   * A plain string on the way OUT, not the transforming input schema. The value
   * is already canonical — the server stored it that way — and re-running the
   * transform on a response is work that can only ever disagree with the row.
   */
  key: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  /**
   * Who holds each level. An exhaustive record on purpose: both rows are
   * created with the feature, so a response missing one is a broken invariant
   * and should fail loudly here rather than render as an empty column.
   */
  grants: z.record(permissionLevelSchema, z.array(z.string())),
});
export type Feature = z.infer<typeof featureSchema>;

/**
 * The key is the name. There is no separate label to keep in step with it, and
 * no way for the two to disagree about what a feature is called — every screen
 * that shows a feature shows the key.
 */
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
