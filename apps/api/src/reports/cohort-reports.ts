/**
 * The reports about many students at once. A sitting counts in a period by when it was handed in,
 * and its percentile is its standing in its own test's whole cohort — a branch's average is not
 * recounted among the branch.
 */
import { type Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  REPORT_INACTIVE_DAYS_DEFAULT,
  REPORT_KEYS,
  REPORT_TOP_DEFAULT,
  TEST_STATUS,
  type ReportQueryOf,
} from '@iace/contracts';
import { COHORT_WHERE } from '../attempts';
import {
  EXPORT_DATE_FORMATS,
  assertExportable,
  exportInstant,
  type ExportColumn,
} from '../common/exporting';
import { STUDENT_CARD_SELECT, type StudentCard } from '../students';
import { aboutPeriod, elapsed, periodBefore, periodOf, type Period } from './period';
import { type ReportBuilder, type ReportSources } from './report';
import { groupBy, highestOf, meanOf, percentOf } from './report-figures';
import {
  ENROLLED,
  NO_BRANCH,
  STUDENT_COLUMNS,
  aboutBranch,
  cardsOf,
  studentColumns,
} from './report-people';
import { subjectSheet } from './report-subjects';

type PeriodBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.PERFORMANCE_BY_BRANCH>>;
type OpenBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.INACTIVE_STUDENTS>>;

const DAY_MS = 86_400_000;

const MEMBER_SELECT = {
  ...STUDENT_CARD_SELECT,
  enrolledExams: true,
} as const satisfies Prisma.StudentSelect;

type Member = Prisma.StudentGetPayload<{ select: typeof MEMBER_SELECT }>;

interface Sitting {
  id: string;
  testId: string;
  student: Member;
  correct: number;
  wrong: number;
  sectionScores: unknown;
  percentile: number;
}

const inBranch = (branchId: string | undefined): Prisma.AttemptWhereInput =>
  branchId === undefined ? {} : { student: { currentBranchId: branchId } };

/** The period's ranked sittings, each at its standing in its own test's cohort. */
async function rankedIn(
  { prisma, leaderboard }: ReportSources,
  period: Period,
  branchId?: string,
): Promise<Sitting[]> {
  const where = { ...COHORT_WHERE, submittedAt: period.within, ...inBranch(branchId) };
  assertExportable(await prisma.attempt.count({ where }));
  const rows = await prisma.attempt.findMany({
    where,
    select: {
      id: true,
      testId: true,
      correctCount: true,
      wrongCount: true,
      sectionScores: true,
      student: { select: MEMBER_SELECT },
    },
  });
  const standings = await leaderboard.standingsOfTests(
    [...new Set(rows.map((row) => row.testId))],
    period.within,
  );
  return rows.flatMap((row) => {
    const standing = standings.get(row.id);
    if (!standing) return [];
    return [
      {
        id: row.id,
        testId: row.testId,
        student: row.student,
        correct: row.correctCount ?? 0,
        wrong: row.wrongCount ?? 0,
        sectionScores: row.sectionScores,
        percentile: standing.percentile,
      },
    ];
  });
}

const accuracyOf = (sittings: readonly Sitting[]): number | null => {
  const correct = sittings.reduce((sum, sitting) => sum + sitting.correct, 0);
  return percentOf(correct, correct + sittings.reduce((sum, sitting) => sum + sitting.wrong, 0));
};

const percentilesOf = (sittings: readonly Sitting[]): number[] =>
  sittings.map((sitting) => sitting.percentile);

/** How students are gathered for a comparison; one enrolled on two programs counts under both. */
interface Dimension {
  label: string;
  keysOf: (member: Pick<Member, 'currentBranch' | 'programs' | 'enrolledExams'>) => string[];
}

const orNone = (keys: readonly string[], none: string): string[] =>
  keys.length === 0 ? [none] : [...keys];

const BY_BRANCH: Dimension = {
  label: 'Branch',
  keysOf: (member) => [member.currentBranch?.name ?? NO_BRANCH],
};
const BY_PROGRAM: Dimension = {
  label: 'Program',
  keysOf: (member) => orNone(member.programs, 'No program'),
};
const BY_EXAM: Dimension = {
  label: 'Exam',
  keysOf: (member) => orNone(member.enrolledExams, 'No exam'),
};

interface GroupRow {
  key: string;
  enrolled: number;
  sittings: Sitting[];
}

const sitters = (row: GroupRow): number =>
  new Set(row.sittings.map((sitting) => sitting.student.id)).size;

const groupColumns = (label: string): ExportColumn<GroupRow>[] => [
  { header: label, width: 26, value: (row) => row.key },
  { header: 'Students', width: 10, value: (row) => row.enrolled },
  { header: 'Students who sat', width: 16, value: sitters },
  { header: 'Participation (%)', width: 16, value: (row) => percentOf(sitters(row), row.enrolled) },
  { header: 'Ranked sittings', width: 15, value: (row) => row.sittings.length },
  { header: 'Average percentile', width: 18, value: (row) => meanOf(percentilesOf(row.sittings)) },
  { header: 'Accuracy (%)', width: 13, value: (row) => accuracyOf(row.sittings) },
];

/** Every group that has a student or a sitting, best average first. */
const performanceBy =
  (dimension: Dimension): PeriodBuilder =>
  async (sources, query) => {
    const period = periodOf(query);
    const [sittings, enrolled] = await Promise.all([
      rankedIn(sources, period),
      sources.prisma.student.findMany({
        where: ENROLLED,
        select: { currentBranch: { select: { name: true } }, programs: true, enrolledExams: true },
      }),
    ]);
    const enrolledIn = new Map<string, number>();
    for (const member of enrolled) {
      for (const key of dimension.keysOf(member))
        enrolledIn.set(key, (enrolledIn.get(key) ?? 0) + 1);
    }
    const satIn = new Map<string, Sitting[]>();
    for (const sitting of sittings) {
      for (const key of dimension.keysOf(sitting.student)) {
        const group = satIn.get(key);
        if (group) group.push(sitting);
        else satIn.set(key, [sitting]);
      }
    }
    const rows = [...new Set([...enrolledIn.keys(), ...satIn.keys()])]
      .map((key) => ({ key, enrolled: enrolledIn.get(key) ?? 0, sittings: satIn.get(key) ?? [] }))
      .sort(
        (a, b) =>
          (meanOf(percentilesOf(b.sittings)) ?? -1) - (meanOf(percentilesOf(a.sittings)) ?? -1) ||
          a.key.localeCompare(b.key),
      );
    return {
      about: [aboutPeriod(period)],
      figures: [
        { label: 'Ranked sittings', value: sittings.length },
        {
          label: 'Students who sat',
          value: new Set(sittings.map((sitting) => sitting.student.id)).size,
        },
      ],
      sheets: [
        { name: `${dimension.label} performance`, columns: groupColumns(dimension.label), rows },
      ],
    };
  };

interface Standing {
  student: Member;
  percentiles: number[];
}

/** One row a student: every ranked sitting of theirs in the period. */
function standingsOf(sittings: readonly Sitting[]): Map<string, Standing> {
  const standings = new Map<string, Standing>();
  for (const { student, percentile } of sittings) {
    const standing = standings.get(student.id) ?? { student, percentiles: [] };
    standing.percentiles.push(percentile);
    standings.set(student.id, standing);
  }
  return standings;
}

const averageOf = (standing: Standing): number => meanOf(standing.percentiles) ?? 0;

interface Placed extends Standing {
  place: number;
}

const TOP_COLUMNS: ExportColumn<Placed>[] = [
  { header: 'Place', width: 8, value: (row) => row.place },
  { header: 'Student', width: 28, value: (row) => row.student.fullName },
  { header: 'Branch', width: 20, value: (row) => row.student.currentBranch?.name ?? NO_BRANCH },
  { header: 'Tests sat', width: 10, value: (row) => row.percentiles.length },
  { header: 'Average percentile', width: 18, value: averageOf },
  { header: 'Best percentile', width: 15, value: (row) => highestOf(row.percentiles) },
];

const topPerformers: PeriodBuilder = async (sources, query) => {
  const period = periodOf(query);
  const [about, sittings] = await Promise.all([
    aboutBranch(sources.prisma, query.branchId),
    rankedIn(sources, period, query.branchId),
  ]);
  const ranked = [...standingsOf(sittings).values()].sort(
    (a, b) => averageOf(b) - averageOf(a) || b.percentiles.length - a.percentiles.length,
  );
  const rows = ranked
    .slice(0, query.top ?? REPORT_TOP_DEFAULT)
    .map((standing, at) => ({ ...standing, place: at + 1 }));
  return {
    about: [aboutPeriod(period), ...about],
    figures: [{ label: 'Students who sat', value: ranked.length }],
    sheets: [{ name: 'Top performers', columns: TOP_COLUMNS, rows }],
  };
};

interface Moved {
  student: Member;
  before: number;
  now: number;
}

const MOVED_COLUMNS: ExportColumn<Moved>[] = [
  { header: 'Student', width: 28, value: (row) => row.student.fullName },
  { header: 'Branch', width: 20, value: (row) => row.student.currentBranch?.name ?? NO_BRANCH },
  { header: 'Period before', width: 14, value: (row) => row.before },
  { header: 'This period', width: 12, value: (row) => row.now },
  { header: 'Change', width: 9, value: (row) => Math.round((row.now - row.before) * 100) / 100 },
];

/** Only students ranked in both periods: one with no earlier sitting has nothing to have moved from. */
const mostImproved: PeriodBuilder = async (sources, query) => {
  const period = periodOf(query);
  const [about, now, before] = await Promise.all([
    aboutBranch(sources.prisma, query.branchId),
    rankedIn(sources, period, query.branchId),
    rankedIn(sources, periodBefore(period), query.branchId),
  ]);
  const earlier = standingsOf(before);
  const moved = [...standingsOf(now)].flatMap(([id, standing]): Moved[] => {
    const was = earlier.get(id);
    if (!was) return [];
    return [{ student: standing.student, before: averageOf(was), now: averageOf(standing) }];
  });
  const top = query.top ?? REPORT_TOP_DEFAULT;
  const byGain = [...moved].sort((a, b) => b.now - b.before - (a.now - a.before));
  return {
    about: [aboutPeriod(period), ...about],
    figures: [{ label: 'Ranked in both periods', value: moved.length }],
    sheets: [
      {
        name: 'Most improved',
        columns: MOVED_COLUMNS,
        rows: byGain.filter((row) => row.now > row.before).slice(0, top),
      },
      {
        name: 'Fallen back',
        columns: MOVED_COLUMNS,
        rows: byGain
          .filter((row) => row.now < row.before)
          .reverse()
          .slice(0, top),
      },
    ],
  };
};

const weakSubjects: PeriodBuilder = async (sources, query) => {
  const period = periodOf(query);
  const [about, sittings] = await Promise.all([
    aboutBranch(sources.prisma, query.branchId),
    rankedIn(sources, period, query.branchId),
  ]);
  const sheet = await subjectSheet(
    sources,
    sittings.map((sitting) => sitting.sectionScores),
    true,
  );
  return {
    about: [aboutPeriod(period), ...about],
    figures: [{ label: 'Ranked sittings', value: sittings.length }],
    sheets: [sheet],
  };
};

interface TopicRow {
  subject: string;
  topic: string;
  questions: number;
  correct: number;
  wrong: number;
  skipped: number;
}

const NO_TOPIC = 'No topic';

const TOPIC_COLUMNS: ExportColumn<TopicRow>[] = [
  { header: 'Subject', width: 26, value: (row) => row.subject },
  { header: 'Topic', width: 32, value: (row) => row.topic },
  { header: 'Questions', width: 10, value: (row) => row.questions },
  { header: 'Correct', width: 9, value: (row) => row.correct },
  { header: 'Wrong', width: 9, value: (row) => row.wrong },
  { header: 'Blank', width: 9, value: (row) => row.skipped },
  {
    header: 'Got it right (%)',
    width: 16,
    value: (row) => percentOf(row.correct, row.correct + row.wrong),
  },
];

/** Off each test's own item rollup, so the figures are a test's cohort to date, not the period's alone. */
const weakTopics: PeriodBuilder = async ({ prisma }, query) => {
  const period = periodOf(query);
  const sat = await prisma.attempt.groupBy({
    by: ['testId'],
    where: { ...COHORT_WHERE, submittedAt: period.within },
  });
  const items = await prisma.testQuestionStat.findMany({
    where: { testId: { in: sat.map((row) => row.testId) } },
    select: {
      correctCount: true,
      wrongCount: true,
      skippedCount: true,
      question: { select: { subjectId: true, topicId: true } },
    },
  });
  const [subjects, topics] = await Promise.all([
    prisma.subject.findMany({ select: { id: true, name: true } }),
    prisma.topic.findMany({
      where: { id: { in: [...new Set(items.flatMap((item) => item.question.topicId ?? []))] } },
      select: { id: true, name: true },
    }),
  ]);
  const subjectName = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const topicName = new Map(topics.map((topic) => [topic.id, topic.name]));
  const rows = [...groupBy(items, (item) => `${item.question.subjectId}/${item.question.topicId}`)]
    .flatMap(([, held]): TopicRow[] => {
      const [first] = held;
      if (!first) return [];
      return [
        {
          subject: subjectName.get(first.question.subjectId) ?? '',
          topic: topicName.get(first.question.topicId ?? '') ?? NO_TOPIC,
          questions: held.length,
          correct: held.reduce((sum, item) => sum + item.correctCount, 0),
          wrong: held.reduce((sum, item) => sum + item.wrongCount, 0),
          skipped: held.reduce((sum, item) => sum + item.skippedCount, 0),
        },
      ];
    })
    .sort(
      (a, b) =>
        (percentOf(a.correct, a.correct + a.wrong) ?? Number.POSITIVE_INFINITY) -
          (percentOf(b.correct, b.correct + b.wrong) ?? Number.POSITIVE_INFINITY) ||
        a.topic.localeCompare(b.topic),
    );
  return {
    about: [
      aboutPeriod(period),
      { label: 'Counted over', value: 'Each test sat in the period, to date' },
    ],
    figures: [{ label: 'Tests sat', value: sat.length }],
    sheets: [{ name: 'Topics', columns: TOPIC_COLUMNS, rows }],
  };
};

interface Retaker {
  student: StudentCard;
  retakes: number;
  tests: number;
}

const RETAKE_COLUMNS: ExportColumn<Retaker>[] = [
  ...studentColumns<Retaker>((row) => row.student),
  { header: 'Retakes', width: 9, value: (row) => row.retakes },
  { header: 'Tests retaken', width: 13, value: (row) => row.tests },
];

const retakes: PeriodBuilder = async ({ prisma }, query) => {
  const period = periodOf(query);
  const where = {
    isGraded: false,
    status: ATTEMPT_STATUS.EVALUATED,
    submittedAt: period.within,
  };
  assertExportable(await prisma.attempt.count({ where }));
  const sat = await prisma.attempt.findMany({ where, select: { studentId: true, testId: true } });
  const byStudent = groupBy(sat, (sitting) => sitting.studentId);
  const cards = await cardsOf(prisma, [...byStudent.keys()]);
  const rows = cards
    .map((student) => {
      const held = byStudent.get(student.id) ?? [];
      return {
        student,
        retakes: held.length,
        tests: new Set(held.map((sitting) => sitting.testId)).size,
      };
    })
    .sort((a, b) => b.retakes - a.retakes);
  return {
    about: [aboutPeriod(period)],
    figures: [{ label: 'Retakes', value: sat.length }],
    sheets: [{ name: 'Retakes', columns: RETAKE_COLUMNS, rows }],
  };
};

interface Idle {
  student: StudentCard;
  lastAttemptAt: Date | null;
}

const idleColumns = (now: number): ExportColumn<Idle>[] => [
  ...studentColumns<Idle>((row) => row.student),
  {
    header: 'Last sitting',
    width: 18,
    date: EXPORT_DATE_FORMATS.INSTANT,
    value: (row) => exportInstant(row.lastAttemptAt),
  },
  {
    header: 'Days since',
    width: 11,
    value: (row) =>
      row.lastAttemptAt === null ? null : Math.floor((now - row.lastAttemptAt.getTime()) / DAY_MS),
  },
];

/** Read off each student's own rollup: no sitting is scanned to learn that there has been none. */
const inactive: OpenBuilder = async ({ prisma }, query) => {
  const days = query.days ?? REPORT_INACTIVE_DAYS_DEFAULT;
  const now = Date.now();
  const cutoff = new Date(now - days * DAY_MS);
  const where: Prisma.StudentWhereInput = {
    ...ENROLLED,
    ...(query.branchId === undefined ? {} : { currentBranchId: query.branchId }),
    OR: [
      { stat: null },
      { stat: { lastAttemptAt: null } },
      { stat: { lastAttemptAt: { lt: cutoff } } },
    ],
  };
  assertExportable(await prisma.student.count({ where }));
  const [about, students] = await Promise.all([
    aboutBranch(prisma, query.branchId),
    prisma.student.findMany({
      where,
      select: { ...STUDENT_CARD_SELECT, stat: { select: { lastAttemptAt: true } } },
    }),
  ]);
  // Never sat first, then the longest away.
  const rows = students
    .map(({ stat, ...student }) => ({ student, lastAttemptAt: stat?.lastAttemptAt ?? null }))
    .sort((a, b) => (a.lastAttemptAt?.getTime() ?? 0) - (b.lastAttemptAt?.getTime() ?? 0));
  return {
    about: [{ label: 'No sitting in', value: `${days} days` }, ...about],
    figures: [
      { label: 'Inactive students', value: rows.length },
      { label: 'Never sat a test', value: rows.filter((row) => row.lastAttemptAt === null).length },
    ],
    sheets: [{ name: 'Inactive students', columns: idleColumns(now), rows }],
  };
};

interface Absentee {
  student: StudentCard;
  reached: number;
  sat: number;
}

const ABSENTEE_COLUMNS: ExportColumn<Absentee>[] = [
  ...STUDENT_COLUMNS.map((column): ExportColumn<Absentee> => ({
    ...column,
    value: (row) => column.value(row.student),
  })),
  { header: 'Tests reached', width: 13, value: (row) => row.reached },
  { header: 'Sat', width: 7, value: (row) => row.sat },
  { header: 'Missed', width: 9, value: (row) => row.reached - row.sat },
];

/** Whoever a test opened in the period reaches and holds no sitting of, most missed first. */
const absentees: PeriodBuilder = async ({ prisma, access }, query) => {
  const period = periodOf(query);
  const tests = await prisma.test.findMany({
    where: { status: TEST_STATUS.ACTIVE, opensAt: elapsed(period) },
    select: { id: true, testSeriesId: true },
  });
  const onThem = { testId: { in: tests.map((test) => test.id) } };
  assertExportable(await prisma.attempt.count({ where: onThem }));
  const sat = await prisma.attempt.findMany({
    where: onThem,
    select: { testId: true, studentId: true },
  });
  const held = new Set(sat.map((sitting) => `${sitting.testId}/${sitting.studentId}`));

  const tallies = new Map<string, { reached: number; sat: number }>();
  for (const [seriesId, opened] of groupBy(tests, (test) => test.testSeriesId)) {
    for (const studentId of await access.studentsReaching(seriesId)) {
      const tally = tallies.get(studentId) ?? { reached: 0, sat: 0 };
      tally.reached += opened.length;
      tally.sat += opened.filter((test) => held.has(`${test.id}/${studentId}`)).length;
      tallies.set(studentId, tally);
    }
  }
  const missing = [...tallies].filter(([, tally]) => tally.sat < tally.reached);
  assertExportable(missing.length);
  const students = await cardsOf(
    prisma,
    missing.map(([id]) => id),
  );
  const cards = new Map(students.map((student) => [student.id, student]));
  const rows = missing
    .flatMap(([id, tally]): Absentee[] => {
      const student = cards.get(id);
      return student ? [{ student, ...tally }] : [];
    })
    .sort(
      (a, b) =>
        b.reached - b.sat - (a.reached - a.sat) ||
        (a.student.fullName ?? '').localeCompare(b.student.fullName ?? ''),
    );
  return {
    about: [aboutPeriod(period)],
    figures: [
      { label: 'Tests opened', value: tests.length },
      { label: 'Students reached', value: tallies.size },
      { label: 'Missed every test', value: rows.filter((row) => row.sat === 0).length },
    ],
    sheets: [{ name: 'Absentees', columns: ABSENTEE_COLUMNS, rows }],
  };
};

export const COHORT_REPORTS = {
  [REPORT_KEYS.PERFORMANCE_BY_BRANCH]: performanceBy(BY_BRANCH),
  [REPORT_KEYS.PERFORMANCE_BY_PROGRAM]: performanceBy(BY_PROGRAM),
  [REPORT_KEYS.PERFORMANCE_BY_EXAM]: performanceBy(BY_EXAM),
  [REPORT_KEYS.INACTIVE_STUDENTS]: inactive,
  [REPORT_KEYS.ABSENTEES]: absentees,
  [REPORT_KEYS.TOP_PERFORMERS]: topPerformers,
  [REPORT_KEYS.MOST_IMPROVED]: mostImproved,
  [REPORT_KEYS.WEAK_SUBJECTS]: weakSubjects,
  [REPORT_KEYS.WEAK_TOPICS]: weakTopics,
  [REPORT_KEYS.RETAKES]: retakes,
};
