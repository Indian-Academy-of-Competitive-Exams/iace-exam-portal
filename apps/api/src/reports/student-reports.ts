/**
 * The reports about one student. A sitting's card, a paper's marks, a standing and the lifetime
 * rollups are each read from `attempts`, which owns them, so a page handed to a parent says what
 * the student's own screen says.
 */
import {
  AppException,
  ATTEMPT_STATUS,
  ErrorCodes,
  REPORT_KEYS,
  REPORT_LETTERHEAD,
  TEST_STATUS,
  instituteDateTimeLabel,
  measureOf,
  type ReportFact,
  type ReportQueryOf,
} from '@iace/contracts';
import { questionTalliesOf, sectionScoresIn } from '../attempts';
import {
  EXPORT_DATE_FORMATS,
  exportInstant,
  type ExportColumn,
  type ExportSheet,
} from '../common/exporting';
import { aboutPeriod, periodBefore, periodOf, type Period } from './period';
import { type Report, type ReportBuilder, type ReportSources } from './report';
import { groupBy, highestOf, meanOf, minutesOf, percentOf } from './report-figures';
import { branchOf, cardsOf } from './report-people';
import { TEST_NAME, TEST_OPENED, TEST_SERIES, testRowsOf } from './report-tests';

type StudentBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.STUDENT_CUMULATIVE>>;
type StudentPeriodBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.STUDENT_WEEKLY>>;
type ScoreCardBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.STUDENT_SCORE_CARD>>;

const UNTITLED = 'Untitled test';
const NOT_RANKED = 'Not ranked';

interface Who {
  name: string;
  about: ReportFact[];
}

async function whoIs({ prisma }: ReportSources, studentId: string): Promise<Who> {
  const [student] = await cardsOf(prisma, [studentId]);
  if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'That student does not exist');
  const name = student.fullName ?? student.mobile;
  return {
    name,
    about: [
      { label: 'Student', value: name },
      { label: 'Mobile', value: student.mobile },
      { label: 'Branch', value: branchOf(student) },
    ],
  };
}

interface Sitting {
  id: string;
  testId: string;
  title: string;
  attemptNo: number;
  isGraded: boolean;
  submittedAt: Date | null;
  score: number;
  maxMarks: number;
  correct: number;
  wrong: number;
  blank: number;
  timeTakenSec: number | null;
  sectionScores: unknown;
  rank: number | null;
  percentile: number | null;
  cohortSize: number | null;
}

/** A student's marked sittings, oldest first, each at the standing its cohort gives it now. */
async function sittingsOf(
  { prisma, leaderboard, attemptReport }: ReportSources,
  studentId: string,
  period?: Period,
): Promise<Sitting[]> {
  const rows = await prisma.attempt.findMany({
    where: {
      studentId,
      status: ATTEMPT_STATUS.EVALUATED,
      ...(period ? { submittedAt: period.within } : {}),
    },
    orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      testId: true,
      attemptNo: true,
      isGraded: true,
      submittedAt: true,
      score: true,
      correctCount: true,
      wrongCount: true,
      unattemptedCount: true,
      timeTakenSec: true,
      sectionScores: true,
      test: { select: { title: true } },
    },
  });
  const [standings, marks] = await Promise.all([
    leaderboard.standingsOf(rows.map((row) => row.id)),
    attemptReport.paperMarks([...new Set(rows.map((row) => row.testId))]),
  ]);
  return rows.map((row) => {
    const standing = standings.get(row.id);
    return {
      id: row.id,
      testId: row.testId,
      title: row.test.title ?? UNTITLED,
      attemptNo: row.attemptNo,
      isGraded: row.isGraded,
      submittedAt: row.submittedAt,
      score: Number(row.score ?? 0),
      maxMarks: marks.get(row.testId) ?? 0,
      correct: row.correctCount ?? 0,
      wrong: row.wrongCount ?? 0,
      blank: row.unattemptedCount ?? 0,
      timeTakenSec: row.timeTakenSec,
      sectionScores: row.sectionScores,
      rank: standing?.rank ?? null,
      percentile: standing?.percentile ?? null,
      cohortSize: standing?.cohortSize ?? null,
    };
  });
}

const SITTING_COLUMNS: ExportColumn<Sitting>[] = [
  {
    header: 'Handed in',
    width: 18,
    date: EXPORT_DATE_FORMATS.INSTANT,
    value: (row) => exportInstant(row.submittedAt),
  },
  { header: 'Test', width: 36, value: (row) => row.title },
  { header: 'Attempt no', width: 11, fileOnly: true, value: (row) => row.attemptNo },
  { header: 'Score', width: 9, value: (row) => row.score },
  { header: 'Out of', width: 8, value: (row) => row.maxMarks },
  { header: 'Correct', width: 9, value: (row) => row.correct },
  { header: 'Wrong', width: 9, value: (row) => row.wrong },
  { header: 'Blank', width: 9, value: (row) => row.blank },
  { header: 'Time (min)', width: 11, value: (row) => minutesOf(row.timeTakenSec) },
  { header: 'Rank', width: 8, value: (row) => row.rank },
  { header: 'Ranked sittings', width: 15, value: (row) => row.cohortSize },
  { header: 'Percentile', width: 11, value: (row) => row.percentile },
];

const percentilesOf = (sittings: readonly Sitting[]): number[] =>
  sittings.flatMap((sitting) => (sitting.percentile === null ? [] : [sitting.percentile]));

const sumOf = (sittings: readonly Sitting[], of: (sitting: Sitting) => number): number =>
  sittings.reduce((sum, sitting) => sum + of(sitting), 0);

const accuracyOf = (sittings: readonly Sitting[]): number | null => {
  const correct = sumOf(sittings, (sitting) => sitting.correct);
  return percentOf(correct, correct + sumOf(sittings, (sitting) => sitting.wrong));
};

interface SubjectRow {
  subject: string;
  correct: number;
  wrong: number;
  blank: number;
  timeSpentSec: number;
}

const SUBJECT_COLUMNS: ExportColumn<SubjectRow>[] = [
  { header: 'Subject', width: 30, value: (row) => row.subject },
  { header: 'Correct', width: 9, value: (row) => row.correct },
  { header: 'Wrong', width: 9, value: (row) => row.wrong },
  { header: 'Blank', width: 9, value: (row) => row.blank },
  {
    header: 'Accuracy (%)',
    width: 13,
    value: (row) => percentOf(row.correct, row.correct + row.wrong),
  },
  { header: 'Time (min)', width: 11, value: (row) => minutesOf(row.timeSpentSec) },
];

/** Summed off each sitting's own section scores; a section filed under no subject reads by its name. */
async function subjectsOf(
  { prisma }: ReportSources,
  sittings: readonly Sitting[],
): Promise<ExportSheet<SubjectRow>> {
  const scores = sittings.flatMap((sitting) => sectionScoresIn(sitting.sectionScores) ?? []);
  const sections = await prisma.baseConfigSection.findMany({
    where: { id: { in: [...new Set(scores.map((score) => score.baseConfigSectionId))] } },
    select: { id: true, name: true, subject: { select: { name: true } } },
  });
  const subjectOf = new Map(
    sections.map((section) => [section.id, section.subject?.name ?? section.name]),
  );
  const rows = [...groupBy(scores, (score) => subjectOf.get(score.baseConfigSectionId) ?? '')]
    .map(([subject, held]) => ({
      subject,
      correct: held.reduce((sum, score) => sum + score.correctCount, 0),
      wrong: held.reduce((sum, score) => sum + score.wrongCount, 0),
      blank: held.reduce((sum, score) => sum + score.unattemptedCount, 0),
      timeSpentSec: held.reduce((sum, score) => sum + score.timeSpentSec, 0),
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
  return { name: 'Subjects', columns: SUBJECT_COLUMNS, rows };
}

const scoreCard: ScoreCardBuilder = async (sources, { studentId, attemptId }) => {
  const who = await whoIs(sources, studentId);
  const card = await sources.performance.scoreCard(studentId, attemptId);
  const sections = [...card.sections].sort((a, b) => a.order - b.order);
  const about: ReportFact[] = [...who.about, { label: 'Test', value: card.testTitle ?? UNTITLED }];
  if (card.submittedAt) {
    about.push({ label: 'Handed in', value: instituteDateTimeLabel(card.submittedAt) });
  }

  return {
    about,
    figures: [
      { label: 'Score', value: `${card.score} / ${card.maxMarks}` },
      { label: 'Percentage', value: card.percentage },
      {
        label: 'Rank',
        value: card.rank === null ? NOT_RANKED : `${card.rank} of ${card.cohortSize}`,
      },
      { label: 'Percentile', value: card.percentile },
      { label: 'Correct', value: card.correctCount },
      { label: 'Wrong', value: card.wrongCount },
      { label: 'Blank', value: card.unattemptedCount },
      { label: 'Time taken (min)', value: minutesOf(card.timeTakenSec) },
    ],
    sheets: [
      {
        name: 'Sections',
        columns: [
          { header: 'Section', width: 30, value: (row) => row.name },
          { header: 'Score', width: 9, value: (row) => row.score },
          { header: 'Out of', width: 8, value: (row) => row.maxMarks },
          { header: 'Correct', width: 9, value: (row) => row.correctCount },
          { header: 'Wrong', width: 9, value: (row) => row.wrongCount },
          { header: 'Blank', width: 9, value: (row) => row.unattemptedCount },
          { header: 'Time (min)', width: 11, value: (row) => minutesOf(row.timeSpentSec) },
          { header: 'Cohort average', width: 15, value: (row) => row.cohortAverageScore },
        ] satisfies ExportColumn<(typeof sections)[number]>[],
        rows: sections,
      },
    ],
  };
};

/** One period of one student, set beside the period before it. */
async function periodReport(
  sources: ReportSources,
  studentId: string,
  period: Period,
): Promise<Report & { name: string }> {
  const [who, sittings, before] = await Promise.all([
    whoIs(sources, studentId),
    sittingsOf(sources, studentId, period),
    sittingsOf(sources, studentId, periodBefore(period)),
  ]);
  const percentiles = percentilesOf(sittings);
  return {
    name: who.name,
    about: [...who.about, aboutPeriod(period)],
    figures: [
      { label: 'Tests sat', value: new Set(sittings.map((sitting) => sitting.testId)).size },
      { label: 'Average percentile', value: meanOf(percentiles) },
      { label: 'Best percentile', value: highestOf(percentiles) },
      { label: 'Accuracy (%)', value: accuracyOf(sittings) },
      { label: 'Average percentile, period before', value: meanOf(percentilesOf(before)) },
    ],
    sheets: [
      { name: 'Sittings', columns: SITTING_COLUMNS, rows: sittings },
      await subjectsOf(sources, sittings),
    ],
  };
}

const periodic: StudentPeriodBuilder = async (sources, { studentId, from, to }) => {
  const { name: _name, ...report } = await periodReport(sources, studentId, periodOf({ from, to }));
  return report;
};

const SIGNATURES = 'Branch head: ________________________     Parent: ________________________';

const parentLetter: StudentPeriodBuilder = async (sources, { studentId, from, to }) => {
  const period = periodOf({ from, to });
  const { name, ...report } = await periodReport(sources, studentId, period);
  return {
    ...report,
    preface: [
      'Dear Parent,',
      `This is how ${name} did in the ${REPORT_LETTERHEAD} tests sat from ${aboutPeriod(period).value}. Each test is marked against every student who sat it, and the percentile says how many of them ${name} scored above.`,
    ],
    closing: [
      'Rank and percentile are as they stand on the date above, and move as more students sit each test.',
      SIGNATURES,
    ],
  };
};

interface SubjectStanding {
  subject: string;
  answered: number;
  correct: number;
  accuracy: number | null;
  pace: number | null;
}

const STANDING_COLUMNS: ExportColumn<SubjectStanding>[] = [
  { header: 'Subject', width: 30, value: (row) => row.subject },
  { header: 'Answered', width: 10, value: (row) => row.answered },
  { header: 'Correct', width: 9, value: (row) => row.correct },
  { header: 'Accuracy (%)', width: 13, value: (row) => row.accuracy },
  { header: 'Seconds a question', width: 18, value: (row) => row.pace },
];

const cumulative: StudentBuilder = async (sources, { studentId }) => {
  const who = await whoIs(sources, studentId);
  const [overview, sittings] = await Promise.all([
    sources.overview.overview(studentId),
    sittingsOf(sources, studentId),
  ]);
  const { standing, measure } = overview;
  const subjects = overview.subjects.map((subject) => {
    const { attempted, correct, accuracy, pace } = measureOf(subject.tallies);
    return { subject: subject.name, answered: attempted, correct, accuracy, pace };
  });
  const figures: ReportFact[] = [
    { label: 'Tests sat', value: standing.testsEvaluated },
    { label: 'Retakes', value: standing.retakeCount },
    { label: 'Average percentile', value: standing.avgPercentile },
    { label: 'Best percentile', value: standing.bestPercentile },
    { label: 'Average score', value: standing.avgScore },
    { label: 'Accuracy (%)', value: measure.accuracy },
  ];
  if (standing.lastAttemptAt) {
    figures.push({ label: 'Last sitting', value: instituteDateTimeLabel(standing.lastAttemptAt) });
  }
  return {
    about: who.about,
    figures,
    sheets: [
      { name: 'Subjects', columns: STANDING_COLUMNS, rows: subjects },
      { name: 'Sittings', columns: SITTING_COLUMNS, rows: sittings },
    ],
  };
};

interface TopicRow {
  subject: string;
  topic: string;
  questions: number;
  answered: number;
  correct: number;
  timeSpentSec: number;
}

const NO_TOPIC = 'No topic';

const TOPIC_COLUMNS: ExportColumn<TopicRow>[] = [
  { header: 'Subject', width: 26, value: (row) => row.subject },
  { header: 'Topic', width: 32, value: (row) => row.topic },
  { header: 'Questions met', width: 14, value: (row) => row.questions },
  { header: 'Answered', width: 10, value: (row) => row.answered },
  { header: 'Correct', width: 9, value: (row) => row.correct },
  { header: 'Accuracy (%)', width: 13, value: (row) => percentOf(row.correct, row.answered) },
  {
    header: 'Seconds a question',
    width: 18,
    value: (row) => (row.questions === 0 ? null : Math.round(row.timeSpentSec / row.questions)),
  },
];

/** Weakest first, so the top of the page is where the next week's work is. */
const topics: StudentBuilder = async (sources, { studentId }) => {
  const who = await whoIs(sources, studentId);
  const tallies = await questionTalliesOf(sources, studentId);
  const questions = await sources.prisma.question.findMany({
    where: { id: { in: [...tallies.keys()] } },
    select: { id: true, subjectId: true, topicId: true },
  });
  const [subjects, named] = await Promise.all([
    sources.prisma.subject.findMany({
      where: { id: { in: [...new Set(questions.map((question) => question.subjectId))] } },
      select: { id: true, name: true },
    }),
    sources.prisma.topic.findMany({
      where: {
        id: { in: questions.flatMap((question) => (question.topicId ? [question.topicId] : [])) },
      },
      select: { id: true, name: true },
    }),
  ]);
  const subjectName = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const topicName = new Map(named.map((topic) => [topic.id, topic.name]));

  const rows = [...groupBy(questions, (question) => `${question.subjectId}/${question.topicId}`)]
    .map(([, held]): TopicRow => {
      const [first] = held;
      const met = held.flatMap((question) => tallies.get(question.id) ?? []);
      return {
        subject: subjectName.get(first?.subjectId ?? '') ?? '',
        topic: topicName.get(first?.topicId ?? '') ?? NO_TOPIC,
        questions: met.reduce((sum, tally) => sum + tally.seen, 0),
        answered: met.reduce((sum, tally) => sum + tally.answered, 0),
        correct: met.reduce((sum, tally) => sum + tally.correct, 0),
        timeSpentSec: met.reduce((sum, tally) => sum + tally.timeSpentSec, 0),
      };
    })
    .sort(
      (a, b) =>
        (percentOf(a.correct, a.answered) ?? Number.POSITIVE_INFINITY) -
          (percentOf(b.correct, b.answered) ?? Number.POSITIVE_INFINITY) ||
        a.topic.localeCompare(b.topic),
    );
  return {
    about: who.about,
    figures: [{ label: 'Topics met', value: rows.length }],
    sheets: [{ name: 'Topics', columns: TOPIC_COLUMNS, rows }],
  };
};

/** Every open test of a series they reach that they hold no sitting of, a void one included. */
const missed: StudentBuilder = async (sources, { studentId }) => {
  const who = await whoIs(sources, studentId);
  const reached = (await sources.access.seriesReachedBy(studentId)) ?? [];
  const [open, sat] = await Promise.all([
    testRowsOf(sources, {
      testSeriesId: { in: reached.map((series) => series.id) },
      status: TEST_STATUS.ACTIVE,
      OR: [{ opensAt: null }, { opensAt: { lte: new Date() } }],
    }),
    sources.prisma.attempt.findMany({ where: { studentId }, select: { testId: true } }),
  ]);
  const held = new Set(sat.map((sitting) => sitting.testId));
  const rows = open.filter((test) => !held.has(test.id));
  return {
    about: who.about,
    figures: [
      { label: 'Open tests reached', value: open.length },
      { label: 'Sat', value: open.length - rows.length },
      { label: 'Missed', value: rows.length },
    ],
    sheets: [{ name: 'Tests missed', columns: [TEST_NAME, TEST_SERIES, TEST_OPENED], rows }],
  };
};

export const STUDENT_REPORTS = {
  [REPORT_KEYS.STUDENT_SCORE_CARD]: scoreCard,
  [REPORT_KEYS.STUDENT_WEEKLY]: periodic,
  [REPORT_KEYS.STUDENT_MONTHLY]: periodic,
  [REPORT_KEYS.STUDENT_CUMULATIVE]: cumulative,
  [REPORT_KEYS.STUDENT_PARENT_LETTER]: parentLetter,
  [REPORT_KEYS.STUDENT_TOPICS]: topics,
  [REPORT_KEYS.STUDENT_MISSED]: missed,
};
