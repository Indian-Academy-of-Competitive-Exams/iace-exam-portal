import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ADMIN_ROLES,
  ASSIGNMENT_ROLES,
  AppException,
  ErrorCodes,
  FEATURES,
  FEATURE_KEYS,
  FORM_LEVEL_FIELD,
  PAPER_SOURCES,
  PERMISSION_LEVELS,
  satisfiesLevel,
  scopedSections,
  type AdminRole,
  type Assignment,
  type AssignableAdmin,
  type AssignmentQueueRow,
  type AssignmentRole,
  type AssignmentWithTest,
  type CreateAssignmentBody,
  type DifficultyMix,
  type DrawSpec,
  type FeatureKey,
  type MineAssignmentsQuery,
  type Paginated,
  type PaperSource,
  type TestScopeRef,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AdminsService } from '../admins';
import { isUniqueViolation } from '../common/prisma-errors';
import { pageArgs, paged } from '../common/pagination';
import { endOfInstituteDay, startOfInstituteDay } from '../common/time/institute-day';

const ASSIGNMENT_INCLUDE = {
  baseConfigSection: { select: { name: true, questionCount: true } },
  assignee: { select: { fullName: true, email: true } },
  test: { select: { questionPoolFilter: true } },
} as const satisfies Prisma.QuestionAssignmentInclude;

type AssignmentRow = Prisma.QuestionAssignmentGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>;

const WITH_TEST_INCLUDE = {
  ...ASSIGNMENT_INCLUDE,
  test: { select: { title: true, questionPoolFilter: true } },
} as const satisfies Prisma.QuestionAssignmentInclude;

type AssignmentWithTestRow = Prisma.QuestionAssignmentGetPayload<{
  include: typeof WITH_TEST_INCLUDE;
}>;

/** The key a role's work needs — assigning it to someone without it would fail every write they made. */
const FEATURE_FOR_ROLE: Record<AssignmentRole, FeatureKey> = {
  [ASSIGNMENT_ROLES.TYPIST]: FEATURE_KEYS.QUESTION_AUTHORING,
  [ASSIGNMENT_ROLES.PROOFREADER]: FEATURE_KEYS.QUESTION_PROOFREAD,
};

/** What somebody doing this job is CALLED — it orders the picker and decides nothing. */
const ADMIN_ROLE_FOR_ROLE: Record<AssignmentRole, AdminRole> = {
  [ASSIGNMENT_ROLES.TYPIST]: ADMIN_ROLES.TYPIST,
  [ASSIGNMENT_ROLES.PROOFREADER]: ADMIN_ROLES.PROOFREADER,
};

const ROLE_ORDER = [ASSIGNMENT_ROLES.TYPIST, ASSIGNMENT_ROLES.PROOFREADER] as const;

/** A picked paper is drawn from the bank, so it has nothing to type — it still has everything to read. */
const SOURCES_FOR_ROLE: Record<AssignmentRole, readonly PaperSource[]> = {
  [ASSIGNMENT_ROLES.TYPIST]: [PAPER_SOURCES.FRAMED],
  [ASSIGNMENT_ROLES.PROOFREADER]: [PAPER_SOURCES.FRAMED, PAPER_SOURCES.PICKED],
};

const TEST_QUEUE_SELECT = {
  id: true,
  title: true,
  paperSource: true,
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
    select: {
      id: true,
      role: true,
      baseConfigSectionId: true,
      assigneeId: true,
      dueAt: true,
      finalizedAt: true,
      assignee: { select: { fullName: true, email: true } },
    },
  },
} as const satisfies Prisma.TestSelect;

type QueueTest = Prisma.TestGetPayload<{ select: typeof TEST_QUEUE_SELECT }>;
type QueueSection = QueueTest['baseConfig']['sections'][number];
type HeldAssignment = QueueTest['assignments'][number];

interface DueBounds {
  from?: Date;
  to?: Date;
}

/** Institute days, inclusive at both ends — a UTC midnight would drop everything due that evening. */
function dueBounds(query: MineAssignmentsQuery): DueBounds | undefined {
  if (!query.dueFrom && !query.dueTo) return undefined;
  return {
    ...(query.dueFrom ? { from: startOfInstituteDay(query.dueFrom) } : {}),
    ...(query.dueTo ? { to: endOfInstituteDay(query.dueTo) } : {}),
  };
}

/** A section nobody holds has no due date, so a due-date filter cannot be looking for it. */
const withinDue = (at: Date | null, bounds: DueBounds): boolean =>
  at !== null && (!bounds.from || at >= bounds.from) && (!bounds.to || at <= bounds.to);

const nameLike = (text: string): Prisma.StringFilter => ({ contains: text, mode: 'insensitive' });

const matchesSection = (name: string, wanted: string | undefined): boolean =>
  !wanted || name.toLowerCase().includes(wanted.toLowerCase());

const sectionsOf = (test: QueueTest): QueueSection[] => [
  ...scopedSections(test.baseConfig.sections, test.scope, (test.scopeRef as TestScopeRef) ?? null),
];

const isHeld = (row: AssignmentQueueRow): row is AssignmentQueueRow & { id: string } =>
  row.id !== null;

/** In the queue while the paper's source gives the role work and nobody has finished it. */
function needingRole(
  test: QueueTest,
  section: QueueSection,
  role: AssignmentRole,
  query: MineAssignmentsQuery,
  due: DueBounds | undefined,
): AssignmentQueueRow[] {
  const source = test.paperSource;
  if (source === null || !SOURCES_FOR_ROLE[role].includes(source)) return [];

  const held =
    test.assignments.find((row) => row.role === role && row.baseConfigSectionId === section.id) ??
    null;
  if (held?.finalizedAt) return [];
  if (query.assigneeId && !(held && query.assigneeId.includes(held.assigneeId))) return [];
  if (due && !withinDue(held?.dueAt ?? null, due)) return [];

  return [
    {
      id: held?.id ?? null,
      testId: test.id,
      testTitle: test.title,
      baseConfigSectionId: section.id,
      sectionName: section.name,
      assigneeId: held?.assigneeId ?? null,
      assigneeName: held ? nameOf(held.assignee) : null,
      role,
      dueAt: held?.dueAt?.toISOString() ?? null,
      finalizedAt: null,
      writtenCount: 0,
      sectionQuestionCount: section.questionCount,
      sectionMix: sectionMixOf(test.questionPoolFilter, section.id),
    },
  ];
}

const nameOf = (assignee: HeldAssignment['assignee']): string =>
  assignee.fullName ?? assignee.email;

const SOURCE_UNCHOSEN_MESSAGE =
  'Say where this test gets its questions before handing a section to anybody.';

const PICKED_NEEDS_NO_TYPIST_MESSAGE =
  'This test is picked from the bank, so its sections take a proof-reader and no typist.';

const otherRole = (role: AssignmentRole): AssignmentRole =>
  role === ASSIGNMENT_ROLES.TYPIST ? ASSIGNMENT_ROLES.PROOFREADER : ASSIGNMENT_ROLES.TYPIST;

const roleLabel = (role: AssignmentRole): string =>
  role === ASSIGNMENT_ROLES.TYPIST ? 'typist' : 'proof-reader';

/** One person's job on one section of one test — a work queue per admin, and the gate `offer()` checks. */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admins: AdminsService,
  ) {}

  /** Every assignment on the test, section and assignee named, one query. */
  async forTest(testId: string): Promise<Assignment[]> {
    const rows = await this.prisma.questionAssignment.findMany({
      where: { testId },
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ baseConfigSection: { order: 'asc' } }, { role: 'asc' }],
    });
    const written = await this.sectionWrittenCounts(rows);
    return rows.map((row) => toAssignment(row, written.get(sectionKey(row)) ?? 0));
  }

  /** Active admins already holding what a role needs — who the picker offers, and nothing more. */
  async assignable(role: AssignmentRole): Promise<AssignableAdmin[]> {
    const called = ADMIN_ROLE_FOR_ROLE[role];
    const holders = await this.admins.holdersOf(FEATURE_FOR_ROLE[role], PERMISSION_LEVELS.WRITE);
    // The feature key decides who is on this list; the role only decides who is at the top of it.
    return holders.sort((a, b) => Number(b.role === called) - Number(a.role === called));
  }

  async assign(testId: string, body: CreateAssignmentBody, actorId: string): Promise<Assignment> {
    const test = await this.requireTest(testId);
    assertRoleFits(test.paperSource, body.role);
    const section = await this.requireSection(test.baseConfigId, body.baseConfigSectionId);
    const assignee = await this.requireAssignee(body.assigneeId);
    await this.assertHoldsFeature(assignee, body.role);
    await this.assertNotTheOtherRole(testId, section.id, body.assigneeId, body.role);

    try {
      const row = await this.prisma.questionAssignment.create({
        data: {
          testId,
          baseConfigId: test.baseConfigId,
          baseConfigSectionId: section.id,
          assigneeId: body.assigneeId,
          role: body.role,
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
          createdById: actorId,
        },
        include: ASSIGNMENT_INCLUDE,
      });
      return this.withWrittenCount(row);
    } catch (error) {
      // Two admins raced the same section; the unique picked one. The loser is told why, not how.
      if (!isUniqueViolation(error)) throw error;
      throw new AppException(
        ErrorCodes.CONFLICT,
        `That section already has a ${roleLabel(body.role)}`,
      );
    }
  }

  /** A finished job is a record: only an unfinalized row can be taken back. */
  async remove(id: string): Promise<void> {
    const row = await this.prisma.questionAssignment.findUnique({
      where: { id },
      select: { finalizedAt: true },
    });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such assignment');
    if (row.finalizedAt) {
      throw new AppException(
        ErrorCodes.CONFLICT,
        'This section has already been proof-read, so its record stays. It cannot be removed.',
      );
    }
    await this.prisma.questionAssignment.delete({ where: { id } });
  }

  /** An ordinary admin's own rows; a super admin's every section still needing the role's work. */
  mine(
    adminId: string,
    query: MineAssignmentsQuery,
    isSuperAdmin = false,
  ): Promise<Paginated<AssignmentQueueRow>> {
    return isSuperAdmin ? this.needingWork(query) : this.assignedTo(adminId, query);
  }

  /** One row by id. Not theirs reads as not there, unless they own the institute. */
  async one(id: string, adminId: string, isSuperAdmin: boolean): Promise<AssignmentWithTest> {
    const row = await this.prisma.questionAssignment.findUnique({
      where: { id },
      include: WITH_TEST_INCLUDE,
    });
    if (!row || (row.assigneeId !== adminId && !isSuperAdmin)) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'No such assignment');
    }
    const written = await this.sectionWrittenCounts([row]);
    return toAssignmentWithTest(row, written.get(sectionKey(row)) ?? 0);
  }

  private async assignedTo(
    adminId: string,
    query: MineAssignmentsQuery,
  ): Promise<Paginated<AssignmentQueueRow>> {
    const due = dueBounds(query);
    const where: Prisma.QuestionAssignmentWhereInput = {
      assigneeId: adminId,
      ...(query.outstanding ? { finalizedAt: null } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.test ? { test: { title: nameLike(query.test) } } : {}),
      ...(query.section ? { baseConfigSection: { name: nameLike(query.section) } } : {}),
      ...(due
        ? { dueAt: { ...(due.from ? { gte: due.from } : {}), ...(due.to ? { lte: due.to } : {}) } }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.questionAssignment.findMany({
        where,
        include: WITH_TEST_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.questionAssignment.count({ where }),
    ]);
    const written = await this.sectionWrittenCounts(rows);
    return paged(
      query,
      rows.map((row) => toAssignmentWithTest(row, written.get(sectionKey(row)) ?? 0)),
      total,
    );
  }

  /** Expanded in memory: the cross of unfrozen tests and their sections is thousands of rows here, not millions. */
  private async needingWork(query: MineAssignmentsQuery): Promise<Paginated<AssignmentQueueRow>> {
    const roles = query.role ? [query.role] : [...ROLE_ORDER];
    const due = dueBounds(query);
    const tests = await this.prisma.test.findMany({
      where: {
        finalizedAt: null,
        paperSource: { in: [...new Set(roles.flatMap((role) => SOURCES_FOR_ROLE[role]))] },
        ...(query.test ? { title: nameLike(query.test) } : {}),
      },
      select: TEST_QUEUE_SELECT,
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    });

    const rows = tests.flatMap((test) =>
      sectionsOf(test)
        .filter((section) => matchesSection(section.name, query.section))
        .flatMap((section) =>
          roles.flatMap((role) => needingRole(test, section, role, query, due)),
        ),
    );

    const items = rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    const written = await this.sectionWrittenCounts(items.filter(isHeld));
    return paged(
      query,
      items.map((row) => ({ ...row, writtenCount: written.get(sectionKey(row)) ?? 0 })),
      rows.length,
    );
  }

  /** Idempotent: finalising twice hands back the same row rather than erroring on the second call. */
  async finalize(id: string, adminId: string, isSuperAdmin = false): Promise<Assignment> {
    const row = await this.prisma.questionAssignment.findUnique({
      where: { id },
      include: ASSIGNMENT_INCLUDE,
    });
    // Not theirs reads as not there — the same guard authoring.service.ts uses for a draft.
    if (!row || (row.assigneeId !== adminId && !isSuperAdmin)) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'No such assignment');
    }
    // One fact per role — "I wrote this" and "I read this" — with no ordering between them.
    if (row.finalizedAt) return this.withWrittenCount(row);

    const updated = await this.prisma.questionAssignment.update({
      where: { id },
      data: { finalizedAt: new Date() },
      include: ASSIGNMENT_INCLUDE,
    });
    return this.withWrittenCount(updated);
  }

  /** How many questions any assignment on a row's own (test, section) carries — a section fact. */
  private async sectionWrittenCounts(
    rows: readonly { id: string; testId: string; baseConfigSectionId: string }[],
  ): Promise<Map<string, number>> {
    const ids = rows.map((row) => row.id);
    const counts =
      ids.length === 0
        ? []
        : await this.prisma.question.groupBy({
            by: ['assignmentId'],
            where: { assignmentId: { in: ids } },
            _count: { _all: true },
          });
    const byAssignmentId = new Map(counts.map((row) => [row.assignmentId, row._count._all]));

    const bySection = new Map<string, number>();
    for (const row of rows) {
      const key = sectionKey(row);
      bySection.set(key, (bySection.get(key) ?? 0) + (byAssignmentId.get(row.id) ?? 0));
    }
    return bySection;
  }

  private async withWrittenCount(row: AssignmentRow): Promise<Assignment> {
    const written = await this.sectionWrittenCounts([row]);
    return toAssignment(row, written.get(sectionKey(row)) ?? 0);
  }

  private async requireTest(
    id: string,
  ): Promise<{ id: string; baseConfigId: string; paperSource: PaperSource | null }> {
    const test = await this.prisma.test.findUnique({
      where: { id },
      select: { id: true, baseConfigId: true, paperSource: true },
    });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    return test;
  }

  private async requireSection(baseConfigId: string, id: string): Promise<{ id: string }> {
    const section = await this.prisma.baseConfigSection.findFirst({
      where: { id, baseConfigId },
      select: { id: true },
    });
    if (!section) throw new AppException(ErrorCodes.NOT_FOUND, 'No such section');
    return section;
  }

  private async requireAssignee(id: string): Promise<{ id: string; name: string }> {
    const admin = await this.prisma.admin.findUnique({
      where: { id },
      select: { id: true, fullName: true, email: true },
    });
    if (!admin) throw new AppException(ErrorCodes.NOT_FOUND, 'No such admin');
    return { id: admin.id, name: admin.fullName ?? admin.email };
  }

  private async assertHoldsFeature(
    assignee: { id: string; name: string },
    role: AssignmentRole,
  ): Promise<void> {
    const key = FEATURE_FOR_ROLE[role];
    const permissions = await this.admins.permissionsFor(assignee.id);
    if (satisfiesLevel(permissions[key], PERMISSION_LEVELS.WRITE)) return;

    const message = `${assignee.name} does not hold ${FEATURES[key].label} access`;
    throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
      fieldErrors: { assigneeId: [message] },
    });
  }

  /** Spec §11's convention, made real: nobody checks their own typing on the same section. */
  private async assertNotTheOtherRole(
    testId: string,
    sectionId: string,
    assigneeId: string,
    role: AssignmentRole,
  ): Promise<void> {
    const clash = await this.prisma.questionAssignment.findUnique({
      where: {
        testId_baseConfigSectionId_role: {
          testId,
          baseConfigSectionId: sectionId,
          role: otherRole(role),
        },
      },
      select: { assigneeId: true },
    });
    if (clash?.assigneeId !== assigneeId) return;

    const message =
      role === ASSIGNMENT_ROLES.PROOFREADER
        ? 'This admin is already the typist on this section'
        : 'This admin is already the proof-reader on this section';
    throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
      fieldErrors: { assigneeId: [message] },
    });
  }
}

/** Nobody is handed a section until the test says where its questions come from, and PICKED needs no typist. */
function assertRoleFits(paperSource: PaperSource | null, role: AssignmentRole): void {
  if (paperSource === null) {
    throw new AppException(ErrorCodes.CONFLICT, SOURCE_UNCHOSEN_MESSAGE, {
      fieldErrors: { [FORM_LEVEL_FIELD]: [SOURCE_UNCHOSEN_MESSAGE] },
    });
  }
  if (paperSource === PAPER_SOURCES.PICKED && role === ASSIGNMENT_ROLES.TYPIST) {
    throw new AppException(ErrorCodes.VALIDATION_ERROR, PICKED_NEEDS_NO_TYPIST_MESSAGE, {
      fieldErrors: { role: [PICKED_NEEDS_NO_TYPIST_MESSAGE] },
    });
  }
}

/** A section is only unique within its own test — two tests can share a base config's section id. */
const sectionKey = (row: { testId: string; baseConfigSectionId: string }): string =>
  `${row.testId}:${row.baseConfigSectionId}`;

function toAssignment(row: AssignmentRow, writtenCount: number): Assignment {
  return {
    id: row.id,
    testId: row.testId,
    baseConfigSectionId: row.baseConfigSectionId,
    sectionName: row.baseConfigSection.name,
    assigneeId: row.assigneeId,
    assigneeName: row.assignee.fullName ?? row.assignee.email,
    role: row.role,
    dueAt: row.dueAt?.toISOString() ?? null,
    finalizedAt: row.finalizedAt?.toISOString() ?? null,
    writtenCount,
    sectionQuestionCount: row.baseConfigSection.questionCount,
    sectionMix: sectionMixOf(row.test.questionPoolFilter, row.baseConfigSectionId),
  };
}

/** Absent means the section draws every difficulty, not zero of each — never defaulted here. */
function sectionMixOf(questionPoolFilter: unknown, sectionId: string): DifficultyMix | null {
  const spec = questionPoolFilter as DrawSpec | null;
  return spec?.sections?.[sectionId]?.mix ?? null;
}

function toAssignmentWithTest(
  row: AssignmentWithTestRow,
  writtenCount: number,
): AssignmentWithTest {
  return { ...toAssignment(row, writtenCount), testTitle: row.test.title };
}
