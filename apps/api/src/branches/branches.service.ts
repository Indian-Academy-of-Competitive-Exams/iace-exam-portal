import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  BRANCH_TYPE,
  ErrorCodes,
  fieldDiff,
  type Branch,
  type BranchListQuery,
  type BranchType,
  type CreateBranchBody,
  type Paginated,
  type StudentType,
  type UpdateBranchBody,
} from '@iace/contracts';
import { pageArgs, paged } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContext } from '../audit';
import {
  branchDeletionBlocker,
  branchEditBlocker,
  studentBranchBlocker,
  INACTIVE_BRANCH_MESSAGE,
  NO_ONLINE_BRANCH_MESSAGE,
  ONLINE_BRANCH_EXISTS_MESSAGE,
} from './branch-rules';
import { everyTermMatches } from '../common/search-terms';

const BRANCH_INCLUDE = {
  _count: { select: { students: true } },
} as const satisfies Prisma.BranchInclude;

interface BranchRow {
  id: string;
  name: string;
  type: BranchType;
  isActive: boolean;
  createdAt: Date;
  _count: { students: number };
}

export const AUDITED_BRANCH_FIELDS = ['name', 'isActive'] as const;

/** Owns `Branch` (docs/03 §5) — the only module that writes it. */
@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContext,
  ) {}

  /** Whether a student of this type may sit in this branch, read once. One they already sit in (`live: false`) is not refused for being retired or deleted since: that is not this save's fault. */
  async assertFitsStudent(
    branchId: string,
    studentType: StudentType,
    { live, fieldKey }: { live: boolean; fieldKey: string },
  ): Promise<void> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { type: true, isActive: true },
    });
    if (!branch && !live) return;
    if (!branch) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'No such branch', {
        fieldErrors: { [fieldKey]: ['Pick a branch'] },
      });
    }

    const refusal =
      live && !branch.isActive
        ? INACTIVE_BRANCH_MESSAGE
        : studentBranchBlocker(studentType, branch.type);
    if (refusal) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, refusal, {
        fieldErrors: { [fieldKey]: [refusal] },
      });
    }
  }

  /** The one branch every online student sits in; refused under the branch field until a super admin creates it. */
  async onlineBranchId(fieldKey: string): Promise<string> {
    const online = await this.findLiveVirtual();
    if (online) return online.id;

    throw new AppException(ErrorCodes.VALIDATION_ERROR, NO_ONLINE_BRANCH_MESSAGE, {
      fieldErrors: { [fieldKey]: [NO_ONLINE_BRANCH_MESSAGE] },
    });
  }

  async list(query: BranchListQuery): Promise<Paginated<Branch>> {
    const where: Prisma.BranchWhereInput = {
      ...everyTermMatches<Prisma.BranchWhereInput>(query.q, (term) => [
        { name: { contains: term, mode: 'insensitive' } },
      ]),
      ...(query.activeOnly ? { isActive: true } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.branch.findMany({
        where,
        include: BRANCH_INCLUDE,
        // The online branch first: it is the one every admin is looking for by default. `desc` because VIRTUAL is declared after PHYSICAL.
        orderBy: [{ type: 'desc' }, { name: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.branch.count({ where }),
    ]);

    return paged(query, rows.map(toBranch), total);
  }

  async create(input: CreateBranchBody): Promise<Branch> {
    // The name arrives canonical from the schema, so this catches the real duplicate rather than a differently-typed one.
    const clash = await this.findByName(input.name);
    if (clash) {
      throw new AppException(ErrorCodes.CONFLICT, 'That branch already exists', {
        fieldErrors: { name: ['That branch already exists'] },
      });
    }

    if (input.type === BRANCH_TYPE.VIRTUAL && (await this.findLiveVirtual())) {
      throw new AppException(ErrorCodes.CONFLICT, ONLINE_BRANCH_EXISTS_MESSAGE, {
        fieldErrors: { type: [ONLINE_BRANCH_EXISTS_MESSAGE] },
      });
    }

    const branch = await this.prisma.branch.create({
      data: { name: input.name, type: input.type },
      include: BRANCH_INCLUDE,
    });

    return toBranch(branch);
  }

  async update(id: string, input: UpdateBranchBody): Promise<Branch> {
    const branch = await this.requireBranch(id);

    const blocker = branchEditBlocker(branch, input);
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    if (input.name !== undefined && input.name !== branch.name) {
      const clash = await this.findByName(input.name);
      if (clash) {
        throw new AppException(ErrorCodes.CONFLICT, 'That branch already exists', {
          fieldErrors: { name: ['That branch already exists'] },
        });
      }
    }

    const updatedColumns = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    };

    const updated = await this.prisma.branch.update({
      where: { id },
      data: updatedColumns,
      include: BRANCH_INCLUDE,
    });

    this.auditContext.setChanged(
      fieldDiff(branch, { ...branch, ...updatedColumns }, AUDITED_BRANCH_FIELDS),
    );

    return toBranch(updated);
  }

  async remove(id: string): Promise<void> {
    const branch = await this.requireBranch(id);

    const blocker = branchDeletionBlocker({
      studentCount: branch._count.students,
      type: branch.type,
    });
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    await this.prisma.branch.delete({ where: { id } });
  }

  /** The branch's name for a screen that holds only its id. Null where it has been deleted. */
  async nameOf(branchId: string): Promise<string | null> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { name: true },
    });
    return branch?.name ?? null;
  }

  private findLiveVirtual(): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({
      where: { type: BRANCH_TYPE.VIRTUAL },
      select: { id: true },
    });
  }

  private findByName(name: string): Promise<{ id: string } | null> {
    return this.prisma.branch.findUnique({ where: { name }, select: { id: true } });
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
    type: row.type,
    isActive: row.isActive,
    studentCount: row._count.students,
    createdAt: row.createdAt.toISOString(),
  };
}
