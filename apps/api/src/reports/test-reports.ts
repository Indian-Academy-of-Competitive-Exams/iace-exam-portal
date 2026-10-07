/**
 * The reports about one test. Each is read off the test's own analytics and result sheet — the
 * figures its analytics screen shows and the rows its workbook writes — so a printed page cannot
 * say something the screen does not.
 */
import {
  MERIT_TYPE,
  PAPER_QUESTION_STATUS,
  QUESTION_TYPE,
  REPORT_KEYS,
  REPORT_TOP_DEFAULT,
  instituteDateTimeLabel,
  type LocalizedContent,
  type PaperQuestionStatus,
  type ReportFact,
  type ReportQueryOf,
} from '@iace/contracts';
import { TestReportSheets, type PaperTerm, type ResultRow } from '../attempts';
import {
  EXPORT_DATE_FORMATS,
  exportInstant,
  type ExportColumn,
  type ExportSheet,
} from '../common/exporting';
import { stemPreviewOf } from '../questions';
import { STUDENT_CARD_SELECT, type StudentCard } from '../students';
import { type ReportBuilder, type ReportSources } from './report';
import { groupBy, highestOf, meanOf, minutesOf, percentOf } from './report-figures';
import { adminNames, branchOf, cardsOf, studentColumns } from './report-people';

type TestBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.TEST_RESULTS>>;

const UNTITLED = 'Untitled test';

interface OpenTest {
  sheets: TestReportSheets;
  about: ReportFact[];
  testSeriesId: string;
}

/** The analytics read refuses a test that is not there, so it goes first. */
async function openTest(sources: ReportSources, testId: string): Promise<OpenTest> {
  const sheets = await TestReportSheets.of(sources, testId);
  const test = await sources.prisma.test.findUniqueOrThrow({
    where: { id: testId },
    select: {
      opensAt: true,
      testSeriesId: true,
      testSeries: { select: { name: true } },
    },
  });
  const about: ReportFact[] = [
    { label: 'Test', value: sheets.analytics.title ?? UNTITLED },
    { label: 'Series', value: test.testSeries.name },
  ];
  if (test.opensAt) about.push({ label: 'Opened', value: instituteDateTimeLabel(test.opensAt) });
  return { sheets, about, testSeriesId: test.testSeriesId };
}

type RankedRow = ResultRow & { rank: number; percentile: number };

const isRanked = (row: ResultRow): row is RankedRow => row.rank !== null && row.percentile !== null;

async function rankedOf(sheets: TestReportSheets): Promise<RankedRow[]> {
  return (await sheets.results()).rows.filter(isRanked);
}

const scoreOf = (row: ResultRow): number => Number(row.score);

const RANK: ExportColumn<RankedRow> = { header: 'Rank', width: 8, value: (row) => row.rank };
const NAME: ExportColumn<RankedRow> = {
  header: 'Student',
  width: 28,
  value: (row) => row.student.fullName,
};
const BRANCH: ExportColumn<RankedRow> = {
  header: 'Branch',
  width: 20,
  value: (row) => branchOf(row.student),
};
const SCORE: ExportColumn<RankedRow> = { header: 'Score', width: 9, value: scoreOf };

const results: TestBuilder = async (sources, { testId }) => {
  const { sheets, about } = await openTest(sources, testId);
  return { about, figures: [], sheets: [await sheets.results()] };
};

const BAND_COLUMNS: ExportColumn<{ from: number; to: number; count: number }>[] = [
  { header: 'From (marks)', width: 13, value: (row) => row.from },
  { header: 'To (marks)', width: 13, value: (row) => row.to },
  { header: 'Sittings', width: 10, value: (row) => row.count },
];

const summary: TestBuilder = async (sources, { testId }) => {
  const { sheets, about } = await openTest(sources, testId);
  const [, ...figures] = sheets.summary().rows;
  return {
    about,
    figures: figures.map(({ label, value }) => ({
      label,
      value: value instanceof Date ? null : value,
    })),
    sheets: [
      { name: 'Score spread', columns: BAND_COLUMNS, rows: sheets.analytics.summary.bands },
      sheets.sections(),
    ],
  };
};

const sections: TestBuilder = async (sources, { testId }) => {
  const { sheets, about } = await openTest(sources, testId);
  return { about, figures: [], sheets: [sheets.sections()] };
};

const items: TestBuilder = async (sources, { testId }) => {
  const { sheets, about } = await openTest(sources, testId);
  return { about, figures: [], sheets: [sheets.questions()] };
};

const absentees: TestBuilder = async (sources, { testId }) => {
  const { sheets, about } = await openTest(sources, testId);
  const absent = await sheets.absent();
  return {
    about,
    figures: [
      { label: 'Students reached', value: sheets.analytics.summary.reachedCount },
      { label: 'Absent', value: absent.rows.length },
    ],
    sheets: [absent],
  };
};

const MERIT_COLUMNS: ExportColumn<RankedRow>[] = [
  RANK,
  NAME,
  BRANCH,
  SCORE,
  { header: 'Time (min)', width: 11, value: (row) => minutesOf(row.timeTakenSec) },
  { header: 'Percentile', width: 11, value: (row) => row.percentile },
];

const merit: TestBuilder = async (sources, { testId, top = REPORT_TOP_DEFAULT }) => {
  const { sheets, about } = await openTest(sources, testId);
  const ranked = await rankedOf(sheets);
  // Already in rank order, so the first row met for a branch is that branch's best.
  const toppers = [...groupBy(ranked, (row) => branchOf(row.student)).values()].flatMap(
    ([first]) => (first ? [first] : []),
  );
  return {
    about,
    figures: [{ label: 'Ranked sittings', value: ranked.length }],
    sheets: [
      { name: 'Merit list', columns: MERIT_COLUMNS, rows: ranked.slice(0, top) },
      { name: 'Branch toppers', columns: [BRANCH, NAME, RANK, SCORE], rows: toppers },
    ],
  };
};

interface BranchRow {
  branch: string;
  reached: number;
  ranked: RankedRow[];
}

const BRANCH_COLUMNS: ExportColumn<BranchRow>[] = [
  { header: 'Branch', width: 22, value: (row) => row.branch },
  { header: 'Reached', width: 10, value: (row) => row.reached },
  { header: 'Ranked sittings', width: 15, value: (row) => row.ranked.length },
  {
    header: 'Participation (%)',
    width: 16,
    value: (row) => percentOf(row.ranked.length, row.reached),
  },
  { header: 'Mean score', width: 11, value: (row) => meanOf(row.ranked.map(scoreOf)) },
  { header: 'Highest', width: 9, value: (row) => highestOf(row.ranked.map(scoreOf)) },
  {
    header: 'Mean percentile',
    width: 15,
    value: (row) => meanOf(row.ranked.map((sitting) => sitting.percentile)),
  },
];

const branches: TestBuilder = async (sources, { testId }) => {
  const { sheets, about, testSeriesId } = await openTest(sources, testId);
  const [ranked, reached] = await Promise.all([
    rankedOf(sheets),
    sources.access.studentsReaching(testSeriesId).then((ids) => cardsOf(sources.prisma, ids)),
  ]);
  const rankedIn = groupBy(ranked, (row) => branchOf(row.student));
  const reachedIn = groupBy(reached, branchOf);
  const rows = [...new Set([...reachedIn.keys(), ...rankedIn.keys()])]
    .sort((a, b) => a.localeCompare(b))
    .map((branch) => ({
      branch,
      reached: reachedIn.get(branch)?.length ?? 0,
      ranked: rankedIn.get(branch) ?? [],
    }));
  return {
    about,
    figures: [
      { label: 'Students reached', value: reached.length },
      { label: 'Ranked sittings', value: ranked.length },
    ],
    sheets: [{ name: 'Branches', columns: BRANCH_COLUMNS, rows }],
  };
};

interface Cutoff {
  id: string;
  name: string;
  marks: number;
}

const clears = (row: RankedRow, cutoff: Cutoff): boolean =>
  (row.bySection.get(cutoff.id)?.score ?? Number.NEGATIVE_INFINITY) >= cutoff.marks;

function cutoffColumns(held: readonly Cutoff[]): ExportColumn<RankedRow>[] {
  return [
    RANK,
    NAME,
    BRANCH,
    SCORE,
    ...held.map((cutoff): ExportColumn<RankedRow> => ({
      header: `${cutoff.name} (cutoff ${cutoff.marks})`,
      width: 22,
      value: (row) => row.bySection.get(cutoff.id)?.score ?? null,
    })),
    {
      header: 'Result',
      width: 14,
      value: (row) => (held.every((cutoff) => clears(row, cutoff)) ? 'Qualified' : 'Not qualified'),
    },
  ];
}

const cutoffs: TestBuilder = async (sources, { testId }) => {
  const { sheets, about } = await openTest(sources, testId);
  // A scoped test carries only some of its blueprint's sections, and only those can be cleared.
  const qualifying = await sources.prisma.baseConfigSection.findMany({
    where: {
      paperQuestions: { some: { testId } },
      meritOrQualifying: MERIT_TYPE.QUALIFYING,
      qualifyingCutoff: { not: null },
    },
    orderBy: { order: 'asc' },
    select: { id: true, name: true, qualifyingCutoff: true },
  });
  const held = qualifying.map((section) => ({
    id: section.id,
    name: section.name,
    marks: Number(section.qualifyingCutoff),
  }));
  if (held.length === 0) {
    return { about, figures: [{ label: 'Qualifying sections', value: 0 }], sheets: [] };
  }

  const ranked = await rankedOf(sheets);
  const qualified = ranked.filter((row) => held.every((cutoff) => clears(row, cutoff))).length;
  return {
    about,
    figures: [
      { label: 'Qualifying sections', value: held.length },
      { label: 'Qualified', value: qualified },
      { label: 'Not qualified', value: ranked.length - qualified },
    ],
    sheets: [{ name: 'Sectional cutoffs', columns: cutoffColumns(held), rows: ranked }],
  };
};

interface VoidRow {
  attemptNo: number;
  score: number | null;
  voidedAt: Date | null;
  voidReason: string | null;
  voidedBy: string | null;
  student: StudentCard;
}

const VOID_COLUMNS: ExportColumn<VoidRow>[] = [
  ...studentColumns<VoidRow>((row) => row.student),
  { header: 'Attempt no', width: 11, value: (row) => row.attemptNo },
  { header: 'Score', width: 9, value: (row) => row.score },
  {
    header: 'Void at',
    width: 18,
    date: EXPORT_DATE_FORMATS.INSTANT,
    value: (row) => exportInstant(row.voidedAt),
  },
  { header: 'Reason', width: 36, value: (row) => row.voidReason },
  { header: 'Void by', width: 24, value: (row) => row.voidedBy },
];

const voided: TestBuilder = async (sources, { testId }) => {
  const { about } = await openTest(sources, testId);
  const sittings = await sources.prisma.attempt.findMany({
    where: { testId, voidedAt: { not: null } },
    orderBy: { voidedAt: 'desc' },
    select: {
      attemptNo: true,
      score: true,
      voidedAt: true,
      voidReason: true,
      voidedById: true,
      student: { select: STUDENT_CARD_SELECT },
    },
  });
  const names = await adminNames(
    sources.prisma,
    sittings.map((sitting) => sitting.voidedById),
  );
  const rows = sittings.map(({ voidedById, score, ...sitting }) => ({
    ...sitting,
    score: score === null ? null : Number(score),
    voidedBy: voidedById === null ? null : (names.get(voidedById) ?? null),
  }));
  const sheet: ExportSheet<VoidRow> = { name: 'Void sittings', columns: VOID_COLUMNS, rows };
  return { about, figures: [{ label: 'Void sittings', value: rows.length }], sheets: [sheet] };
};

interface Keyed {
  order: number;
  section: string;
  code: string | null;
  stem: string;
  answer: string | null;
  marks: number;
  negativeMarks: number;
  status: PaperQuestionStatus;
}

const DISPOSITION_LABELS = {
  [PAPER_QUESTION_STATUS.ACTIVE]: null,
  [PAPER_QUESTION_STATUS.DROPPED]: 'Dropped',
  [PAPER_QUESTION_STATUS.BONUS]: 'Bonus',
} as const satisfies Record<PaperQuestionStatus, string | null>;

const KEY_COLUMNS: ExportColumn<Keyed>[] = [
  { header: '#', width: 6, value: (row) => row.order },
  { header: 'Section', width: 24, value: (row) => row.section },
  { header: 'Code', width: 14, text: true, value: (row) => row.code },
  { header: 'Question', width: 60, value: (row) => row.stem },
  { header: 'Answer', width: 18, value: (row) => row.answer },
  { header: 'Marks', width: 8, value: (row) => row.marks },
  { header: 'Negative marks', width: 14, value: (row) => row.negativeMarks },
  { header: 'Marked as', width: 11, value: (row) => DISPOSITION_LABELS[row.status] },
];

/** An option is named by its place in the paper's own pinned order, which is the order it is printed in. */
function answerOf(term: PaperTerm): string | null {
  if (term.type === QUESTION_TYPE.TEXT_FIELD) {
    const accepted = Object.values(term.answerKey?.answers ?? {});
    return accepted.find((answer) => typeof answer === 'string') ?? null;
  }
  const places = term.correctOptionIds
    .map((id) => term.optionIds.indexOf(id) + 1)
    .filter((place) => place > 0)
    .sort((a, b) => a - b);
  return places.length === 0 ? null : `Option ${places.join(', ')}`;
}

/** The key the scorer marks against, read fresh: never through the scorer's own held copy. */
const answerKey: TestBuilder = async (sources, { testId }) => {
  const { about } = await openTest(sources, testId);
  const [terms, rows] = await Promise.all([
    sources.papers.termsNow(testId),
    sources.prisma.paperQuestion.findMany({
      where: { testId },
      select: {
        id: true,
        order: true,
        baseConfigSection: { select: { name: true } },
        question: { select: { questionCode: true } },
        questionVersion: { select: { content: true } },
      },
    }),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const keyed = terms.flatMap((term): Keyed[] => {
    const row = byId.get(term.id);
    if (!row) return [];
    const content = (row.questionVersion.content as LocalizedContent | null) ?? {};
    return [
      {
        order: row.order,
        section: row.baseConfigSection.name,
        code: row.question.questionCode,
        stem: stemPreviewOf(content),
        answer: answerOf(term),
        marks: term.marks,
        negativeMarks: term.negativeMarks,
        status: term.status,
      },
    ];
  });
  return {
    about,
    figures: [{ label: 'Questions', value: keyed.length }],
    sheets: [{ name: 'Answer key', columns: KEY_COLUMNS, rows: keyed }],
  };
};

export const TEST_REPORTS = {
  [REPORT_KEYS.TEST_RESULTS]: results,
  [REPORT_KEYS.TEST_SUMMARY]: summary,
  [REPORT_KEYS.TEST_SECTIONS]: sections,
  [REPORT_KEYS.TEST_ITEMS]: items,
  [REPORT_KEYS.TEST_ABSENTEES]: absentees,
  [REPORT_KEYS.TEST_MERIT]: merit,
  [REPORT_KEYS.TEST_BRANCHES]: branches,
  [REPORT_KEYS.TEST_CUTOFFS]: cutoffs,
  [REPORT_KEYS.TEST_VOIDED]: voided,
  [REPORT_KEYS.TEST_ANSWER_KEY]: answerKey,
};
