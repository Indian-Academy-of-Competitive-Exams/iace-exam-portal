import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  TEST_STATUS,
  type SeriesTestRow,
  type SetSeriesTestUnlockBody,
  type SetTestSeriesBody,
  type TestSeriesLink,
  type TestStatus,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { activationBlocker } from './test-rules';

const OFFERING_SELECT = {
  id: true,
  status: true,
  isLocked: true,
  _count: { select: { series: true, attempts: true } },
} as const satisfies Prisma.TestSelect;

const dateOrNull = (value: string | null | undefined): Date | null =>
  value === null || value === undefined ? null : new Date(value);

const attempts = (count: number): string => `${count} ${count === 1 ? 'attempt' : 'attempts'}`;

type OfferingRow = Prisma.TestGetPayload<{ select: typeof OFFERING_SELECT }>;

/** How a finalized test is offered: through a series, never on its own. */
@Injectable()
export class OfferingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
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
    await this.assertSeriesExist(wanted.map((row) => row.testSeriesId));
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

  private async assertSeriesExist(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.prisma.testSeries.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true },
    });
    if (found.length === ids.length) return;

    const message = 'One of the chosen series no longer exists.';
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

    await this.prisma.testSeriesTest.update({
      where: { testSeriesId_testId: { testSeriesId, testId } },
      data: { unlockAt: dateOrNull(input.unlockAt) },
    });

    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId });
    return this.testsIn(testSeriesId);
  }

  /** One link dropped, from the series' side. Refused once anyone has sat the test. */
  async removeFromSeries(testSeriesId: string, testId: string): Promise<SeriesTestRow[]> {
    await this.requireLink(testSeriesId, testId);
    const test = await this.requireTest(testId);
    this.assertNotSat(test);

    await this.prisma.testSeriesTest.delete({
      where: { testSeriesId_testId: { testSeriesId, testId } },
    });

    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId });
    return this.testsIn(testSeriesId);
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
