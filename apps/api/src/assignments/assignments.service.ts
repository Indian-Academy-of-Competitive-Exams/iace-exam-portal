import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ADMIN_ROLES,
  ASSIGNMENT_ROLES,
  AUDIT_FEATURE,
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
  type AssignmentRole,
  type AssignmentSection,
  type AssignmentSectionsQuery,
  type AssignmentTest,
  type AssignmentTestsQuery,
  type AssignmentWithTest,
  type CreateAssignmentBody,
  type DifficultyMix,
  type DrawSpec,
  type FeatureKey,
  type MineAssignmentsQuery,
  type Paginated,
  type PaperSource,
  type SectionProgressQuery,
  type SectionEditLock,
  type SectionProgressRow,
  type SectionRoleProgress,
  type TestScopeRef,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AdminsService } from '../admins';
import { sectionEditingBy } from '../common/edit-lock';
import { isUniqueViolation } from '../common/prisma-errors';
import { pageArgs, paged } from '../common/pagination';
import { endOfInstituteDay, startOfInstituteDay } from '../common/time/institute-day';
import { uncheckedOn } from './unread-questions';

const CHOOSE_WITH_DONE_MESSAGE =
  'Mark the section done by choosing its questions, so the reader gets the paper they will read.';
const OFFERED_MESSAGE = 'This test has been offered, so nobody new can be given its sections.';
const PASSED_ON_MESSAGE =
  'This section has passed to somebody else, so it is no longer yours to release.';
const NOT_HANDED_MESSAGE = 'This section has not reached you yet.';
const ALREADY_HOLDS_MESSAGE = 'This admin already holds that role on this section.';
const HAS_WORKED_MESSAGE =
  'Work has been done under this assignment, so it stays on the record. Give the role to somebody else instead.';
const REPLACED_MESSAGE = 'This assignment has passed to somebody else and stays on the record.';

const notWhole = (issue: string) =>
  new AppException(ErrorCodes.CONFLICT, issue, { fieldErrors: { [FORM_LEVEL_FIELD]: [issue] } });

const ASSIGNMENT_INCLUDE = {
  baseConfigSection: { select: { name: true, questionCount: true, subjectId: true } },
  assignee: { select: { fullName: true, email: true } },
  test: { select: { questionPoolFilter: true, finalizedAt: true, paperSource: true } },
} as const satisfies Prisma.QuestionAssignmentInclude;

type AssignmentRow = Prisma.QuestionAssignmentGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>;

const WITH_TEST_INCLUDE = {
  ...ASSIGNMENT_INCLUDE,
  test: { select: { title: true, questionPoolFilter: true, finalizedAt: true, paperSource: true } },
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

/** Both sources take both roles: on a picked paper the typist fixes what its reader sends back. */
const SOURCES_FOR_ROLE: Record<AssignmentRole, readonly PaperSource[]> = {
  [ASSIGNMENT_ROLES.TYPIST]: [PAPER_SOURCES.FRAMED, PAPER_SOURCES.PICKED],
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
    where: { replacedAt: null },
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

interface DueBounds {
  from?: Date;
  to?: Date;
}

/** Institute days, inclusive at both ends — a UTC midnight would drop everything due that evening. */
function dueBounds(query: { dueFrom?: string; dueTo?: string }): DueBounds | undefined {
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
  ...scopedSections(test.baseConfig.sections, test.scope, (test.scopeRef as TestScopeRef) ?? null),
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

const SOURCE_UNCHOSEN_MESSAGE =
  'Say where this test gets its questions before handing a section to anybody.';

const otherRole = (role: AssignmentRole): AssignmentRole =>
  role === ASSIGNMENT_ROLES.TYPIST ? ASSIGNMENT_ROLES.PROOFREADER : ASSIGNMENT_ROLES.TYPIST;

const roleLabel = (role: AssignmentRole): string =>
  role === ASSIGNMENT_ROLES.TYPIST ? 'typist' : 'proof-reader';

/** One person's job on one section of one test — a work queue per admin, and the gate `offer()` checks. */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
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
    const removable = await Promise.all(rows.map((row) => this.removable(row)));
    return rows.map((row, index) =>
      toAssignment(row, written.get(sectionKey(row)) ?? NO_COUNTS, removable[index] ?? false),
    );
  }

  /** Every row on one section, the replaced ones included, oldest first — the section's own record. */
  async sectionAssignments(testId: string, baseConfigSectionId: string): Promise<Assignment[]> {
    const rows = await this.prisma.questionAssignment.findMany({
      where: { testId, baseConfigSectionId },
      include: ASSIGNMENT_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    const written = await this.sectionWrittenCounts(rows);
    return rows.map((row) => toAssignment(row, written.get(sectionKey(row)) ?? NO_COUNTS));
  }

  /** Active admins already holding what a role needs — who the picker offers, and nothing more. */
  async assignable(role: AssignmentRole): Promise<AssignableAdmin[]> {
    const called = ADMIN_ROLE_FOR_ROLE[role];
    const holders = await this.admins.holdersOf(FEATURE_FOR_ROLE[role], PERMISSION_LEVELS.WRITE);
    // The feature key decides who is on this list; the role only decides who is at the top of it.
    return holders.sort((a, b) => Number(b.role === called) - Number(a.role === called));
  }

  /** A role already held passes to the new admin: the earlier row stays, marked replaced, as the record. */
  async assign(testId: string, body: CreateAssignmentBody, actorId: string): Promise<Assignment> {
    const test = await this.requireTest(testId);
    if (test.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, OFFERED_MESSAGE);
    assertSourceChosen(test.paperSource);
    const section = await this.requireSection(test.baseConfigId, body.baseConfigSectionId);
    const assignee = await this.requireAssignee(body.assigneeId);
    await this.assertHoldsFeature(assignee, body.role);
    await this.assertNotTheOtherRole(testId, section.id, body.assigneeId, body.role);

    const pair = { testId, baseConfigSectionId: section.id };
    const holding = await this.prisma.questionAssignment.findFirst({
      where: { ...pair, role: body.role, replacedAt: null },
    });
    if (holding?.assigneeId === body.assigneeId) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, ALREADY_HOLDS_MESSAGE, {
        fieldErrors: { assigneeId: [ALREADY_HOLDS_MESSAGE] },
      });
    }
    // The section's progress belongs to the role, not the person: it carries over to whoever takes it.
    const handedAt = holding ? holding.handedAt : await this.handedOnArrival(pair, body.role);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // Test before its rows, the app's one lock order: an edit reopening this holder took the test first.
        await tx.$queryRaw`SELECT 1 FROM "Test" WHERE "id" = ${testId}::uuid FOR UPDATE`;
        if (holding) {
          await tx.questionAssignment.update({
            where: { id: holding.id },
            data: { replacedAt: new Date() },
          });
        }
        return tx.questionAssignment.create({
          data: {
            ...pair,
            baseConfigId: test.baseConfigId,
            assigneeId: body.assigneeId,
            role: body.role,
            dueAt: body.dueAt ? new Date(body.dueAt) : null,
            finalizedAt: holding?.finalizedAt ?? null,
            handedAt,
            createdById: actorId,
          },
          include: ASSIGNMENT_INCLUDE,
        });
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

  /** Work done is a record: only a row nothing has been done under can be taken back. */
  async remove(id: string): Promise<void> {
    const row = await this.prisma.questionAssignment.findUnique({ where: { id } });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such assignment');
    if (row.replacedAt) throw new AppException(ErrorCodes.CONFLICT, REPLACED_MESSAGE);
    if (!(await this.removable(row))) {
      throw new AppException(ErrorCodes.CONFLICT, HAS_WORKED_MESSAGE);
    }
    await this.prisma.questionAssignment.delete({ where: { id } });
  }

  /** Typed, edited, reviewed, commented or finished anything on the section: then it is a record. */
  private async removable(row: {
    id: string;
    testId: string;
    baseConfigSectionId: string;
    assigneeId: string;
    finalizedAt: Date | null;
    replacedAt: Date | null;
    createdAt: Date;
  }): Promise<boolean> {
    if (row.finalizedAt || row.replacedAt) return false;
    const pair = { testId: row.testId, baseConfigSectionId: row.baseConfigSectionId };
    const who = row.assigneeId;
    const onSection = await this.prisma.question.findMany({
      where: {
        OR: [
          { paperQuestions: { some: pair } },
          { assignment: { ...pair, role: ASSIGNMENT_ROLES.TYPIST } },
        ],
      },
      select: { id: true },
    });
    const [typed, reviewed, said, edited] = await Promise.all([
      this.prisma.question.count({ where: { assignmentId: row.id } }),
      this.prisma.questionReview.count({
        where: { ...pair, OR: [{ checkedById: who }, { sentBackById: who }, { fixedById: who }] },
      }),
      this.prisma.sectionComment.count({ where: { ...pair, authorId: who } }),
      this.prisma.rowActionLog.count({
        where: {
          actorId: who,
          feature: AUDIT_FEATURE.QUESTION,
          createdAt: { gte: row.createdAt },
          entityId: { in: onSection.map((question) => question.id) },
        },
      }),
    ]);
    return typed + reviewed + said + edited === 0;
  }

  /** A reader given a typed section its typist has already finished starts with it in hand. */
  private async handedOnArrival(
    pair: { testId: string; baseConfigSectionId: string },
    role: AssignmentRole,
  ): Promise<Date | null> {
    if (role !== ASSIGNMENT_ROLES.PROOFREADER) return null;
    const typing = await this.prisma.questionAssignment.findFirst({
      where: {
        ...pair,
        role: ASSIGNMENT_ROLES.TYPIST,
        replacedAt: null,
        finalizedAt: { not: null },
        test: { paperSource: PAPER_SOURCES.FRAMED },
      },
      select: { finalizedAt: true },
    });
    return typing ? new Date() : null;
  }

  /** One admin's own rows, whichever role they came in as. Their work, and their actions. */
  mine(adminId: string, query: MineAssignmentsQuery): Promise<Paginated<AssignmentWithTest>> {
    return this.assignedTo(adminId, query);
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
    return toAssignmentWithTest(row, written.get(sectionKey(row)) ?? NO_COUNTS);
  }

  private async assignedTo(
    adminId: string,
    query: MineAssignmentsQuery,
  ): Promise<Paginated<AssignmentWithTest>> {
    const due = dueBounds(query);
    const where: Prisma.QuestionAssignmentWhereInput = {
      assigneeId: adminId,
      ...(query.outstanding ? { finalizedAt: null, replacedAt: null } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.testId ? { testId: query.testId } : {}),
      ...(query.baseConfigSectionId ? { baseConfigSectionId: query.baseConfigSectionId } : {}),
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
      rows.map((row) => toAssignmentWithTest(row, written.get(sectionKey(row)) ?? NO_COUNTS)),
      total,
    );
  }

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

    const items = rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    const written = await this.sectionWrittenCounts(items);
    return paged(
      query,
      items.map((row) => ({
        ...row,
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
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
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

  /** Who holds the section right now, so a screen warns before the work rather than at the save. */
  async sectionLock(testId: string, baseConfigSectionId: string): Promise<SectionEditLock> {
    const editingBy = await sectionEditingBy(this.redis, this.prisma, {
      testId,
      baseConfigSectionId,
    });
    return { editingBy };
  }

  /** A reader's release. Idempotent: a repeat restamps rather than erroring. A typist uses Done. */
  async finalize(id: string, adminId: string, isSuperAdmin = false): Promise<Assignment> {
    const row = await this.requireOwn(id, adminId, isSuperAdmin);
    if (row.role === ASSIGNMENT_ROLES.TYPIST) {
      throw new AppException(ErrorCodes.CONFLICT, CHOOSE_WITH_DONE_MESSAGE);
    }
    if (row.replacedAt) throw new AppException(ErrorCodes.CONFLICT, PASSED_ON_MESSAGE);
    if (!row.handedAt) throw notWhole(NOT_HANDED_MESSAGE);
    await this.assertSectionWhole(row);
    await this.assertEveryQuestionChecked(row);

    // Re-reading is the same fact restated: the stamp moves, so a section read again is covered again.
    const updated = await this.prisma.questionAssignment.update({
      where: { id },
      data: { finalizedAt: new Date() },
      include: ASSIGNMENT_INCLUDE,
    });
    return this.withWrittenCount(updated);
  }

  /** A reader always gets a whole section: typed ones at the typist's Done, and every one at its count. */
  private async assertSectionWhole(row: AssignmentRow): Promise<void> {
    const section = { testId: row.testId, baseConfigSectionId: row.baseConfigSectionId };
    // A picked section's typist only fixes what comes back, so it never finishes the section.
    const typed = row.test.paperSource === PAPER_SOURCES.FRAMED;
    const [typing, onPaper] = await Promise.all([
      typed
        ? this.prisma.questionAssignment.count({
            where: {
              ...section,
              role: ASSIGNMENT_ROLES.TYPIST,
              finalizedAt: null,
              replacedAt: null,
            },
          })
        : 0,
      this.prisma.paperQuestion.count({ where: section }),
    ]);
    const needed = row.baseConfigSection.questionCount;
    if (typing > 0) throw notWhole('Its typist has not marked this section done yet.');
    if (onPaper < needed) {
      throw notWhole(`The paper holds ${onPaper} of the ${needed} questions this section needs.`);
    }
  }

  /** Released means every question on the paper was looked at and passed, not only most of them. */
  private async assertEveryQuestionChecked(row: AssignmentRow): Promise<void> {
    const unchecked = await this.prisma.paperQuestion.count({
      where: { ...uncheckedOn(row.testId), baseConfigSectionId: row.baseConfigSectionId },
    });
    if (unchecked > 0) {
      throw notWhole(`${unchecked} of this section's questions are not checked yet.`);
    }
  }

  /** Not theirs reads as not there. */
  private async requireOwn(
    id: string,
    adminId: string,
    isSuperAdmin: boolean,
  ): Promise<AssignmentRow> {
    const row = await this.prisma.questionAssignment.findUnique({
      where: { id },
      include: ASSIGNMENT_INCLUDE,
    });
    if (!row || (row.assigneeId !== adminId && !isSuperAdmin)) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'No such assignment');
    }
    return row;
  }

  /** Every assignment on a row's own (test, section), not just the row's — the typist's work counts for the reader. */
  private async sectionWrittenCounts(
    rows: readonly { testId: string; baseConfigSectionId: string }[],
  ): Promise<Map<string, SectionCounts>> {
    const sections = [...new Map(rows.map((row) => [sectionKey(row), row])).values()];
    if (sections.length === 0) return new Map();

    const held = await this.prisma.questionAssignment.findMany({
      where: {
        OR: sections.map(({ testId, baseConfigSectionId }) => ({ testId, baseConfigSectionId })),
      },
      select: {
        id: true,
        testId: true,
        baseConfigSectionId: true,
        role: true,
        finalizedAt: true,
        replacedAt: true,
      },
    });
    const ids = held.map((row) => row.id);
    const written =
      ids.length === 0
        ? []
        : await this.prisma.question.groupBy({
            by: ['assignmentId'],
            where: { assignmentId: { in: ids } },
            _count: { _all: true },
          });
    const writtenBy = new Map(written.map((row) => [row.assignmentId, row._count._all]));

    const bySection = new Map(sections.map((row) => [sectionKey(row), NO_COUNTS]));
    for (const row of held) {
      const key = sectionKey(row);
      const so_far = bySection.get(key);
      if (!so_far) continue;
      bySection.set(key, {
        writtenCount: so_far.writtenCount + (writtenBy.get(row.id) ?? 0),
        typistDone:
          row.role === ASSIGNMENT_ROLES.TYPIST && !row.replacedAt
            ? row.finalizedAt !== null
            : so_far.typistDone,
        readerDone:
          row.role === ASSIGNMENT_ROLES.PROOFREADER && !row.replacedAt
            ? row.finalizedAt !== null
            : so_far.readerDone,
      });
    }
    return bySection;
  }

  private async withWrittenCount(row: AssignmentRow): Promise<Assignment> {
    const counts = await this.sectionWrittenCounts([row]);
    return toAssignment(row, counts.get(sectionKey(row)) ?? NO_COUNTS);
  }

  private async requireTest(id: string): Promise<{
    id: string;
    baseConfigId: string;
    paperSource: PaperSource | null;
    finalizedAt: Date | null;
  }> {
    const test = await this.prisma.test.findUnique({
      where: { id },
      select: { id: true, baseConfigId: true, paperSource: true, finalizedAt: true },
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
    const clash = await this.prisma.questionAssignment.findFirst({
      where: { testId, baseConfigSectionId: sectionId, role: otherRole(role), replacedAt: null },
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

/** Nobody is handed a section until the test says where its questions come from. */
function assertSourceChosen(paperSource: PaperSource | null): void {
  if (paperSource === null) {
    throw new AppException(ErrorCodes.CONFLICT, SOURCE_UNCHOSEN_MESSAGE, {
      fieldErrors: { [FORM_LEVEL_FIELD]: [SOURCE_UNCHOSEN_MESSAGE] },
    });
  }
}

/** One row per (test, section), carrying both halves of its work — never one row per role. */
function sectionRow(test: QueueTest, section: QueueSection): SectionProgressRow {
  return {
    testId: test.id,
    testTitle: test.title,
    baseConfigSectionId: section.id,
    sectionName: section.name,
    ...NO_COUNTS,
    sectionQuestionCount: section.questionCount,
    typing: roleProgress(test, section, ASSIGNMENT_ROLES.TYPIST),
    reading: roleProgress(test, section, ASSIGNMENT_ROLES.PROOFREADER),
  };
}

/** A section is only unique within its own test — two tests can share a base config's section id. */
const sectionKey = (row: { testId: string; baseConfigSectionId: string }): string =>
  `${row.testId}:${row.baseConfigSectionId}`;

/** What a section holds, counted across every assignment on it. */
export interface SectionCounts {
  writtenCount: number;
  typistDone: boolean | null;
  readerDone: boolean | null;
}

const NO_COUNTS: SectionCounts = { writtenCount: 0, typistDone: null, readerDone: null };

function toAssignment(
  row: AssignmentRow,
  counts: SectionCounts,
  removable: boolean | null = null,
): Assignment {
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
    writtenCount: counts.writtenCount,
    typistDone: counts.typistDone,
    readerDone: counts.readerDone,
    testOffered: row.test.finalizedAt !== null,
    handedAt: row.handedAt?.toISOString() ?? null,
    replacedAt: row.replacedAt?.toISOString() ?? null,
    removable,
    sectionQuestionCount: row.baseConfigSection.questionCount,
    sectionMix: sectionMixOf(row.test.questionPoolFilter, row.baseConfigSectionId),
    sectionSubjectId: row.baseConfigSection.subjectId,
  };
}

/** Absent means the section draws every difficulty, not zero of each — never defaulted here. */
function sectionMixOf(questionPoolFilter: unknown, sectionId: string): DifficultyMix | null {
  const spec = questionPoolFilter as DrawSpec | null;
  return spec?.sections?.[sectionId]?.mix ?? null;
}

function toAssignmentWithTest(
  row: AssignmentWithTestRow,
  counts: SectionCounts,
): AssignmentWithTest {
  return { ...toAssignment(row, counts), testTitle: row.test.title };
}
