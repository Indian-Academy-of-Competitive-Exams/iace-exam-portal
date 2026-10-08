import { z } from 'zod';
import {
  civilDate,
  csvIdQuery,
  csvQuery,
  emailSchema,
  matchModeQuery,
  mobileSchema,
  optionalBooleanQuery,
  searchQuery,
} from './common';
import { paginationQuerySchema } from './envelope';
import { examCourseSchema } from './exams';

// ============================================================================
// Students, as the ADMIN sees them.
// ============================================================================

const genderSchema = z.enum(['MALE', 'FEMALE', 'OTHER']);
export type Gender = z.infer<typeof genderSchema>;
/** The same values as a list, for building a picker without restating them. */
export const GENDERS = genderSchema.options;

/** `YYYY-MM-DD`; the column is a DATE, so a timestamp would imply a precision (and timezone) a date of birth doesn't have. */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  // Round-tripped, not parsed: Date.parse rolls 1998-02-31 over to 03-03 instead of failing.
  .refine((v) => isRealCalendarDay(v), 'That is not a real date');

/** Guards toISOString, which THROWS on an invalid date rather than returning NaN. */
function isRealCalendarDay(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

/** The earliest birth year worth accepting — anything older is a typo. */
export const EARLIEST_BIRTH_YEAR = 1900;

/** The same floor as a picker bound, so a calendar cannot offer what dobSchema refuses. */
export const EARLIEST_BIRTH_DATE = `${EARLIEST_BIRTH_YEAR}-01-01`;

/** A real date, in the past, and this side of plausible — it feeds the pre-test gate. */
export const dobSchema = dateOnlySchema
  .refine((value) => value <= todayISO(), 'A date of birth cannot be in the future')
  .refine(
    (value) => Number(value.slice(0, 4)) >= EARLIEST_BIRTH_YEAR,
    `That year looks like a typo. Use ${EARLIEST_BIRTH_YEAR} or later`,
  );

/** Today at the institute, as YYYY-MM-DD — what a date input caps itself at. */
export function todayISO(): string {
  return civilDate();
}

/** Letters plus marks inside real names — "K. Ravi Kumar", "D'Souza"; commas are refused since "Kumari, Asha" is a spreadsheet artefact that greets wrongly. */
export const personNameSchema = z
  .string()
  .trim()
  // Word and Excel type the curly mark; folded, a name has one spelling however it was keyed.
  .overwrite((name) => name.replace(/[‘’]/g, "'"))
  .min(2, 'A name needs at least two letters')
  .max(120)
  .regex(/^\p{L}[\p{L}\p{M}\s.'-]*$/u, 'Use letters only: no digits, commas or other characters');

// ============================================================================
// Reading
// ============================================================================

/** Where a student sits relative to the institute; mandatory on every route in, since it decides which branch they may be given. */
export const STUDENT_TYPE = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  NON_IACE: 'NON_IACE',
} as const;
export const studentTypeSchema = z.enum(STUDENT_TYPE);
export type StudentType = z.infer<typeof studentTypeSchema>;
/** The same values as a list, for building a picker without restating them — as `GENDERS` does. */
export const STUDENT_TYPES = studentTypeSchema.options;

/** The profile fields each readiness flag asks for. Derived on every read and never stored, so no writer can leave one stale. */
export const READINESS_FIELDS = {
  /** The LIGHT gate: prompted before a test, never blocking, so it asks for three fields and not the whole profile. */
  preTestReady: ['motherName', 'fatherName', 'dob'],
  /** Aadhaar and PAN are not here: their images are never stored and nothing verifies them yet, so the nudge would never end. */
  profileCompleted: ['photoUrl', 'dob', 'gender'],
} as const;
export type ReadinessFlag = keyof typeof READINESS_FIELDS;
export type ReadinessField = (typeof READINESS_FIELDS)[ReadinessFlag][number];

/** A space passes a NOT NULL check and fails a human one: the gate exists to collect a real answer. */
const answered = (value: unknown): boolean =>
  value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '');

/** Both flags off a stored profile row; a student with no row yet is neither. */
export function readinessOf(
  profile: Partial<Record<ReadinessField, unknown>> | null | undefined,
): Record<ReadinessFlag, boolean> {
  const filled = (flag: ReadinessFlag) =>
    profile != null && READINESS_FIELDS[flag].every((field) => answered(profile[field]));
  return { preTestReady: filled('preTestReady'), profileCompleted: filled('profileCompleted') };
}

/** The columns `readinessOf` reads, for a query that selects no more than it needs. */
export const READINESS_PROFILE_SELECT = {
  motherName: true,
  fatherName: true,
  dob: true,
  photoUrl: true,
  gender: true,
} as const satisfies Record<ReadinessField, true>;

export const studentSummarySchema = z.object({
  id: z.string(),
  mobile: z.string(),
  fullName: z.string().nullable(),
  studentType: studentTypeSchema,
  /** `Exam.code` values: what a student is enrolled for. Reach comes through courses, programs, events and grants. */
  enrolledExams: z.array(z.string()),
  /** A whole course, for a student coached across every exam in it rather than one. */
  enrolledCourses: z.array(examCourseSchema),
  /** Program codes, which reach a PROGRAM series with no membership row. */
  programs: z.array(z.string()),
  /** Reaches a series through something of their own, by the resolver's rule; FREE series reach everyone regardless. */
  hasOwnAccess: z.boolean(),
  isActive: z.boolean(),
  /** Signs in and sees their history, but cannot start a test. Not a sign-in state. */
  isTestBlocked: z.boolean(),
  preTestReady: z.boolean(),
  profileCompleted: z.boolean(),
  createdAt: z.string(),
});
export type StudentSummary = z.infer<typeof studentSummarySchema>;

/** A number box: empty is no number, and every other way it can be wrong reads as the one sentence. */
const numberBox = (holds: (value: number) => boolean, message: string) =>
  z
    .union([z.literal(''), z.coerce.number().refine(holds, message)], message)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

const LATEST_HISTORY_YEAR = 2100;

const historyYearSchema = numberBox(
  (year) => Number.isInteger(year) && year >= EARLIEST_BIRTH_YEAR && year <= LATEST_HISTORY_YEAR,
  `Enter a year between ${EARLIEST_BIRTH_YEAR} and ${LATEST_HISTORY_YEAR}`,
);

/** Schooling so far. JSON: the shape varies by board, and none of it is ever queried. */
export const educationEntrySchema = z.object({
  level: z.string().trim().min(1, 'Which qualification?').max(60),
  board: z.string().trim().max(80).optional(),
  institution: z.string().trim().max(120).optional(),
  year: historyYearSchema,
  percentage: numberBox(
    (share) => share >= 0 && share <= 100,
    'Enter a percentage between 0 and 100',
  ),
});

/** Exams sat ELSEWHERE, not attempts here. Self-reported, so nothing may depend on it. */
export const pastExamEntrySchema = z.object({
  exam: z.string().trim().min(1, 'Which exam?').max(80),
  year: historyYearSchema,
  result: z.string().trim().max(80).optional(),
});

/** How many rows either list may hold. A profile is not a CV. */
export const PROFILE_LIST_MAX = 12;

/** `Program.code` values — the coaching programs the student is a candidate for. */
const programCodesSchema = z.array(z.string());

/** Everything the admin may see — note what is NOT here (see the file header). */
export const studentProfileSchema = z.object({
  motherName: z.string().nullable(),
  fatherName: z.string().nullable(),
  dob: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  gender: genderSchema.nullable(),
  /** A short-lived SIGNED URL, never a stored path — the bucket is private. */
  photoUrl: z.string().nullable(),
  /** Aadhaar and PAN are VERIFICATION STATUS only — the images are never stored, so there's no URL to hand back and no permanent link to an identity document. */
  aadhaarVerified: z.boolean(),
  panVerified: z.boolean(),
  /** Also a short-lived SIGNED URL. Unlike Aadhaar and PAN this one IS stored — it is a certificate, not an identity document. */
  tenthMarksheetUrl: z.string().nullable(),
  educationDetails: z.array(educationEntrySchema).nullable(),
  pastExamHistory: z.array(pastExamEntrySchema).nullable(),
});

/** One event a student is a candidate on. Named here because the profile is where they come off it. */
const studentEventSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type StudentEvent = z.infer<typeof studentEventSchema>;

/** A number they used to sign in with, and when it stopped being theirs. */
const formerMobileSchema = z.object({
  mobile: z.string(),
  replacedAt: z.string(),
});
export type FormerMobile = z.infer<typeof formerMobileSchema>;

export const studentDetailSchema = studentSummarySchema.extend({
  /** A join row rather than an array on the student, so it is read here and never patched here. */
  events: z.array(studentEventSchema),
  /** Newest first. Found by in the roster search, and never a way to sign in. */
  formerMobiles: z.array(formerMobileSchema),
  currentBranchId: z.string().nullable(),
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
const STUDENT_SORT_VALUES = Object.values(STUDENT_SORTS) as [StudentSort, ...StudentSort[]];

export const studentListQuerySchema = paginationQuerySchema.extend({
  /** Matches a mobile number or a name, case-insensitively. */
  q: searchQuery(),
  /** Everyone whose current branch these are — "who do these centres teach". */
  branchId: csvIdQuery(),
  /** `Program.code` values an import wrote onto the student. */
  programCode: csvIdQuery(),
  /** Candidates on these events — a join row, not a column the student carries. */
  eventId: csvIdQuery(),
  /** The courses they are enrolled on, which is what a STANDARD series reaches them by. */
  course: csvQuery(examCourseSchema),
  isActive: optionalBooleanQuery(),
  isTestBlocked: optionalBooleanQuery(),
  /** Mother's name, father's name and DOB — what a student needs before a test. */
  preTestReady: optionalBooleanQuery(),
  profileCompleted: optionalBooleanQuery(),
  /** Students with no enrolment and no program: they can reach no test, so they are a to-do list. */
  noAccess: optionalBooleanQuery(),
  sort: z.enum(STUDENT_SORT_VALUES).optional().default(STUDENT_SORTS.RECENT),
  match: matchModeQuery(),
});
export type StudentListQuery = z.infer<typeof studentListQuerySchema>;
export type StudentListQueryInput = z.input<typeof studentListQuerySchema>;

/** Which workbook a students export writes: the importable roster, or the rollup figures. */
export const STUDENT_EXPORT_VIEWS = {
  ROSTER: 'roster',
  PERFORMANCE: 'performance',
} as const;
export type StudentExportView = (typeof STUDENT_EXPORT_VIEWS)[keyof typeof STUDENT_EXPORT_VIEWS];

/** The list's own query minus the page: every matching row, in the list's order. */
export const studentExportQuerySchema = studentListQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({
    view: z
      .enum([STUDENT_EXPORT_VIEWS.ROSTER, STUDENT_EXPORT_VIEWS.PERFORMANCE])
      .default(STUDENT_EXPORT_VIEWS.ROSTER),
  });
export type StudentExportQuery = z.infer<typeof studentExportQuerySchema>;
export type StudentExportQueryInput = z.input<typeof studentExportQuerySchema>;

// ============================================================================
// Writing
// ============================================================================

/** A box of spaces is empty to whoever left it, so it's folded away before the real schema; a pipe, not `z.preprocess`, which types its input as `unknown`. */
const isBlank = (value: unknown) => typeof value === 'string' && value.trim() === '';

/** Blank or absent → absent. Used where an empty box means "not known yet". */
export function blankIsAbsent<S extends z.ZodType<unknown, string>>(schema: S) {
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
  studentType: studentTypeSchema,
  enrolledExams: z.array(z.string()).optional(),
  enrolledCourses: z.array(examCourseSchema).optional(),
  programs: programCodesSchema.optional(),
  currentBranchId: blankIsAbsent(z.string().min(1)),
});
export type CreateStudentInput = z.input<typeof createStudentSchema>;
export type CreateStudentBody = z.infer<typeof createStudentSchema>;

/** Every field optional: this is a patch, and an omitted key means "leave it". */
const updateStudentProfileSchema = z.object({
  motherName: blankClears(personNameSchema),
  fatherName: blankClears(personNameSchema),
  dob: blankClears(dobSchema),
  email: blankClears(emailSchema.pipe(z.string().max(160))),
  address: z.string().trim().max(500).nullish(),
  gender: genderSchema.nullish(),
  educationDetails: z.array(educationEntrySchema).max(PROFILE_LIST_MAX).optional(),
  pastExamHistory: z.array(pastExamEntrySchema).max(PROFILE_LIST_MAX).optional(),
});

/** An enrolment reaches every series tagged with that exam, so it is a route to a test. */
export const BLOCKED_ENROLMENT_MESSAGE =
  'That student is blocked from tests. Lift the block before enrolling them in another exam.';

export const updateStudentSchema = z.object({
  // null clears the name; '' is the same intent typed differently.
  fullName: blankClears(personNameSchema),
  studentType: studentTypeSchema.optional(),
  /** Replaces the enrolments wholesale — an empty array is a real answer. */
  enrolledExams: z.array(z.string()).optional(),
  /** Replaces the courses wholesale — an empty array is a real answer. */
  enrolledCourses: z.array(examCourseSchema).optional(),
  /** Replaces the programs wholesale — an empty array is a real answer. */
  programs: programCodesSchema.optional(),
  currentBranchId: blankClears(z.string().min(1)),
  profile: updateStudentProfileSchema.optional(),
  /** The `updatedAt` the form read. A save that does not match it is refused, not merged. */
  expectedUpdatedAt: z.string().optional(),
});
export type UpdateStudentInput = z.input<typeof updateStudentSchema>;
export type UpdateStudentBody = z.infer<typeof updateStudentSchema>;

export const setStudentActiveSchema = z.object({ isActive: z.boolean() });
export type SetStudentActiveBody = z.infer<typeof setStudentActiveSchema>;

/** Its own route, not a patch field: it is who they sign in as, and moving it signs them out. */
export const changeStudentMobileSchema = z.object({ mobile: mobileSchema });
export type ChangeStudentMobileInput = z.input<typeof changeStudentMobileSchema>;
export type ChangeStudentMobileBody = z.infer<typeof changeStudentMobileSchema>;

/** A sign-in code an admin reads out to a student whose sent one did not arrive. Shown once, never stored in the clear. */
export const studentDeskCodeSchema = z.object({
  code: z.string(),
  expiresInSec: z.number().int(),
});
export type StudentDeskCode = z.infer<typeof studentDeskCodeSchema>;

export const setStudentTestBlockedSchema = z.object({ isTestBlocked: z.boolean() });
export type SetStudentTestBlockedBody = z.infer<typeof setStudentTestBlockedSchema>;

/** Paged, because the report scope picker must reach a sitting older than any cap would keep. */
export const studentSittingsQuerySchema = paginationQuerySchema.extend({
  /** Matches the test's title, case-insensitively. */
  q: searchQuery(),
});
export type StudentSittingsQueryInput = z.input<typeof studentSittingsQuerySchema>;
export type StudentSittingsQuery = z.infer<typeof studentSittingsQuerySchema>;

/** Admin routes are namespaced so a future student-facing `/students` cannot collide. */
export const ADMIN_STUDENT_ROUTES = {
  list: '/admin/students',
  create: '/admin/students',
  detail: (id: string) => `/admin/students/${id}`,
  update: (id: string) => `/admin/students/${id}`,
  setActive: (id: string) => `/admin/students/${id}/active`,
  setTestBlocked: (id: string) => `/admin/students/${id}/test-blocked`,
  changeMobile: (id: string) => `/admin/students/${id}/mobile`,
  deskCode: (id: string) => `/admin/students/${id}/desk-code`,
  erasure: (id: string) => `/admin/students/${id}/erasure`,
  sittings: (id: string) => `/admin/students/${id}/sittings`,
  export: '/admin/students/export',
} as const;
