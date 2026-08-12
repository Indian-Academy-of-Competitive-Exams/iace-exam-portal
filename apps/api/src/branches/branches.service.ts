import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  type Branch,
  type BranchListQuery,
  type CreateBranchBody,
  type Paginated,
  type UpdateBranchBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { branchDeletionBlocker, branchEditBlocker } from './branch-rules';

const BRANCH_INCLUDE = {
  _count: { select: { groups: true } },
} as const satisfies Prisma.BranchInclude;

interface BranchRow {
  id: string;
  name: string;
  isGlobal: boolean;
  isActive: boolean;
  createdAt: Date;
  _count: { groups: number };
}

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: BranchListQuery): Promise<Paginated<Branch>> {
    const where: Prisma.BranchWhereInput = {
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.activeOnly ? { isActive: true } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.branch.findMany({
        where,
        include: BRANCH_INCLUDE,
        // GLOBAL first: it is the one every admin is looking for by default,
        // and alphabetical order would bury it somewhere in the middle.
        orderBy: [{ isGlobal: 'desc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.branch.count({ where }),
    ]);

    return { items: rows.map(toBranch), page: query.page, pageSize: query.pageSize, total };
  }

  async create(input: CreateBranchBody): Promise<Branch> {
    // The name arrives canonical from the schema, so this catches the real
    // duplicate rather than a differently-typed one.
    const clash = await this.prisma.branch.findUnique({ where: { name: input.name } });
    if (clash) {
      throw new AppException(ErrorCodes.CONFLICT, 'That branch already exists', {
        fieldErrors: { name: ['That branch already exists'] },
      });
    }

    const branch = await this.prisma.branch.create({
      data: { name: input.name },
      include: BRANCH_INCLUDE,
    });
    return toBranch(branch);
  }

  async update(id: string, input: UpdateBranchBody): Promise<Branch> {
    const branch = await this.requireBranch(id);

    const blocker = branchEditBlocker(branch, input);
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    if (input.name !== undefined && input.name !== branch.name) {
      const clash = await this.prisma.branch.findUnique({ where: { name: input.name } });
      if (clash) {
        throw new AppException(ErrorCodes.CONFLICT, 'That branch already exists', {
          fieldErrors: { name: ['That branch already exists'] },
        });
      }
    }

    const updated = await this.prisma.branch.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
      include: BRANCH_INCLUDE,
    });
    return toBranch(updated);
  }

  async remove(id: string): Promise<void> {
    const branch = await this.requireBranch(id);

    const blocker = branchDeletionBlocker({
      groupCount: branch._count.groups,
      isGlobal: branch.isGlobal,
    });
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    await this.prisma.branch.delete({ where: { id } });
  }

  private async requireBranch(id: string): Promise<BranchRow> {
    const branch = await this.prisma.branch.findUnique({ where: { id }, include: BRANCH_INCLUDE });
    if (!branch) throw new AppException(ErrorCodes.NOT_FOUND, 'No such branch');
    return branch;
  }
}

function toBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    name: row.name,
    isGlobal: row.isGlobal,
    isActive: row.isActive,
    groupCount: row._count.groups,
    createdAt: row.createdAt.toISOString(),
  };
}
