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

/**
 * A date of birth: a real date, in the past, and this side of plausible.
 *
 * The future half matters most. A DOB is one of the three fields the pre-test
 * gate collects, so a mistyped year does not just sit in a profile — it marks a
 * student ready for a test on data that cannot be true.
 */
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
 * A person's name: letters, and the few marks that appear INSIDE real names.
 *
 * Digits, commas and symbols are refused. A comma is the specific one that
 * prompted this — "Kumari, Asha" is a spreadsheet artefact, not a name, and it
 * sorts and greets wrongly wherever it is shown.
 *
 * A dot, apostrophe and hyphen are kept deliberately: "K. Ravi Kumar",
 * "D'Souza" and double-barrelled names are ordinary here, and rejecting them
 * would send admins looking for workarounds. Tighten to `\p{L}` and spaces
 * alone if that turns out to be the wrong call.
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

export const groupRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Two branches may both run a "SSC CGL MORNING" — the name alone is ambiguous. */
  branchName: z.string(),
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
  /**
   * Still on the PIN an import gave them (the first four digits of their own
   * number). Guessable by anyone holding the roster, so it is shown rather than
   * left implicit — and it is why `hasSignedIn` is not simply "has a PIN".
   */
  hasDefaultPin: z.boolean(),
  preTestReady: z.boolean(),
  profileCompleted: z.boolean(),
  groups: z.array(groupRefSchema),
  createdAt: z.string(),
});
export type StudentSummary = z.infer<typeof studentSummarySchema>;

/**
 * Schooling so far. Stored as JSON because the shape varies by board and level
 * and none of it is ever queried — it is read back as a block on one screen.
 */
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

/**
 * Government exams the student has sat ELSEWHERE — not attempts on this
 * platform, which are the Attempt table. Self-reported and never verified, so
 * nothing is allowed to depend on it.
 */
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
   * The identity documents.
   *
   * These were once withheld from admins deliberately. That was reversed: the
   * institute verifies these records, and an admin who cannot see the Aadhaar
   * a student uploaded cannot do the checking they are responsible for.
   *
   * They are short-lived SIGNED URLs, never stored paths — the bucket is
   * private, and a permanent link to somebody's Aadhaar is not something to put
   * in a JSON response whoever is reading it.
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

/**
 * How a list is ordered. Named rather than free-form so a column the database
 * cannot serve cheaply never becomes a sort someone relies on.
 */
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
  /**
   * Everyone in ANY group under this branch. Students reach tests through
   * groups, and groups belong to branches, so "who does this centre teach" is
   * a question the roster has to be able to answer directly.
   */
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
 * A box holding nothing but spaces is empty to the person who left it. Folding
 * it away BEFORE the value reaches its real schema is what stops it tripping a
 * minimum length, or a letters-only rule, it was never meant to meet.
 *
 * These pipe rather than `z.preprocess`, which types its input as `unknown` and
 * would leave every form field that uses one untyped.
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
