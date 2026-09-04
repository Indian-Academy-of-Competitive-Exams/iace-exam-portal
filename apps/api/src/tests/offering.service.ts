import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  TEST_STATUS,
  type SeriesTestRow,
  type SetSeriesTestUnlockBody,
  type SetProgramUnlockBody,
  type SetTestSeriesBody,
  type TestProgramUnlock,
  type TestSchedule,
  type TestSeriesLink,
  type TestStatus,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { AuditContext } from '../audit';
import { activationBlocker } from './test-rules';

const OFFERING_SELECT = {
  id: true,
  status: true,
  isLocked: true,
  examStageId: true,
  opensAt: true,
  _count: { select: { series: true, attempts: true } },
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

const LATE_ENTRY_NEEDS_AN_OPENING =
  'Late entry is counted from the moment the test opens, and this test has no opening time. Give it one, or leave late entry blank.';

/** Without an opening there is nothing to count from, so a cap would silently never close entry. */
function assertLateEntryHasAnOpening(opensAt: Date | null, lateEntrySec: number | null): void {
  if (lateEntrySec === null || opensAt !== null) return;

  throw new AppException(ErrorCodes.VALIDATION_ERROR, LATE_ENTRY_NEEDS_AN_OPENING, {
    fieldErrors: { lateEntrySec: [LATE_ENTRY_NEEDS_AN_OPENING] },
  });
}

interface SeriesPosition {
  testSeriesId: string;
  order: number | null;
}

/** `linksOf`'s order, sorted here so the column lands on the same link Postgres would return. */
const byPosition = (left: SeriesPosition, right: SeriesPosition): number =>
  (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) ||
  left.testSeriesId.localeCompare(right.testSeriesId);

type OfferingRow = Prisma.TestGetPayload<{ select: typeof OFFERING_SELECT }>;

/** How a finalized test is offered: through a series, never on its own. */
@Injectable()
export class OfferingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
    private readonly auditContext: AuditContext,
  ) {}

  async series(testId: string): Promise<TestSeriesLink[]> {
    await this.requireTest(testId);
    return this.linksOf(testId);
  }

  /** The whole set, not a delta: the screen holds every series this test is offered in. */
  async setSeries(testId: string, input: SetTestSeriesBody): Promise<TestSeriesLink[]> {
    const test = await this.requireTest(testId);
    const wanted = [...new Map(input.series.map((row) => [row.testSeriesId, row])).values()];
    this.assertStillReachable(test, wanted.length);
    await this.assertSeriesUsable(
      test,
      wanted.map((row) => row.testSeriesId),
    );
    await this.assertNoneDropped(test, new Set(wanted.map((row) => row.testSeriesId)));

    const touched = await this.prisma.$transaction(async (tx) => {
      const before = await tx.testSeriesTest.findMany({
        where: { testId },
        select: { testSeriesId: true },
      });
      await tx.testSeriesTest.deleteMany({ where: { testId } });
      if (wanted.length > 0) {
        await tx.testSeriesTest.createMany({
          data: wanted.map((row) => ({
            testId,
            testSeriesId: row.testSeriesId,
            order: row.order ?? null,
          })),
        });
      }
      await this.mirrorSeriesOntoTest(tx, testId);
      return new Set([
        ...before.map((row) => row.testSeriesId),
        ...wanted.map((row) => row.testSeriesId),
      ]);
    });

    // Every series whose contents moved: the catalog a student reads is cached against it.
    for (const testSeriesId of touched) {
      this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId });
    }

    return this.linksOf(testId);
  }

  async setStatus(testId: string, status: TestStatus): Promise<TestStatus> {
    const test = await this.requireTest(testId);
    if (test.status === status) return status;

    if (status === TEST_STATUS.ACTIVE) {
      const blocker = activationBlocker({
        isLocked: test.isLocked,
        seriesCount: test._count.series,
      });
      if (blocker) {
        throw new AppException(ErrorCodes.CONFLICT, blocker, {
          fieldErrors: { [FORM_LEVEL_FIELD]: [blocker] },
        });
      }
    }

    await this.prisma.test.update({ where: { id: testId }, data: { status } });

    for (const link of await this.linksOf(testId)) {
      this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: link.testSeriesId });
    }

    return status;
  }

  /** The mirror of the activation rule: what is offered must stay reachable while it is offered. */
  private assertStillReachable(test: OfferingRow, wanted: number): void {
    if (wanted > 0 || test.status !== TEST_STATUS.ACTIVE) return;

    const message =
      'This test is being offered, and a test reaches a student only through a series. Retire it before taking it out of the last one.';
    throw new AppException(ErrorCodes.CONFLICT, message, {
      fieldErrors: { series: [message] },
    });
  }

  private async linksOf(testId: string): Promise<TestSeriesLink[]> {
    const rows = await this.prisma.testSeriesTest.findMany({
      where: { testId },
      include: { testSeries: { select: { name: true } } },
      orderBy: [{ order: 'asc' }, { testSeriesId: 'asc' }],
    });
    return rows.map((row) => ({
      testSeriesId: row.testSeriesId,
      name: row.testSeries.name,
      order: row.order,
    }));
  }

  /** A series must exist, and must be built for this test's stage or for no stage at all. */
  private async assertSeriesUsable(test: OfferingRow, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.prisma.testSeries.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true, examStageId: true },
    });

    if (found.length !== ids.length) {
      const gone = 'One of the chosen series no longer exists.';
      throw new AppException(ErrorCodes.VALIDATION_ERROR, gone, {
        fieldErrors: { series: [gone] },
      });
    }

    // A stage-agnostic series carries any test; another stage's would serve this paper to its students.
    const foreign = found.filter(
      (row) => row.examStageId !== null && row.examStageId !== test.examStageId,
    );
    if (foreign.length === 0) return;

    const named = foreign.map((row) => row.name).join(', ');
    const message = `${named} ${foreign.length === 1 ? 'is' : 'are'} built for a different exam stage, and a test reaches students through the series carrying it.`;
    throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
      fieldErrors: { series: [message] },
    });
  }

  /** The tests one series holds, in the order it holds them. */
  async testsIn(testSeriesId: string): Promise<SeriesTestRow[]> {
    const rows = await this.prisma.testSeriesTest.findMany({
      where: { testSeriesId },
      select: {
        testId: true,
        order: true,
        unlockAt: true,
        test: { select: { title: true, _count: { select: { attempts: true } } } },
      },
      orderBy: [{ order: 'asc' }, { testId: 'asc' }],
    });

    return rows.map((row) => ({
      testId: row.testId,
      title: row.test.title,
      order: row.order,
      unlockAt: row.unlockAt?.toISOString() ?? null,
      attemptCount: row.test._count.attempts,
    }));
  }

  /** When a test opens inside one series. Every branch sits it at that instant. */
  async setUnlock(
    testSeriesId: string,
    testId: string,
    input: SetSeriesTestUnlockBody,
  ): Promise<SeriesTestRow[]> {
    await this.requireLink(testSeriesId, testId);

    await this.prisma.$transaction(async (tx) => {
      await tx.testSeriesTest.update({
        where: { testSeriesId_testId: { testSeriesId, testId } },
        data: { unlockAt: dateOrNull(input.unlockAt) },
      });
      await this.mirrorSeriesOntoTest(tx, testId);
    });

    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId });
    return this.testsIn(testSeriesId);
  }

  /** One link dropped, from the series' side. Refused once anyone has sat the test. */
  async removeFromSeries(testSeriesId: string, testId: string): Promise<SeriesTestRow[]> {
    await this.requireLink(testSeriesId, testId);
    const test = await this.requireTest(testId);
    this.assertNotSat(test);

    await this.prisma.$transaction(async (tx) => {
      await tx.testSeriesTest.delete({
        where: { testSeriesId_testId: { testSeriesId, testId } },
      });
      await this.mirrorSeriesOntoTest(tx, testId);
    });

    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId });
    return this.testsIn(testSeriesId);
  }

  /** The join table still writes; the columns the resolver reads follow, or the two disagree. */
  private async mirrorSeriesOntoTest(tx: Prisma.TransactionClient, testId: string): Promise<void> {
    const held = await tx.testSeriesTest.findMany({
      where: { testId },
      select: { testSeriesId: true, order: true, unlockAt: true },
    });
    const first = [...held].sort(byPosition)[0];
    const opensAt = first?.unlockAt ?? null;
    await tx.test.update({
      where: { id: testId },
      data: {
        testSeriesId: first?.testSeriesId ?? null,
        seriesOrder: first?.order ?? null,
        opensAt,
      },
    });
    await dropUnlocksTheOpeningOvertook(tx, testId, opensAt);
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
    await this.requireProgram(programCode);
    const opensAt = new Date(input.opensAt);
    assertOpensNoLaterThanTheTest(test.opensAt, opensAt);

    await this.prisma.testProgramUnlock.upsert({
      where: { testId_programCode: { testId, programCode } },
      update: { opensAt },
      create: { testId, programCode, opensAt },
    });

    await this.announceTest(testId);
    return this.programUnlocks(testId);
  }

  async clearProgramUnlock(testId: string, programCode: string): Promise<TestProgramUnlock[]> {
    await this.requireTest(testId);

    await this.prisma.testProgramUnlock.deleteMany({ where: { testId, programCode } });
    await this.announceTest(testId);
    return this.programUnlocks(testId);
  }

  private async requireProgram(programCode: string): Promise<void> {
    const program = await this.prisma.program.findUnique({
      where: { code: programCode },
      select: { code: true },
    });
    if (!program) throw new AppException(ErrorCodes.NOT_FOUND, 'No such program');
  }

  /** The test's own clock, written where the resolver reads it. No branch row collapses onto it. */
  async setSchedule(testId: string, input: TestSchedule): Promise<TestSchedule> {
    const test = await this.requireTest(testId);
    assertLateEntryHasAnOpening(test.opensAt, input.lateEntrySec);

    await this.prisma.test.update({ where: { id: testId }, data: input });

    await this.announceTest(testId);
    return input;
  }

  /** Filed against the test, and every series carrying it loses its cached catalog. */
  private async announceTest(testId: string): Promise<void> {
    this.auditContext.setEntityId(testId);
    const links = await this.prisma.testSeriesTest.findMany({
      where: { testId },
      select: { testSeriesId: true },
    });
    for (const link of links) {
      this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: link.testSeriesId });
    }
  }

  private async requireLink(testSeriesId: string, testId: string): Promise<void> {
    const link = await this.prisma.testSeriesTest.findUnique({
      where: { testSeriesId_testId: { testSeriesId, testId } },
      select: { testId: true },
    });
    if (!link) throw new AppException(ErrorCodes.NOT_FOUND, 'That test is not in this series');
  }

  /** Unticking a series is a removal like any other, so it answers to the same rule. */
  private async assertNoneDropped(test: OfferingRow, wanted: ReadonlySet<string>): Promise<void> {
    if (test._count.attempts === 0) return;

    const held = await this.prisma.testSeriesTest.findMany({
      where: { testId: test.id },
      select: { testSeriesId: true },
    });
    if (held.every((row) => wanted.has(row.testSeriesId))) return;

    this.assertNotSat(test);
  }

  private assertNotSat(test: OfferingRow): void {
    if (test._count.attempts === 0) return;

    // A test students have sat is part of their record wherever it was offered.
    const message = `This test has ${attempts(test._count.attempts)} on it, so it cannot be taken out of a series.`;
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
