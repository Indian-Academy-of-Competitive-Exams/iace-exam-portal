import { z } from 'zod';
import { mobileSchema } from './common';
import { paginationQuerySchema } from './envelope';

// ============================================================================
// Students, as the ADMIN sees them.
// ============================================================================

export const genderSchema = z.enum(['MALE', 'FEMALE', 'OTHER']);
export type Gender = z.infer<typeof genderSchema>;
/** The same values as a list, for building a picker without restating them. */
export const GENDERS = genderSchema.options;

/** `YYYY-MM-DD`. The column is a DATE, so a timestamp would imply a precision
 *  (and a timezone) that a date of birth does not have. */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'That is not a real date');

/** The earliest birth year worth accepting — anything older is a typo. */
export const EARLIEST_BIRTH_YEAR = 1900;

/** A real date, in the past, and this side of plausible — it feeds the pre-test gate. */
export const dobSchema = dateOnlySchema
  .refine((value) => value <= todayISO(), 'A date of birth cannot be in the future')
  .refine(
    (value) => Number(value.slice(0, 4)) >= EARLIEST_BIRTH_YEAR,
    `That year looks like a typo — use ${EARLIEST_BIRTH_YEAR} or later`,
  );

/** Today, as YYYY-MM-DD. Also what a date input should cap itself at. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Letters plus the marks that appear inside real names — "K. Ravi Kumar", "D'Souza".
 * Commas are refused: "Kumari, Asha" is a spreadsheet artefact, and it greets wrongly.
 */
export const personNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^\p{L}[\p{L}\p{M}\s.'-]*$/u, 'Use letters only — no digits, commas or other characters');

// ============================================================================
// Reading
// ============================================================================

/**
 * Where a student sits relative to the institute. Mandatory on every route in —
 * it decides which branch and which groups they may be given.
 */
export const STUDENT_TYPE = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  NON_IACE: 'NON_IACE',
} as const;
export const studentTypeSchema = z.enum(STUDENT_TYPE);
export type StudentType = z.infer<typeof studentTypeSchema>;

export const groupRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The name is unique within this code, so it is what disambiguates one. */
  examType: z.string().nullable(),
});
export type GroupRef = z.infer<typeof groupRefSchema>;

export const studentSummarySchema = z.object({
  id: z.string(),
  mobile: z.string(),
  fullName: z.string().nullable(),
  isActive: z.boolean(),
  /** Whether a PIN has ever been set — an admin-created student exists but has never signed in. */
  hasSignedIn: z.boolean(),
  /** Still on an import's default PIN, which anyone holding the roster can guess. */
  hasDefaultPin: z.boolean(),
  preTestReady: z.boolean(),
  profileCompleted: z.boolean(),
  groups: z.array(groupRefSchema),
  createdAt: z.string(),
});
export type StudentSummary = z.infer<typeof studentSummarySchema>;

/** Schooling so far. JSON: the shape varies by board, and none of it is ever queried. */
export const educationEntrySchema = z.object({
  level: z.string().trim().min(1, 'Which qualification?').max(60),
  board: z.string().trim().max(80).optional(),
  institution: z.string().trim().max(120).optional(),
  year: z
    .union([z.literal(''), z.coerce.number().int().min(EARLIEST_BIRTH_YEAR).max(2100)])
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  percentage: z
    .union([z.literal(''), z.coerce.number().min(0).max(100)])
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
});
export type EducationEntry = z.infer<typeof educationEntrySchema>;

/** Exams sat ELSEWHERE, not attempts here. Self-reported, so nothing may depend on it. */
export const pastExamEntrySchema = z.object({
  exam: z.string().trim().min(1, 'Which exam?').max(80),
  year: z
    .union([z.literal(''), z.coerce.number().int().min(EARLIEST_BIRTH_YEAR).max(2100)])
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  result: z.string().trim().max(80).optional(),
});
export type PastExamEntry = z.infer<typeof pastExamEntrySchema>;

/** How many rows either list may hold. A profile is not a CV. */
export const PROFILE_LIST_MAX = 12;

/** Everything the admin may see — note what is NOT here (see the file header). */
export const studentProfileSchema = z.object({
  motherName: z.string().nullable(),
  fatherName: z.string().nullable(),
  dob: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  gender: genderSchema.nullable(),
  photoUrl: z.string().nullable(),
  /**
   * The identity documents, as short-lived SIGNED URLs and never stored paths —
   * the bucket is private, and a permanent link to an Aadhaar does not belong in a response.
   */
  aadhaarUrl: z.string().nullable(),
  panUrl: z.string().nullable(),
  educationDetails: z.array(educationEntrySchema).nullable(),
  pastExamHistory: z.array(pastExamEntrySchema).nullable(),
});
export type StudentProfileView = z.infer<typeof studentProfileSchema>;

export const studentDetailSchema = studentSummarySchema.extend({
  preferredLanguage: z.string(),
  updatedAt: z.string(),
  profile: studentProfileSchema.nullable(),
});
export type StudentDetail = z.infer<typeof studentDetailSchema>;

/** Named, not free-form, so a column the database cannot serve cheaply never becomes a sort. */
export const STUDENT_SORTS = {
  RECENT: 'recent',
  OLDEST: 'oldest',
  NAME: 'name',
  MOBILE: 'mobile',
} as const;
export type StudentSort = (typeof STUDENT_SORTS)[keyof typeof STUDENT_SORTS];
export const STUDENT_SORT_VALUES = Object.values(STUDENT_SORTS) as [StudentSort, ...StudentSort[]];

/** A query param that is present-or-absent, never "false means don't care". */
const optionalBoolean = () =>
  z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true'));

export const studentListQuerySchema = paginationQuerySchema.extend({
  /** Matches a mobile number or a name, case-insensitively. */
  q: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  groupId: z.string().optional(),
  /** Everyone in any group under this branch — "who does this centre teach". */
  branchId: z.string().optional(),
  isActive: optionalBoolean(),
  /** Admin-created students who have never set a PIN of their own. */
  neverSignedIn: optionalBoolean(),
  /** Still on the starting PIN an import gave them — a list worth chasing. */
  hasDefaultPin: optionalBoolean(),
  /** Mother's name, father's name and DOB — what a student needs before a test. */
  preTestReady: optionalBoolean(),
  profileCompleted: optionalBoolean(),
  /** Students with no group at all: they can reach no test, so they are a to-do list. */
  ungrouped: optionalBoolean(),
  /** Enrolled on or after / on or before. Inclusive at both ends. */
  joinedFrom: dateOnlySchema.optional(),
  joinedTo: dateOnlySchema.optional(),
  sort: z.enum(STUDENT_SORT_VALUES).optional().default(STUDENT_SORTS.RECENT),
});
export type StudentListQuery = z.infer<typeof studentListQuerySchema>;
export type StudentListQueryInput = z.input<typeof studentListQuerySchema>;

// ============================================================================
// Writing
// ============================================================================

/**
 * A box of spaces is empty to whoever left it, so it is folded away before the real schema.
 * A pipe, not `z.preprocess`, which types its input as `unknown`.
 */
const isBlank = (value: unknown) => typeof value === 'string' && value.trim() === '';

/** Blank or absent → absent. Used where an empty box means "not known yet". */
function blankIsAbsent<S extends z.ZodType<unknown, string>>(schema: S) {
  return z
    .string()
    .optional()
    .transform((value) => (isBlank(value) ? undefined : value))
    .pipe(schema.optional());
}

/** Blank → null. Used on a patch, where clearing a box must clear the field. */
function blankClears<S extends z.ZodType<unknown, string>>(schema: S) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => (isBlank(value) ? null : value))
    .pipe(schema.nullable().optional());
}

/** Created ahead of first login. Only the mobile is required, so the OTP flow finds this row. */
export const createStudentSchema = z.object({
  mobile: mobileSchema,
  // An empty box means "not known yet". `.min(1).optional()` rejects '', which blocks submit.
  fullName: blankIsAbsent(personNameSchema),
  groupIds: z.array(z.string()).optional(),
});
export type CreateStudentInput = z.input<typeof createStudentSchema>;
export type CreateStudentBody = z.infer<typeof createStudentSchema>;

/** Every field optional: this is a patch, and an omitted key means "leave it". */
export const updateStudentProfileSchema = z.object({
  motherName: blankClears(personNameSchema),
  fatherName: blankClears(personNameSchema),
  dob: blankClears(dobSchema),
  email: z.string().trim().max(160).nullish(),
  address: z.string().trim().max(500).nullish(),
  gender: genderSchema.nullish(),
  educationDetails: z.array(educationEntrySchema).max(PROFILE_LIST_MAX).optional(),
  pastExamHistory: z.array(pastExamEntrySchema).max(PROFILE_LIST_MAX).optional(),
});

export const updateStudentSchema = z.object({
  // null clears the name; '' is the same intent typed differently.
  fullName: blankClears(personNameSchema),
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
