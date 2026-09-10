import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  TEST_STATUS,
  allowsCohortScheduling,
  type EvaluationMode,
  scopedDurationSec,
  scopedQuestionCount,
  TEST_SCOPE,
  type SeriesTestRow,
  type TestScopeRef,
  type SetSeriesTestUnlockBody,
  type SetProgramUnlockBody,
  type SetTestSeriesBody,
  type TestProgramUnlock,
  type TestSeriesLink,
  type TestStatus,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { AuditContext } from '../audit';
import {
  activationBlocker,
  seriesFitIssue,
  seriesRefused,
  SERIES_GONE_MESSAGE,
} from './test-rules';

const OFFERING_SELECT = {
  id: true,
  status: true,
  isLocked: true,
  examStageId: true,
  opensAt: true,
  evaluationMode: true,
  testSeriesId: true,
  seriesOrder: true,
  testSeries: { select: { name: true } },
  _count: { select: { attempts: true } },
} as const satisfies Prisma.TestSelect;

const SERIES_TEST_SELECT = {
  id: true,
  title: true,
  seriesOrder: true,
  opensAt: true,
  status: true,
  isLocked: true,
  // A test's questions and clock are DERIVED: a scoped paper is its own sections' worth, not the config's.
  scope: true,
  scopeRef: true,
  baseConfig: {
    select: {
      totalQuestions: true,
      durationSec: true,
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
  _count: { select: { attempts: true } },
} as const satisfies Prisma.TestSelect;

const dateOrNull = (value: string | null | undefined): Date | null =>
  value === null || value === undefined ? null : new Date(value);

const attempts = (count: number): string => `${count} ${count === 1 ? 'attempt' : 'attempts'}`;

const OPENS_BEFORE_THE_TEST_DOES =
  'A program opens a test earlier, never later — entry closes at the same instant for everyone, so a later opening would only shorten this cohort’s window.';

const TEST_HAS_NO_OPENING =
  'This test has no opening time of its own, so it is already open. Give the test an opening time before letting a program in ahead of it.';

/** The write guard's exact complement: a row the opening overtook now DELAYS its cohort, so it goes. */
async function dropUnlocksTheOpeningOvertook(
  tx: Prisma.TransactionClient,
  testId: string,
  testOpensAt: Date | null,
): Promise<void> {
  await tx.testProgramUnlock.deleteMany({
    where: { testId, ...(testOpensAt === null ? {} : { opensAt: { gt: testOpensAt } }) },
  });
}

/** No constraint can carry this: it compares a row on one table with a column on another. */
function assertOpensNoLaterThanTheTest(testOpensAt: Date | null, opensAt: Date): void {
  if (testOpensAt !== null && opensAt <= testOpensAt) return;

  const message = testOpensAt === null ? TEST_HAS_NO_OPENING : OPENS_BEFORE_THE_TEST_DOES;
  throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
    fieldErrors: { opensAt: [message] },
  });
}

const STAGGER_IS_RANKED_ONLY =
  'A program opening staggers one cohort ahead of another, which only means something where a rank compares them. This test is practice, so it opens once for everybody.';

/** A CHECK only ever sees its own row, so unlike the pair above this rule cannot live on the table. */
function assertStaggerIsRanked(evaluationMode: EvaluationMode): void {
  if (allowsCohortScheduling(evaluationMode)) return;

  throw new AppException(ErrorCodes.VALIDATION_ERROR, STAGGER_IS_RANKED_ONLY, {
    fieldErrors: { opensAt: [STAGGER_IS_RANKED_ONLY] },
  });
}

type OfferingRow = Prisma.TestGetPayload<{ select: typeof OFFERING_SELECT }>;

const linkOf = (test: OfferingRow): TestSeriesLink => ({
  testSeriesId: test.testSeriesId,
  name: test.testSeries.name,
  order: test.seriesOrder,
});

/** How a finalized test is offered: through the one series carrying it, never on its own. */
@Injectable()
export class OfferingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
    private readonly auditContext: AuditContext,
  ) {}

  async series(testId: string): Promise<TestSeriesLink> {
    return linkOf(await this.requireTest(testId));
  }

  /** One column, so the test's own clock is untouched by a move and cannot be re-saved away. */
  async moveToSeries(testId: string, input: SetTestSeriesBody): Promise<TestSeriesLink> {
    const test = await this.requireTest(testId);
    const next = input.testSeriesId;
    if (next === test.testSeriesId) return linkOf(test);

    this.assertNotSat(test);
    await this.assertSeriesUsable(test, next);

    const moved = await this.prisma.test.update({
      where: { id: testId },
      data: { testSeriesId: next, seriesOrder: null },
      select: OFFERING_SELECT,
    });

    // Both sides: the catalog a student reads is cached against the series it moved between.
    for (const testSeriesId of [test.testSeriesId, next]) {
      this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId });
    }

    return linkOf(moved);
  }

  async setStatus(testId: string, status: TestStatus): Promise<TestStatus> {
    const test = await this.requireTest(testId);
    if (test.status === status) return status;

    if (status === TEST_STATUS.ACTIVE) {
      const blocker = activationBlocker(test);
      if (blocker) {
        throw new AppException(ErrorCodes.CONFLICT, blocker, {
          fieldErrors: { [FORM_LEVEL_FIELD]: [blocker] },
        });
      }
    }

    await this.prisma.test.update({ where: { id: testId }, data: { status } });
    this.announce(test);

    return status;
  }

  /** A series must exist, be built for this test's stage, and judge it the way it is judged. */
  private async assertSeriesUsable(test: OfferingRow, testSeriesId: string): Promise<void> {
    const series = await this.prisma.testSeries.findUnique({
      where: { id: testSeriesId },
      select: { name: true, examStageId: true, evaluationMode: true },
    });
    if (series === null) throw seriesRefused(SERIES_GONE_MESSAGE);

    const issue = seriesFitIssue(series, test);
    if (issue) throw seriesRefused(issue);
  }

  /** The tests one series holds, in the order it holds them. */
  async testsIn(testSeriesId: string): Promise<SeriesTestRow[]> {
    const rows = await this.prisma.test.findMany({
      where: { testSeriesId },
      select: SERIES_TEST_SELECT,
      orderBy: [{ seriesOrder: 'asc' }, { id: 'asc' }],
    });

    return rows.map((row) => ({
      testId: row.id,
      title: row.title,
      order: row.seriesOrder,
      unlockAt: row.opensAt?.toISOString() ?? null,
      status: row.status,
      isLocked: row.isLocked,
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
      attemptCount: row._count.attempts,
    }));
  }

  /** When a test opens inside its series. Every branch sits it at that instant. */
  async setUnlock(
    testSeriesId: string,
    testId: string,
    input: SetSeriesTestUnlockBody,
  ): Promise<SeriesTestRow[]> {
    await this.requireTestIn(testSeriesId, testId);
    const opensAt = dateOrNull(input.unlockAt);

    await this.prisma.$transaction(async (tx) => {
      await tx.test.update({ where: { id: testId }, data: { opensAt } });
      await dropUnlocksTheOpeningOvertook(tx, testId, opensAt);
    });

    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId });
    return this.testsIn(testSeriesId);
  }

  /** Which programs open this test ahead of everyone else, and when. */
  private async programUnlocks(testId: string): Promise<TestProgramUnlock[]> {
    const rows = await this.prisma.testProgramUnlock.findMany({
      where: { testId },
      orderBy: [{ programCode: 'asc' }],
    });
    return rows.map((row) => ({
      programCode: row.programCode,
      opensAt: row.opensAt.toISOString(),
    }));
  }

  /** A program opens a test EARLIER. Later would narrow its cohort — the closing time is shared. */
  async setProgramUnlock(
    testId: string,
    programCode: string,
    input: SetProgramUnlockBody,
  ): Promise<TestProgramUnlock[]> {
    const test = await this.requireTest(testId);
    assertStaggerIsRanked(test.evaluationMode);
    await this.requireProgram(programCode);
    const opensAt = new Date(input.opensAt);
    assertOpensNoLaterThanTheTest(test.opensAt, opensAt);

    await this.prisma.testProgramUnlock.upsert({
      where: { testId_programCode: { testId, programCode } },
      update: { opensAt },
      create: { testId, programCode, opensAt },
    });

    this.announce(test);
    return this.programUnlocks(testId);
  }

  async clearProgramUnlock(testId: string, programCode: string): Promise<TestProgramUnlock[]> {
    const test = await this.requireTest(testId);

    await this.prisma.testProgramUnlock.deleteMany({ where: { testId, programCode } });
    this.announce(test);
    return this.programUnlocks(testId);
  }

  private async requireProgram(programCode: string): Promise<void> {
    const program = await this.prisma.program.findUnique({
      where: { code: programCode },
      select: { code: true },
    });
    if (!program) throw new AppException(ErrorCodes.NOT_FOUND, 'No such program');
  }

  /** Filed against the test, and the series carrying it loses its cached catalog. */
  private announce(test: OfferingRow): void {
    this.auditContext.setEntityId(test.id);
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: test.testSeriesId });
  }

  private async requireTestIn(testSeriesId: string, testId: string): Promise<OfferingRow> {
    const test = await this.requireTest(testId);
    if (test.testSeriesId !== testSeriesId) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'That test is not in this series');
    }
    return test;
  }

  private assertNotSat(test: OfferingRow): void {
    if (test._count.attempts === 0) return;

    // A test students have sat is part of their record wherever it was offered.
    const message = `This test has ${attempts(test._count.attempts)} on it, so it cannot be moved to another series.`;
    throw new AppException(ErrorCodes.CONFLICT, message, {
      fieldErrors: { [FORM_LEVEL_FIELD]: [message] },
    });
  }

  private async requireTest(id: string): Promise<OfferingRow> {
    const test = await this.prisma.test.findUnique({ where: { id }, select: OFFERING_SELECT });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    return test;
  }
}

/** Prisma hands JSON back as `JsonValue`; the shape it holds is the scope's own. */
function scopeRefOf(row: { scopeRef: Prisma.JsonValue }): TestScopeRef | null {
  return (row.scopeRef as TestScopeRef | null) ?? null;
}
