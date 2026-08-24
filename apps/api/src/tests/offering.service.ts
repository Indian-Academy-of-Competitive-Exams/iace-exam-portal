import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  TEST_STATUS,
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
  _count: { select: { series: true } },
} as const satisfies Prisma.TestSelect;

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

  private async requireTest(id: string): Promise<OfferingRow> {
    const test = await this.prisma.test.findUnique({ where: { id }, select: OFFERING_SELECT });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    return test;
  }
}
