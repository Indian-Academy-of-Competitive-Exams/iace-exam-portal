/**
 * The reports about tests across a period. A sitting falls in a period by when it was handed in, on
 * the institute's calendar; a test's own figures are its cohort's to date, since a test never shuts.
 */
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  INSTITUTE_TIME_ZONE,
  REPORT_KEYS,
  TEST_STATUS,
  type ReportQueryOf,
} from '@iace/contracts';
import { COHORT_WHERE, IN_COHORT } from '../attempts';
import { EXPORT_DATE_FORMATS, type ExportColumn } from '../common/exporting';
import { toDateColumn } from '../common/time/institute-day';
import { type StudentCard } from '../students';
import { aboutPeriod, daysOf, elapsed, periodBefore, periodOf } from './period';
import { type ReportBuilder } from './report';
import { groupBy, meanOf } from './report-figures';
import { STUDENT_COLUMNS, cardsOf } from './report-people';
import {
  TEST_COHORT,
  TEST_NAME,
  TEST_OPENED,
  TEST_REACHED,
  TEST_SERIES,
  TEST_STATE,
  testRowsOf,
  type TestRow,
} from './report-tests';

type PeriodBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.TEST_ACTIVITY_WEEKLY>>;
type SeriesBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.SERIES_PROGRESS>>;

interface ActivityRow extends TestRow {
  inPeriod: number;
}

const [RANKED, ...COHORT_REST] = TEST_COHORT;

const ACTIVITY_COLUMNS: ExportColumn<ActivityRow>[] = [
  TEST_NAME,
  TEST_SERIES,
  TEST_OPENED,
  { header: 'Sittings in period', width: 17, value: (row) => row.inPeriod },
  ...(RANKED ? [{ ...RANKED, header: 'Ranked to date' }] : []),
  TEST_REACHED,
  ...COHORT_REST,
];

/** Every test that opened in the period or was sat in it: a test opened and left unsat is news too. */
const activity: PeriodBuilder = async (sources, query) => {
  const { prisma } = sources;
  const period = periodOf(query);
  const inPeriod = { ...COHORT_WHERE, submittedAt: period.within };
  const [opened, sat, students, before] = await Promise.all([
    prisma.test.findMany({
      where: { status: TEST_STATUS.ACTIVE, opensAt: elapsed(period) },
      select: { id: true },
    }),
    prisma.attempt.groupBy({ by: ['testId'], where: inPeriod, _count: true }),
    prisma.attempt.groupBy({ by: ['studentId'], where: inPeriod }),
    prisma.attempt.count({
      where: { ...COHORT_WHERE, submittedAt: periodBefore(period).within },
    }),
  ]);
  const satIn = new Map(sat.map((row) => [row.testId, row._count]));
  const ids = [...new Set([...opened.map((test) => test.id), ...satIn.keys()])];
  const tests = await testRowsOf(sources, { id: { in: ids } });
  const rows = tests.map((test) => ({ ...test, inPeriod: satIn.get(test.id) ?? 0 }));

  return {
    about: [aboutPeriod(period)],
    figures: [
      { label: 'Tests opened', value: opened.length },
      { label: 'Ranked sittings', value: rows.reduce((sum, row) => sum + row.inPeriod, 0) },
      { label: 'Students who sat', value: students.length },
      { label: 'Sittings, period before', value: before },
    ],
    sheets: [{ name: 'Tests', columns: ACTIVITY_COLUMNS, rows }],
  };
};

interface SeriesStudent {
  student: StudentCard;
  percentiles: number[];
}

const SERIES_STUDENT_COLUMNS: ExportColumn<SeriesStudent>[] = [
  ...STUDENT_COLUMNS.map((column): ExportColumn<SeriesStudent> => ({
    ...column,
    value: (row) => column.value(row.student),
  })),
  { header: 'Tests sat', width: 10, value: (row) => row.percentiles.length },
  { header: 'Average percentile', width: 18, value: (row) => meanOf(row.percentiles) },
];

const SERIES_TEST_COLUMNS: ExportColumn<TestRow>[] = [
  TEST_NAME,
  TEST_STATE,
  TEST_OPENED,
  ...TEST_COHORT,
];

/** A series' tests in the order it runs them, and how far each student it reaches has come. */
const seriesProgress: SeriesBuilder = async (sources, { seriesId }) => {
  const { prisma, access, leaderboard } = sources;
  const series = await prisma.testSeries.findUnique({
    where: { id: seriesId },
    select: { name: true },
  });
  if (series === null) throw new AppException(ErrorCodes.NOT_FOUND, 'That series does not exist');

  const tests = (await testRowsOf(sources, { testSeriesId: seriesId })).sort(
    (a, b) =>
      (a.seriesOrder ?? Number.MAX_SAFE_INTEGER) - (b.seriesOrder ?? Number.MAX_SAFE_INTEGER),
  );
  const live = tests.filter((test) => test.status === TEST_STATUS.ACTIVE);
  const [reached, standings] = await Promise.all([
    access.studentsReaching(seriesId),
    leaderboard.standingsOfTests(live.map((test) => test.id)),
  ]);
  const sat = groupBy([...standings.values()], (standing) => standing.studentId);
  // Whoever sat a test is listed even if the series no longer reaches them.
  const cards = await cardsOf(prisma, [...new Set([...reached, ...sat.keys()])]);
  const students = cards
    .map((student) => ({
      student,
      percentiles: (sat.get(student.id) ?? []).map((standing) => standing.percentile),
    }))
    .sort(
      (a, b) =>
        b.percentiles.length - a.percentiles.length ||
        (meanOf(b.percentiles) ?? 0) - (meanOf(a.percentiles) ?? 0),
    );

  return {
    about: [{ label: 'Series', value: series.name }],
    figures: [
      { label: 'Active tests', value: live.length },
      { label: 'Students reached', value: reached.length },
      {
        label: 'Sat every active test',
        value:
          live.length === 0
            ? 0
            : students.filter((row) => row.percentiles.length === live.length).length,
      },
    ],
    sheets: [
      { name: 'Tests', columns: SERIES_TEST_COLUMNS, rows: tests },
      { name: 'Students', columns: SERIES_STUDENT_COLUMNS, rows: students },
    ],
  };
};

const SCHEDULE_COLUMNS: ExportColumn<TestRow>[] = [
  { ...TEST_OPENED, header: 'Opens' },
  TEST_NAME,
  TEST_SERIES,
  TEST_STATE,
  { ...TEST_REACHED, header: 'Reaches' },
];

/** What opens in the period, a draft with a date set included: a schedule is read before the day. */
const schedule: PeriodBuilder = async (sources, query) => {
  const period = periodOf(query);
  const rows = await testRowsOf(sources, { opensAt: period.within });
  return {
    about: [aboutPeriod(period)],
    figures: [{ label: 'Tests', value: rows.length }],
    sheets: [{ name: 'Schedule', columns: SCHEDULE_COLUMNS, rows }],
  };
};

interface DayRow {
  day: string;
  sittings: number;
  students: number;
  tests: number;
}

const DAY_COLUMNS: ExportColumn<DayRow>[] = [
  {
    header: 'Day',
    width: 14,
    date: EXPORT_DATE_FORMATS.DAY,
    value: (row) => toDateColumn(row.day),
  },
  { header: 'Ranked sittings', width: 15, value: (row) => row.sittings },
  { header: 'Students', width: 10, value: (row) => row.students },
  { header: 'Tests sat', width: 10, value: (row) => row.tests },
];

/** One row a day, a day nobody sat included: a gap in the hall is what the trend is read for. */
const participation: PeriodBuilder = async ({ prisma }, query) => {
  const period = periodOf(query);
  const counted = await prisma.$queryRaw<DayRow[]>(Prisma.sql`
    SELECT to_char(("submittedAt" AT TIME ZONE ${INSTITUTE_TIME_ZONE})::date, 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS sittings,
           COUNT(DISTINCT "studentId")::int AS students,
           COUNT(DISTINCT "testId")::int AS tests
    FROM "Attempt"
    WHERE "submittedAt" BETWEEN ${period.within.gte} AND ${period.within.lte} AND ${IN_COHORT}
    GROUP BY 1
  `);
  const byDay = new Map(counted.map((row) => [row.day, row]));
  const rows = daysOf(period).map(
    (day) => byDay.get(day) ?? { day, sittings: 0, students: 0, tests: 0 },
  );
  return {
    about: [aboutPeriod(period)],
    figures: [
      { label: 'Ranked sittings', value: rows.reduce((sum, row) => sum + row.sittings, 0) },
      { label: 'Days with a sitting', value: counted.length },
    ],
    sheets: [{ name: 'Days', columns: DAY_COLUMNS, rows }],
  };
};

export const PERIOD_REPORTS = {
  [REPORT_KEYS.TEST_ACTIVITY_WEEKLY]: activity,
  [REPORT_KEYS.TEST_ACTIVITY_MONTHLY]: activity,
  [REPORT_KEYS.SERIES_PROGRESS]: seriesProgress,
  [REPORT_KEYS.TEST_SCHEDULE]: schedule,
  [REPORT_KEYS.PARTICIPATION_TREND]: participation,
};
