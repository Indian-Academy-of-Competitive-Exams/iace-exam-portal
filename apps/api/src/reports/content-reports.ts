/**
 * The reports about the paper before anyone sits it: where each section's typing and reading stand,
 * what is late, who did how much, and what the bank holds. Every figure here is a count of rows
 * that already carry their own timestamp — nothing is inferred from time on screen.
 */
import {
  ASSIGNMENT_ROLES,
  AppException,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  QUESTION_STATUS,
  REPORT_KEYS,
  REPORT_TOP_DEFAULT,
  SEND_BACK_REASONS,
  type AssignmentRole,
  type DifficultyLevel,
  type LocalizedContent,
  type ReportQueryOf,
  type SendBackReason,
} from '@iace/contracts';
import { OWED_WHERE } from '../assignments';
import { EXPORT_DATE_FORMATS, exportInstant, type ExportColumn } from '../common/exporting';
import { stemPreviewOf } from '../questions';
import { aboutPeriod, periodOf } from './period';
import { type ReportBuilder } from './report';
import { groupBy } from './report-figures';
import { adminNames } from './report-people';

type OpenBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.BANK_INVENTORY>>;
type PeriodBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.STAFF_OUTPUT>>;
type TestBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.AUTHORING_PROGRESS>>;

const DAY_MS = 86_400_000;
const UNTITLED = 'Untitled test';

const ROLE_LABELS = {
  [ASSIGNMENT_ROLES.TYPIST]: 'Typist',
  [ASSIGNMENT_ROLES.PROOFREADER]: 'Proof-reader',
} as const satisfies Record<AssignmentRole, string>;

const REASON_LABELS = {
  [SEND_BACK_REASONS.SPELLING]: 'Spelling',
  [SEND_BACK_REASONS.DATA_CORRECTION]: 'Data correction',
  [SEND_BACK_REASONS.ANSWER_OPTION]: 'Answer or option',
} as const satisfies Record<SendBackReason, string>;

const DIFFICULTY_LABELS = {
  [DIFFICULTY_LEVEL.LOW]: 'Low',
  [DIFFICULTY_LEVEL.MEDIUM]: 'Medium',
  [DIFFICULTY_LEVEL.HIGH]: 'High',
} as const satisfies Record<DifficultyLevel, string>;

const instant = <Row>(header: string, of: (row: Row) => Date | null): ExportColumn<Row> => ({
  header,
  width: 18,
  date: EXPORT_DATE_FORMATS.INSTANT,
  value: (row) => exportInstant(of(row)),
});

interface Seat {
  assignee: string;
  dueAt: Date | null;
  finalizedAt: Date | null;
  handedAt: Date | null;
}

interface SectionProgress {
  name: string;
  order: number;
  needed: number;
  onPaper: number;
  checked: number;
  sentBack: number;
  typist?: Seat;
  reader?: Seat;
}

const PROGRESS_COLUMNS: ExportColumn<SectionProgress>[] = [
  { header: 'Section', width: 28, value: (row) => row.name },
  { header: 'Questions', width: 10, value: (row) => row.onPaper },
  { header: 'Needed', width: 8, value: (row) => row.needed },
  { header: 'Typist', width: 22, value: (row) => row.typist?.assignee ?? null },
  instant('Typing due', (row) => row.typist?.dueAt ?? null),
  instant('Typed', (row) => row.typist?.finalizedAt ?? null),
  { header: 'Proof-reader', width: 22, value: (row) => row.reader?.assignee ?? null },
  instant('Reading due', (row) => row.reader?.dueAt ?? null),
  instant('Read', (row) => row.reader?.finalizedAt ?? null),
  { header: 'Checked', width: 9, value: (row) => row.checked },
  { header: 'Sent back, open', width: 15, value: (row) => row.sentBack },
];

/** One row a section, its two seats side by side; a seat somebody was taken off is not its holder. */
const authoringProgress: TestBuilder = async ({ prisma }, { testId }) => {
  const test = await prisma.test.findUnique({
    where: { id: testId },
    select: { title: true, testSeries: { select: { name: true } } },
  });
  if (test === null) throw new AppException(ErrorCodes.NOT_FOUND, 'That test does not exist');

  const [assignments, onPaper, reviews] = await Promise.all([
    prisma.questionAssignment.findMany({
      where: { testId, replacedAt: null },
      select: {
        role: true,
        dueAt: true,
        finalizedAt: true,
        handedAt: true,
        assignee: { select: { fullName: true, email: true } },
        baseConfigSection: { select: { id: true, name: true, order: true, questionCount: true } },
      },
    }),
    prisma.paperQuestion.groupBy({ by: ['baseConfigSectionId'], where: { testId }, _count: true }),
    prisma.questionReview.findMany({
      where: { testId },
      select: { baseConfigSectionId: true, checkedAt: true, sentBackAt: true, fixedAt: true },
    }),
  ]);
  const paperIn = new Map(onPaper.map((row) => [row.baseConfigSectionId, row._count]));
  const reviewsIn = groupBy(reviews, (review) => review.baseConfigSectionId);

  const rows = [...groupBy(assignments, (assignment) => assignment.baseConfigSection.id)]
    .flatMap(([sectionId, held]): SectionProgress[] => {
      const [first] = held;
      if (!first) return [];
      const seatOf = (role: AssignmentRole): Seat | undefined => {
        const seat = held.find((assignment) => assignment.role === role);
        return seat && { ...seat, assignee: seat.assignee.fullName ?? seat.assignee.email };
      };
      const read = reviewsIn.get(sectionId) ?? [];
      return [
        {
          name: first.baseConfigSection.name,
          order: first.baseConfigSection.order,
          needed: first.baseConfigSection.questionCount,
          onPaper: paperIn.get(sectionId) ?? 0,
          checked: read.filter((review) => review.checkedAt !== null).length,
          sentBack: read.filter((review) => review.sentBackAt !== null && review.fixedAt === null)
            .length,
          typist: seatOf(ASSIGNMENT_ROLES.TYPIST),
          reader: seatOf(ASSIGNMENT_ROLES.PROOFREADER),
        },
      ];
    })
    .sort((a, b) => a.order - b.order);

  return {
    about: [
      { label: 'Test', value: test.title ?? UNTITLED },
      { label: 'Series', value: test.testSeries.name },
    ],
    figures: [
      { label: 'Sections assigned', value: rows.length },
      { label: 'Typed', value: rows.filter((row) => row.typist?.finalizedAt).length },
      { label: 'Read', value: rows.filter((row) => row.reader?.finalizedAt).length },
    ],
    sheets: [{ name: 'Sections', columns: PROGRESS_COLUMNS, rows }],
  };
};

interface Overdue {
  test: string;
  section: string;
  role: AssignmentRole;
  assignee: string;
  dueAt: Date;
}

const overdueColumns = (now: number): ExportColumn<Overdue>[] => [
  { header: 'Test', width: 34, value: (row) => row.test },
  { header: 'Section', width: 26, value: (row) => row.section },
  { header: 'Role', width: 13, value: (row) => ROLE_LABELS[row.role] },
  { header: 'Held by', width: 24, value: (row) => row.assignee },
  instant('Due', (row) => row.dueAt),
  {
    header: 'Days late',
    width: 10,
    value: (row) => Math.floor((now - row.dueAt.getTime()) / DAY_MS),
  },
];

/** Outstanding, still its holder's, and past its day: the longest late first. */
const overdueAssignments: OpenBuilder = async ({ prisma }) => {
  const now = new Date();
  const late = await prisma.questionAssignment.findMany({
    where: { ...OWED_WHERE, dueAt: { lt: now } },
    orderBy: { dueAt: 'asc' },
    select: {
      role: true,
      dueAt: true,
      assignee: { select: { fullName: true, email: true } },
      baseConfigSection: { select: { name: true } },
      test: { select: { title: true } },
    },
  });
  const rows = late.flatMap((assignment): Overdue[] =>
    assignment.dueAt === null
      ? []
      : [
          {
            test: assignment.test.title ?? UNTITLED,
            section: assignment.baseConfigSection.name,
            role: assignment.role,
            assignee: assignment.assignee.fullName ?? assignment.assignee.email,
            dueAt: assignment.dueAt,
          },
        ],
  );
  return {
    about: [],
    figures: [{ label: 'Overdue', value: rows.length }],
    sheets: [{ name: 'Overdue', columns: overdueColumns(now.getTime()), rows }],
  };
};

const OUTPUT = {
  TYPED: 'Questions typed',
  SECTIONS_TYPED: 'Sections typed',
  SECTIONS_READ: 'Sections read',
  CHECKED: 'Questions checked',
  SENT_BACK: 'Sent back',
  FIXED: 'Fixed',
} as const;
type Output = (typeof OUTPUT)[keyof typeof OUTPUT];

interface StaffRow {
  name: string;
  counts: Partial<Record<Output, number>>;
}

const STAFF_COLUMNS: ExportColumn<StaffRow>[] = [
  { header: 'Admin', width: 26, value: (row) => row.name },
  ...Object.values(OUTPUT).map((output): ExportColumn<StaffRow> => ({
    header: output,
    width: 16,
    value: (row) => row.counts[output] ?? 0,
  })),
];

/** Each column is a count of rows stamped in the period by that person; nobody is listed for nothing. */
const staffOutput: PeriodBuilder = async ({ prisma }, query) => {
  const period = periodOf(query);
  const within = period.within;
  const sections = (role: AssignmentRole) =>
    prisma.questionAssignment.groupBy({
      by: ['assigneeId'],
      where: { role, finalizedAt: within },
      _count: true,
    });
  const [typed, sectionsTyped, sectionsRead, checked, sentBack, fixed] = await Promise.all([
    prisma.question.groupBy({ by: ['createdById'], where: { createdAt: within }, _count: true }),
    sections(ASSIGNMENT_ROLES.TYPIST),
    sections(ASSIGNMENT_ROLES.PROOFREADER),
    prisma.questionReview.groupBy({
      by: ['checkedById'],
      where: { checkedAt: within },
      _count: true,
    }),
    prisma.questionReview.groupBy({
      by: ['sentBackById'],
      where: { sentBackAt: within },
      _count: true,
    }),
    prisma.questionReview.groupBy({ by: ['fixedById'], where: { fixedAt: within }, _count: true }),
  ]);

  const tallies = new Map<string, Partial<Record<Output, number>>>();
  const count = (output: Output, rows: readonly { id: string | null; n: number }[]) => {
    for (const { id, n } of rows) {
      if (id === null) continue;
      tallies.set(id, { ...tallies.get(id), [output]: n });
    }
  };
  count(
    OUTPUT.TYPED,
    typed.map((row) => ({ id: row.createdById, n: row._count })),
  );
  count(
    OUTPUT.SECTIONS_TYPED,
    sectionsTyped.map((row) => ({ id: row.assigneeId, n: row._count })),
  );
  count(
    OUTPUT.SECTIONS_READ,
    sectionsRead.map((row) => ({ id: row.assigneeId, n: row._count })),
  );
  count(
    OUTPUT.CHECKED,
    checked.map((row) => ({ id: row.checkedById, n: row._count })),
  );
  count(
    OUTPUT.SENT_BACK,
    sentBack.map((row) => ({ id: row.sentBackById, n: row._count })),
  );
  count(
    OUTPUT.FIXED,
    fixed.map((row) => ({ id: row.fixedById, n: row._count })),
  );

  const names = await adminNames(prisma, [...tallies.keys()]);
  const rows = [...tallies]
    .map(([id, counts]) => ({ name: names.get(id) ?? 'Removed admin', counts }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    about: [aboutPeriod(period)],
    figures: [{ label: 'Admins', value: rows.length }],
    sheets: [{ name: 'Staff output', columns: STAFF_COLUMNS, rows }],
  };
};

interface SentBackRow {
  typist: string;
  reasons: SendBackReason[];
  fixed: number;
}

const SENT_BACK_COLUMNS: ExportColumn<SentBackRow>[] = [
  { header: 'Typist', width: 26, value: (row) => row.typist },
  ...Object.values(SEND_BACK_REASONS).map((reason): ExportColumn<SentBackRow> => ({
    header: REASON_LABELS[reason],
    width: 16,
    value: (row) => row.reasons.filter((held) => held === reason).length,
  })),
  { header: 'Sent back', width: 10, value: (row) => row.reasons.length },
  { header: 'Fixed', width: 8, value: (row) => row.fixed },
];

/** By whoever wrote the question, which is who a send-back is addressed to. */
const sendBacks: PeriodBuilder = async ({ prisma }, query) => {
  const period = periodOf(query);
  const sent = await prisma.questionReview.findMany({
    where: { sentBackAt: period.within },
    select: { reason: true, fixedAt: true, question: { select: { createdById: true } } },
  });
  const names = await adminNames(
    prisma,
    sent.map((review) => review.question.createdById),
  );
  const rows = [...groupBy(sent, (review) => review.question.createdById)]
    .map(([id, held]) => ({
      typist: (id && names.get(id)) ?? 'Unknown author',
      reasons: held.flatMap((review) => review.reason ?? []),
      fixed: held.filter((review) => review.fixedAt !== null).length,
    }))
    .sort((a, b) => b.reasons.length - a.reasons.length);
  return {
    about: [aboutPeriod(period)],
    figures: [
      { label: 'Sent back', value: sent.length },
      { label: 'Fixed', value: sent.filter((review) => review.fixedAt !== null).length },
    ],
    sheets: [{ name: 'Send-backs', columns: SENT_BACK_COLUMNS, rows }],
  };
};

interface Shelf {
  subject: string;
  active: number;
  archived: number;
  byDifficulty: Partial<Record<DifficultyLevel, number>>;
}

const SHELF_COLUMNS: ExportColumn<Shelf>[] = [
  { header: 'Subject', width: 30, value: (row) => row.subject },
  { header: 'Active', width: 9, value: (row) => row.active },
  ...Object.values(DIFFICULTY_LEVEL).map((level): ExportColumn<Shelf> => ({
    header: DIFFICULTY_LABELS[level],
    width: 9,
    value: (row) => row.byDifficulty[level] ?? 0,
  })),
  { header: 'Archived', width: 10, value: (row) => row.archived },
];

interface TopicShelf {
  subject: string;
  topic: string;
  questions: number;
}

const NO_TOPIC = 'No topic';

const TOPIC_SHELF_COLUMNS: ExportColumn<TopicShelf>[] = [
  { header: 'Subject', width: 30, value: (row) => row.subject },
  { header: 'Topic', width: 34, value: (row) => row.topic },
  { header: 'Active questions', width: 16, value: (row) => row.questions },
];

const totalOf = (rows: readonly { _count: number }[]): number =>
  rows.reduce((sum, row) => sum + row._count, 0);

/** What a paper can be drawn from: a subject's difficulty split counts its active questions only. */
const bankInventory: OpenBuilder = async ({ prisma }) => {
  const [counted, byTopic, subjects, topics] = await Promise.all([
    prisma.question.groupBy({ by: ['subjectId', 'status', 'difficulty'], _count: true }),
    prisma.question.groupBy({
      by: ['subjectId', 'topicId'],
      where: { status: QUESTION_STATUS.ACTIVE },
      _count: true,
    }),
    prisma.subject.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.topic.findMany({ select: { id: true, name: true } }),
  ]);
  const held = groupBy(counted, (row) => row.subjectId);
  const shelves = subjects.map((subject): Shelf => {
    const rows = held.get(subject.id) ?? [];
    const active = rows.filter((row) => row.status === QUESTION_STATUS.ACTIVE);
    const activeCount = totalOf(active);
    const byDifficulty: Partial<Record<DifficultyLevel, number>> = {};
    for (const row of active) byDifficulty[row.difficulty] = row._count;
    return {
      subject: subject.name,
      active: activeCount,
      archived: totalOf(rows) - activeCount,
      byDifficulty,
    };
  });
  const subjectName = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const topicName = new Map(topics.map((topic) => [topic.id, topic.name]));
  const topicRows = byTopic
    .map((row) => ({
      subject: subjectName.get(row.subjectId) ?? '',
      topic: (row.topicId && topicName.get(row.topicId)) ?? NO_TOPIC,
      questions: row._count,
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic));
  return {
    about: [],
    figures: [
      { label: 'Active questions', value: shelves.reduce((sum, row) => sum + row.active, 0) },
    ],
    sheets: [
      { name: 'Subjects', columns: SHELF_COLUMNS, rows: shelves },
      { name: 'Topics', columns: TOPIC_SHELF_COLUMNS, rows: topicRows },
    ],
  };
};

interface Usage {
  subject: string;
  active: number;
  used: number;
}

const USAGE_COLUMNS: ExportColumn<Usage>[] = [
  { header: 'Subject', width: 30, value: (row) => row.subject },
  { header: 'Active questions', width: 16, value: (row) => row.active },
  { header: 'Used on a paper', width: 16, value: (row) => row.used },
  { header: 'Never used', width: 11, value: (row) => row.active - row.used },
];

interface Used {
  code: string | null;
  subject: string;
  stem: string;
  papers: number;
}

const USED_COLUMNS: ExportColumn<Used>[] = [
  { header: 'Code', width: 14, text: true, value: (row) => row.code },
  { header: 'Subject', width: 24, value: (row) => row.subject },
  { header: 'Question', width: 60, value: (row) => row.stem },
  { header: 'Papers', width: 8, value: (row) => row.papers },
];

/** In use is derived from the papers themselves; no counter on a question says it. */
const questionUsage: OpenBuilder = async ({ prisma }, { top = REPORT_TOP_DEFAULT }) => {
  const active = { status: QUESTION_STATUS.ACTIVE };
  const [all, used, most, subjects] = await Promise.all([
    prisma.question.groupBy({ by: ['subjectId'], where: active, _count: true }),
    prisma.question.groupBy({
      by: ['subjectId'],
      where: { ...active, paperQuestions: { some: {} } },
      _count: true,
    }),
    prisma.paperQuestion.groupBy({
      by: ['questionId'],
      _count: true,
      orderBy: [{ _count: { questionId: 'desc' } }, { questionId: 'asc' }],
      take: top,
    }),
    prisma.subject.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const questions = await prisma.question.findMany({
    where: { id: { in: most.map((row) => row.questionId) } },
    select: {
      id: true,
      questionCode: true,
      subjectId: true,
      currentVersion: { select: { content: true } },
    },
  });
  const allIn = new Map(all.map((row) => [row.subjectId, row._count]));
  const usedIn = new Map(used.map((row) => [row.subjectId, row._count]));
  const subjectName = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const byId = new Map(questions.map((question) => [question.id, question]));
  const usage = subjects.map((subject) => ({
    subject: subject.name,
    active: allIn.get(subject.id) ?? 0,
    used: usedIn.get(subject.id) ?? 0,
  }));
  const mostUsed = most.flatMap((row): Used[] => {
    const question = byId.get(row.questionId);
    if (!question) return [];
    const content = (question.currentVersion?.content as LocalizedContent | null) ?? {};
    return [
      {
        code: question.questionCode,
        subject: subjectName.get(question.subjectId) ?? '',
        stem: stemPreviewOf(content),
        papers: row._count,
      },
    ];
  });
  return {
    about: [],
    figures: [
      { label: 'Active questions', value: usage.reduce((sum, row) => sum + row.active, 0) },
      { label: 'Never used', value: usage.reduce((sum, row) => sum + row.active - row.used, 0) },
    ],
    sheets: [
      { name: 'Subjects', columns: USAGE_COLUMNS, rows: usage },
      { name: 'Most used', columns: USED_COLUMNS, rows: mostUsed },
    ],
  };
};

export const CONTENT_REPORTS = {
  [REPORT_KEYS.AUTHORING_PROGRESS]: authoringProgress,
  [REPORT_KEYS.OVERDUE_ASSIGNMENTS]: overdueAssignments,
  [REPORT_KEYS.STAFF_OUTPUT]: staffOutput,
  [REPORT_KEYS.SEND_BACKS]: sendBacks,
  [REPORT_KEYS.BANK_INVENTORY]: bankInventory,
  [REPORT_KEYS.QUESTION_USAGE]: questionUsage,
};
