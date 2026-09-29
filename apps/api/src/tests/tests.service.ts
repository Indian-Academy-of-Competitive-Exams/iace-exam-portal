import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  scopedSections,
  TEST_SCOPE,
  fieldDiff,
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
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { AuditContext } from '../audit';
import { BaseConfigsService } from '../configs';
import {
  PAPER_SOURCE_FIXED_MESSAGE,
  OFFERED_TEST_MESSAGE,
  SAT_TEST_MESSAGE,
  SERIES_GONE_MESSAGE,
  changedTestFields,
  inTheCatalog,
  locksOutTestEdit,
  scopeRefOf,
  testShapeOf,
  movesThePaper,
  scopeRefIssue,
  seriesFitIssue,
  seriesRefused,
  titleRefused,
  testDeletionBlocker,
} from './test-rules';
import { beginDraftPaperEdit } from './begin-paper-edit';
import { takeTestEditLock, testEditingBy, type Editor } from './edit-lock';
import { formRefusal } from '../common/form-refusal';
import { pageArgs, paged } from '../common/pagination';
import { everyTermMatches } from '../common/search-terms';

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
  'scope',
  'examTemplate',
  'status',
  'paperSource',
] as const;

/** Owns `Test`: what it covers and how it is judged. Its shape is its `BaseConfig`'s. */
@Injectable()
export class TestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: BaseConfigsService,
    private readonly auditContext: AuditContext,
    private readonly events: DomainEventBus,
    private readonly redis: RedisService,
  ) {}

  async list(query: TestListQuery): Promise<Paginated<Test>> {
    const where: Prisma.TestWhereInput = {
      ...everyTermMatches<Prisma.TestWhereInput>(query.q, (term) => [
        { title: { contains: term, mode: 'insensitive' } },
      ]),
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
        ...pageArgs(query),
      }),
      this.prisma.test.count({ where }),
    ]);

    return paged(query, rows.map(toTest), total);
  }

  async detail(id: string): Promise<TestDetail> {
    const row = await this.requireTest(id);
    return {
      ...toTest(row),
      ...toTestSchedule(row),
      baseConfig: await this.configs.detail(row.baseConfigId),
      editingBy: await testEditingBy(this.redis, this.prisma, id),
    };
  }

  /** The stage comes off the CONFIG, never the body. */
  async create(input: CreateTestBody, createdById: string): Promise<TestDetail> {
    const config = await this.configs.assertUsable(input.baseConfigId);
    const series = await this.seriesCarrying(input.testSeriesId, config.examStageId);

    await this.assertTitleFree(series.id, input.title);

    const scope = input.scope ?? TEST_SCOPE.FULL;
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

  async update(id: string, input: UpdateTestBody, editor: Editor = {}): Promise<TestDetail> {
    const test = await this.requireTest(id);
    await takeTestEditLock(this.redis, this.prisma, id, editor);
    if (input.paperSource !== undefined) {
      this.assertPaperSourceOpen(test);
    }

    const changed = changedTestFields(test, input);
    if (test._count.attempts > 0 && locksOutTestEdit(changed)) {
      throw formRefusal(ErrorCodes.CONFLICT, SAT_TEST_MESSAGE);
    }
    const paperMoves = movesThePaper(changed);
    if (test.finalizedAt !== null && paperMoves) {
      throw formRefusal(ErrorCodes.CONFLICT, OFFERED_TEST_MESSAGE);
    }

    if (input.title !== undefined) {
      await this.assertTitleFree(test.testSeriesId, input.title, id);
    }

    const config = await this.configs.detail(test.baseConfigId);
    // Judged against what the test WILL hold: either half of the pair may be the one moving.
    const scope = input.scope ?? test.scope;
    const scopeRef = input.scopeRef === undefined ? scopeRefOf(test) : (input.scopeRef ?? null);
    this.assertCovers(config, scope, scopeRef);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (paperMoves) await beginDraftPaperEdit(tx, id);
      // A row outside the new scope cannot be judged complete or offered, so a narrower scope drops it.
      if (changed.includes('scope') || changed.includes('scopeRef')) {
        const keptIds = scopedSections(config.sections, scope, scopeRef).map(
          (section) => section.id,
        );
        if (keptIds.length > 0) {
          await tx.paperQuestion.deleteMany({
            where: { testId: id, baseConfigSectionId: { notIn: keptIds } },
          });
          // Its holders stand down with the paper, or a dropped section's reader blocks the offer for ever.
          await tx.questionAssignment.updateMany({
            where: { testId: id, baseConfigSectionId: { notIn: keptIds }, replacedAt: null },
            data: { replacedAt: new Date() },
          });
        }
      }

      return tx.test.update({
        where: { id },
        data: {
          title: input.title,
          scope: input.scope,
          scopeRef: toJson(input.scopeRef),
          examTemplate: input.examTemplate,
          paperSource: input.paperSource,
          questionPoolFilter: toJson(input.questionPoolFilter),
          // An Offer step opened before this edit must be refused, so every paper edit moves the version.
          version: paperMoves ? { increment: 1 } : undefined,
        },
        include: TEST_INCLUDE,
      });
    }, TX_LIMITS.SHORT);

    this.auditContext.setChanged(fieldDiff(test, updated, AUDITED_TEST_FIELDS));

    // The catalog and the brief hold both, and an offered test may still be renamed or re-skinned.
    const shownChanged = updated.title !== test.title || updated.examTemplate !== test.examTemplate;
    if (inTheCatalog(test) && shownChanged) {
      this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: test.testSeriesId });
    }

    return {
      ...toTest(updated),
      ...toTestSchedule(updated),
      baseConfig: config,
      editingBy: await testEditingBy(this.redis, this.prisma, id),
    };
  }

  async remove(id: string): Promise<void> {
    const test = await this.requireTest(id);

    const blocker = testDeletionBlocker({ attemptCount: test._count.attempts });
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    await this.prisma.test.delete({ where: { id } });

    if (inTheCatalog(test)) {
      this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: test.testSeriesId });
    }
  }

  /** Chosen once and never again, super admin included: every assignment on the test rests on it. */
  private assertPaperSourceOpen(test: TestRow): void {
    if (test.paperSource === null) return;
    throw new AppException(ErrorCodes.CONFLICT, PAPER_SOURCE_FIXED_MESSAGE, {
      fieldErrors: { paperSource: [PAPER_SOURCE_FIXED_MESSAGE] },
    });
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

  /** The unique index is the guarantee; this is so the refusal lands on the field that caused it. */
  private async assertTitleFree(
    testSeriesId: string,
    title: string | null | undefined,
    exceptId?: string,
  ): Promise<void> {
    if (title === null || title === undefined) return;

    const clash = await this.prisma.test.findFirst({
      where: {
        testSeriesId,
        title: { equals: title, mode: 'insensitive' },
        ...(exceptId === undefined ? {} : { id: { not: exceptId } }),
      },
      select: { id: true },
    });
    if (clash !== null) throw titleRefused();
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

/** `null` becomes `DbNull`, the column's own NULL; undefined passes through, so Prisma leaves the field alone. */
function toJson(
  value: TestScopeRef | DrawSpec | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue | undefined);
}

function toTest(row: TestRow): Test {
  return {
    id: row.id,
    title: row.title,
    baseConfigId: row.baseConfigId,
    baseConfigName: row.baseConfig.name,
    ...testShapeOf(row),
    examStageId: row.examStageId,
    examStage: row.examStage,
    scope: row.scope,
    scopeRef: scopeRefOf(row),
    examTemplate: row.examTemplate,
    questionPoolFilter: (row.questionPoolFilter as DrawSpec | null) ?? null,
    paperSource: row.paperSource,
    status: row.status,
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
function toTestSchedule(row: TestRow): Omit<TestDetail, keyof Test | 'baseConfig' | 'editingBy'> {
  return {
    seriesOrder: row.seriesOrder,
    opensAt: row.opensAt?.toISOString() ?? null,
    programUnlocks: row.programUnlocks.map((unlock) => ({
      programCode: unlock.programCode,
      opensAt: unlock.opensAt.toISOString(),
    })),
  };
}
