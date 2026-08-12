import { z } from 'zod';
import { mobileSchema } from './common';
import { paginationQuerySchema } from './envelope';

// ============================================================================
// Students, as the ADMIN sees them.
//
// A deliberate omission runs through this file: `aadhaarUrl` and `panUrl` exist
// on StudentProfile and are absent from every schema here. Keeping them out of
// the contract is the enforcement, not a convention — the API cannot serialise
// a field its response schema has no room for, and the admin UI cannot render
// one it was never given. Identity documents stay for verification flows that
// ask for them explicitly.
// ============================================================================

export const genderSchema = z.enum(['MALE', 'FEMALE', 'OTHER']);
export type Gender = z.infer<typeof genderSchema>;

/** `YYYY-MM-DD`. The column is a DATE, so a timestamp would imply a precision
 *  (and a timezone) that a date of birth does not have. */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'That is not a real date');

// ============================================================================
// Reading
// ============================================================================

export const groupRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type GroupRef = z.infer<typeof groupRefSchema>;

export const studentSummarySchema = z.object({
  id: z.string(),
  mobile: z.string(),
  fullName: z.string().nullable(),
  isActive: z.boolean(),
  /**
   * Whether a PIN has ever been set. An admin-created student exists but has
   * never signed in, and a group list that cannot tell the two apart is the
   * first thing anyone asks about.
   */
  hasSignedIn: z.boolean(),
  preTestReady: z.boolean(),
  profileCompleted: z.boolean(),
  groups: z.array(groupRefSchema),
  createdAt: z.string(),
});
export type StudentSummary = z.infer<typeof studentSummarySchema>;

/** Everything the admin may see — note what is NOT here (see the file header). */
export const studentProfileSchema = z.object({
  motherName: z.string().nullable(),
  fatherName: z.string().nullable(),
  dob: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  gender: genderSchema.nullable(),
  photoUrl: z.string().nullable(),
  educationDetails: z.unknown().nullable(),
  pastExamHistory: z.unknown().nullable(),
});
export type StudentProfileView = z.infer<typeof studentProfileSchema>;

export const studentDetailSchema = studentSummarySchema.extend({
  preferredLanguage: z.string(),
  updatedAt: z.string(),
  profile: studentProfileSchema.nullable(),
});
export type StudentDetail = z.infer<typeof studentDetailSchema>;

export const studentListQuerySchema = paginationQuerySchema.extend({
  /** Matches a mobile number or a name, case-insensitively. */
  q: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  groupId: z.string().optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /** Admin-created students who have never set a PIN. */
  neverSignedIn: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});
export type StudentListQuery = z.infer<typeof studentListQuerySchema>;
export type StudentListQueryInput = z.input<typeof studentListQuerySchema>;

// ============================================================================
// Writing
// ============================================================================

/**
 * Creating a student ahead of their first login. Only the mobile is required —
 * the same field the student would have signed up with, so when they do, the
 * OTP flow finds this row instead of making a second one.
 */
export const createStudentSchema = z.object({
  mobile: mobileSchema,
  // An empty box means "not known yet", not an invalid name. `.min(1).optional()`
  // rejected '' — optional permits undefined, never the empty string — so a form
  // whose name field was simply left alone could not be submitted at all.
  fullName: optionalText(120),
  groupIds: z.array(z.string()).optional(),
});
export type CreateStudentInput = z.input<typeof createStudentSchema>;
export type CreateStudentBody = z.infer<typeof createStudentSchema>;

/**
 * An optional free-text field: absent, or text. An empty string is neither, so
 * it is folded into "absent" rather than failing a length rule the admin never
 * meant to trip.
 */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));
}

/** Every field optional: this is a patch, and an omitted key means "leave it". */
export const updateStudentProfileSchema = z.object({
  motherName: z.string().trim().max(120).nullish(),
  fatherName: z.string().trim().max(120).nullish(),
  dob: dateOnlySchema.nullish(),
  email: z.string().trim().max(160).nullish(),
  address: z.string().trim().max(500).nullish(),
  gender: genderSchema.nullish(),
});

export const updateStudentSchema = z.object({
  // null clears the name; '' is the same intent typed differently.
  fullName: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((value) => (value === '' ? null : value)),
  preferredLanguage: z.string().trim().min(2).max(8).optional(),
  /** Replaces membership wholesale. A student must stay in at least one group. */
  groupIds: z.array(z.string()).optional(),
  profile: updateStudentProfileSchema.optional(),
});
export type UpdateStudentInput = z.input<typeof updateStudentSchema>;
export type UpdateStudentBody = z.infer<typeof updateStudentSchema>;

export const setStudentActiveSchema = z.object({ isActive: z.boolean() });
export type SetStudentActiveBody = z.infer<typeof setStudentActiveSchema>;

/** Admin routes are namespaced so a future student-facing `/students` cannot collide. */
export const ADMIN_STUDENT_ROUTES = {
  list: '/admin/students',
  create: '/admin/students',
  detail: (id: string) => `/admin/students/${id}`,
  update: (id: string) => `/admin/students/${id}`,
  setActive: (id: string) => `/admin/students/${id}/active`,
} as const;

/** Page codes the guards check. Granting them needs admin management (later);
 *  until then the seeded super admin bypasses the check. */
export const ADMIN_PAGES = {
  STUDENTS_MANAGE: 'students.manage',
  GROUPS_MANAGE: 'groups.manage',
} as const;
