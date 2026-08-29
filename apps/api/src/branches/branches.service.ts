import { forwardRef, Inject, Injectable } from '@nestjs/common';
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
import { branchScopeWhere, type BranchScope } from '../common/security';
import { PrismaService } from '../prisma/prisma.service';
import { type TestSeriesService } from '../access';
import { AuditContext } from '../audit';
import {
  branchDeletionBlocker,
  branchEditBlocker,
  studentBranchBlocker,
  INACTIVE_BRANCH_MESSAGE,
  ONLINE_BRANCH_EXISTS_MESSAGE,
} from './branch-rules';

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
    // `require`, not a static import: `access` reaches back here through students, and a
    // top-level import re-enters a still-loading barrel.
    @Inject(
      forwardRef(
        () =>
          (module.require('../access') as { TestSeriesService: typeof TestSeriesService })
            .TestSeriesService,
      ),
    )
    private readonly series: TestSeriesService,
    private readonly auditContext: AuditContext,
  ) {}

  /**
   * Whether a branch may take something new — used by whoever is about to attach to one. Throws with
   * the message the form should show; returns quietly when the branch is fine.
   */
  async assertUsable(branchId: string, fieldKey = 'branchId'): Promise<void> {
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'No such branch', {
        fieldErrors: { [fieldKey]: ['Pick a branch'] },
      });
    }
    if (!branch.isActive) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, INACTIVE_BRANCH_MESSAGE, {
        fieldErrors: { [fieldKey]: [INACTIVE_BRANCH_MESSAGE] },
      });
    }
  }

  /**
   * Whether a branch suits the KIND of student being put in it. Separate from `assertUsable`: a
   * patch that only changes the type leaves the stored branch alone, and a branch retired since
   * they were put in it is not this save's fault to refuse.
   */
  async assertSuitsStudentType(
    branchId: string,
    studentType: StudentType,
    fieldKey = 'branchId',
  ): Promise<void> {
    const branchType = await this.branchTypeOf(branchId);
    if (!branchType) return;

    const blocker = studentBranchBlocker(studentType, branchType);
    if (blocker) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, blocker, {
        fieldErrors: { [fieldKey]: [blocker] },
      });
    }
  }

  async list(query: BranchListQuery, scope: BranchScope): Promise<Paginated<Branch>> {
    const reachable = branchScopeWhere(scope);
    const where: Prisma.BranchWhereInput = {
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.activeOnly ? { isActive: true } : {}),
      ...(reachable ? { id: reachable } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.branch.findMany({
        where,
        include: BRANCH_INCLUDE,
        // The online branch first: it is the one every admin is looking for by
        // default. `desc` because VIRTUAL is declared after PHYSICAL.
        orderBy: [{ type: 'desc' }, { name: 'asc' }],
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
    const clash = await this.findLiveByName(input.name);
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

    // A new centre appears on every series' scheduling screen, switched off — the same rule
    // series creation follows from the other side.
    await this.series.fanOutToBranch(branch.id);

    return toBranch(branch);
  }

  async update(id: string, input: UpdateBranchBody): Promise<Branch> {
    const branch = await this.requireBranch(id);

    const blocker = branchEditBlocker(branch, input);
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    if (input.name !== undefined && input.name !== branch.name) {
      const clash = await this.findLiveByName(input.name);
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

  private async branchTypeOf(branchId: string): Promise<BranchType | null> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { type: true },
    });
    return branch?.type ?? null;
  }

  private findLiveVirtual(): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({
      where: { type: BRANCH_TYPE.VIRTUAL, deletedAt: null },
      select: { id: true },
    });
  }

  /** `name` is unique only among live rows, so this is a filtered read, not a lookup by key. */
  private findLiveByName(name: string): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({ where: { name, deletedAt: null }, select: { id: true } });
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
