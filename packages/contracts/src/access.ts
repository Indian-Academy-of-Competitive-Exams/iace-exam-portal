import { z } from 'zod';
import { ATTEMPT_STATUS, attemptStatusSchema, type AttemptStatus } from './attempts';
import { csvIdQuery, matchModeQuery, optionalBooleanQuery, searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { canonicalNameSchema } from './naming';
import { examCourseSchema } from './exams';

// ============================================================================
// Access. A student reaches a series by exam match, by program match or by an
// explicit grant, and the series must be enabled for their branch. There are no
// groups, and nothing is open to everyone.
// ============================================================================

/** How a series becomes available. */
export const UNLOCK_MODE = {
  /** Opens on its own: at once, or once every test in the prerequisite series is finished. */
  AUTO: 'AUTO',
  /** Never opens on its own — the student asks and an admin answers. */
  REQUEST: 'REQUEST',
} as const;
/** STANDARD reaches by exam or program; FREE also by an enrolled course; PROGRAM only by program; EVENT only the candidates on its Event. */
export const TEST_SERIES_KIND = {
  STANDARD: 'STANDARD',
  FREE: 'FREE',
  PROGRAM: 'PROGRAM',
  EVENT: 'EVENT',
} as const;
export const testSeriesKindSchema = z.enum(TEST_SERIES_KIND);

/** How many EXAMS a student may hold FREE-series access across by asking: a course is many exams. */
export const FREE_SERIES_EXAM_CAP = 2;
export type TestSeriesKind = z.infer<typeof testSeriesKindSchema>;
export const TEST_SERIES_KINDS = testSeriesKindSchema.options;

export const unlockModeSchema = z.enum(UNLOCK_MODE);
export type UnlockMode = z.infer<typeof unlockModeSchema>;
export const UNLOCK_MODES = unlockModeSchema.options;

export const UNLOCK_STATE = {
  LOCKED: 'LOCKED',
  UNLOCKED: 'UNLOCKED',
} as const;
export const unlockStateSchema = z.enum(UNLOCK_STATE);
export type UnlockState = z.infer<typeof unlockStateSchema>;

export const UNLOCK_REQUEST_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export const unlockRequestStatusSchema = z.enum(UNLOCK_REQUEST_STATUS);
export type UnlockRequestStatus = z.infer<typeof unlockRequestStatusSchema>;

export const NOTIFICATION_TYPE = {
  TEST_ASSIGNED: 'TEST_ASSIGNED',
  RESULT_READY: 'RESULT_READY',
  ENROLLMENT_ADDED: 'ENROLLMENT_ADDED',
  GRANT_ADDED: 'GRANT_ADDED',
  SERIES_UNLOCKED: 'SERIES_UNLOCKED',
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
  prerequisiteSeriesId: z.string().nullable(),
  unlockMode: unlockModeSchema,
  kind: testSeriesKindSchema,
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
  prerequisiteSeriesId: z.string().nullish(),
  unlockMode: unlockModeSchema.optional(),
  kind: testSeriesKindSchema.optional(),
  branchIds: z.array(z.string()).optional(),
  isEnabled: z.boolean().optional(),
  eventId: z.string().nullish(),
});
export type CreateTestSeriesInput = z.input<typeof createTestSeriesSchema>;
export type CreateTestSeriesBody = z.infer<typeof createTestSeriesSchema>;

export const updateTestSeriesSchema = createTestSeriesSchema.partial();
export type UpdateTestSeriesInput = z.input<typeof updateTestSeriesSchema>;
export type UpdateTestSeriesBody = z.infer<typeof updateTestSeriesSchema>;

export const testSeriesTestSchema = z.object({
  testSeriesId: z.string(),
  testId: z.string(),
  /** Position in the series, which is what sequential unlocking follows. */
  order: z.number().int().nullable(),
  createdAt: z.string(),
});
export type TestSeriesTest = z.infer<typeof testSeriesTestSchema>;

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

/** Whether a branch's students get a series at all. Admin-only; never shown to a student. */
export const branchTestConfigSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  testSeriesId: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
});
export type BranchTestConfig = z.infer<typeof branchTestConfigSchema>;

/** The row plus the branch it is about, which is the only way the screen reads. */
export const branchTestConfigRowSchema = branchTestConfigSchema.extend({
  branch: z.object({ id: z.string(), name: z.string() }),
});
export type BranchTestConfigRow = z.infer<typeof branchTestConfigRowSchema>;

/** One series as ONE branch sees it: what it is, and whether this branch runs it. */
export const branchSeriesRowSchema = z.object({
  testSeriesId: z.string(),
  name: z.string(),
  kind: testSeriesKindSchema,
  examStage: z.object({ id: z.string(), name: z.string(), examCode: z.string() }).nullable(),
  testCount: z.number().int(),
  /** The branch's own switch. A series with no row for it reads as off, never as a third state. */
  enabled: z.boolean(),
});
export type BranchSeriesRow = z.infer<typeof branchSeriesRowSchema>;

export const branchSeriesListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  examStageId: csvIdQuery(),
  kind: testSeriesKindSchema.optional(),
  /** Absent is every series; the two values narrow to what this branch does or does not run. */
  enabled: optionalBooleanQuery(),
});
export type BranchSeriesListQuery = z.infer<typeof branchSeriesListQuerySchema>;
export type BranchSeriesListQueryInput = z.input<typeof branchSeriesListQuerySchema>;

/** The whole draft in one write, so one confirm on screen is one request and one cache bust. */
export const BRANCH_SERIES_DRAFT_MAX = 500;
export const setBranchSeriesSchema = z.object({
  changes: z
    .array(z.object({ testSeriesId: z.string(), enabled: z.boolean() }))
    .min(1, 'Nothing to save')
    .max(BRANCH_SERIES_DRAFT_MAX, `Save at most ${BRANCH_SERIES_DRAFT_MAX} changes at a time`),
});
export type SetBranchSeriesInput = z.input<typeof setBranchSeriesSchema>;
export type SetBranchSeriesBody = z.infer<typeof setBranchSeriesSchema>;

/** How many rows actually MOVED — a draft re-posted unchanged answers zero. */
export const branchSeriesSavedSchema = z.object({ changed: z.number().int() });
export type BranchSeriesSaved = z.infer<typeof branchSeriesSavedSchema>;

/** The switch alone: a branch runs a series indefinitely, and WHEN an exam happens is the test's. */
export const updateBranchTestConfigSchema = z.object({ enabled: z.boolean().optional() });
export type UpdateBranchTestConfigInput = z.input<typeof updateBranchTestConfigSchema>;
export type UpdateBranchTestConfigBody = z.infer<typeof updateBranchTestConfigSchema>;

/** What one branch does differently for one test. No row is the plain rules, not a row of nulls. */
export const branchTestScheduleRowSchema = z.object({
  branchId: z.string(),
  branch: z.object({ id: z.string(), name: z.string() }),
  /** Seconds after the test opens that a student may still begin. Null is any time it is open. */
  lateEntrySec: z.number().int().nullable(),
  /** Seconds added to this branch's clock. Null is the duration the configuration gives everyone. */
  extraTimeSec: z.number().int().nullable(),
});
export type BranchTestScheduleRow = z.infer<typeof branchTestScheduleRowSchema>;

/** The whole set, not a delta: the screen holds every branch this test reaches. */
export const setBranchTestSchedulesSchema = z.object({
  branches: z.array(
    z.object({
      branchId: z.string().min(1),
      lateEntrySec: z.number().int().min(0).nullable(),
      extraTimeSec: z.number().int().min(0).nullable(),
    }),
  ),
});
export type SetBranchTestSchedulesInput = z.input<typeof setBranchTestSchedulesSchema>;
export type SetBranchTestSchedulesBody = z.infer<typeof setBranchTestSchedulesSchema>;

export const studentSeriesUnlockSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  testSeriesId: z.string(),
  unlockedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type StudentSeriesUnlock = z.infer<typeof studentSeriesUnlockSchema>;

export const seriesUnlockRequestSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  testSeriesId: z.string(),
  status: unlockRequestStatusSchema,
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedById: z.string().nullable(),
});
export type SeriesUnlockRequest = z.infer<typeof seriesUnlockRequestSchema>;

/** A request as the admin queue reads it — a triage screen cannot act on two bare ids. */
export const seriesUnlockRequestRowSchema = seriesUnlockRequestSchema.extend({
  testSeries: z.object({ id: z.string(), name: z.string() }),
  student: z.object({ id: z.string(), fullName: z.string().nullable(), mobile: z.string() }),
});
export type SeriesUnlockRequestRow = z.infer<typeof seriesUnlockRequestRowSchema>;

/** A FREE series a student does not reach yet, as the browse screen lists it. */
export const openSeriesSchema = z.object({
  id: z.string(),
  name: z.string(),
  examStage: z.object({ name: z.string(), examCode: z.string() }).nullable(),
  /** They have already asked and nobody has answered yet. */
  pending: z.boolean(),
});
export type OpenSeries = z.infer<typeof openSeriesSchema>;

/** The list, with the exams they already hold a free series on — what the cap is counted against. */
export const openSeriesListSchema = z.object({
  series: z.array(openSeriesSchema),
  examsHeld: z.array(z.string()),
});
export type OpenSeriesList = z.infer<typeof openSeriesListSchema>;

export const unlockRequestListQuerySchema = paginationQuerySchema.extend({
  status: unlockRequestStatusSchema.optional(),
  testSeriesId: z.string().optional(),
  /** NARROWS the caller's scope. A branch outside it answers nothing, never everything. */
  branchId: z.string().optional(),
});
export type UnlockRequestListQuery = z.infer<typeof unlockRequestListQuerySchema>;
export type UnlockRequestListQueryInput = z.input<typeof unlockRequestListQuerySchema>;

/** PENDING is where a request starts, so it is not something an admin can decide it back to. */
export const unlockDecisionSchema = unlockRequestStatusSchema.exclude([
  UNLOCK_REQUEST_STATUS.PENDING,
]);
export type UnlockDecision = z.infer<typeof unlockDecisionSchema>;

export const decideUnlockRequestSchema = z.object({ status: unlockDecisionSchema });
export type DecideUnlockRequestInput = z.input<typeof decideUnlockRequestSchema>;
export type DecideUnlockRequestBody = z.infer<typeof decideUnlockRequestSchema>;

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
  unlockMode: unlockModeSchema,
  unlockState: unlockStateSchema,
  prerequisiteSeriesId: z.string().nullable(),
  prerequisiteSeriesName: z.string().nullable(),
  canRequestUnlock: z.boolean(),
  /** An ask already in the queue, so the screen offers waiting rather than asking twice. */
  unlockRequested: z.boolean(),
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
  /** Every branch has a row from the moment the series exists — see the fan-out. */
  branches: (id: string) => `/admin/test-series/${id}/branches`,
  branch: (id: string, branchId: string) => `/admin/test-series/${id}/branches/${branchId}`,
  /** The link, from the series' side. The tests module owns it — a test is offered THROUGH a series. */
  tests: (id: string) => `/admin/test-series/${id}/tests`,
  test: (id: string, testId: string) => `/admin/test-series/${id}/tests/${testId}`,
} as const;

/**
 * The queue is addressed on its own, not under a student: an admin triages what came in, and
 * which student each row is about is the ANSWER rather than the way in.
 */
export const ADMIN_UNLOCK_REQUEST_ROUTES = {
  list: '/admin/unlock-requests',
  decide: (id: string) => `/admin/unlock-requests/${id}`,
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
