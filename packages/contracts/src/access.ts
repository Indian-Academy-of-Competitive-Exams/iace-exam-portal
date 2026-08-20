import { z } from 'zod';

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
