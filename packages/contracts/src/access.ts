import { z } from 'zod';
import { ATTEMPT_STATUS, attemptStatusSchema, type AttemptStatus } from './attempts';
import { csvIdQuery, matchModeQuery, optionalBooleanQuery, searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { canonicalNameSchema } from './naming';
import { examCourseSchema } from './exams';
import { evaluationModeSchema } from './tests';

// ============================================================================
// Access. A series' kind decides who reaches it, a grant overrides every kind,
// and `isEnabled` gates all of them. There are no groups, and the branch gate
// belongs to STANDARD alone.
// ============================================================================

/** FREE reaches everyone; STANDARD only the branches on its branchIds whose students enrolled the stage's course; PROGRAM only its program; EVENT only the candidates on its Event. */
export const TEST_SERIES_KIND = {
  STANDARD: 'STANDARD',
  FREE: 'FREE',
  PROGRAM: 'PROGRAM',
  EVENT: 'EVENT',
} as const;
export const testSeriesKindSchema = z.enum(TEST_SERIES_KIND);

export type TestSeriesKind = z.infer<typeof testSeriesKindSchema>;
export const TEST_SERIES_KINDS = testSeriesKindSchema.options;

export const NOTIFICATION_TYPE = {
  TEST_ASSIGNED: 'TEST_ASSIGNED',
  RESULT_READY: 'RESULT_READY',
  ENROLLMENT_ADDED: 'ENROLLMENT_ADDED',
  GRANT_ADDED: 'GRANT_ADDED',
  GENERIC: 'GENERIC',
} as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPE);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/**
 * A coaching variant. Adding one is a row, never a migration.
 * Named for the catalog because `programSchema` in ./students is the code string
 * a student carries, which is a different thing with the obvious name.
 */
export const programCatalogSchema = z.object({
  id: z.string(),
  /** What `Student.programs` and `TestSeries.programCode` both hold. */
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type Program = z.infer<typeof programCatalogSchema>;

export const PROGRAM_CODE_MAX = 40;
export const PROGRAM_NAME_MAX = 120;

/** Canonical, because a student row and a series both carry this exact string with no FK. */
export const programCodeSchema = canonicalNameSchema({
  max: PROGRAM_CODE_MAX,
  label: 'program code',
});

export const programNameSchema = z
  .string()
  .trim()
  .min(2, 'Give the program a name')
  .max(PROGRAM_NAME_MAX, `A name cannot be longer than ${PROGRAM_NAME_MAX} characters`);

export const programListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  activeOnly: optionalBooleanQuery(),
});
export type ProgramListQuery = z.infer<typeof programListQuerySchema>;
export type ProgramListQueryInput = z.input<typeof programListQuerySchema>;

export const createProgramSchema = z.object({
  code: programCodeSchema,
  name: programNameSchema,
});
export type CreateProgramInput = z.input<typeof createProgramSchema>;
export type CreateProgramBody = z.infer<typeof createProgramSchema>;

/** The code is refused once a student or a series carries it — nothing links back to this row. */
export const updateProgramSchema = z.object({
  code: programCodeSchema.optional(),
  name: programNameSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateProgramInput = z.input<typeof updateProgramSchema>;
export type UpdateProgramBody = z.infer<typeof updateProgramSchema>;

/** Who an EVENT series reaches: sitters, some of whom are not students yet. */
export const eventSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  candidateCount: z.number().int(),
  /** Above zero the delete is refused, so the screen leaves the action out rather than offering it. */
  seriesCount: z.number().int(),
  createdAt: z.string(),
});
export type Event = z.infer<typeof eventSchema>;

export const EVENT_NAME_MAX = 120;

export const createEventSchema = z.object({
  name: z.string().trim().min(2, 'Give the event a name').max(EVENT_NAME_MAX),
  description: z.string().trim().max(500).optional(),
});
export type CreateEventInput = z.input<typeof createEventSchema>;
export type CreateEventBody = z.infer<typeof createEventSchema>;

export const updateEventSchema = createEventSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateEventInput = z.input<typeof updateEventSchema>;
export type UpdateEventBody = z.infer<typeof updateEventSchema>;

export const eventListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  activeOnly: optionalBooleanQuery(),
});
export type EventListQuery = z.infer<typeof eventListQuerySchema>;
export type EventListQueryInput = z.input<typeof eventListQuerySchema>;

/** One student on an Event's roster, as the candidate list reads it. */
export const eventCandidateSchema = z.object({
  studentId: z.string(),
  fullName: z.string().nullable(),
  mobile: z.string(),
  addedAt: z.string(),
});
export type EventCandidate = z.infer<typeof eventCandidateSchema>;

/** A roster is an intake, not a handful: it pages, and the search reads the name and the number. */
export const eventCandidateListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
});
export type EventCandidateListQuery = z.infer<typeof eventCandidateListQuerySchema>;
export type EventCandidateListQueryInput = z.input<typeof eventCandidateListQuerySchema>;

/** A whole roster in one write. Re-importing the same sheet adds nobody twice. */
export const addEventCandidatesSchema = z.object({
  studentIds: z.array(z.string().min(1)).min(1, 'Choose at least one student'),
});
export type AddEventCandidatesInput = z.input<typeof addEventCandidatesSchema>;
export type AddEventCandidatesBody = z.infer<typeof addEventCandidatesSchema>;

/** The unit of offering. A test reaches a student only through one of these. */
export const testSeriesSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  examStageId: z.string().nullable(),
  /** Null is exam or course access; set means the student must carry the program. */
  programCode: z.string().nullable(),
  /** Unlock the tests in order rather than opening them together. */
  sequentialTests: z.boolean(),
  /** A graded ramp: each paper harder than the last. Order is `sequentialTests`, not this. */
  progressive: z.boolean(),
  kind: testSeriesKindSchema,
  /** What its tests are judged as. Every test it holds carries this, so it is fixed once it holds one. */
  evaluationMode: evaluationModeSchema,
  /** Which branches run it. STANDARD only — a CHECK refuses a value on any other kind. */
  branchIds: z.array(z.string()),
  /** Off until somebody switches it on; a series nobody enabled reaches nobody. */
  isEnabled: z.boolean(),
  /** The event whose candidates are its roster. Required exactly when kind is EVENT. */
  eventId: z.string().nullable(),
  createdAt: z.string(),
});
export type TestSeries = z.infer<typeof testSeriesSchema>;

/** The series as a list row: the stage it sits on and how many branches run it. */
export const testSeriesSummarySchema = testSeriesSchema.extend({
  examStage: z.object({ id: z.string(), name: z.string(), examCode: z.string() }).nullable(),
  testCount: z.number().int(),
  /** Branches with the series switched on, out of every branch it has a row for. */
  enabledBranchCount: z.number().int(),
  branchCount: z.number().int(),
});
export type TestSeriesSummary = z.infer<typeof testSeriesSummarySchema>;

export const SERIES_NAME_MAX = 120;
export const seriesNameSchema = z
  .string()
  .trim()
  .min(2, 'Give the series a name')
  .max(SERIES_NAME_MAX, `A name cannot be longer than ${SERIES_NAME_MAX} characters`);

/** A series is named by who reaches it: a program, its kind, or nothing in particular. */
export function seriesNameKind(input: {
  programCode?: string | null;
  kind?: TestSeriesKind;
}): string {
  const program = input.programCode?.trim();
  if (program) return program;
  if (input.kind === TEST_SERIES_KIND.FREE) return 'Free Mocks';
  if (input.kind === TEST_SERIES_KIND.EVENT) return 'Event Test';
  return 'Mock Test Series';
}

export const testSeriesListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  examStageId: csvIdQuery(),
  /** One test's stage: keeps a picker to series built for it, plus the stage-agnostic ones. */
  forExamStageId: z.string().optional(),
  programCode: z.string().optional(),
  kind: testSeriesKindSchema.optional(),
  /** The series' own switch. Absent is every series, on or off. */
  isEnabled: optionalBooleanQuery(),
  match: matchModeQuery(),
  /** A student id: drops what they already reach, so a picker cannot offer a grant that does nothing. */
  notReachedBy: z.string().optional(),
});
export type TestSeriesListQuery = z.infer<typeof testSeriesListQuerySchema>;
export type TestSeriesListQueryInput = z.input<typeof testSeriesListQuerySchema>;

export const createTestSeriesSchema = z.object({
  name: seriesNameSchema,
  description: z.string().trim().max(500).optional(),
  /** The stage this belongs to. Null is a series that spans a course rather than one paper. */
  examStageId: z.string().nullish(),
  /** Set means program-only: a student without the program never reaches it. */
  programCode: z.string().nullish(),
  sequentialTests: z.boolean().optional(),
  progressive: z.boolean().optional(),
  kind: testSeriesKindSchema.optional(),
  /** Absent is RANKED, and it stops being changeable the moment the series holds a test. */
  evaluationMode: evaluationModeSchema.optional(),
  isEnabled: z.boolean().optional(),
  eventId: z.string().nullish(),
});
export type CreateTestSeriesInput = z.input<typeof createTestSeriesSchema>;
export type CreateTestSeriesBody = z.infer<typeof createTestSeriesSchema>;

export const updateTestSeriesSchema = createTestSeriesSchema.partial();
export type UpdateTestSeriesInput = z.input<typeof updateTestSeriesSchema>;
export type UpdateTestSeriesBody = z.infer<typeof updateTestSeriesSchema>;

/** The escape hatch for access that is not exam-, program- or branch-derivable. */
export const studentGrantSchema = z.object({
  studentId: z.string(),
  testSeriesId: z.string(),
  createdAt: z.string(),
});
export type StudentGrant = z.infer<typeof studentGrantSchema>;

/** A grant as the student screen reads it: the series it opens, named. */
export const studentGrantRowSchema = studentGrantSchema.extend({
  testSeries: z.object({ id: z.string(), name: z.string() }),
});
export type StudentGrantRow = z.infer<typeof studentGrantRowSchema>;

/** Why a student reaches a series. A grant can sit beside an automatic one, so a row carries a set. */
export const STUDENT_SERIES_SOURCE = {
  COURSE: 'COURSE',
  PROGRAM: 'PROGRAM',
  FREE: 'FREE',
  EVENT: 'EVENT',
  GRANT: 'GRANT',
} as const;
export const studentSeriesSourceSchema = z.enum(STUDENT_SERIES_SOURCE);
export type StudentSeriesSource = z.infer<typeof studentSeriesSourceSchema>;

/** One series a student reaches, and what opens it — the branch gate has already been applied. */
export const studentSeriesAccessSchema = z.object({
  id: z.string(),
  name: z.string(),
  sources: z.array(studentSeriesSourceSchema),
  grantedAt: z.string().nullable(),
});
export type StudentSeriesAccess = z.infer<typeof studentSeriesAccessSchema>;

export const grantSeriesSchema = z.object({ testSeriesId: z.string().min(1, 'Choose a series') });
export type GrantSeriesInput = z.input<typeof grantSeriesSchema>;
export type GrantSeriesBody = z.infer<typeof grantSeriesSchema>;

/** One branch, and whether this series reaches it. Admin-only; never shown to a student. */
export const seriesBranchSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
});
export type SeriesBranch = z.infer<typeof seriesBranchSchema>;

/** The whole list `branchIds` should hold from now on — the array itself, not a diff against it. */
export const updateSeriesBranchesSchema = z.object({ branchIds: z.array(z.string()) });
export type UpdateSeriesBranchesInput = z.input<typeof updateSeriesBranchesSchema>;
export type UpdateSeriesBranchesBody = z.infer<typeof updateSeriesBranchesSchema>;

export const notificationSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string().nullable(),
  /** Deep links. Both are null for a GENERIC notification. */
  testId: z.string().nullable(),
  testSeriesId: z.string().nullable(),
  isRead: z.boolean(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListQuerySchema = paginationQuerySchema.extend({
  unreadOnly: optionalBooleanQuery(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type NotificationListQueryInput = z.input<typeof notificationListQuerySchema>;

// ============================================================================
// When a test opens. `unlockAt` belongs to the series-test link — one time for
// every branch, because a rank only means something if the cohort sat together.
// `lateEntrySec` is the branch's own, counted FROM that unlock so it can never
// contradict it and survives the exam being moved.
// ============================================================================

const MILLISECONDS_PER_SECOND = 1000;

export interface TestTiming {
  unlockAt: string | null;
  lateEntrySec: number | null;
}

export interface TestWindow {
  opensAt: string | null;
  closesAt: string | null;
}

/** A cutoff with nothing to count from is not a cutoff, so both halves must be there. */
export function testWindow({ unlockAt, lateEntrySec }: TestTiming): TestWindow {
  if (unlockAt === null || lateEntrySec === null) return { opensAt: unlockAt, closesAt: null };

  const closes = Date.parse(unlockAt) + lateEntrySec * MILLISECONDS_PER_SECOND;
  return { opensAt: unlockAt, closesAt: new Date(closes).toISOString() };
}

/** Whether a sitting may BEGIN: open at the instant it opens, shut at the instant entry closes. */
export function testIsOpen(window: TestWindow, now: Date): boolean {
  const at = now.getTime();
  if (window.opensAt !== null && Date.parse(window.opensAt) > at) return false;
  return window.closesAt === null || Date.parse(window.closesAt) > at;
}

// ============================================================================
// The student's catalog — every series they reach, resolved from exam, program,
// grant and branch. A series has no window; each TEST carries its own, and
// `canStart` is derived from the clock on every read rather than cached.
// ============================================================================

export const studentCatalogTestSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  /** What the paper IS, not what this student may do with it — static, so it caches safely. */
  durationSec: z.number().int(),
  totalQuestions: z.number().int(),
  totalMarks: z.number(),
  /** Position in the series. Ordering only — sequential gating is the series' own flag. */
  order: z.number().int().nullable(),
  /** When this test opens inside its series. Null is open from the moment the series is reached. */
  opensAt: z.string().nullable(),
  /** The last instant a student may BEGIN it. Null is any time while it is open. */
  closesAt: z.string().nullable(),
  /** Where this student has got to. Null is never opened; IN_PROGRESS is what Resume reopens. */
  attemptStatus: attemptStatusSchema.nullable(),
  canStart: z.boolean(),
});
export type StudentCatalogTest = z.infer<typeof studentCatalogTestSchema>;

/** A locked series is still LISTED — it is the journey the student is on. */
export const studentCatalogSeriesSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  examStage: z
    .object({
      id: z.string(),
      name: z.string(),
      examCode: z.string(),
      course: examCourseSchema,
    })
    .nullable(),
  programCode: z.string().nullable(),
  kind: testSeriesKindSchema,
  sequentialTests: z.boolean(),
  tests: z.array(studentCatalogTestSchema),
});
export type StudentCatalogSeries = z.infer<typeof studentCatalogSeriesSchema>;

/** Which tab a test sits under, read off the TEST: a series has no window and no sitting. */
export const TEST_BUCKET = {
  OPEN: 'OPEN',
  LATER: 'LATER',
  MISSED: 'MISSED',
  DONE: 'DONE',
} as const;
export type TestBucket = (typeof TEST_BUCKET)[keyof typeof TEST_BUCKET];

const SAT = new Set<AttemptStatus>([ATTEMPT_STATUS.SUBMITTED, ATTEMPT_STATUS.EVALUATED]);

export function testBucket(test: StudentCatalogTest, now: Date): TestBucket {
  // Sat comes first: a test with retakes left is still startable, and Done is where it belongs.
  if (test.attemptStatus !== null && SAT.has(test.attemptStatus)) return TEST_BUCKET.DONE;
  if (test.canStart) return TEST_BUCKET.OPEN;

  // Shut and never sat: the chance is gone, which is a different fact from not open YET.
  const closed = test.closesAt !== null && Date.parse(test.closesAt) <= now.getTime();
  return closed ? TEST_BUCKET.MISSED : TEST_BUCKET.LATER;
}

/** What the card's button says. A running sitting is resumed, never started a second time. */
export function testAction(test: StudentCatalogTest): 'START' | 'RESUME' | null {
  if (!test.canStart) return null;
  return test.attemptStatus === ATTEMPT_STATUS.IN_PROGRESS ? 'RESUME' : 'START';
}

/** `testBlocked` leaves everything listed and view-only — nothing is startable. */
export const studentCatalogSchema = z.object({
  testBlocked: z.boolean(),
  series: z.array(studentCatalogSeriesSchema),
});
export type StudentCatalog = z.infer<typeof studentCatalogSchema>;

export const ADMIN_PROGRAM_ROUTES = {
  list: '/admin/programs',
  create: '/admin/programs',
  update: (id: string) => `/admin/programs/${id}`,
  remove: (id: string) => `/admin/programs/${id}`,
} as const;

export const EVENT_ROUTES = {
  list: '/admin/events',
  create: '/admin/events',
  detail: (id: string) => `/admin/events/${id}`,
  update: (id: string) => `/admin/events/${id}`,
  remove: (id: string) => `/admin/events/${id}`,
  candidates: (id: string) => `/admin/events/${id}/candidates`,
  addCandidates: (id: string) => `/admin/events/${id}/candidates`,
  removeCandidate: (id: string, studentId: string) => `/admin/events/${id}/candidates/${studentId}`,
} as const;

export const ADMIN_SERIES_ROUTES = {
  list: '/admin/test-series',
  create: '/admin/test-series',
  detail: (id: string) => `/admin/test-series/${id}`,
  update: (id: string) => `/admin/test-series/${id}`,
  remove: (id: string) => `/admin/test-series/${id}`,
  /** Read every branch and whether this series reaches it; write the whole `branchIds` list. */
  branches: (id: string) => `/admin/test-series/${id}/branches`,
  /** The link, from the series' side. The tests module owns it — a test is offered THROUGH a series. */
  tests: (id: string) => `/admin/test-series/${id}/tests`,
  test: (id: string, testId: string) => `/admin/test-series/${id}/tests/${testId}`,
} as const;

/** A grant is filed against the STUDENT, which is who you are looking at when you make one. */
export const ADMIN_STUDENT_SERIES_ROUTES = {
  list: (studentId: string) => `/admin/students/${studentId}/series`,
} as const;

export const ADMIN_GRANT_ROUTES = {
  list: (studentId: string) => `/admin/students/${studentId}/grants`,
  create: (studentId: string) => `/admin/students/${studentId}/grants`,
  remove: (studentId: string, testSeriesId: string) =>
    `/admin/students/${studentId}/grants/${testSeriesId}`,
} as const;
