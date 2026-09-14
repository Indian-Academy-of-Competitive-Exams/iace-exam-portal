import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  OPENING_HAS_PASSED,
  TEST_STATUS,
  testIsOpen,
  type SeriesTestRow,
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
  attemptsLabel,
  seriesFitIssue,
  seriesRefused,
  SERIES_GONE_MESSAGE,
  testShapeOf,
} from './test-rules';

const OFFERING_SELECT = {
  id: true,
  title: true,
  status: true,
  isLocked: true,
  examStageId: true,
  opensAt: true,
  testSeriesId: true,
  seriesOrder: true,
  testSeries: { select: { name: true, sequentialTests: true } },
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

const OPENS_BEFORE_THE_TEST_DOES =
  'A program opens a test earlier, never later — a later opening would hold this program’s students back after the test has opened for everyone else.';

const UNLOCK_FIELD = 'unlockAt';

const nameTakenIn = (seriesName: string, title: string) =>
  `${seriesName} already has a test called ${title}, and a name belongs to one test inside its series.`;

const UNTITLED_TEST = 'An untitled test';

const OPENS_IN_ORDER = 'This series opens its tests in order.';

const opensBeforeItsTurn = (title: string) =>
  `${OPENS_IN_ORDER} ${title} comes before it and opens no earlier, so this opening has to be after that one.`;

const opensAfterItsTurn = (title: string) =>
  `${OPENS_IN_ORDER} ${title} comes after it and opens no later, so this opening has to be before that one.`;

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

/** An unpositioned test sorts last, exactly as the student catalog sorts it. */
const ORDERED_LAST = Number.MAX_SAFE_INTEGER;

const byOrderThenId = (left: SeriesPosition, right: SeriesPosition): number =>
  (left.seriesOrder ?? ORDERED_LAST) - (right.seriesOrder ?? ORDERED_LAST) ||
  left.id.localeCompare(right.id);

interface SeriesPosition {
  id: string;
  seriesOrder: number | null;
}

interface SeriesSibling extends SeriesPosition {
  title: string | null;
  opensAt: Date | null;
}

/** In order means the openings ascend with it — one row judged against every other row of its series. */
function orderClash(
  test: SeriesPosition,
  opensAt: Date,
  siblings: readonly SeriesSibling[],
): string | null {
  for (const sibling of siblings) {
    if (sibling.opensAt === null || sibling.id === test.id) continue;

    const title = sibling.title ?? UNTITLED_TEST;
    const place = byOrderThenId(sibling, test);
    if (place < 0 && sibling.opensAt >= opensAt) return opensBeforeItsTurn(title);
    if (place > 0 && sibling.opensAt <= opensAt) return opensAfterItsTurn(title);
  }

  return null;
}

/** A test arrives unpositioned and so sorts last: nothing already in the series may open after it. */
function arrivalClash(opensAt: Date, siblings: readonly SeriesSibling[]): string | null {
  for (const sibling of siblings) {
    if (sibling.opensAt !== null && sibling.opensAt >= opensAt) {
      return opensBeforeItsTurn(sibling.title ?? UNTITLED_TEST);
    }
  }

  return null;
}

/** Only a new time is judged: what is already saved never passes through here again. */
function assertOpeningAhead(opensAt: Date, now: Date, field: string): void {
  if (!testIsOpen(opensAt.toISOString(), now)) return;

  throw new AppException(ErrorCodes.VALIDATION_ERROR, OPENING_HAS_PASSED, {
    fieldErrors: { [field]: [OPENING_HAS_PASSED] },
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

    // A test students have sat is part of their record wherever it was offered.
    this.assertUnsat(test, 'it cannot be moved to another series');
    const series = await this.assertSeriesUsable(test, next);
    await this.assertTitleFreeIn(next, series.name, test);
    const opensAt = test.opensAt;
    if (series.sequentialTests && opensAt !== null) {
      await this.assertOpeningFitsOrder(next, FORM_LEVEL_FIELD, (siblings) =>
        arrivalClash(opensAt, siblings),
      );
    }

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

  /** A series must exist and be built for this test's stage, and it says how it opens what it holds. */
  private async assertSeriesUsable(
    test: OfferingRow,
    testSeriesId: string,
  ): Promise<{ name: string; sequentialTests: boolean }> {
    const series = await this.prisma.testSeries.findUnique({
      where: { id: testSeriesId },
      select: { name: true, examStageId: true, sequentialTests: true },
    });
    if (series === null) throw seriesRefused(SERIES_GONE_MESSAGE);

    const issue = seriesFitIssue(series, test);
    if (issue) throw seriesRefused(issue);

    return series;
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
      ...testShapeOf(row),
      attemptCount: row._count.attempts,
    }));
  }

  /** When a test opens inside its series. Every branch sits it at that instant. */
  async setUnlock(
    testSeriesId: string,
    testId: string,
    input: SetSeriesTestUnlockBody,
    now: Date = new Date(),
  ): Promise<SeriesTestRow[]> {
    const test = await this.requireTestIn(testSeriesId, testId);
    // `Test.opensAt` is a frozen field, and this is its other door — see TEST_UNFROZEN_FIELDS.
    this.assertUnsat(test, 'when it opens can no longer move');
    const opensAt = dateOrNull(input.unlockAt);
    if (opensAt !== null) {
      assertOpeningAhead(opensAt, now, UNLOCK_FIELD);
      if (test.testSeries.sequentialTests) {
        await this.assertOpeningFitsOrder(testSeriesId, UNLOCK_FIELD, (siblings) =>
          orderClash(test, opensAt, siblings),
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.test.update({ where: { id: testId }, data: { opensAt } });
      await dropUnlocksTheOpeningOvertook(tx, testId, opensAt);
    });

    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId });
    return this.testsIn(testSeriesId);
  }

  /** A name is unique inside a series, so the series it ARRIVES in is the one that judges it. */
  private async assertTitleFreeIn(
    testSeriesId: string,
    seriesName: string,
    test: OfferingRow,
  ): Promise<void> {
    if (test.title === null) return;

    const clash = await this.prisma.test.findFirst({
      where: { testSeriesId, title: { equals: test.title, mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash !== null) throw seriesRefused(nameTakenIn(seriesName, test.title));
  }

  /** A series holds a handful of tests, so the whole set is read and compared here rather than in SQL. */
  private async assertOpeningFitsOrder(
    testSeriesId: string,
    field: string,
    clashOf: (siblings: readonly SeriesSibling[]) => string | null,
  ): Promise<void> {
    const siblings = await this.prisma.test.findMany({
      where: { testSeriesId },
      select: { id: true, title: true, seriesOrder: true, opensAt: true },
    });

    const clash = clashOf(siblings);
    if (clash === null) return;

    throw new AppException(ErrorCodes.VALIDATION_ERROR, clash, {
      fieldErrors: { [field]: [clash] },
    });
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

  /** A program opens a test EARLIER. Later would hold its students back behind everyone else. */
  async setProgramUnlock(
    testId: string,
    programCode: string,
    input: SetProgramUnlockBody,
    now: Date = new Date(),
  ): Promise<TestProgramUnlock[]> {
    const test = await this.requireTest(testId);
    await this.requireProgram(programCode);
    const opensAt = new Date(input.opensAt);
    assertOpeningAhead(opensAt, now, 'opensAt');
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

  /** A sat test's history is fixed: `consequence` names what its attempts forbid. */
  private assertUnsat(test: OfferingRow, consequence: string): void {
    if (test._count.attempts === 0) return;

    const message = `This test has ${attemptsLabel(test._count.attempts)} on it, so ${consequence}.`;
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
