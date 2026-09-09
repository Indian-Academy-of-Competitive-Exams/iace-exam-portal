import { z } from 'zod';
import { paginationQuerySchema } from './envelope';

// ============================================================================
// Feature-level access control: an admin holds a LEVEL on a FEATURE key.
// No roles, no per-route grants, no hierarchy — every feature is a peer, and
// several screens may share one key. The key set is CODE-OWNED: it is this file,
// never a table and never a form, so a key nothing checks cannot be granted.
// ============================================================================

/** WRITE is create + update + delete, and always implies READ. There is no DELETE level. */
export const PERMISSION_LEVELS = {
  READ: 'READ',
  WRITE: 'WRITE',
} as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[keyof typeof PERMISSION_LEVELS];
export const permissionLevelSchema = z.enum(PERMISSION_LEVELS);

/** Every key a controller can require. Adding one is a code change, by design. */
export const FEATURE_KEYS = {
  STUDENT_MANAGEMENT: 'STUDENT_MANAGEMENT',
  QUESTION_MANAGEMENT: 'QUESTION_MANAGEMENT',
  QUESTION_AUTHORING: 'QUESTION_AUTHORING',
  QUESTION_PROOFREAD: 'QUESTION_PROOFREAD',
  TEST_MANAGEMENT: 'TEST_MANAGEMENT',
  BRANCH_TEST_MANAGEMENT: 'BRANCH_TEST_MANAGEMENT',
  STUDENT_PERFORMANCE: 'STUDENT_PERFORMANCE',
  NOTIFICATION_MANAGEMENT: 'NOTIFICATION_MANAGEMENT',
} as const;
export const featureKeySchema = z.enum(FEATURE_KEYS);
export type FeatureKey = z.infer<typeof featureKeySchema>;
export const FEATURE_KEY_VALUES = featureKeySchema.options;

/** What each key is called and covers on the permissions screen. */
export const FEATURES: Readonly<Record<FeatureKey, { label: string; description: string }>> = {
  [FEATURE_KEYS.STUDENT_MANAGEMENT]: {
    label: 'Students',
    description: 'The student directory, imports, branches, the exam catalog, programs and events.',
  },
  [FEATURE_KEYS.QUESTION_MANAGEMENT]: {
    label: 'Question bank',
    description: 'Questions, their versions, subjects and topics.',
  },
  [FEATURE_KEYS.QUESTION_AUTHORING]: {
    label: 'Authoring',
    description: 'Entering questions, and the author\u2019s own drafts.',
  },
  [FEATURE_KEYS.QUESTION_PROOFREAD]: {
    label: 'Proof-reading',
    description: 'Reading questions and flagging quality issues.',
  },
  [FEATURE_KEYS.TEST_MANAGEMENT]: {
    label: 'Tests',
    description: 'Base configs, tests, papers and series.',
  },
  [FEATURE_KEYS.BRANCH_TEST_MANAGEMENT]: {
    label: 'Branch access',
    description: 'Which branches a test series runs for.',
  },
  [FEATURE_KEYS.STUDENT_PERFORMANCE]: {
    label: 'Student performance',
    description: "Any student's analytics — percentile, cohort standing and time use.",
  },
  [FEATURE_KEYS.NOTIFICATION_MANAGEMENT]: {
    label: 'Announcements',
    description: 'Sending announcements to students, including ones that cost money to deliver.',
  },
};

/** What an admin may do, by feature. An absent key means no access, so the map is partial. */
export const adminPermissionsSchema = z.partialRecord(featureKeySchema, permissionLevelSchema);
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

/** A code-owned key, with who holds it. There is no feature row to create or edit. */
export const featureSchema = z.object({
  key: featureKeySchema,
  label: z.string(),
  description: z.string(),
  /** Exhaustive on purpose: a level with nobody on it is an empty list, never a missing key. */
  grants: z.record(permissionLevelSchema, z.array(z.string())),
});
export type Feature = z.infer<typeof featureSchema>;

/** Grant and revoke are the same shape — the verb is the HTTP method. */
export const permissionGrantSchema = z.object({
  featureKey: featureKeySchema,
  level: permissionLevelSchema,
  adminId: z.string().min(1),
});
export type PermissionGrantInput = z.input<typeof permissionGrantSchema>;
export type PermissionGrantBody = z.infer<typeof permissionGrantSchema>;

export const ADMIN_ADMIN_ROUTES = {
  list: '/admin/admins',
  create: '/admin/admins',
  update: (id: string) => `/admin/admins/${id}`,
  /** One route both ways. A PATCH, not a DELETE: the row survives, `createdById` points at it. */
  setActive: (id: string) => `/admin/admins/${id}/active`,
} as const;

export const ADMIN_FEATURE_ROUTES = {
  /** Read-only: the list is FEATURES above, not a table. */
  list: '/admin/features',
  grant: '/admin/features/permissions',
  /** In the path, not a body: proxies drop a DELETE body, and a silent no-op revoke is the worst case. */
  revoke: (featureKey: FeatureKey, level: PermissionLevel, adminId: string) =>
    `/admin/features/${featureKey}/permissions/${level}/${adminId}`,
} as const;
