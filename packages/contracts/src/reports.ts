import { z } from 'zod';
import { searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { dateOnlySchema, todayISO } from './students';

// ============================================================================
// Reports. One catalogue, code-owned: a key names a report, what it cannot be
// built without, and what narrows it. Every report answers with one document
// shape, so a screen, a printed page and a spreadsheet read the same rows.
// ============================================================================

export const REPORT_GROUPS = {
  INSTITUTE: 'institute',
  TESTS: 'tests',
  STUDENTS: 'students',
  PERFORMANCE: 'performance',
  ENROLMENT: 'enrolment',
  CONTENT: 'content',
  OPERATIONS: 'operations',
} as const;
export type ReportGroup = (typeof REPORT_GROUPS)[keyof typeof REPORT_GROUPS];

/** What a report is asked for by. */
export const REPORT_PARAMS = {
  TEST: 'test',
  STUDENT: 'student',
  ATTEMPT: 'attempt',
  SERIES: 'series',
  EVENT: 'event',
  BRANCH: 'branch',
  PERIOD: 'period',
  TOP: 'top',
  DAYS: 'days',
} as const;
export type ReportParam = (typeof REPORT_PARAMS)[keyof typeof REPORT_PARAMS];

/** The periods a picker offers by name; anything else is two dates. */
export const REPORT_PERIODS = {
  THIS_WEEK: 'this-week',
  LAST_WEEK: 'last-week',
  THIS_MONTH: 'this-month',
  LAST_MONTH: 'last-month',
} as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[keyof typeof REPORT_PERIODS];

export const REPORT_KEYS = {
  TEST_RESULTS: 'test-results',
  TEST_SUMMARY: 'test-summary',
  TEST_SECTIONS: 'test-sections',
  TEST_ITEMS: 'test-items',
  TEST_ABSENTEES: 'test-absentees',
  TEST_MERIT: 'test-merit',
  TEST_BRANCHES: 'test-branches',
  TEST_CUTOFFS: 'test-cutoffs',
  TEST_VOIDED: 'test-voided',
  TEST_ACTIVITY_WEEKLY: 'test-activity-weekly',
  TEST_ACTIVITY_MONTHLY: 'test-activity-monthly',
  SERIES_PROGRESS: 'series-progress',
  TEST_SCHEDULE: 'test-schedule',
  PARTICIPATION_TREND: 'participation-trend',
  STUDENT_SCORE_CARD: 'student-score-card',
  STUDENT_WEEKLY: 'student-weekly',
  STUDENT_MONTHLY: 'student-monthly',
  STUDENT_CUMULATIVE: 'student-cumulative',
  STUDENT_PARENT_LETTER: 'student-parent-letter',
  STUDENT_TOPICS: 'student-topics',
  STUDENT_MISSED: 'student-missed',
  PERFORMANCE_BY_BRANCH: 'performance-by-branch',
  PERFORMANCE_BY_PROGRAM: 'performance-by-program',
  PERFORMANCE_BY_EXAM: 'performance-by-exam',
  TOP_PERFORMERS: 'top-performers',
  MOST_IMPROVED: 'most-improved',
  WEAK_SUBJECTS: 'weak-subjects',
  WEAK_TOPICS: 'weak-topics',
  ABSENTEES: 'absentees',
  INACTIVE_STUDENTS: 'inactive-students',
  RETAKES: 'retakes',
  STUDENT_ROSTER: 'student-roster',
  NEW_ENROLMENTS: 'new-enrolments',
  STRENGTH: 'strength',
  PROFILE_COMPLETENESS: 'profile-completeness',
  STUDENT_STATUS: 'student-status',
  MANUAL_GRANTS: 'manual-grants',
  EVENT_CANDIDATES: 'event-candidates',
  MOBILE_CHANGES: 'mobile-changes',
  AUTHORING_PROGRESS: 'authoring-progress',
  OVERDUE_ASSIGNMENTS: 'overdue-assignments',
  STAFF_OUTPUT: 'staff-output',
  SEND_BACKS: 'send-backs',
  BANK_INVENTORY: 'bank-inventory',
  QUESTION_USAGE: 'question-usage',
  AUDIT_TRAIL: 'audit-trail',
  ADMIN_ACTIVITY: 'admin-activity',
  ANNOUNCEMENTS: 'announcements',
  PERMISSIONS_MATRIX: 'permissions-matrix',
  DIGEST_WEEKLY: 'digest-weekly',
  DIGEST_MONTHLY: 'digest-monthly',
} as const;
export const reportKeySchema = z.enum(REPORT_KEYS);
export type ReportKey = z.infer<typeof reportKeySchema>;

export interface ReportSpec {
  title: string;
  group: ReportGroup;
  /** What it cannot be built without. */
  needs: readonly ReportParam[];
  /** What narrows it when given. */
  takes?: readonly ReportParam[];
  /** The period its picker opens on. */
  period?: ReportPeriod;
  superAdminOnly?: true;
}

const ONE_TEST = { group: REPORT_GROUPS.TESTS, needs: [REPORT_PARAMS.TEST] } as const;
const A_PERIOD = { needs: [REPORT_PARAMS.PERIOD] } as const;
const A_MONTH_OF_SITTINGS = {
  group: REPORT_GROUPS.PERFORMANCE,
  needs: [REPORT_PARAMS.PERIOD],
  period: REPORT_PERIODS.LAST_MONTH,
} as const;
const THE_ROLL = { group: REPORT_GROUPS.ENROLMENT, needs: [] } as const;
const THE_ROLL_OVER_A_MONTH = {
  group: REPORT_GROUPS.ENROLMENT,
  needs: [REPORT_PARAMS.PERIOD],
  period: REPORT_PERIODS.THIS_MONTH,
} as const;
const THE_BANK = { group: REPORT_GROUPS.CONTENT, needs: [] } as const;
const THE_DESK_OVER_A_WEEK = {
  group: REPORT_GROUPS.CONTENT,
  needs: [REPORT_PARAMS.PERIOD],
  period: REPORT_PERIODS.LAST_WEEK,
} as const;
const THE_OFFICE_OVER_A_WEEK = {
  group: REPORT_GROUPS.OPERATIONS,
  needs: [REPORT_PARAMS.PERIOD],
  period: REPORT_PERIODS.LAST_WEEK,
} as const;
const ONE_STUDENT = { group: REPORT_GROUPS.STUDENTS, needs: [REPORT_PARAMS.STUDENT] } as const;
const A_STUDENTS_PERIOD = {
  group: REPORT_GROUPS.STUDENTS,
  needs: [REPORT_PARAMS.STUDENT, REPORT_PARAMS.PERIOD],
} as const;

export const REPORTS = {
  [REPORT_KEYS.TEST_RESULTS]: { ...ONE_TEST, title: 'Result sheet' },
  [REPORT_KEYS.TEST_SUMMARY]: { ...ONE_TEST, title: 'Test summary' },
  [REPORT_KEYS.TEST_SECTIONS]: { ...ONE_TEST, title: 'Section analysis' },
  [REPORT_KEYS.TEST_ITEMS]: { ...ONE_TEST, title: 'Item analysis' },
  [REPORT_KEYS.TEST_ABSENTEES]: { ...ONE_TEST, title: 'Absentees' },
  [REPORT_KEYS.TEST_MERIT]: { ...ONE_TEST, title: 'Merit list', takes: [REPORT_PARAMS.TOP] },
  [REPORT_KEYS.TEST_BRANCHES]: { ...ONE_TEST, title: 'Branch comparison' },
  [REPORT_KEYS.TEST_CUTOFFS]: { ...ONE_TEST, title: 'Sectional cutoffs' },
  [REPORT_KEYS.TEST_VOIDED]: { ...ONE_TEST, title: 'Void sittings' },
  [REPORT_KEYS.TEST_ACTIVITY_WEEKLY]: {
    ...A_PERIOD,
    group: REPORT_GROUPS.TESTS,
    title: 'Weekly test activity',
    period: REPORT_PERIODS.LAST_WEEK,
  },
  [REPORT_KEYS.TEST_ACTIVITY_MONTHLY]: {
    ...A_PERIOD,
    group: REPORT_GROUPS.TESTS,
    title: 'Monthly test summary',
    period: REPORT_PERIODS.LAST_MONTH,
  },
  [REPORT_KEYS.SERIES_PROGRESS]: {
    group: REPORT_GROUPS.TESTS,
    needs: [REPORT_PARAMS.SERIES],
    title: 'Series progress',
  },
  [REPORT_KEYS.TEST_SCHEDULE]: {
    ...A_PERIOD,
    group: REPORT_GROUPS.TESTS,
    title: 'Test schedule',
    period: REPORT_PERIODS.THIS_WEEK,
  },
  [REPORT_KEYS.PARTICIPATION_TREND]: {
    ...A_PERIOD,
    group: REPORT_GROUPS.TESTS,
    title: 'Participation trend',
    period: REPORT_PERIODS.THIS_MONTH,
  },
  [REPORT_KEYS.STUDENT_SCORE_CARD]: {
    group: REPORT_GROUPS.STUDENTS,
    needs: [REPORT_PARAMS.STUDENT, REPORT_PARAMS.ATTEMPT],
    title: 'Score card',
  },
  [REPORT_KEYS.STUDENT_WEEKLY]: {
    ...A_STUDENTS_PERIOD,
    title: 'Weekly student report',
    period: REPORT_PERIODS.LAST_WEEK,
  },
  [REPORT_KEYS.STUDENT_MONTHLY]: {
    ...A_STUDENTS_PERIOD,
    title: 'Monthly student report',
    period: REPORT_PERIODS.LAST_MONTH,
  },
  [REPORT_KEYS.STUDENT_CUMULATIVE]: { ...ONE_STUDENT, title: 'Cumulative student report' },
  [REPORT_KEYS.STUDENT_PARENT_LETTER]: {
    ...A_STUDENTS_PERIOD,
    title: 'Progress letter to parents',
    period: REPORT_PERIODS.LAST_MONTH,
  },
  [REPORT_KEYS.STUDENT_TOPICS]: { ...ONE_STUDENT, title: 'Topic-wise accuracy' },
  [REPORT_KEYS.STUDENT_MISSED]: { ...ONE_STUDENT, title: 'Tests missed' },
  [REPORT_KEYS.PERFORMANCE_BY_BRANCH]: { ...A_MONTH_OF_SITTINGS, title: 'Branch performance' },
  [REPORT_KEYS.PERFORMANCE_BY_PROGRAM]: { ...A_MONTH_OF_SITTINGS, title: 'Program performance' },
  [REPORT_KEYS.PERFORMANCE_BY_EXAM]: { ...A_MONTH_OF_SITTINGS, title: 'Exam performance' },
  [REPORT_KEYS.TOP_PERFORMERS]: {
    ...A_MONTH_OF_SITTINGS,
    title: 'Top performers',
    takes: [REPORT_PARAMS.BRANCH, REPORT_PARAMS.TOP],
  },
  [REPORT_KEYS.MOST_IMPROVED]: {
    ...A_MONTH_OF_SITTINGS,
    title: 'Most improved',
    takes: [REPORT_PARAMS.BRANCH, REPORT_PARAMS.TOP],
  },
  [REPORT_KEYS.WEAK_SUBJECTS]: {
    ...A_MONTH_OF_SITTINGS,
    title: 'Subject-wise accuracy',
    takes: [REPORT_PARAMS.BRANCH],
  },
  [REPORT_KEYS.WEAK_TOPICS]: { ...A_MONTH_OF_SITTINGS, title: 'Topic-wise difficulty' },
  [REPORT_KEYS.ABSENTEES]: { ...A_MONTH_OF_SITTINGS, title: 'Absentees across tests' },
  [REPORT_KEYS.INACTIVE_STUDENTS]: {
    group: REPORT_GROUPS.PERFORMANCE,
    needs: [],
    takes: [REPORT_PARAMS.DAYS, REPORT_PARAMS.BRANCH],
    title: 'Inactive students',
  },
  [REPORT_KEYS.RETAKES]: { ...A_MONTH_OF_SITTINGS, title: 'Retakes' },
  [REPORT_KEYS.STUDENT_ROSTER]: {
    ...THE_ROLL,
    title: 'Student roster',
    takes: [REPORT_PARAMS.BRANCH],
  },
  [REPORT_KEYS.NEW_ENROLMENTS]: { ...THE_ROLL_OVER_A_MONTH, title: 'New enrolments' },
  [REPORT_KEYS.STRENGTH]: { ...THE_ROLL, title: 'Strength' },
  [REPORT_KEYS.PROFILE_COMPLETENESS]: {
    ...THE_ROLL,
    title: 'Unfinished profiles',
    takes: [REPORT_PARAMS.BRANCH],
  },
  [REPORT_KEYS.STUDENT_STATUS]: { ...THE_ROLL, title: 'Suspended, blocked and deleted students' },
  [REPORT_KEYS.MANUAL_GRANTS]: { ...THE_ROLL_OVER_A_MONTH, title: 'Access granted by hand' },
  [REPORT_KEYS.EVENT_CANDIDATES]: {
    group: REPORT_GROUPS.ENROLMENT,
    needs: [REPORT_PARAMS.EVENT],
    title: 'Event candidates',
  },
  [REPORT_KEYS.MOBILE_CHANGES]: { ...THE_ROLL_OVER_A_MONTH, title: 'Mobile number changes' },
  [REPORT_KEYS.AUTHORING_PROGRESS]: {
    group: REPORT_GROUPS.CONTENT,
    needs: [REPORT_PARAMS.TEST],
    title: 'Authoring progress',
  },
  [REPORT_KEYS.OVERDUE_ASSIGNMENTS]: { ...THE_BANK, title: 'Overdue sections' },
  [REPORT_KEYS.STAFF_OUTPUT]: { ...THE_DESK_OVER_A_WEEK, title: 'Staff output' },
  [REPORT_KEYS.SEND_BACKS]: { ...THE_DESK_OVER_A_WEEK, title: 'Questions sent back' },
  [REPORT_KEYS.BANK_INVENTORY]: { ...THE_BANK, title: 'Question bank inventory' },
  [REPORT_KEYS.QUESTION_USAGE]: {
    ...THE_BANK,
    title: 'Question usage',
    takes: [REPORT_PARAMS.TOP],
  },
  [REPORT_KEYS.AUDIT_TRAIL]: { ...THE_OFFICE_OVER_A_WEEK, title: 'Audit trail' },
  [REPORT_KEYS.ADMIN_ACTIVITY]: {
    ...THE_OFFICE_OVER_A_WEEK,
    title: 'Admin activity',
    superAdminOnly: true,
  },
  [REPORT_KEYS.ANNOUNCEMENTS]: {
    ...THE_OFFICE_OVER_A_WEEK,
    title: 'Announcements and their cost',
    period: REPORT_PERIODS.LAST_MONTH,
  },
  [REPORT_KEYS.PERMISSIONS_MATRIX]: {
    group: REPORT_GROUPS.OPERATIONS,
    needs: [],
    title: 'Admins and permissions',
    superAdminOnly: true,
  },
  [REPORT_KEYS.DIGEST_WEEKLY]: {
    ...A_PERIOD,
    group: REPORT_GROUPS.INSTITUTE,
    title: 'Weekly institute report',
    period: REPORT_PERIODS.LAST_WEEK,
  },
  [REPORT_KEYS.DIGEST_MONTHLY]: {
    ...A_PERIOD,
    group: REPORT_GROUPS.INSTITUTE,
    title: 'Monthly institute report',
    period: REPORT_PERIODS.LAST_MONTH,
  },
} as const satisfies Record<ReportKey, ReportSpec>;

/** What heads every printed page. */
export const REPORT_LETTERHEAD = 'IACE';

/** How many rows a merit list or a top-performers table carries when nobody says. */
export const REPORT_TOP_DEFAULT = 10;
export const REPORT_TOP_MAX = 500;

/** How long without a sitting makes a student inactive when nobody says. */
export const REPORT_INACTIVE_DAYS_DEFAULT = 14;

/** The most rows one table of a document carries; a spreadsheet carries them all. */
export const REPORT_MAX_ROWS = 5_000;

const DAYS_MAX = 365;

export const reportQuerySchema = z
  .object({
    testId: z.uuid().optional(),
    studentId: z.uuid().optional(),
    attemptId: z.uuid().optional(),
    seriesId: z.uuid().optional(),
    eventId: z.uuid().optional(),
    branchId: z.uuid().optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    top: z.coerce.number().int().min(1).max(REPORT_TOP_MAX).optional(),
    days: z.coerce.number().int().min(1).max(DAYS_MAX).optional(),
  })
  .refine(({ from, to }) => from === undefined || to === undefined || from <= to, {
    path: ['to'],
    message: 'A period cannot end before it starts',
  });
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type ReportQueryInput = z.input<typeof reportQuerySchema>;

/** The query keys each param travels as; a period is the only one that is two. */
export const REPORT_PARAM_FIELDS = {
  [REPORT_PARAMS.TEST]: ['testId'],
  [REPORT_PARAMS.STUDENT]: ['studentId'],
  [REPORT_PARAMS.ATTEMPT]: ['attemptId'],
  [REPORT_PARAMS.SERIES]: ['seriesId'],
  [REPORT_PARAMS.EVENT]: ['eventId'],
  [REPORT_PARAMS.BRANCH]: ['branchId'],
  [REPORT_PARAMS.PERIOD]: ['from', 'to'],
  [REPORT_PARAMS.TOP]: ['top'],
  [REPORT_PARAMS.DAYS]: ['days'],
} as const satisfies Record<ReportParam, readonly (keyof ReportQuery)[]>;

type FieldsOf<P extends ReportParam> = (typeof REPORT_PARAM_FIELDS)[P][number];

/** A report's query once its catalogue row has been checked: what it needs is no longer optional. */
export type ReportQueryOf<K extends ReportKey> = ReportQuery &
  Required<Pick<ReportQuery, FieldsOf<(typeof REPORTS)[K]['needs'][number]>>>;

/** The query keys `key` cannot be built without and was not given. */
export function reportFieldsMissing(key: ReportKey, query: ReportQuery): (keyof ReportQuery)[] {
  const needs: readonly ReportParam[] = REPORTS[key].needs;
  return needs
    .flatMap((param): readonly (keyof ReportQuery)[] => REPORT_PARAM_FIELDS[param])
    .filter((field) => query[field] === undefined);
}

export interface ReportPeriodRange {
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

/** A civil date built at UTC midnight, as a picker builds one: no instant, so no zone to get wrong. */
const atUtc = (day: string): Date => new Date(`${day}T00:00:00Z`);
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The civil dates a named period covers; a week runs Monday to Sunday. */
export function reportPeriodOf(preset: ReportPeriod, today = todayISO()): ReportPeriodRange {
  const date = atUtc(today);
  if (preset === REPORT_PERIODS.THIS_WEEK || preset === REPORT_PERIODS.LAST_WEEK) {
    const sinceMonday = (date.getUTCDay() + WEEK_DAYS - 1) % WEEK_DAYS;
    const back = preset === REPORT_PERIODS.LAST_WEEK ? sinceMonday + WEEK_DAYS : sinceMonday;
    const monday = date.getTime() - back * DAY_MS;
    return { from: dayOf(monday), to: dayOf(monday + (WEEK_DAYS - 1) * DAY_MS) };
  }
  const month = date.getUTCMonth() - (preset === REPORT_PERIODS.LAST_MONTH ? 1 : 0);
  return {
    from: dayOf(Date.UTC(date.getUTCFullYear(), month, 1)),
    to: dayOf(Date.UTC(date.getUTCFullYear(), month + 1, 0)),
  };
}

const reportCellSchema = z.union([z.string(), z.number(), z.null()]);
export type ReportCell = z.infer<typeof reportCellSchema>;

const reportFactSchema = z.object({ label: z.string(), value: reportCellSchema });
export type ReportFact = z.infer<typeof reportFactSchema>;

const reportTableSchema = z.object({
  title: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.array(reportCellSchema)),
  /** Every row the report holds; more than `rows` where the table was cut at `REPORT_MAX_ROWS`. */
  total: z.number().int(),
});
export type ReportTable = z.infer<typeof reportTableSchema>;

/** A column of figures is one where every cell that holds anything holds a number; a page sets it right-aligned. */
export function holdsFigures(table: Pick<ReportTable, 'rows'>, at: number): boolean {
  return (
    table.rows.some((row) => typeof row[at] === 'number') &&
    table.rows.every((row) => typeof row[at] !== 'string')
  );
}

export const reportDocumentSchema = z.object({
  key: reportKeySchema,
  title: z.string(),
  /** Rank and percentile are counted live, so a report is true as of the moment it was built. */
  asOf: z.string(),
  /** What it covers: the test, the period, the branch. */
  about: z.array(reportFactSchema),
  /** Paragraphs set before the figures and after the tables: what makes a report a letter. */
  preface: z.array(z.string()).default([]),
  figures: z.array(reportFactSchema),
  tables: z.array(reportTableSchema),
  closing: z.array(z.string()).default([]),
});
export type ReportDocument = z.infer<typeof reportDocumentSchema>;

/** The params chosen from a list too long to hand over whole; the rest are dates and numbers. */
export const REPORT_CHOICE_PARAMS = [
  REPORT_PARAMS.TEST,
  REPORT_PARAMS.STUDENT,
  REPORT_PARAMS.ATTEMPT,
  REPORT_PARAMS.SERIES,
  REPORT_PARAMS.EVENT,
  REPORT_PARAMS.BRANCH,
] as const;
export const reportChoiceParamSchema = z.enum(REPORT_CHOICE_PARAMS);
export type ReportChoiceParam = z.infer<typeof reportChoiceParamSchema>;

/** One row of a report's picker. Its own route, so asking for a report needs no grant but REPORTS. */
export const reportChoiceSchema = z.object({
  value: z.string(),
  label: z.string(),
  hint: z.string().nullable(),
});
export type ReportChoice = z.infer<typeof reportChoiceSchema>;

export const reportChoicesQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  /** Whose sittings: the one choice that hangs off another. */
  studentId: z.uuid().optional(),
});
export type ReportChoicesQuery = z.infer<typeof reportChoicesQuerySchema>;
export type ReportChoicesQueryInput = z.input<typeof reportChoicesQuerySchema>;

/** The reports a student may read of themselves. Each is asked for without a student: that is the caller. */
export const STUDENT_REPORT_KEYS = [
  REPORT_KEYS.STUDENT_SCORE_CARD,
  REPORT_KEYS.STUDENT_WEEKLY,
  REPORT_KEYS.STUDENT_MONTHLY,
  REPORT_KEYS.STUDENT_CUMULATIVE,
  REPORT_KEYS.STUDENT_TOPICS,
] as const;
export const studentReportKeySchema = z.enum(STUDENT_REPORT_KEYS);
export type StudentReportKey = z.infer<typeof studentReportKeySchema>;

export const ME_REPORT_ROUTES = {
  read: (key: StudentReportKey) => `/me/reports/${key}`,
} as const;

export const ADMIN_REPORT_ROUTES = {
  read: (key: ReportKey) => `/admin/reports/${key}`,
  export: (key: ReportKey) => `/admin/reports/${key}/export`,
  choices: (param: ReportChoiceParam) => `/admin/reports/choices/${param}`,
} as const;
