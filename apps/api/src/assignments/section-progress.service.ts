import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ASSIGNMENT_ROLES,
  AppException,
  ErrorCodes,
  PAPER_SOURCES,
  scopedSections,
  type AssignmentRole,
  type AssignmentSection,
  type AssignmentSectionsQuery,
  type AssignmentTest,
  type AssignmentTestsQuery,
  type Paginated,
  type PaperSource,
  type SectionProgressQuery,
  type SectionProgressRow,
  type SectionRoleProgress,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { scopeRefOf } from '../common/prisma-json';
import { pageArgs, paged } from '../common/pagination';
import { endOfInstituteDay, startOfInstituteDay } from '../common/time/institute-day';
import { everyTermMatches } from '../common/search-terms';
import { standingOf } from './assignment-gates';
import {
  NO_COUNTS,
  sectionKey,
  sectionWrittenCounts,
  seatKey,
  spentSeconds,
  type SeatRow,
} from './assignment-counts';

/** Both sources take both roles: on a picked paper the typist fixes what its reader sends back. */
const SOURCES_FOR_ROLE: Record<AssignmentRole, readonly PaperSource[]> = {
  [ASSIGNMENT_ROLES.TYPIST]: [PAPER_SOURCES.FRAMED, PAPER_SOURCES.PICKED],
  [ASSIGNMENT_ROLES.PROOFREADER]: [PAPER_SOURCES.FRAMED, PAPER_SOURCES.PICKED],
};

const TEST_QUEUE_SELECT = {
  id: true,
  title: true,
  paperSource: true,
  finalizedAt: true,
  scope: true,
  scopeRef: true,
  questionPoolFilter: true,
  baseConfig: {
    select: {
      sections: {
        select: { id: true, name: true, order: true, moduleId: true, questionCount: true },
        orderBy: { order: 'asc' },
      },
    },
  },
  assignments: {
    where: { replacedAt: null },
    select: {
      id: true,
      role: true,
      baseConfigSectionId: true,
      assigneeId: true,
      dueAt: true,
      finalizedAt: true,
      replacedAt: true,
      assignee: { select: { fullName: true, email: true } },
    },
  },
} as const satisfies Prisma.TestSelect;

type QueueTest = Prisma.TestGetPayload<{ select: typeof TEST_QUEUE_SELECT }>;
type QueueSection = QueueTest['baseConfig']['sections'][number];

interface DueBounds {
  from?: Date;
  to?: Date;
}

/** Institute days, inclusive at both ends — a UTC midnight would drop everything due that evening. */
export function dueBounds(query: { dueFrom?: string; dueTo?: string }): DueBounds | undefined {
  if (!query.dueFrom && !query.dueTo) return undefined;
  return {
    ...(query.dueFrom ? { from: startOfInstituteDay(query.dueFrom) } : {}),
    ...(query.dueTo ? { to: endOfInstituteDay(query.dueTo) } : {}),
  };
}

/** A role nobody holds has no due date, so a due-date filter cannot be looking for it. */
const withinDue = (at: Date | null, bounds: DueBounds): boolean =>
  at !== null && (!bounds.from || at >= bounds.from) && (!bounds.to || at <= bounds.to);

/** A test still being built: the picker and the progress list must offer and list the same ones. */
const UNFROZEN_TEST = {
  finalizedAt: null,
  paperSource: { not: null },
} as const satisfies Prisma.TestWhereInput;

const sectionsOf = (test: QueueTest): QueueSection[] => [
  ...scopedSections(test.baseConfig.sections, test.scope, scopeRefOf(test)),
];

/** Null where the paper's source gives the role nothing to do; otherwise who holds it, if anybody. */
function roleProgress(
  test: QueueTest,
  section: QueueSection,
  role: AssignmentRole,
): SectionRoleProgress | null {
  const source = test.paperSource;
  if (source === null || !SOURCES_FOR_ROLE[role].includes(source)) return null;

  const held =
    test.assignments.find((row) => row.role === role && row.baseConfigSectionId === section.id) ??
    null;

  return {
    assignmentId: held?.id ?? null,
    assigneeId: held?.assigneeId ?? null,
    assigneeName: held ? (held.assignee.fullName ?? held.assignee.email) : null,
    dueAt: held?.dueAt?.toISOString() ?? null,
    finalizedAt: held?.finalizedAt?.toISOString() ?? null,
    standing: held ? standingOf({ ...held, test }) : null,
    secondsSpent: 0,
  };
}

const roles = (row: SectionProgressRow): SectionRoleProgress[] =>
  [row.typing, row.reading].filter((held): held is SectionRoleProgress => held !== null);

/** Either half satisfies it: a section is theirs if they type it or read it. */
const heldByAnyOf = (row: SectionProgressRow, wanted: readonly string[]): boolean =>
  roles(row).some((held) => held.assigneeId !== null && wanted.includes(held.assigneeId));

/** Either half satisfies it: the two roles carry their own dates and need not agree. */
const dueWithin = (row: SectionProgressRow, bounds: DueBounds): boolean =>
  roles(row).some((held) => withinDue(held.dueAt === null ? null : new Date(held.dueAt), bounds));

/** Who holds what across the institute's unfrozen tests, and the pickers that narrow it — reads only. */
@Injectable()
export class SectionProgressService {
  constructor(private readonly prisma: PrismaService) {}

  /** Expanded in memory: the cross of unfrozen tests and their sections is thousands of rows here, not millions. */
  async progress(query: SectionProgressQuery): Promise<Paginated<SectionProgressRow>> {
    const due = dueBounds(query);
    const tests = await this.prisma.test.findMany({
      where: {
        ...UNFROZEN_TEST,
        ...(query.testId ? { id: query.testId } : {}),
      },
      select: TEST_QUEUE_SELECT,
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    });

    const rows = tests
      .flatMap((test) =>
        sectionsOf(test)
          .filter(
            (section) => !query.baseConfigSectionId || section.id === query.baseConfigSectionId,
          )
          .map((section) => sectionRow(test, section)),
      )
      .filter((row) => !query.assigneeId || heldByAnyOf(row, query.assigneeId))
      .filter((row) => !due || dueWithin(row, due));

    const { skip, take } = pageArgs(query);
    const items = rows.slice(skip, skip + take);
    const [written, spent] = await Promise.all([
      sectionWrittenCounts(this.prisma, items),
      spentSeconds(this.prisma, items.flatMap(seatsOf)),
    ]);
    return paged(
      query,
      items.map((row) => ({
        ...withTime(row, spent),
        writtenCount: (written.get(sectionKey(row)) ?? NO_COUNTS).writtenCount,
      })),
      rows.length,
    );
  }

  /** What a test picker offers: their own tests, or every unfrozen one when a super admin asks. */
  async tests(
    query: AssignmentTestsQuery,
    adminId: string,
    isSuperAdmin: boolean,
  ): Promise<Paginated<AssignmentTest>> {
    const where: Prisma.TestWhereInput = {
      ...UNFROZEN_TEST,
      ...(ownScope(query, isSuperAdmin) ? { assignments: { some: heldBy(adminId, query) } } : {}),
      ...everyTermMatches<Prisma.TestWhereInput>(query.q, (term) => [
        { title: { contains: term, mode: 'insensitive' } },
      ]),
      ...(query.id ? { id: { in: query.id } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.test.findMany({
        where,
        select: { id: true, title: true },
        orderBy: [{ title: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.test.count({ where }),
    ]);
    return paged(query, rows, total);
  }

  /** The chosen test's sections, in the test's own order — a dozen rows, so no page to ask for. */
  async sectionChoices(
    testId: string,
    query: AssignmentSectionsQuery,
    adminId: string,
    isSuperAdmin: boolean,
  ): Promise<AssignmentSection[]> {
    if (ownScope(query, isSuperAdmin)) {
      const held = await this.prisma.questionAssignment.findMany({
        where: { testId, ...heldBy(adminId, query) },
        select: { baseConfigSection: { select: { id: true, name: true } } },
        orderBy: { baseConfigSection: { order: 'asc' } },
      });
      return held.map((row) => row.baseConfigSection);
    }

    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      select: TEST_QUEUE_SELECT,
    });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    return sectionsOf(test).map((section) => ({ id: section.id, name: section.name }));
  }
}

/** A super admin reads the whole institute unless they ask for their own queue; nobody else ever does. */
const ownScope = (query: { mine?: boolean }, isSuperAdmin: boolean): boolean =>
  !isSuperAdmin || query.mine === true;

const heldBy = (
  adminId: string,
  query: { role?: AssignmentRole },
): Prisma.QuestionAssignmentWhereInput => ({
  assigneeId: adminId,
  ...(query.role ? { role: query.role } : {}),
});

/** One row per (test, section), carrying both halves of its work — never one row per role. */
function sectionRow(test: QueueTest, section: QueueSection): SectionProgressRow {
  return {
    testId: test.id,
    testTitle: test.title,
    baseConfigSectionId: section.id,
    sectionName: section.name,
    paperSource: test.paperSource,
    ...NO_COUNTS,
    sectionQuestionCount: section.questionCount,
    typing: roleProgress(test, section, ASSIGNMENT_ROLES.TYPIST),
    reading: roleProgress(test, section, ASSIGNMENT_ROLES.PROOFREADER),
  };
}

/** Each role somebody holds on a section, as the seat their time is kept under. */
const seatsOf = (row: SectionProgressRow): SeatRow[] =>
  (
    [
      [ASSIGNMENT_ROLES.TYPIST, row.typing],
      [ASSIGNMENT_ROLES.PROOFREADER, row.reading],
    ] as const
  ).flatMap(([role, held]) =>
    held?.assigneeId
      ? [
          {
            testId: row.testId,
            baseConfigSectionId: row.baseConfigSectionId,
            assigneeId: held.assigneeId,
            role,
          },
        ]
      : [],
  );

function withTime(row: SectionProgressRow, spent: Map<string, number>): SectionProgressRow {
  const seconds = new Map(seatsOf(row).map((seat) => [seat.role, spent.get(seatKey(seat)) ?? 0]));
  const timed = (held: SectionRoleProgress | null, role: AssignmentRole) =>
    held && { ...held, secondsSpent: seconds.get(role) ?? 0 };
  return {
    ...row,
    typing: timed(row.typing, ASSIGNMENT_ROLES.TYPIST),
    reading: timed(row.reading, ASSIGNMENT_ROLES.PROOFREADER),
  };
}
