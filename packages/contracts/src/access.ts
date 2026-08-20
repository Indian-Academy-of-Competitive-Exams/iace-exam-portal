import { z } from 'zod';
import { optionalBooleanQuery, searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { canonicalNameSchema } from './naming';

// ============================================================================
// Access. A student reaches a series by exam match, by program match or by an
// explicit grant, and the series must be enabled for their branch. There are no
// groups, and nothing is open to everyone.
// ============================================================================

/** How a series becomes available. */
export const UNLOCK_MODE = {
  /** Opens on its own, typically when the prerequisite series is done. */
  AUTO: 'AUTO',
  /** The student asks; an admin or a rule approves. */
  REQUEST: 'REQUEST',
  /** An admin grants it and nothing else does. */
  ADMIN: 'ADMIN',
} as const;
export const unlockModeSchema = z.enum(UNLOCK_MODE);
export type UnlockMode = z.infer<typeof unlockModeSchema>;
export const UNLOCK_MODES = unlockModeSchema.options;

export const UNLOCK_STATE = {
  LOCKED: 'LOCKED',
  UNLOCKED: 'UNLOCKED',
} as const;
export const unlockStateSchema = z.enum(UNLOCK_STATE);
export type UnlockState = z.infer<typeof unlockStateSchema>;
export const UNLOCK_STATES = unlockStateSchema.options;

export const UNLOCK_REQUEST_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export const unlockRequestStatusSchema = z.enum(UNLOCK_REQUEST_STATUS);
export type UnlockRequestStatus = z.infer<typeof unlockRequestStatusSchema>;
export const UNLOCK_REQUEST_STATUSES = unlockRequestStatusSchema.options;

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
export const NOTIFICATION_TYPES = notificationTypeSchema.options;

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

/** The unit of offering. A test reaches a student only through one of these. */
export const testSeriesSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  examStageId: z.string().nullable(),
  /** Null is exam or family access; set means the student must carry the program. */
  programCode: z.string().nullable(),
  /** Unlock the tests in order rather than opening them together. */
  sequentialTests: z.boolean(),
  prerequisiteSeriesId: z.string().nullable(),
  unlockMode: unlockModeSchema,
  /** Pricing only. Free is not open access. */
  isFree: z.boolean(),
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

export const testSeriesListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  examStageId: z.string().optional(),
  programCode: z.string().optional(),
  isFree: optionalBooleanQuery(),
});
export type TestSeriesListQuery = z.infer<typeof testSeriesListQuerySchema>;
export type TestSeriesListQueryInput = z.input<typeof testSeriesListQuerySchema>;

export const createTestSeriesSchema = z.object({
  name: seriesNameSchema,
  description: z.string().trim().max(500).optional(),
  /** The stage this belongs to. Null is a series that spans a family rather than one paper. */
  examStageId: z.string().nullish(),
  /** Set means program-only: a student without the program never reaches it. */
  programCode: z.string().nullish(),
  sequentialTests: z.boolean().optional(),
  prerequisiteSeriesId: z.string().nullish(),
  unlockMode: unlockModeSchema.optional(),
  isFree: z.boolean().optional(),
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

export const grantSeriesSchema = z.object({ testSeriesId: z.string().min(1, 'Choose a series') });
export type GrantSeriesInput = z.input<typeof grantSeriesSchema>;
export type GrantSeriesBody = z.infer<typeof grantSeriesSchema>;

/** Whether a branch's students get a series, and when. Admin-only; never shown to a student. */
export const branchTestConfigSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  testSeriesId: z.string(),
  enabled: z.boolean(),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
  createdAt: z.string(),
});
export type BranchTestConfig = z.infer<typeof branchTestConfigSchema>;

/** The row plus the branch it is about, which is the only way the screen reads. */
export const branchTestConfigRowSchema = branchTestConfigSchema.extend({
  branch: z.object({ id: z.string(), name: z.string() }),
});
export type BranchTestConfigRow = z.infer<typeof branchTestConfigRowSchema>;

/**
 * What a branch may change about a series it runs. The row itself is never created or deleted
 * here — every branch gets one when the series is created, so "not offered" is `enabled: false`
 * and not a missing row.
 */
export const updateBranchTestConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    startAt: z.iso.datetime().nullish(),
    endAt: z.iso.datetime().nullish(),
  })
  .refine((value) => !value.startAt || !value.endAt || value.startAt < value.endAt, {
    message: 'The window has to end after it starts',
    path: ['endAt'],
  });
export type UpdateBranchTestConfigInput = z.input<typeof updateBranchTestConfigSchema>;
export type UpdateBranchTestConfigBody = z.infer<typeof updateBranchTestConfigSchema>;

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

export const ADMIN_PROGRAM_ROUTES = {
  list: '/admin/programs',
  create: '/admin/programs',
  update: (id: string) => `/admin/programs/${id}`,
  remove: (id: string) => `/admin/programs/${id}`,
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
} as const;

/** A grant is filed against the STUDENT, which is who you are looking at when you make one. */
export const ADMIN_GRANT_ROUTES = {
  list: (studentId: string) => `/admin/students/${studentId}/grants`,
  create: (studentId: string) => `/admin/students/${studentId}/grants`,
  remove: (studentId: string, testSeriesId: string) =>
    `/admin/students/${studentId}/grants/${testSeriesId}`,
} as const;
