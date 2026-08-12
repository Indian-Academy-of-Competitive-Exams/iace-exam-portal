import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  type AddGroupMembersResult,
  type CreateGroupBody,
  type GroupListQuery,
  type GroupSummary,
  type Paginated,
  type UpdateGroupBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { canRemoveFromGroup, groupDeletionBlocker, LAST_GROUP_MESSAGE } from './group-rules';

/** Counts come from the relation, so a list never issues a query per row. */
const GROUP_INCLUDE = {
  _count: { select: { students: true, testSeries: true } },
} as const satisfies Prisma.GroupInclude;

interface GroupRow {
  id: string;
  name: string;
  branch: string | null;
  description: string | null;
  createdAt: Date;
  _count: { students: number; testSeries: number };
}

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: GroupListQuery): Promise<Paginated<GroupSummary>> {
    const search = query.q?.trim();
    const where: Prisma.GroupWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { branch: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

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

    return {
      items: rows.map(toSummary),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async detail(id: string): Promise<GroupSummary> {
    const group = await this.prisma.group.findUnique({ where: { id }, include: GROUP_INCLUDE });
    if (!group) throw new AppException(ErrorCodes.NOT_FOUND, 'No such batch');
    return toSummary(group);
  }

  async create(input: CreateGroupBody): Promise<GroupSummary> {
    await this.assertNameFree(input.name);

    const group = await this.prisma.group.create({
      data: {
        name: input.name,
        branch: input.branch ?? null,
        description: input.description ?? null,
      },
      include: GROUP_INCLUDE,
    });
    return toSummary(group);
  }

  async update(id: string, input: UpdateGroupBody): Promise<GroupSummary> {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new AppException(ErrorCodes.NOT_FOUND, 'No such batch');

    if (input.name !== undefined && input.name !== group.name)
      await this.assertNameFree(input.name);

    const updated = await this.prisma.group.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.branch === undefined ? {} : { branch: input.branch }),
        ...(input.description === undefined ? {} : { description: input.description }),
      },
      include: GROUP_INCLUDE,
    });
    return toSummary(updated);
  }

  /** Only ever deletes a batch nothing depends on — see group-rules.ts. */
  async remove(id: string): Promise<void> {
    const group = await this.prisma.group.findUnique({ where: { id }, include: GROUP_INCLUDE });
    if (!group) throw new AppException(ErrorCodes.NOT_FOUND, 'No such batch');

    const blocker = groupDeletionBlocker({
      studentCount: group._count.students,
      testSeriesCount: group._count.testSeries,
    });
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    await this.prisma.group.delete({ where: { id } });
  }

  // ==========================================================================
  // Membership
  // ==========================================================================

  /**
   * Adding is a set operation: a student already in the batch is left alone
   * rather than treated as an error, because selecting a whole page and adding
   * it is the normal way this gets used.
   */
  async addMembers(id: string, studentIds: string[]): Promise<AddGroupMembersResult> {
    const group = await this.prisma.group.findUnique({
      where: { id },
      include: { students: { select: { id: true } } },
    });
    if (!group) throw new AppException(ErrorCodes.NOT_FOUND, 'No such batch');

    const wanted = [...new Set(studentIds)];
    const found = await this.prisma.student.findMany({
      where: { id: { in: wanted } },
      select: { id: true },
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

    const existing = new Set(group.students.map((s) => s.id));
    const toAdd = wanted.filter((studentId) => !existing.has(studentId));

    if (toAdd.length > 0) {
      await this.prisma.group.update({
        where: { id },
        data: { students: { connect: toAdd.map((studentId) => ({ id: studentId })) } },
      });
    }

    return { added: toAdd.length, alreadyMembers: wanted.length - toAdd.length };
  }

  /** Refuses to take a student out of their last batch — see group-rules.ts. */
  async removeMember(id: string, studentId: string): Promise<void> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { groups: { select: { id: true } } },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    const isMember = student.groups.some((group) => group.id === id);
    if (!isMember)
      throw new AppException(ErrorCodes.NOT_FOUND, 'That student is not in this batch');

    if (!canRemoveFromGroup(student.groups.length)) {
      throw new AppException(ErrorCodes.CONFLICT, LAST_GROUP_MESSAGE);
    }

    await this.prisma.group.update({
      where: { id },
      data: { students: { disconnect: { id: studentId } } },
    });
  }

  // ==========================================================================

  private async assertNameFree(name: string): Promise<void> {
    const clash = await this.prisma.group.findUnique({ where: { name } });
    if (clash) {
      throw new AppException(ErrorCodes.CONFLICT, 'A batch with that name already exists', {
        fieldErrors: { name: ['That name is taken'] },
      });
    }
  }
}

function toSummary(row: GroupRow): GroupSummary {
  return {
    id: row.id,
    name: row.name,
    branch: row.branch,
    description: row.description,
    studentCount: row._count.students,
    testSeriesCount: row._count.testSeries,
    createdAt: row.createdAt.toISOString(),
  };
}
