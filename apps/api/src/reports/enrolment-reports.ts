/**
 * The reports about who is on the roll: the roster itself, who joined, how the headcount divides,
 * whose profile is unfinished, and the access handed out by hand. None of these reads a sitting.
 */
import { type Prisma } from '@prisma/client';
import {
  AppException,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  ErrorCodes,
  READINESS_FIELDS,
  READINESS_PROFILE_SELECT,
  REPORT_KEYS,
  STUDENT_TYPE,
  courseLabel,
  readinessOf,
  studentListQuerySchema,
  type ReadinessField,
  type ReportQueryOf,
  type StudentType,
} from '@iace/contracts';
import {
  EXPORT_DATE_FORMATS,
  assertExportable,
  exportInstant,
  type ExportColumn,
} from '../common/exporting';
import { type PrismaService } from '../prisma/prisma.service';
import { STUDENT_CARD_SELECT, studentWhere, type StudentCard } from '../students';
import { aboutPeriod, periodOf } from './period';
import { type ReportBuilder } from './report';
import { groupBy } from './report-figures';
import {
  ENROLLED,
  NO_BRANCH,
  aboutBranch,
  adminNames,
  cardsOf,
  studentColumns,
} from './report-people';

type OpenBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.STRENGTH>>;
type PeriodBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.NEW_ENROLMENTS>>;
type EventBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.EVENT_CANDIDATES>>;

const TYPE_LABELS = {
  [STUDENT_TYPE.ONLINE]: 'Online',
  [STUDENT_TYPE.OFFLINE]: 'Offline',
  [STUDENT_TYPE.NON_IACE]: 'Non-IACE',
} as const satisfies Record<StudentType, string>;

const ROLL_SELECT = {
  ...STUDENT_CARD_SELECT,
  studentType: true,
  enrolledCourses: true,
  enrolledExams: true,
  isActive: true,
  isTestBlocked: true,
  createdAt: true,
} as const satisfies Prisma.StudentSelect;

type Enrolled = Prisma.StudentGetPayload<{ select: typeof ROLL_SELECT }>;

const standingOf = (student: Pick<Enrolled, 'isActive' | 'isTestBlocked'>): string => {
  if (!student.isActive) return 'Sign-in suspended';
  return student.isTestBlocked ? 'Tests blocked' : 'Active';
};

const joined = <Row>(of: (row: Row) => Date | null, header: string): ExportColumn<Row> => ({
  header,
  width: 18,
  date: EXPORT_DATE_FORMATS.INSTANT,
  value: (row) => exportInstant(of(row)),
});

const ROLL_COLUMNS: ExportColumn<Enrolled>[] = [
  ...studentColumns<Enrolled>((row) => row),
  { header: 'Type', width: 10, value: (row) => TYPE_LABELS[row.studentType] },
  { header: 'Courses', width: 18, value: (row) => row.enrolledCourses.map(courseLabel).join(', ') },
  { header: 'Exams', width: 24, value: (row) => row.enrolledExams.join(', ') },
  { header: 'Programs', width: 24, value: (row) => row.programs.join(', ') },
  { header: 'Status', width: 18, value: standingOf },
  joined((row) => row.createdAt, 'Joined'),
];

/** The students list's own filter, so a roster printed here is the roster the screen shows. */
const rollWhere = (branchId?: string): Prisma.StudentWhereInput =>
  studentWhere(studentListQuerySchema.parse(branchId === undefined ? {} : { branchId }));

async function rollOf(prisma: PrismaService, where: Prisma.StudentWhereInput): Promise<Enrolled[]> {
  assertExportable(await prisma.student.count({ where }));
  return prisma.student.findMany({
    where,
    orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    select: ROLL_SELECT,
  });
}

const roster: OpenBuilder = async ({ prisma }, { branchId }) => {
  const [about, rows] = await Promise.all([
    aboutBranch(prisma, branchId),
    rollOf(prisma, rollWhere(branchId)),
  ]);
  return {
    about,
    figures: [{ label: 'Students', value: rows.length }],
    sheets: [{ name: 'Students', columns: ROLL_COLUMNS, rows }],
  };
};

interface Headcount {
  key: string;
  students: readonly Pick<Enrolled, 'studentType'>[];
}

const ofType = (row: Headcount, type: StudentType): number =>
  row.students.filter((student) => student.studentType === type).length;

const headcountColumns = (label: string): ExportColumn<Headcount>[] => [
  { header: label, width: 26, value: (row) => row.key },
  { header: 'Students', width: 10, value: (row) => row.students.length },
  ...Object.values(STUDENT_TYPE).map((type): ExportColumn<Headcount> => ({
    header: TYPE_LABELS[type],
    width: 10,
    value: (row) => ofType(row, type),
  })),
];

/** A student carrying several of a thing is counted under each, so a column is not a partition. */
function headcount<Row extends Pick<Enrolled, 'studentType'>>(
  students: readonly Row[],
  keysOf: (student: Row) => readonly string[],
): Headcount[] {
  const held = new Map<string, Row[]>();
  for (const student of students) {
    for (const key of keysOf(student)) held.set(key, [...(held.get(key) ?? []), student]);
  }
  return [...held]
    .map(([key, group]) => ({ key, students: group }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

const branchKey = (student: Pick<StudentCard, 'currentBranch'>): string[] => [
  student.currentBranch?.name ?? NO_BRANCH,
];

const newEnrolments: PeriodBuilder = async ({ prisma }, query) => {
  const period = periodOf(query);
  const rows = await rollOf(prisma, { deletedAt: null, createdAt: period.within });
  return {
    about: [aboutPeriod(period)],
    figures: [{ label: 'New students', value: rows.length }],
    sheets: [
      { name: 'By branch', columns: headcountColumns('Branch'), rows: headcount(rows, branchKey) },
      { name: 'Students', columns: ROLL_COLUMNS, rows },
    ],
  };
};

const strength: OpenBuilder = async ({ prisma }) => {
  const [students, suspended] = await Promise.all([
    prisma.student.findMany({ where: ENROLLED, select: ROLL_SELECT }),
    prisma.student.count({ where: { deletedAt: null, isActive: false } }),
  ]);
  const sheet = (label: string, keysOf: (student: Enrolled) => readonly string[]) => ({
    name: `By ${label.toLowerCase()}`,
    columns: headcountColumns(label),
    rows: headcount(students, keysOf),
  });
  return {
    about: [],
    figures: [
      { label: 'Students', value: students.length },
      { label: 'Sign-in suspended', value: suspended },
    ],
    sheets: [
      sheet('Branch', branchKey),
      sheet('Course', (student) => student.enrolledCourses.map(courseLabel)),
      sheet('Exam', (student) => student.enrolledExams),
      sheet('Program', (student) => student.programs),
    ],
  };
};

const FIELD_LABELS = {
  motherName: 'Mother’s name',
  fatherName: 'Father’s name',
  dob: 'Date of birth',
  photoUrl: 'Photo',
  gender: 'Gender',
} as const satisfies Record<ReadinessField, string>;

const ASKED: readonly ReadinessField[] = [
  ...new Set([...READINESS_FIELDS.preTestReady, ...READINESS_FIELDS.profileCompleted]),
];

interface Unfinished {
  student: StudentCard;
  missing: string[];
  preTestReady: boolean;
}

const UNFINISHED_COLUMNS: ExportColumn<Unfinished>[] = [
  ...studentColumns<Unfinished>((row) => row.student),
  { header: 'Ready for a test', width: 16, value: (row) => (row.preTestReady ? 'Yes' : 'No') },
  { header: 'Missing', width: 48, value: (row) => row.missing.join(', ') },
];

/** Asked of the same fields the two readiness flags read, so a row here is a prompt the student sees. */
const profileCompleteness: OpenBuilder = async ({ prisma }, { branchId }) => {
  const where = { ...ENROLLED, ...(branchId === undefined ? {} : { currentBranchId: branchId }) };
  assertExportable(await prisma.student.count({ where }));
  const [about, students] = await Promise.all([
    aboutBranch(prisma, branchId),
    prisma.student.findMany({
      where,
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      select: { ...STUDENT_CARD_SELECT, profile: { select: READINESS_PROFILE_SELECT } },
    }),
  ]);
  const rows = students.flatMap(({ profile, ...student }): Unfinished[] => {
    const held: Partial<Record<ReadinessField, unknown>> = profile ?? {};
    const lacking = ASKED.filter((field) => held[field] === null || held[field] === undefined);
    if (lacking.length === 0) return [];
    return [
      {
        student,
        missing: lacking.map((field) => FIELD_LABELS[field]),
        preTestReady: readinessOf(profile).preTestReady,
      },
    ];
  });
  return {
    about,
    figures: [
      { label: 'Students', value: students.length },
      { label: 'Profile unfinished', value: rows.length },
      { label: 'Not ready for a test', value: rows.filter((row) => !row.preTestReady).length },
    ],
    sheets: [{ name: 'Unfinished profiles', columns: UNFINISHED_COLUMNS, rows }],
  };
};

interface Stood {
  student: StudentCard;
  status: string;
  at: Date | null;
  by: string | null;
}

const STOOD_COLUMNS: ExportColumn<Stood>[] = [
  ...studentColumns<Stood>((row) => row.student),
  { header: 'Status', width: 18, value: (row) => row.status },
  joined((row) => row.at, 'Since'),
  { header: 'By', width: 24, value: (row) => row.by },
];

const STANDING_ACTIONS = [AUDIT_ACTION.DEACTIVATE, AUDIT_ACTION.BLOCK, AUDIT_ACTION.DELETE];

/** Since and By come off the audit trail, which is archived past its window: an old change reads blank. */
const studentStatus: OpenBuilder = async ({ prisma }) => {
  const students = await prisma.student.findMany({
    where: {
      anonymizedAt: null,
      OR: [{ deletedAt: { not: null } }, { isActive: false }, { isTestBlocked: true }],
    },
    orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    select: { ...STUDENT_CARD_SELECT, isActive: true, isTestBlocked: true, deletedAt: true },
  });
  const trail = await prisma.rowActionLog.findMany({
    where: {
      feature: AUDIT_FEATURE.STUDENT,
      entityId: { in: students.map((student) => student.id) },
      action: { in: STANDING_ACTIONS },
    },
    orderBy: { createdAt: 'desc' },
    select: { entityId: true, createdAt: true, actorId: true },
  });
  const latest = new Map<string, (typeof trail)[number]>();
  for (const row of trail) if (!latest.has(row.entityId)) latest.set(row.entityId, row);
  const names = await adminNames(
    prisma,
    trail.map((row) => row.actorId),
  );
  const rows = students.map(({ isActive, isTestBlocked, deletedAt, ...student }): Stood => {
    const change = latest.get(student.id);
    return {
      student,
      status: deletedAt === null ? standingOf({ isActive, isTestBlocked }) : 'Deleted',
      at: change?.createdAt ?? deletedAt,
      by: change?.actorId ? (names.get(change.actorId) ?? null) : null,
    };
  });
  return {
    about: [],
    figures: [{ label: 'Students', value: rows.length }],
    sheets: [{ name: 'Students', columns: STOOD_COLUMNS, rows }],
  };
};

interface Granted {
  student: StudentCard;
  series: string;
  at: Date;
  by: string | null;
}

const GRANT_COLUMNS: ExportColumn<Granted>[] = [
  ...studentColumns<Granted>((row) => row.student),
  { header: 'Series', width: 34, value: (row) => row.series },
  joined((row) => row.at, 'Granted'),
  { header: 'By', width: 24, value: (row) => row.by },
];

const manualGrants: PeriodBuilder = async ({ prisma }, query) => {
  const period = periodOf(query);
  const grants = await prisma.studentGrant.findMany({
    where: { createdAt: period.within },
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      createdById: true,
      student: { select: STUDENT_CARD_SELECT },
      testSeries: { select: { name: true } },
    },
  });
  const names = await adminNames(
    prisma,
    grants.map((grant) => grant.createdById),
  );
  const rows = grants.map((grant) => ({
    student: grant.student,
    series: grant.testSeries.name,
    at: grant.createdAt,
    by: grant.createdById ? (names.get(grant.createdById) ?? null) : null,
  }));
  return {
    about: [aboutPeriod(period)],
    figures: [{ label: 'Grants', value: rows.length }],
    sheets: [{ name: 'Grants', columns: GRANT_COLUMNS, rows }],
  };
};

interface Candidate {
  student: StudentCard;
  registeredAt: Date;
  testsSat: number;
}

const CANDIDATE_COLUMNS: ExportColumn<Candidate>[] = [
  ...studentColumns<Candidate>((row) => row.student),
  joined((row) => row.registeredAt, 'Registered'),
  { header: 'Tests sat', width: 10, value: (row) => row.testsSat },
];

/** Who registered against who turned up: a candidate with no sitting on any of the event's tests sat none. */
const eventCandidates: EventBuilder = async ({ prisma }, { eventId }) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      name: true,
      candidates: { select: { studentId: true, createdAt: true } },
      series: { select: { tests: { select: { id: true } } } },
    },
  });
  if (event === null) throw new AppException(ErrorCodes.NOT_FOUND, 'That event does not exist');

  const testIds = event.series.flatMap((series) => series.tests.map((test) => test.id));
  const [cards, sat] = await Promise.all([
    cardsOf(
      prisma,
      event.candidates.map((candidate) => candidate.studentId),
    ),
    prisma.attempt.findMany({
      where: { testId: { in: testIds } },
      select: { studentId: true, testId: true },
    }),
  ]);
  const registered = new Map(
    event.candidates.map((candidate) => [candidate.studentId, candidate.createdAt]),
  );
  const satBy = groupBy(sat, (sitting) => sitting.studentId);
  const rows = cards
    .flatMap((student): Candidate[] => {
      const registeredAt = registered.get(student.id);
      if (!registeredAt) return [];
      const tests = new Set((satBy.get(student.id) ?? []).map((sitting) => sitting.testId));
      return [{ student, registeredAt, testsSat: tests.size }];
    })
    .sort((a, b) => (a.student.fullName ?? '').localeCompare(b.student.fullName ?? ''));
  return {
    about: [{ label: 'Event', value: event.name }],
    figures: [
      { label: 'Candidates', value: rows.length },
      { label: 'Sat a test', value: rows.filter((row) => row.testsSat > 0).length },
      { label: 'Tests', value: testIds.length },
    ],
    sheets: [{ name: 'Candidates', columns: CANDIDATE_COLUMNS, rows }],
  };
};

interface Renumbered {
  student: StudentCard;
  old: string;
  at: Date;
  by: string | null;
}

const RENUMBERED_COLUMNS: ExportColumn<Renumbered>[] = [
  { header: 'Student', width: 28, value: (row) => row.student.fullName },
  { header: 'Old mobile', width: 14, text: true, value: (row) => row.old },
  { header: 'Mobile now', width: 14, text: true, value: (row) => row.student.mobile },
  { header: 'Branch', width: 20, value: (row) => row.student.currentBranch?.name ?? NO_BRANCH },
  joined((row) => row.at, 'Changed'),
  { header: 'By', width: 24, value: (row) => row.by },
];

const mobileChanges: PeriodBuilder = async ({ prisma }, query) => {
  const period = periodOf(query);
  const changes = await prisma.studentMobileHistory.findMany({
    where: { createdAt: period.within },
    orderBy: { createdAt: 'desc' },
    select: {
      mobile: true,
      createdAt: true,
      changedById: true,
      student: { select: STUDENT_CARD_SELECT },
    },
  });
  const names = await adminNames(
    prisma,
    changes.map((change) => change.changedById),
  );
  const rows = changes.map((change) => ({
    student: change.student,
    old: change.mobile,
    at: change.createdAt,
    by: change.changedById ? (names.get(change.changedById) ?? null) : null,
  }));
  return {
    about: [aboutPeriod(period)],
    figures: [{ label: 'Changes', value: rows.length }],
    sheets: [{ name: 'Mobile changes', columns: RENUMBERED_COLUMNS, rows }],
  };
};

export const ENROLMENT_REPORTS = {
  [REPORT_KEYS.STUDENT_ROSTER]: roster,
  [REPORT_KEYS.NEW_ENROLMENTS]: newEnrolments,
  [REPORT_KEYS.STRENGTH]: strength,
  [REPORT_KEYS.PROFILE_COMPLETENESS]: profileCompleteness,
  [REPORT_KEYS.STUDENT_STATUS]: studentStatus,
  [REPORT_KEYS.MANUAL_GRANTS]: manualGrants,
  [REPORT_KEYS.EVENT_CANDIDATES]: eventCandidates,
  [REPORT_KEYS.MOBILE_CHANGES]: mobileChanges,
};
