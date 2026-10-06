/** A test as a row of a report that lists many: its window, who it reaches and how its cohort did. */
import { type Prisma } from '@prisma/client';
import { TEST_STATUS, type TestStatus } from '@iace/contracts';
import { EXPORT_DATE_FORMATS, exportInstant, type ExportColumn } from '../common/exporting';
import { type ReportSources } from './report';
import { percentOf } from './report-figures';
import { cardsOf } from './report-people';

const UNTITLED = 'Untitled test';

export const TEST_STATUS_LABELS = {
  [TEST_STATUS.DRAFT]: 'Draft',
  [TEST_STATUS.ACTIVE]: 'Active',
  [TEST_STATUS.INACTIVE]: 'Inactive',
} as const satisfies Record<TestStatus, string>;

export interface TestRow {
  id: string;
  title: string;
  series: string;
  status: TestStatus;
  opensAt: Date | null;
  seriesOrder: number | null;
  /** Everyone its series reaches today. */
  reached: number;
  /** Its cohort: one ranked sitting a student. */
  ranked: number;
  mean: number | null;
  highest: number | null;
  topper: string | null;
}

/** The tests a filter names, earliest window first, each with its reach and its cohort's figures. */
export async function testRowsOf(
  { prisma, access, leaderboard }: ReportSources,
  where: Prisma.TestWhereInput,
): Promise<TestRow[]> {
  const tests = await prisma.test.findMany({
    where,
    orderBy: [{ opensAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    select: {
      id: true,
      title: true,
      status: true,
      opensAt: true,
      seriesOrder: true,
      testSeriesId: true,
      testSeries: { select: { name: true } },
    },
  });
  const seriesIds = [...new Set(tests.map((test) => test.testSeriesId))];
  const [cohorts, reaches] = await Promise.all([
    leaderboard.cohortsOf(tests.map((test) => test.id)),
    Promise.all(seriesIds.map((id) => access.audienceCount(id))),
  ]);
  const reachOf = new Map(seriesIds.map((id, at) => [id, reaches[at] ?? 0]));
  const toppers = await cardsOf(
    prisma,
    [...cohorts.values()].map((cohort) => cohort.topperId),
  );
  const nameOf = new Map(toppers.map((student) => [student.id, student.fullName]));

  return tests.map((test) => {
    const cohort = cohorts.get(test.id);
    return {
      id: test.id,
      title: test.title ?? UNTITLED,
      series: test.testSeries.name,
      status: test.status,
      opensAt: test.opensAt,
      seriesOrder: test.seriesOrder,
      reached: reachOf.get(test.testSeriesId) ?? 0,
      ranked: cohort?.size ?? 0,
      mean: cohort?.mean ?? null,
      highest: cohort?.highest ?? null,
      topper: cohort ? (nameOf.get(cohort.topperId) ?? null) : null,
    };
  });
}

export const TEST_NAME: ExportColumn<TestRow> = {
  header: 'Test',
  width: 36,
  value: (row) => row.title,
};
export const TEST_SERIES: ExportColumn<TestRow> = {
  header: 'Series',
  width: 30,
  value: (row) => row.series,
};
export const TEST_STATE: ExportColumn<TestRow> = {
  header: 'Status',
  width: 10,
  value: (row) => TEST_STATUS_LABELS[row.status],
};
export const TEST_OPENED: ExportColumn<TestRow> = {
  header: 'Opened',
  width: 18,
  date: EXPORT_DATE_FORMATS.INSTANT,
  value: (row) => exportInstant(row.opensAt),
};
export const TEST_REACHED: ExportColumn<TestRow> = {
  header: 'Reached',
  width: 10,
  value: (row) => row.reached,
};

/** How the cohort did: the columns every list of tests ends on. */
export const TEST_COHORT: ExportColumn<TestRow>[] = [
  { header: 'Ranked sittings', width: 15, value: (row) => row.ranked },
  { header: 'Participation (%)', width: 16, value: (row) => percentOf(row.ranked, row.reached) },
  { header: 'Mean score', width: 11, value: (row) => row.mean },
  { header: 'Highest', width: 9, value: (row) => row.highest },
  { header: 'Topper', width: 26, value: (row) => row.topper },
];
