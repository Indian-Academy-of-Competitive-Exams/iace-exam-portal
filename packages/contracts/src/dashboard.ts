import { z } from 'zod';
import { rowActionSchema } from './audit';
import { difficultyLevelSchema, questionStatusSchema } from './questions';
import { testStatusSchema } from './tests';

// ============================================================================
// The admin landing screen: four bands of counts, each gated by the FEATURE_KEYS
// its caller holds. A band the caller cannot reach is ABSENT from the payload,
// never zeroed — a zero is a number about the platform, and this is the one
// screen every admin lands on whatever they hold.
// ============================================================================

/** How many recent tests the sittings series covers — one point per test, newest last. */
export const DASHBOARD_RECENT_TESTS = 12;

/** Rows in the activity feed and in each window list. */
export const DASHBOARD_FEED_ROWS = 8;
export const DASHBOARD_WINDOW_ROWS = 5;

export const dashboardStudentCountsSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  suspended: z.number().int(),
});
export type DashboardStudentCounts = z.infer<typeof dashboardStudentCountsSchema>;

export const dashboardCatalogCountsSchema = z.object({
  branches: z.number().int(),
  programs: z.number().int(),
  exams: z.number().int(),
});
export type DashboardCatalogCounts = z.infer<typeof dashboardCatalogCountsSchema>;

export const dashboardTestCountsSchema = z.object({
  byStatus: z.partialRecord(testStatusSchema, z.number().int()),
  series: z.number().int(),
});
export type DashboardTestCounts = z.infer<typeof dashboardTestCountsSchema>;

/** Band A. Every tile answers to its own key, so a partial grant is a partial row. */
export const dashboardHeadlineSchema = z.object({
  students: dashboardStudentCountsSchema.optional(),
  catalog: dashboardCatalogCountsSchema.optional(),
  questions: z.partialRecord(questionStatusSchema, z.number().int()).optional(),
  tests: dashboardTestCountsSchema.optional(),
});
export type DashboardHeadline = z.infer<typeof dashboardHeadlineSchema>;

export const dashboardCoverageSchema = z.object({
  subjectId: z.string(),
  subject: z.string(),
  /** Live questions only: an archived one is not depth an admin can draw a paper from. */
  active: z.number().int(),
  byDifficulty: z.partialRecord(difficultyLevelSchema, z.number().int()),
});
export type DashboardCoverage = z.infer<typeof dashboardCoverageSchema>;

/** Band B. Drafts awaiting review are not repeated here — `headline.questions` carries that count. */
export const dashboardBankSchema = z.object({
  /** Absent until proof-reading has raised one — the tile is skipped, never a zero. */
  openFlags: z.number().int().optional(),
  coverage: z.array(dashboardCoverageSchema),
});
export type DashboardBank = z.infer<typeof dashboardBankSchema>;

/** One recent test's folded rollup — the sittings series, read never scanned. */
export const dashboardSittingSchema = z.object({
  testId: z.string(),
  title: z.string().nullable(),
  opensAt: z.string().nullable(),
  attempts: z.number().int(),
  evaluated: z.number().int(),
});
export type DashboardSitting = z.infer<typeof dashboardSittingSchema>;

/** Band C. The feed is every admin's own trail; the sittings need STUDENT_PERFORMANCE. */
export const dashboardActivitySchema = z.object({
  feed: z.array(rowActionSchema),
  sittings: z.array(dashboardSittingSchema).optional(),
});
export type DashboardActivity = z.infer<typeof dashboardActivitySchema>;

export const dashboardWindowSchema = z.object({
  testId: z.string(),
  title: z.string().nullable(),
  series: z.string(),
  /** Null is a test that opened the moment it went live, which has no instant to show. */
  opensAt: z.string().nullable(),
});
export type DashboardWindow = z.infer<typeof dashboardWindowSchema>;

/** Band D. */
export const dashboardWindowsSchema = z.object({
  open: z.array(dashboardWindowSchema),
  upcoming: z.array(dashboardWindowSchema),
});
export type DashboardWindows = z.infer<typeof dashboardWindowsSchema>;

export const dashboardSchema = z.object({
  headline: dashboardHeadlineSchema.optional(),
  bank: dashboardBankSchema.optional(),
  activity: dashboardActivitySchema.optional(),
  windows: dashboardWindowsSchema.optional(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const ADMIN_DASHBOARD_ROUTES = {
  get: '/admin/dashboard',
} as const;
