import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  fieldDiff,
  stageTakesConfigs,
  type CreateExamStageBody,
  type ExamMode,
  type ExamStage,
  type ExamStageListQuery,
  type Paginated,
  type StageDisposition,
  type UpdateExamStageBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContext } from '../audit';
import {
  CATALOG_ONLY_STAGE_MESSAGE,
  INACTIVE_STAGE_MESSAGE,
  stageDeletionBlocker,
  stageEditBlocker,
  type StageUsage,
} from './exam-rules';

const STAGE_INCLUDE = {
  exam: { select: { id: true, code: true, name: true, family: true } },
  _count: { select: { baseConfigs: true, tests: true, series: true } },
} as const satisfies Prisma.ExamStageInclude;

type StageRow = Prisma.ExamStageGetPayload<{ include: typeof STAGE_INCLUDE }>;

/** What a stage's audit diff covers — every column an edit can change. */
export const AUDITED_STAGE_FIELDS = [
  'stageKey',
  'name',
  'order',
  'mode',
  'disposition',
  'isActive',
] as const;

/** Owns `ExamStage` — the level a base config, a series and a test all hang off. */
@Injectable()
export class ExamStagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContext,
  ) {}

  async list(query: ExamStageListQuery): Promise<Paginated<ExamStage>> {
    const where: Prisma.ExamStageWhereInput = {
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.examId ? { examId: { in: query.examId } } : {}),
      ...(query.family ? { exam: { family: query.family } } : {}),
      ...(query.disposition ? { disposition: query.disposition } : {}),
      ...(query.activeOnly ? { isActive: true } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.examStage.findMany({
        where,
        include: STAGE_INCLUDE,
        // The journey's own order, exam by exam — a stage list read in any other
        // order is a list nobody can check against the notification.
        orderBy: [{ exam: { name: 'asc' } }, { order: 'asc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.examStage.count({ where }),
    ]);

    return { items: rows.map(toStage), page: query.page, pageSize: query.pageSize, total };
  }

  async create(input: CreateExamStageBody): Promise<ExamStage> {
    await this.requireExam(input.examId);
    await this.assertKeyFree(input.stageKey);

    const stage = await this.prisma.examStage.create({
      data: {
        examId: input.examId,
        stageKey: input.stageKey,
        name: input.name,
        ...(input.order === undefined ? {} : { order: input.order }),
        ...(input.mode === undefined ? {} : { mode: input.mode }),
        ...(input.disposition === undefined ? {} : { disposition: input.disposition }),
      },
      include: STAGE_INCLUDE,
    });
    return toStage(stage);
  }

  /** A stage never moves exam, so `examId` is not on the patch — see `updateExamStageSchema`. */
  async update(id: string, input: UpdateExamStageBody): Promise<ExamStage> {
    const stage = await this.requireStage(id);

    // The diff, not the body: a PATCH that re-sends the current key is not a key change, and
    // treating it as one would make the row uneditable forever.
    const changes = {
      ...(input.stageKey !== undefined && input.stageKey !== stage.stageKey
        ? { stageKey: input.stageKey }
        : {}),
      ...(input.name !== undefined && input.name !== stage.name ? { name: input.name } : {}),
      ...(input.order !== undefined && input.order !== stage.order ? { order: input.order } : {}),
      ...(input.mode !== undefined && input.mode !== stage.mode ? { mode: input.mode } : {}),
      ...(input.disposition !== undefined && input.disposition !== stage.disposition
        ? { disposition: input.disposition }
        : {}),
      ...(input.isActive !== undefined && input.isActive !== stage.isActive
        ? { isActive: input.isActive }
        : {}),
    };

    if (changes.stageKey !== undefined) {
      const blocker = stageEditBlocker(usageOf(stage), changes);
      if (blocker) {
        throw new AppException(ErrorCodes.CONFLICT, blocker, {
          fieldErrors: { stageKey: [blocker] },
        });
      }
      await this.assertKeyFree(changes.stageKey, id);
    }

    const updated = await this.prisma.examStage.update({
      where: { id },
      data: changes,
      include: STAGE_INCLUDE,
    });

    this.auditContext.setChanged(fieldDiff(stage, { ...stage, ...changes }, AUDITED_STAGE_FIELDS));

    return toStage(updated);
  }

  async remove(id: string): Promise<void> {
    const stage = await this.requireStage(id);

    const blocker = stageDeletionBlocker(usageOf(stage));
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    await this.prisma.examStage.delete({ where: { id } });
  }

  /**
   * Whether a stage may be built on. For whoever is about to attach a base config, a series or a
   * test to one — the field key is a parameter, as it is on the exam catalog.
   */
  async assertUsable(stageId: string, fieldKey = 'examStageId'): Promise<void> {
    const stage = await this.prisma.examStage.findUnique({
      where: { id: stageId },
      select: { isActive: true, disposition: true },
    });
    if (!stage) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'No such stage', {
        fieldErrors: { [fieldKey]: ['Pick a stage'] },
      });
    }
    if (!stage.isActive) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, INACTIVE_STAGE_MESSAGE, {
        fieldErrors: { [fieldKey]: [INACTIVE_STAGE_MESSAGE] },
      });
    }
    // A stage nobody sits carries no paper. It is in the catalog so the journey reads whole.
    if (!stageTakesConfigs(stage.disposition as StageDisposition)) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, CATALOG_ONLY_STAGE_MESSAGE, {
        fieldErrors: { [fieldKey]: [CATALOG_ONLY_STAGE_MESSAGE] },
      });
    }
  }

  private async requireExam(examId: string): Promise<void> {
    const exam = await this.prisma.exam.findUnique({ where: { id: examId }, select: { id: true } });
    if (!exam) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'No such exam', {
        fieldErrors: { examId: ['No such exam'] },
      });
    }
  }

  private async requireStage(id: string): Promise<StageRow> {
    const stage = await this.prisma.examStage.findUnique({ where: { id }, include: STAGE_INCLUDE });
    if (!stage) throw new AppException(ErrorCodes.NOT_FOUND, 'No such stage');
    return stage;
  }

  private async assertKeyFree(stageKey: string, exceptId?: string): Promise<void> {
    const taken = await this.prisma.examStage.findUnique({
      where: { stageKey },
      select: { id: true },
    });
    if (!taken || taken.id === exceptId) return;

    // Table-wide, not per exam: a seed script names a stage by this alone.
    throw new AppException(ErrorCodes.CONFLICT, 'That stage key is already taken', {
      fieldErrors: { stageKey: ['That stage key is already taken'] },
    });
  }
}

function usageOf(row: StageRow): StageUsage {
  return {
    configCount: row._count.baseConfigs,
    testCount: row._count.tests,
    seriesCount: row._count.series,
  };
}

function toStage(row: StageRow): ExamStage {
  return {
    id: row.id,
    examId: row.examId,
    exam: row.exam,
    stageKey: row.stageKey,
    name: row.name,
    order: row.order,
    mode: row.mode as ExamMode,
    disposition: row.disposition as StageDisposition,
    isActive: row.isActive,
    ...usageOf(row),
    createdAt: row.createdAt.toISOString(),
  };
}
