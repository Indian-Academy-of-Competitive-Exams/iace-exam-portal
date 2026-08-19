import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  DIRECT_GRANT_MESSAGE,
  ErrorCodes,
  GROUP_REACH,
  GROUP_TYPES_ACCEPTING_GRANTS,
  acceptsDirectGrants,
  deactivatedMemberBlocker,
  fieldDiff,
  groupReach,
  groupShapeIssue,
  type AddGroupMembersResult,
  type BranchType,
  type CreateGroupBody,
  type GroupListQuery,
  type GroupShapeIssue,
  type GroupSummary,
  type GroupType,
  type Paginated,
  type UpdateGroupBody,
} from '@iace/contracts';
import { BranchesService } from '../branches';
import { ExamTypesService } from '../configs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContext } from '../audit';
import { groupDeletionBlocker, groupEditBlocker } from './group-rules';

const GROUP_INCLUDE = {
  branches: { select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } },
  _count: { select: { testSeries: true } },
} as const satisfies Prisma.GroupInclude;

interface GroupRow {
  id: string;
  name: string;
  type: GroupType;
  examType: string | null;
  isActive: boolean;
  branches: { id: string; name: string; type: BranchType }[];
  description: string | null;
  createdAt: Date;
  _count: { testSeries: number };
}

/** What a group's audit diff covers. `branchIds` is the relation flattened to ids. */
export const AUDITED_GROUP_FIELDS = [
  'name',
  'examType',
  'branchIds',
  'description',
  'isActive',
] as const;

/** Owns `Group` and the `Group`⇄`Student` membership link (docs/03 §5). */
@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branches: BranchesService,
    // Mutual: `configs` counts groups per exam type, and groups validate against the catalog.
    @Inject(forwardRef(() => ExamTypesService))
    private readonly examTypes: ExamTypesService,
    private readonly auditContext: AuditContext,
  ) {}

  async list(query: GroupListQuery): Promise<Paginated<GroupSummary>> {
    const search = query.q?.trim();
    const where: Prisma.GroupWhereInput = {
      ...(query.branchId ? { branches: { some: { id: query.branchId } } } : {}),
      ...(query.acceptsGrants ? { type: { in: [...GROUP_TYPES_ACCEPTING_GRANTS] } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { branches: { some: { name: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.group.findMany({
        where,
        include: GROUP_INCLUDE,
        orderBy: [{ name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.group.count({ where }),
    ]);

    const counts = await this.prisma.$transaction(rows.map((row) => this.studentCountFor(row)));

    return {
      items: rows.map((row, index) => toSummary(row, counts[index] ?? 0)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async detail(id: string): Promise<GroupSummary> {
    const group = await this.requireGroup(id);
    return toSummary(group, await this.studentCountFor(group));
  }

  /** For the configs module: `Group.examType` stores the code, with no relation to follow. */
  countByExamType(code: string): Promise<number> {
    return this.prisma.group.count({ where: { examType: code } });
  }

  /** The same count for a whole page of codes, in one query rather than one per row. */
  async countsByExamTypes(codes: string[]): Promise<Map<string, number>> {
    if (codes.length === 0) return new Map();

    const rows = await this.prisma.group.groupBy({
      by: ['examType'],
      where: { examType: { in: codes } },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.examType ?? '', row._count._all]));
  }

  async create(input: CreateGroupBody): Promise<GroupSummary> {
    await this.assertBranchesUsable(input.branchIds);
    if (input.examType) await this.examTypes.assertUsable([input.examType], 'examType');
    await this.assertNameFree(input.examType ?? null, input.name);

    const group = await this.prisma.group.create({
      data: {
        name: input.name,
        type: input.type,
        examType: input.examType ?? null,
        description: input.description ?? null,
        branches: { connect: input.branchIds.map((id) => ({ id })) },
      },
      include: GROUP_INCLUDE,
    });
    return toSummary(group, await this.studentCountFor(group));
  }

  async update(id: string, input: UpdateGroupBody): Promise<GroupSummary> {
    const group = await this.requireGroup(id);

    const blocker = groupEditBlocker(group, input);
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    this.assertShape(
      groupShapeIssue({ type: group.type, examType: input.examType, branchIds: input.branchIds }),
    );

    // Not `!== undefined`: clearing the code sends null, and the catalog has nothing to check.
    if (input.examType) await this.examTypes.assertUsable([input.examType], 'examType');
    if (input.branchIds) await this.assertBranchesUsable(input.branchIds);

    const examType = input.examType ?? group.examType;
    const name = input.name ?? group.name;
    if (name !== group.name || examType !== group.examType)
      await this.assertNameFree(examType, name, id);

    const updatedColumns = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.examType === undefined ? {} : { examType: input.examType }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(input.branchIds
        ? { branches: { set: input.branchIds.map((branchId) => ({ id: branchId })) } }
        : {}),
    };

    const updated = await this.prisma.group.update({
      where: { id },
      data: updatedColumns,
      include: GROUP_INCLUDE,
    });

    this.auditContext.setChanged(
      fieldDiff(auditFieldsOf(group), auditFieldsOf(updated), AUDITED_GROUP_FIELDS),
    );

    return toSummary(updated, await this.studentCountFor(updated));
  }

  private assertShape(issue: GroupShapeIssue | null): void {
    if (!issue) return;
    throw new AppException(ErrorCodes.VALIDATION_ERROR, issue.message, {
      fieldErrors: { [issue.path]: [issue.message] },
    });
  }

  private async assertBranchesUsable(branchIds: readonly string[]): Promise<void> {
    await Promise.all(branchIds.map((branchId) => this.branches.assertUsable(branchId)));
  }

  private async requireGroup(id: string): Promise<GroupRow> {
    const group = await this.prisma.group.findUnique({ where: { id }, include: GROUP_INCLUDE });
    if (!group) throw new AppException(ErrorCodes.NOT_FOUND, 'No such group');
    return group;
  }

  /** Only ever deletes a group nothing depends on — see group-rules.ts. */
  async remove(id: string): Promise<void> {
    const group = await this.requireGroup(id);

    const blocker = groupDeletionBlocker({
      type: group.type,
      studentCount: await this.studentCountFor(group),
      testSeriesCount: group._count.testSeries,
    });
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    await this.prisma.group.delete({ where: { id } });
  }

  // ==========================================================================
  // Membership
  // ==========================================================================

  /**
   * Adding is a set operation: a student already in the group is left alone rather than treated as
   * an error, because selecting a whole page and adding it is the normal way this gets used.
   * A student blocked from tests joining refuses the whole add — see `deactivatedMemberBlocker`.
   */
  async addMembers(id: string, studentIds: string[]): Promise<AddGroupMembersResult> {
    const group = await this.prisma.group.findUnique({
      where: { id },
      select: { id: true, type: true },
    });
    if (!group) throw new AppException(ErrorCodes.NOT_FOUND, 'No such group');

    if (!acceptsDirectGrants(group.type)) {
      throw new AppException(ErrorCodes.CONFLICT, DIRECT_GRANT_MESSAGE, {
        fieldErrors: { studentIds: [DIRECT_GRANT_MESSAGE] },
      });
    }

    const wanted = [...new Set(studentIds)];
    const found = await this.prisma.student.findMany({
      where: { id: { in: wanted } },
      select: { id: true, isTestBlocked: true, directGroupIds: true },
    });
    if (found.length !== wanted.length) {
      throw new AppException(
        ErrorCodes.VALIDATION_ERROR,
        'One of those students no longer exists',
        {
          fieldErrors: { studentIds: ['One of those students no longer exists'] },
        },
      );
    }

    const existing = new Set(
      found.filter((student) => student.directGroupIds.includes(id)).map((student) => student.id),
    );
    const toAdd = wanted.filter((studentId) => !existing.has(studentId));
    const joining = new Set(toAdd);

    // Over the ones JOINING: a blocked student already in this group gains nothing,
    // and refusing them would block re-submitting a page already added.
    const blocker = deactivatedMemberBlocker(
      found.filter((student) => student.isTestBlocked && joining.has(student.id)).length,
    );
    if (blocker) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, blocker, {
        fieldErrors: { studentIds: [blocker] },
      });
    }

    await this.prisma.$transaction(
      toAdd.map((studentId) =>
        this.prisma.student.update({
          where: { id: studentId },
          data: { directGroupIds: { push: id } },
        }),
      ),
    );

    // Requesting a re-add of an existing member is a no-op, and a no-op leaves nothing to log.
    if (toAdd.length > 0) this.auditContext.setChanged({ members: { from: null, to: toAdd } });

    return { added: toAdd.length, alreadyMembers: wanted.length - toAdd.length };
  }

  /** Always allowed: a grant is not a floor, and a stale one must be removable. */
  async removeMember(id: string, studentId: string): Promise<void> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { directGroupIds: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    if (!student.directGroupIds.includes(id))
      throw new AppException(ErrorCodes.NOT_FOUND, 'That student is not in this group');

    await this.prisma.student.update({
      where: { id: studentId },
      data: { directGroupIds: student.directGroupIds.filter((groupId) => groupId !== id) },
    });

    this.auditContext.setChanged({ members: { from: studentId, to: null } });
  }

  // ==========================================================================

  /**
   * Names are canonical by the time they arrive, so this compares the real thing. `exceptId` keeps a
   * group from clashing with itself; without the check the unique index answers with a bare P2002.
   */
  private async assertNameFree(
    examType: string | null,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    // findFirst, not the compound unique: a null examType matches no row through
    // a unique lookup, because in SQL one null never equals another.
    const clash = await this.prisma.group.findFirst({
      where: { examType, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (clash) {
      throw new AppException(ErrorCodes.CONFLICT, 'A group with this name already exists', {
        fieldErrors: { name: ['A group with this name already exists'] },
      });
    }
  }

  /** Who is in a group depends on its type — an enrolment, everybody, or an explicit grant. */
  studentCountFor(group: Pick<GroupRow, 'id' | 'type' | 'examType'>): Prisma.PrismaPromise<number> {
    const reach = groupReach(group);
    if (reach === GROUP_REACH.EVERYONE)
      return this.prisma.student.count({ where: { deletedAt: null } });
    if (reach === GROUP_REACH.ENROLMENT && group.examType)
      return this.prisma.student.count({ where: { enrolledExams: { has: group.examType } } });
    return this.prisma.student.count({ where: { directGroupIds: { has: group.id } } });
  }
}

function auditFieldsOf(row: GroupRow): Pick<
  GroupRow,
  'name' | 'examType' | 'description' | 'isActive'
> & {
  branchIds: string[];
} {
  return {
    name: row.name,
    examType: row.examType,
    description: row.description,
    isActive: row.isActive,
    branchIds: row.branches.map((branch) => branch.id),
  };
}

function toSummary(row: GroupRow, studentCount: number): GroupSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    examType: row.examType,
    isActive: row.isActive,
    branches: row.branches,
    description: row.description,
    studentCount,
    testSeriesCount: row._count.testSeries,
    createdAt: row.createdAt.toISOString(),
  };
}
