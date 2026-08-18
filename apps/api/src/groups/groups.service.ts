import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  GROUP_TYPE,
  deactivatedMemberBlocker,
  type AddGroupMembersResult,
  type BranchType,
  type CreateGroupBody,
  type GroupListQuery,
  type GroupSummary,
  type GroupType,
  type Paginated,
  type UpdateGroupBody,
} from '@iace/contracts';
import { BranchesService } from '../branches';
import { PrismaService } from '../prisma/prisma.service';
import { canRemoveFromGroup, groupDeletionBlocker, LAST_GROUP_MESSAGE } from './group-rules';

const GROUP_INCLUDE = {
  branches: { select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } },
  _count: { select: { testSeries: true } },
} as const satisfies Prisma.GroupInclude;

interface GroupRow {
  id: string;
  name: string;
  type: GroupType;
  examType: string | null;
  branches: { id: string; name: string; type: BranchType }[];
  description: string | null;
  createdAt: Date;
  _count: { testSeries: number };
}

/** Owns `Group` and the `Group`⇄`Student` membership link (docs/03 §5). */
@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branches: BranchesService,
  ) {}

  async list(query: GroupListQuery): Promise<Paginated<GroupSummary>> {
    const search = query.q?.trim();
    const where: Prisma.GroupWhereInput = {
      ...(query.branchId ? { branches: { some: { id: query.branchId } } } : {}),
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

    const counts = await this.studentCounts(rows.map((row) => row.id));

    return {
      items: rows.map((row) => toSummary(row, counts.get(row.id) ?? 0)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async detail(id: string): Promise<GroupSummary> {
    const group = await this.prisma.group.findUnique({ where: { id }, include: GROUP_INCLUDE });
    if (!group) throw new AppException(ErrorCodes.NOT_FOUND, 'No such group');
    return toSummary(group, await this.studentCount(id));
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
    await this.branches.assertUsable(input.branchId);
    await this.assertNameFree(null, input.name);

    const group = await this.prisma.group.create({
      data: {
        name: input.name,
        type: GROUP_TYPE.EXAM,
        description: input.description ?? null,
        branches: { connect: { id: input.branchId } },
      },
      include: GROUP_INCLUDE,
    });
    return toSummary(group, 0);
  }

  async update(id: string, input: UpdateGroupBody): Promise<GroupSummary> {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new AppException(ErrorCodes.NOT_FOUND, 'No such group');

    if (input.name !== undefined && input.name !== group.name)
      await this.assertNameFree(group.examType, input.name);

    const updated = await this.prisma.group.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
      },
      include: GROUP_INCLUDE,
    });
    return toSummary(updated, await this.studentCount(id));
  }

  /** Only ever deletes a group nothing depends on — see group-rules.ts. */
  async remove(id: string): Promise<void> {
    const group = await this.prisma.group.findUnique({ where: { id }, include: GROUP_INCLUDE });
    if (!group) throw new AppException(ErrorCodes.NOT_FOUND, 'No such group');

    const blocker = groupDeletionBlocker({
      studentCount: await this.studentCount(id),
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
   * A deactivated student joining refuses the whole add — see `deactivatedMemberBlocker`.
   */
  async addMembers(id: string, studentIds: string[]): Promise<AddGroupMembersResult> {
    const group = await this.prisma.group.findUnique({ where: { id }, select: { id: true } });
    if (!group) throw new AppException(ErrorCodes.NOT_FOUND, 'No such group');

    const wanted = [...new Set(studentIds)];
    const found = await this.prisma.student.findMany({
      where: { id: { in: wanted } },
      select: { id: true, isActive: true, directGroupIds: true },
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

    // Over the ones JOINING: a deactivated student already in this group gains nothing,
    // and refusing them would block re-submitting a page already added.
    const blocker = deactivatedMemberBlocker(
      found.filter((student) => !student.isActive && joining.has(student.id)).length,
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

    return { added: toAdd.length, alreadyMembers: wanted.length - toAdd.length };
  }

  /** Refuses to take a student out of their last group — see group-rules.ts. */
  async removeMember(id: string, studentId: string): Promise<void> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { directGroupIds: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    if (!student.directGroupIds.includes(id))
      throw new AppException(ErrorCodes.NOT_FOUND, 'That student is not in this group');

    if (!canRemoveFromGroup(student.directGroupIds.length)) {
      throw new AppException(ErrorCodes.CONFLICT, LAST_GROUP_MESSAGE);
    }

    await this.prisma.student.update({
      where: { id: studentId },
      data: { directGroupIds: student.directGroupIds.filter((groupId) => groupId !== id) },
    });
  }

  // ==========================================================================

  /**
   * Names are canonical by the time they arrive, so this compares the real thing: "SSC CGL Morning"
   * and "ssc cgl morning" are both SSC CGL MORNING and the second one is caught here rather than
   * created beside the first.
   */
  private async assertNameFree(examType: string | null, name: string): Promise<void> {
    // findFirst, not the compound unique: a null examType matches no row through
    // a unique lookup, because in SQL one null never equals another.
    const clash = await this.prisma.group.findFirst({ where: { examType, name } });
    if (clash) {
      throw new AppException(ErrorCodes.CONFLICT, 'A group with this name already exists', {
        fieldErrors: { name: ['A group with this name already exists'] },
      });
    }
  }

  /** Membership is an array on the student, so a count is a query per group. */
  private async studentCounts(groupIds: string[]): Promise<Map<string, number>> {
    if (groupIds.length === 0) return new Map();

    const counts = await this.prisma.$transaction(
      groupIds.map((groupId) =>
        this.prisma.student.count({ where: { directGroupIds: { has: groupId } } }),
      ),
    );
    return new Map(groupIds.map((groupId, index) => [groupId, counts[index] ?? 0]));
  }

  private async studentCount(groupId: string): Promise<number> {
    return this.prisma.student.count({ where: { directGroupIds: { has: groupId } } });
  }
}

function toSummary(row: GroupRow, studentCount: number): GroupSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    examType: row.examType,
    branches: row.branches,
    description: row.description,
    studentCount,
    testSeriesCount: row._count.testSeries,
    createdAt: row.createdAt.toISOString(),
  };
}
