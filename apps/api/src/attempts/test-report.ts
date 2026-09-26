/**
 * One test's report as a workbook: every sitting with its live standing, who it reached and did not
 * sit, and the paper's figures as the analytics screen reads them. Standing comes from the whole-test
 * window query; the paper figures are the analytics service's own, so the file matches the screen.
 */
import { type Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  type AttemptSectionScore,
  type AttemptStatus,
  type TestAnalytics,
  type TestItemAnalytics,
  type TestSectionAnalytics,
} from '@iace/contracts';
import { type AccessResolverService } from '../access';
import {
  EXPORT_DATE_FORMATS,
  assertExportable,
  exportInstant,
  writeWorkbook,
  type ExportColumn,
} from '../common/exporting';
import { type PrismaService } from '../prisma/prisma.service';
import { STUDENT_CARD_SELECT, studentCardsOf, type StudentCard } from '../students';
import { numberOrNull } from './attempt-report';
import { sectionScoresIn } from './score-paper';
import { testResultsSql, type TestResultRow } from './ranking-sql';
import { type TestAnalyticsService } from './test-analytics.service';

const STATUS_LABELS = {
  [ATTEMPT_STATUS.IN_PROGRESS]: 'In progress',
  [ATTEMPT_STATUS.SUBMITTED]: 'Submitted',
  [ATTEMPT_STATUS.EVALUATED]: 'Evaluated',
  [ATTEMPT_STATUS.EXPIRED]: 'Expired',
  [ATTEMPT_STATUS.VOIDED]: 'Voided',
} as const satisfies Record<AttemptStatus, string>;

const PERCENT = 100;

const SITTING_SELECT = {
  id: true,
  studentId: true,
  attemptNo: true,
  status: true,
  score: true,
  correctCount: true,
  wrongCount: true,
  unattemptedCount: true,
  timeTakenSec: true,
  submittedAt: true,
  sectionScores: true,
  student: { select: STUDENT_CARD_SELECT },
} as const satisfies Prisma.AttemptSelect;

type Sitting = Prisma.AttemptGetPayload<{ select: typeof SITTING_SELECT }>;

interface ResultRow extends Sitting {
  rank: number | null;
  percentile: number | null;
  bySection: ReadonlyMap<string, AttemptSectionScore>;
}

export interface TestReport {
  workbook: Buffer;
  results: number;
  absent: number;
}

/** What the report reads through; the controller's own providers, so no new one is registered. */
export interface TestReportSources {
  prisma: PrismaService;
  analytics: TestAnalyticsService;
  access: AccessResolverService;
}

export async function buildTestReport(
  { prisma, analytics, access }: TestReportSources,
  testId: string,
): Promise<TestReport> {
  const report = await analytics.forTest(testId);
  assertExportable(report.summary.attemptCount);

  const [standings, sittings, test] = await Promise.all([
    prisma.$queryRaw<TestResultRow[]>(testResultsSql(testId)),
    prisma.attempt.findMany({ where: { testId }, select: SITTING_SELECT }),
    prisma.test.findUniqueOrThrow({ where: { id: testId }, select: { testSeriesId: true } }),
  ]);
  const byId = new Map(sittings.map((sitting) => [sitting.id, sitting]));
  const results = standings.flatMap((standing) => {
    const sitting = byId.get(standing.attempt_id);
    if (!sitting) return [];
    const { rank, percentile } = standing;
    return [{ ...sitting, rank, percentile, bySection: sectionsOf(sitting) }];
  });

  // Reached, minus anyone holding any sitting of the test, a voided one included.
  const sat = new Set(sittings.map((sitting) => sitting.studentId));
  const absentIds = (await access.studentsReaching(test.testSeriesId)).filter((id) => !sat.has(id));
  assertExportable(absentIds.length);
  const absent = (await studentCardsOf(prisma, absentIds)).sort((a, b) =>
    (a.fullName ?? '').localeCompare(b.fullName ?? ''),
  );

  const sections = [...report.sections].sort((a, b) => a.order - b.order);
  const workbook = await writeWorkbook([
    { name: 'Results', columns: resultColumns(sections), rows: results },
    { name: 'Absent', columns: PERSON_COLUMNS, rows: absent },
    { name: 'Sections', columns: SECTION_COLUMNS, rows: sections },
    { name: 'Questions', columns: questionColumns(sections), rows: report.items },
    { name: 'Summary', columns: SUMMARY_COLUMNS, rows: summaryRows(report) },
  ]);
  return { workbook, results: results.length, absent: absent.length };
}

function sectionsOf(sitting: Sitting): ReadonlyMap<string, AttemptSectionScore> {
  const scores = sectionScoresIn(sitting.sectionScores) ?? [];
  return new Map(scores.map((score) => [score.baseConfigSectionId, score]));
}

const PERSON_COLUMNS: ExportColumn<StudentCard>[] = [
  { header: 'Student', width: 28, value: (row) => row.fullName },
  { header: 'Mobile', width: 14, text: true, value: (row) => row.mobile },
  { header: 'Branch', width: 20, value: (row) => row.currentBranch?.name ?? null },
  { header: 'Programs', width: 24, value: (row) => row.programs.join(', ') },
];

function resultColumns(sections: readonly TestSectionAnalytics[]): ExportColumn<ResultRow>[] {
  const person = PERSON_COLUMNS.map((column): ExportColumn<ResultRow> => ({
    ...column,
    value: (row) => column.value(row.student),
  }));
  return [
    { header: 'Rank', width: 8, value: (row) => row.rank },
    { header: 'Percentile', width: 11, value: (row) => row.percentile },
    ...person,
    { header: 'Attempt no', width: 11, value: (row) => row.attemptNo },
    { header: 'Status', width: 12, value: (row) => STATUS_LABELS[row.status] },
    { header: 'Score', width: 9, value: (row) => numberOrNull(row.score) },
    { header: 'Correct', width: 9, value: (row) => row.correctCount },
    { header: 'Wrong', width: 9, value: (row) => row.wrongCount },
    { header: 'Blank', width: 9, value: (row) => row.unattemptedCount },
    { header: 'Time taken (sec)', width: 16, value: (row) => row.timeTakenSec },
    {
      header: 'Submitted at',
      width: 18,
      date: EXPORT_DATE_FORMATS.INSTANT,
      value: (row) => exportInstant(row.submittedAt),
    },
    ...sections.flatMap((section) => sectionColumns(section)),
  ];
}

/** A sitting the scorer has not reached has no section scores yet, so its cells stay blank. */
function sectionColumns(section: TestSectionAnalytics): ExportColumn<ResultRow>[] {
  const scoreIn = (row: ResultRow) => row.bySection.get(section.baseConfigSectionId);
  return [
    { header: `${section.name} score`, width: 12, value: (row) => scoreIn(row)?.score ?? null },
    {
      header: `${section.name} correct`,
      width: 12,
      value: (row) => scoreIn(row)?.correctCount ?? null,
    },
    {
      header: `${section.name} wrong`,
      width: 12,
      value: (row) => scoreIn(row)?.wrongCount ?? null,
    },
  ];
}

const SECTION_COLUMNS: ExportColumn<TestSectionAnalytics>[] = [
  { header: 'Section', width: 24, value: (row) => row.name },
  { header: 'Max marks', width: 11, value: (row) => row.maxMarks },
  { header: 'Attempted', width: 11, value: (row) => row.attempted },
  { header: 'Average score', width: 14, value: (row) => row.averageScore },
  { header: 'Average time (sec)', width: 18, value: (row) => row.averageTimeSec },
];

function questionColumns(
  sections: readonly TestSectionAnalytics[],
): ExportColumn<TestItemAnalytics>[] {
  const names = new Map(sections.map((section) => [section.baseConfigSectionId, section.name]));
  return [
    { header: '#', width: 6, value: (row) => row.order },
    { header: 'Code', width: 14, text: true, value: (row) => row.questionCode },
    { header: 'Section', width: 20, value: (row) => names.get(row.baseConfigSectionId) ?? null },
    { header: 'Question', width: 48, value: (row) => row.stemPreview },
    { header: 'Attempted', width: 11, value: (row) => row.attemptedCount },
    { header: 'Correct', width: 9, value: (row) => row.correctCount },
    { header: 'Wrong', width: 9, value: (row) => row.wrongCount },
    { header: 'Blank', width: 9, value: (row) => row.skippedCount },
    { header: 'Average time (sec)', width: 18, value: (row) => row.averageTimeSec },
    {
      header: 'Got it right (%)',
      width: 16,
      value: (row) => (row.pValue === null ? null : Math.round(row.pValue * PERCENT * 10) / 10),
    },
  ];
}

interface SummaryRow {
  label: string;
  value: string | number | Date | null;
}

const SUMMARY_COLUMNS: ExportColumn<SummaryRow>[] = [
  { header: 'Figure', width: 22, value: (row) => row.label },
  { header: 'Value', width: 28, value: (row) => row.value },
];

function summaryRows({ title, summary }: TestAnalytics): SummaryRow[] {
  const topper = summary.topper;
  return [
    { label: 'Test', value: title },
    { label: 'Students reached', value: summary.reachedCount },
    { label: 'Sittings', value: summary.attemptCount },
    { label: 'Ranked sittings', value: summary.evaluatedCount },
    { label: 'Mean score', value: summary.meanScore },
    { label: 'Median (approximate)', value: summary.medianScore },
    { label: 'Highest', value: summary.maxScore },
    { label: 'Lowest', value: summary.minScore },
    { label: 'Average time (sec)', value: summary.averageTimeSec },
    { label: 'Topper', value: topper ? `${topper.name} (${topper.score ?? '—'})` : null },
  ];
}
