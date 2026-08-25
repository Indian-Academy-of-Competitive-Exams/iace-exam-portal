import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  PAPER_BINDING,
  fieldDiff,
  type BaseConfigDetail,
  type CreateTestBody,
  type Paginated,
  type QuestionPoolFilter,
  type Test,
  type TestDetail,
  type TestListQuery,
  type TestScopeRef,
  type UpdateTestBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { AuditContext } from '../audit';
import { BaseConfigsService } from '../configs';
import {
  SAT_TEST_MESSAGE,
  locksOutTestEdit,
  paperBindingIssue,
  scopeRefIssue,
  TEST_DEFAULTS,
  testDeletionBlocker,
  unfreezing,
} from './test-rules';

const TEST_INCLUDE = {
  baseConfig: { select: { name: true, totalQuestions: true, durationSec: true } },
  examStage: {
    select: {
      id: true,
      stageKey: true,
      name: true,
      exam: { select: { id: true, code: true, name: true, family: true } },
    },
  },
  _count: { select: { attempts: true, series: true, paperQuestions: true } },
} as const satisfies Prisma.TestInclude;

type TestRow = Prisma.TestGetPayload<{ include: typeof TEST_INCLUDE }>;

/** What a test's audit diff covers. Its shape lives on the config and is diffed there. */
export const AUDITED_TEST_FIELDS = [
  'title',
  'isLocked',
  'scope',
  'evaluationMode',
  'paperBinding',
  'maxRetakes',
  'drawStrategy',
  'status',
] as const;

/** Owns `Test`: what it covers and how it is judged. Its shape is its `BaseConfig`'s. */
@Injectable()
export class TestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: BaseConfigsService,
    private readonly auditContext: AuditContext,
    private readonly events: DomainEventBus,
  ) {}

  async list(query: TestListQuery): Promise<Paginated<Test>> {
    const where: Prisma.TestWhereInput = {
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.examStageId ? { examStageId: query.examStageId } : {}),
      ...(query.examId ? { examStage: { examId: { in: query.examId } } } : {}),
      ...(query.baseConfigId ? { baseConfigId: query.baseConfigId } : {}),
      ...(query.status ? { status: { in: query.status } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.test.findMany({
        where,
        include: TEST_INCLUDE,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.test.count({ where }),
    ]);

    return { items: rows.map(toTest), page: query.page, pageSize: query.pageSize, total };
  }

  async detail(id: string): Promise<TestDetail> {
    const row = await this.requireTest(id);
    return { ...toTest(row), baseConfig: await this.configs.detail(row.baseConfigId) };
  }

  /** The stage comes off the CONFIG, never the body — the composite FK needs them agreeing. */
  async create(input: CreateTestBody, createdById: string): Promise<TestDetail> {
    const config = await this.configs.assertUsable(input.baseConfigId);

    const scope = input.scope ?? TEST_DEFAULTS.scope;
    const evaluationMode = input.evaluationMode ?? TEST_DEFAULTS.evaluationMode;
    const paperBinding = input.paperBinding ?? TEST_DEFAULTS.paperBinding;
    const scopeRef = input.scopeRef ?? null;
    this.assertJudgeable(evaluationMode, paperBinding);
    this.assertCovers(config, scope, scopeRef);

    const created = await this.prisma.test.create({
      data: {
        baseConfigId: config.id,
        examStageId: config.examStageId,
        title: input.title,
        scope,
        scopeRef: toJson(scopeRef),
        evaluationMode,
        paperBinding,
        maxRetakes: input.maxRetakes ?? null,
        drawStrategy: input.drawStrategy ?? TEST_DEFAULTS.drawStrategy,
        questionPoolFilter: toJson(input.questionPoolFilter ?? null),
        createdById,
      },
    });

    return this.detail(created.id);
  }

  async update(id: string, input: UpdateTestBody): Promise<TestDetail> {
    const test = await this.requireTest(id);

    const shapeChange = locksOutTestEdit(input);
    if (test._count.attempts > 0 && shapeChange) {
      throw new AppException(ErrorCodes.CONFLICT, SAT_TEST_MESSAGE, {
        fieldErrors: { [FORM_LEVEL_FIELD]: [SAT_TEST_MESSAGE] },
      });
    }

    const config = await this.configs.detail(test.baseConfigId);
    // Judged against what the test WILL hold: either half of the pair may be the one moving.
    const scope = input.scope ?? test.scope;
    const scopeRef = input.scopeRef === undefined ? scopeRefOf(test) : (input.scopeRef ?? null);
    this.assertJudgeable(
      input.evaluationMode ?? test.evaluationMode,
      input.paperBinding ?? test.paperBinding,
    );
    this.assertCovers(config, scope, scopeRef);

    // A paper belongs to a FIXED test. Switching to per-attempt leaves rows nothing will ever read.
    if (
      input.paperBinding === PAPER_BINDING.GENERATED &&
      test.paperBinding !== input.paperBinding
    ) {
      await this.prisma.paperQuestion.deleteMany({ where: { testId: id } });
    }

    const updated = await this.prisma.test.update({
      where: { id },
      data: {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        ...(input.scopeRef === undefined ? {} : { scopeRef: toJson(input.scopeRef ?? null) }),
        ...(input.evaluationMode === undefined ? {} : { evaluationMode: input.evaluationMode }),
        ...(input.paperBinding === undefined ? {} : { paperBinding: input.paperBinding }),
        ...(input.maxRetakes === undefined ? {} : { maxRetakes: input.maxRetakes ?? null }),
        ...(input.drawStrategy === undefined ? {} : { drawStrategy: input.drawStrategy }),
        ...(input.questionPoolFilter === undefined
          ? {}
          : { questionPoolFilter: toJson(input.questionPoolFilter ?? null) }),
        ...(shapeChange ? unfreezing(test) : {}),
      },
      include: TEST_INCLUDE,
    });

    this.auditContext.setChanged(fieldDiff(test, updated, AUDITED_TEST_FIELDS));

    return { ...toTest(updated), baseConfig: config };
  }

  async remove(id: string): Promise<void> {
    const test = await this.requireTest(id);

    const blocker = testDeletionBlocker({ attemptCount: test._count.attempts });
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    // Read before the delete cascades them, or nothing is left to tell the catalog about.
    const links = await this.prisma.testSeriesTest.findMany({
      where: { testId: id },
      select: { testSeriesId: true },
    });

    await this.prisma.test.delete({ where: { id } });

    for (const link of links) {
      this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: link.testSeriesId });
    }
  }

  private assertJudgeable(
    evaluationMode: TestRow['evaluationMode'],
    paperBinding: TestRow['paperBinding'],
  ): void {
    const issue = paperBindingIssue(evaluationMode, paperBinding);
    if (issue) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, issue, {
        fieldErrors: { paperBinding: [issue] },
      });
    }
  }

  /** The scope has to name a part of THIS config, or the draw has nothing to narrow to. */
  private assertCovers(
    config: BaseConfigDetail,
    scope: TestRow['scope'],
    scopeRef: TestScopeRef | null,
  ): void {
    const issue = scopeRefIssue(scope, scopeRef) ?? unknownReference(config, scopeRef);
    if (issue) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, issue, {
        fieldErrors: { scopeRef: [issue] },
      });
    }
  }

  private async requireTest(id: string): Promise<TestRow> {
    const test = await this.prisma.test.findUnique({ where: { id }, include: TEST_INCLUDE });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    return test;
  }
}

function unknownReference(config: BaseConfigDetail, scopeRef: TestScopeRef | null): string | null {
  if (scopeRef?.moduleId && !config.modules.some((module) => module.id === scopeRef.moduleId)) {
    return 'That module is not part of this config.';
  }
  if (
    scopeRef?.sectionId &&
    !config.sections.some((section) => section.id === scopeRef.sectionId)
  ) {
    return 'That section is not part of this config.';
  }
  return null;
}

/** `DbNull` is the column's own NULL; a bare `null` on a Json field means "leave it alone". */
function toJson(
  value: TestScopeRef | QuestionPoolFilter | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function scopeRefOf(row: { scopeRef: Prisma.JsonValue }): TestScopeRef | null {
  return (row.scopeRef as TestScopeRef | null) ?? null;
}

function toTest(row: TestRow): Test {
  return {
    id: row.id,
    title: row.title,
    baseConfigId: row.baseConfigId,
    baseConfigName: row.baseConfig.name,
    totalQuestions: row.baseConfig.totalQuestions,
    durationSec: row.baseConfig.durationSec,
    examStageId: row.examStageId,
    examStage: row.examStage,
    scope: row.scope,
    scopeRef: scopeRefOf(row),
    evaluationMode: row.evaluationMode,
    paperBinding: row.paperBinding,
    maxRetakes: row.maxRetakes,
    drawStrategy: row.drawStrategy,
    questionPoolFilter: (row.questionPoolFilter as QuestionPoolFilter | null) ?? null,
    status: row.status,
    isLocked: row.isLocked,
    version: row.version,
    finalizedAt: row.finalizedAt?.toISOString() ?? null,
    attemptCount: row._count.attempts,
    seriesCount: row._count.series,
    paperQuestionCount: row._count.paperQuestions,
    createdAt: row.createdAt.toISOString(),
  };
}
