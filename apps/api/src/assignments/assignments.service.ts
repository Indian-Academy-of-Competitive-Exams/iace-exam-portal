import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ASSIGNMENT_ROLES,
  AppException,
  ErrorCodes,
  FEATURES,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  satisfiesLevel,
  type Assignment,
  type AssignableAdmin,
  type AssignmentRole,
  type AssignmentWithTest,
  type CreateAssignmentBody,
  type FeatureKey,
  type MineAssignmentsQuery,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AdminsService } from '../admins';
import { isUniqueViolation } from '../common/prisma-errors';

const ASSIGNMENT_INCLUDE = {
  baseConfigSection: { select: { name: true } },
  assignee: { select: { fullName: true, email: true } },
} as const satisfies Prisma.QuestionAssignmentInclude;

type AssignmentRow = Prisma.QuestionAssignmentGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>;

const WITH_TEST_INCLUDE = {
  ...ASSIGNMENT_INCLUDE,
  test: { select: { title: true } },
} as const satisfies Prisma.QuestionAssignmentInclude;

type AssignmentWithTestRow = Prisma.QuestionAssignmentGetPayload<{
  include: typeof WITH_TEST_INCLUDE;
}>;

/** The key a role's work needs — assigning it to someone without it would fail every write they made. */
const FEATURE_FOR_ROLE: Record<AssignmentRole, FeatureKey> = {
  [ASSIGNMENT_ROLES.TYPIST]: FEATURE_KEYS.QUESTION_AUTHORING,
  [ASSIGNMENT_ROLES.PROOFREADER]: FEATURE_KEYS.QUESTION_PROOFREAD,
};

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
    return this.admins.holdersOf(FEATURE_FOR_ROLE[role], PERMISSION_LEVELS.WRITE);
  }

  async assign(testId: string, body: CreateAssignmentBody, actorId: string): Promise<Assignment> {
    const test = await this.requireTest(testId);
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

  async mine(adminId: string, query: MineAssignmentsQuery): Promise<AssignmentWithTest[]> {
    const rows = await this.prisma.questionAssignment.findMany({
      where: { assigneeId: adminId, ...(query.outstanding ? { finalizedAt: null } : {}) },
      include: WITH_TEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const written = await this.sectionWrittenCounts(rows);
    return rows.map((row) => toAssignmentWithTest(row, written.get(sectionKey(row)) ?? 0));
  }

  /** Idempotent: finalising twice hands back the same row rather than erroring on the second call. */
  async finalize(id: string, adminId: string): Promise<Assignment> {
    const row = await this.prisma.questionAssignment.findUnique({
      where: { id },
      include: ASSIGNMENT_INCLUDE,
    });
    // Not theirs reads as not there — the same guard authoring.service.ts uses for a draft.
    if (!row || row.assigneeId !== adminId) {
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

  private async requireTest(id: string): Promise<{ id: string; baseConfigId: string }> {
    const test = await this.prisma.test.findUnique({
      where: { id },
      select: { id: true, baseConfigId: true },
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
  };
}

function toAssignmentWithTest(
  row: AssignmentWithTestRow,
  writtenCount: number,
): AssignmentWithTest {
  return { ...toAssignment(row, writtenCount), testTitle: row.test.title };
}
