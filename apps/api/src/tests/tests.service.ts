import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  TEST_SCOPE,
  fieldDiff,
  scopedQuestionCount,
  scopedDurationSec,
  type BaseConfigDetail,
  type CreateTestBody,
  type Paginated,
  type DrawSpec,
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
  SERIES_GONE_MESSAGE,
  locksOutTestEdit,
  thawsThePaper,
  scopeRefIssue,
  seriesFitIssue,
  seriesRefused,
  TEST_DEFAULTS,
  testDeletionBlocker,
} from './test-rules';
import { thaw } from './thaw';

const TEST_INCLUDE = {
  baseConfig: {
    select: {
      name: true,
      totalQuestions: true,
      durationSec: true,
      // A scoped test's paper is its own sections' worth, never the whole configuration's.
      sections: {
        select: {
          id: true,
          moduleId: true,
          questionCount: true,
          durationSec: true,
          perQuestionSec: true,
        },
      },
    },
  },
  examStage: {
    select: {
      id: true,
      stageKey: true,
      name: true,
      exam: { select: { id: true, code: true, name: true, course: true } },
    },
  },
  testSeries: { select: { name: true } },
  programUnlocks: { select: { programCode: true, opensAt: true } },
  _count: { select: { attempts: true, paperQuestions: true } },
} as const satisfies Prisma.TestInclude;

type TestRow = Prisma.TestGetPayload<{ include: typeof TEST_INCLUDE }>;

/** What a test's audit diff covers. Its shape lives on the config and is diffed there. */
export const AUDITED_TEST_FIELDS = [
  'title',
  'isLocked',
  'scope',
  'examTemplate',
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
    return {
      ...toTest(row),
      ...toTestSchedule(row),
      baseConfig: await this.configs.detail(row.baseConfigId),
    };
  }

  /** The stage comes off the CONFIG, never the body. */
  async create(input: CreateTestBody, createdById: string): Promise<TestDetail> {
    const config = await this.configs.assertUsable(input.baseConfigId);
    const series = await this.seriesCarrying(input.testSeriesId, config.examStageId);

    const scope = input.scope ?? TEST_DEFAULTS.scope;
    const scopeRef = input.scopeRef ?? null;
    this.assertCovers(config, scope, scopeRef);

    const created = await this.prisma.test.create({
      data: {
        baseConfigId: config.id,
        examStageId: config.examStageId,
        testSeriesId: series.id,
        title: input.title,
        // The config only supplies the default; from here the test owns which screen it wears.
        examTemplate: input.examTemplate ?? config.examTemplate,
        scope,
        scopeRef: toJson(scopeRef),
        questionPoolFilter: toJson(input.questionPoolFilter ?? null),
        createdById,
      },
    });

    return this.detail(created.id);
  }

  /** The series a test is born into, read before anything is written. */
  private async seriesCarrying(testSeriesId: string, examStageId: string) {
    const series = await this.prisma.testSeries.findUnique({
      where: { id: testSeriesId },
      select: { id: true, name: true, examStageId: true },
    });
    if (series === null) throw seriesRefused(SERIES_GONE_MESSAGE);

    const issue = seriesFitIssue(series, { examStageId });
    if (issue) throw seriesRefused(issue);

    return series;
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
    this.assertCovers(config, scope, scopeRef);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (thawsThePaper(input)) await thaw(tx, test);

      return tx.test.update({
        where: { id },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.scope === undefined ? {} : { scope: input.scope }),
          ...(input.scopeRef === undefined ? {} : { scopeRef: toJson(input.scopeRef ?? null) }),
          ...(input.examTemplate === undefined ? {} : { examTemplate: input.examTemplate }),
          ...(input.questionPoolFilter === undefined
            ? {}
            : { questionPoolFilter: toJson(input.questionPoolFilter ?? null) }),
          // A finalize drawing from these must lose its claim, so every paper edit moves the version.
          ...(thawsThePaper(input) ? { version: { increment: 1 } } : {}),
        },
        include: TEST_INCLUDE,
      });
    });

    this.auditContext.setChanged(fieldDiff(test, updated, AUDITED_TEST_FIELDS));

    return { ...toTest(updated), ...toTestSchedule(updated), baseConfig: config };
  }

  async remove(id: string): Promise<void> {
    const test = await this.requireTest(id);

    const blocker = testDeletionBlocker({ attemptCount: test._count.attempts });
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    await this.prisma.test.delete({ where: { id } });

    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: test.testSeriesId });
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
  value: TestScopeRef | DrawSpec | null,
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
    // A full paper is the configuration's own maintained total; a scoped one is its sections' worth.
    totalQuestions:
      row.scope === TEST_SCOPE.FULL
        ? row.baseConfig.totalQuestions
        : scopedQuestionCount(row.baseConfig.sections, row.scope, scopeRefOf(row)),
    durationSec: scopedDurationSec(
      row.baseConfig.sections,
      row.baseConfig,
      row.scope,
      scopeRefOf(row),
    ),
    examStageId: row.examStageId,
    examStage: row.examStage,
    scope: row.scope,
    scopeRef: scopeRefOf(row),
    examTemplate: row.examTemplate,
    questionPoolFilter: (row.questionPoolFilter as DrawSpec | null) ?? null,
    status: row.status,
    isLocked: row.isLocked,
    version: row.version,
    finalizedAt: row.finalizedAt?.toISOString() ?? null,
    attemptCount: row._count.attempts,
    testSeriesId: row.testSeriesId,
    testSeriesName: row.testSeries.name,
    paperQuestionCount: row._count.paperQuestions,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The columns `TestDetail` adds over `Test`: the test's own schedule, read as stored. */
function toTestSchedule(row: TestRow): Omit<TestDetail, keyof Test | 'baseConfig'> {
  return {
    seriesOrder: row.seriesOrder,
    opensAt: row.opensAt?.toISOString() ?? null,
    programUnlocks: row.programUnlocks.map((unlock) => ({
      programCode: unlock.programCode,
      opensAt: unlock.opensAt.toISOString(),
    })),
  };
}
