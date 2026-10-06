import { z } from 'zod';
import { dateOnlySchema, todayISO } from './students';

// ============================================================================
// Reports. One catalogue, code-owned: a key names a report, what it cannot be
// built without, and what narrows it. Every report answers with one document
// shape, so a screen, a printed page and a spreadsheet read the same rows.
// ============================================================================

export const REPORT_GROUPS = {
  TESTS: 'tests',
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
} as const satisfies Record<ReportKey, ReportSpec>;

/** How many rows a merit list or a top-performers table carries when nobody says. */
export const REPORT_TOP_DEFAULT = 10;
export const REPORT_TOP_MAX = 500;

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

export const reportDocumentSchema = z.object({
  key: reportKeySchema,
  title: z.string(),
  /** Rank and percentile are counted live, so a report is true as of the moment it was built. */
  asOf: z.string(),
  /** What it covers: the test, the period, the branch. */
  about: z.array(reportFactSchema),
  figures: z.array(reportFactSchema),
  tables: z.array(reportTableSchema),
});
export type ReportDocument = z.infer<typeof reportDocumentSchema>;

export const ADMIN_REPORT_ROUTES = {
  read: (key: ReportKey) => `/admin/reports/${key}`,
  export: (key: ReportKey) => `/admin/reports/${key}/export`,
} as const;
