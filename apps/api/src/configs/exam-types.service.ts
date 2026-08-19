import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  type CreateExamTypeBody,
  type ExamType,
  type ExamTypeListQuery,
  type Paginated,
  type UpdateExamTypeBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { type GroupsService } from '../groups';
import { type StudentsService } from '../students';
import {
  examTypeDeletionBlocker,
  examTypeEditBlocker,
  INACTIVE_EXAM_TYPE_MESSAGE,
  type ExamTypeUsage,
} from './exam-type-rules';

interface ExamTypeRow {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: Date;
}

/** Owns `ExamType` (docs/03 §5) — the only module that writes it. */
@Injectable()
export class ExamTypesService {
  constructor(
    private readonly prisma: PrismaService,
    // `require`, not a static import: a top-level import here re-enters the still-loading `groups`
    // barrel and throws; a CommonJS `require` tolerates the partial circular load instead.
    @Inject(
      forwardRef(
        () =>
          (module.require('../groups') as { GroupsService: typeof GroupsService }).GroupsService,
      ),
    )
    private readonly groups: GroupsService,
    // Same reason as `groups` above: `students` now imports this module for `assertUsable`.
    @Inject(
      forwardRef(
        () =>
          (module.require('../students') as { StudentsService: typeof StudentsService })
            .StudentsService,
      ),
    )
    private readonly students: StudentsService,
  ) {}

  async list(query: ExamTypeListQuery): Promise<Paginated<ExamType>> {
    const where: Prisma.ExamTypeWhereInput = {
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.activeOnly ? { isActive: true } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.examType.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.examType.count({ where }),
    ]);

    const groupCounts = await this.groups.countsByExamTypes(rows.map((row) => row.code));

    return {
      items: rows.map((row) => toExamType(row, groupCounts.get(row.code) ?? 0)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async create(input: CreateExamTypeBody): Promise<ExamType> {
    await this.assertFree(input.name, input.code);

    const examType = await this.prisma.examType.create({
      data: { name: input.name, code: input.code },
    });
    return toExamType(examType, 0);
  }

  async update(id: string, input: UpdateExamTypeBody): Promise<ExamType> {
    const examType = await this.requireExamType(id);

    // The diff, not the body: a PATCH that re-sends the current code is not a code change, and
    // treating it as one would make the row uneditable forever.
    const changes = {
      ...(input.name !== undefined && input.name !== examType.name ? { name: input.name } : {}),
      ...(input.code !== undefined && input.code !== examType.code ? { code: input.code } : {}),
      ...(input.isActive !== undefined && input.isActive !== examType.isActive
        ? { isActive: input.isActive }
        : {}),
    };

    // Only a code change can be refused, and only the four counts answer that — so an ordinary
    // rename or retire does not pay for them.
    if (changes.code !== undefined) {
      const blocker = examTypeEditBlocker(await this.usageOf(examType), changes);
      if (blocker) {
        throw new AppException(ErrorCodes.CONFLICT, blocker, { fieldErrors: { code: [blocker] } });
      }
    }

    if (changes.name !== undefined || changes.code !== undefined) {
      await this.assertFree(changes.name ?? examType.name, changes.code ?? examType.code, id);
    }

    const updated = await this.prisma.examType.update({ where: { id }, data: changes });
    return toExamType(updated, await this.groups.countByExamType(updated.code));
  }

  async remove(id: string): Promise<void> {
    const examType = await this.requireExamType(id);

    const blocker = examTypeDeletionBlocker(await this.usageOf(examType));
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    await this.prisma.examType.delete({ where: { id } });
  }

  /**
   * Whether these codes may be attached to. The field key is a PARAMETER: the group form's field is
   * `examType` and the student form's is `enrolledExams`, and `applyFieldErrors` drops the wrong one.
   */
  async assertUsable(codes: string[], fieldKey: string): Promise<void> {
    if (codes.length === 0) return;

    const found = await this.prisma.examType.findMany({ where: { code: { in: codes } } });

    const missing = codes.filter((code) => !found.some((row) => row.code === code));
    if (missing.length > 0) {
      const message = `No such exam type: ${missing.join(', ')}`;
      throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
        fieldErrors: { [fieldKey]: [message] },
      });
    }

    if (found.some((row) => !row.isActive)) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, INACTIVE_EXAM_TYPE_MESSAGE, {
        fieldErrors: { [fieldKey]: [INACTIVE_EXAM_TYPE_MESSAGE] },
      });
    }
  }

  private async requireExamType(id: string): Promise<ExamTypeRow> {
    const examType = await this.prisma.examType.findUnique({ where: { id } });
    if (!examType) throw new AppException(ErrorCodes.NOT_FOUND, 'No such exam type');
    return examType;
  }

  private async usageOf(examType: ExamTypeRow): Promise<ExamTypeUsage> {
    const [groupCount, studentCount, baseConfigCount, testCount] = await Promise.all([
      this.groups.countByExamType(examType.code),
      this.students.countEnrolledIn(examType.code),
      this.prisma.baseConfig.count({ where: { examTypeId: examType.id } }),
      this.prisma.test.count({
        where: { OR: [{ examTypeId: examType.id }, { baseConfig: { examTypeId: examType.id } }] },
      }),
    ]);
    return { groupCount, studentCount, baseConfigCount, testCount };
  }

  private async assertFree(name: string, code: string, exceptId?: string): Promise<void> {
    const [byName, byCode] = await Promise.all([
      this.prisma.examType.findUnique({ where: { name } }),
      this.prisma.examType.findUnique({ where: { code } }),
    ]);

    if (byName && byName.id !== exceptId) {
      throw new AppException(ErrorCodes.CONFLICT, 'That exam type already exists', {
        fieldErrors: { name: ['That exam type already exists'] },
      });
    }
    if (byCode && byCode.id !== exceptId) {
      throw new AppException(ErrorCodes.CONFLICT, 'That code is already taken', {
        fieldErrors: { code: ['That code is already taken'] },
      });
    }
  }
}

function toExamType(row: ExamTypeRow, groupCount: number): ExamType {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    isActive: row.isActive,
    groupCount,
    createdAt: row.createdAt.toISOString(),
  };
}
