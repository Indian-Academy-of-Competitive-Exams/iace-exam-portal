import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  TEST_STATUS,
  type BranchTestListQuery,
  type BranchTestRow,
  type BranchTestSchedule,
  type BranchTestScheduleRow,
  type Paginated,
  type SetBranchTestScheduleBody,
  type SetBranchTestSchedulesBody,
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
import { activationBlocker, collapsedLateEntry, highestOrNull } from './test-rules';

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

/** A branch that sets neither is a branch with nothing to store — its row goes. */
function partitionBySet(
  rows: SetBranchTestSchedulesBody['branches'],
): [SetBranchTestSchedulesBody['branches'], string[]] {
  const set = rows.filter((row) => row.lateEntrySec !== null || row.extraTimeSec !== null);
  const cleared = rows
    .filter((row) => row.lateEntrySec === null && row.extraTimeSec === null)
    .map((row) => row.branchId);
  return [set, cleared];
}

const attempts = (count: number): string => `${count} ${count === 1 ? 'attempt' : 'attempts'}`;

const OPENS_BEFORE_THE_TEST_DOES =
  'A program opens a test earlier, never later — entry closes at the same instant for everyone, so a later opening would only shorten this cohort’s window.';

const TEST_HAS_NO_OPENING =
  'This test has no opening time of its own, so it is already open. Give the test an opening time before letting a program in ahead of it.';

/** No constraint can carry this: it compares a row on one table with a column on another. */
function assertOpensNoLaterThanTheTest(testOpensAt: Date | null, opensAt: Date): void {
  if (testOpensAt !== null && opensAt <= testOpensAt) return;

  const message = testOpensAt === null ? TEST_HAS_NO_OPENING : OPENS_BEFORE_THE_TEST_DOES;
  throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
    fieldErrors: { opensAt: [message] },
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

function toBranchTestRow(row: {
  testSeriesId: string;
  testId: string;
  order: number | null;
  unlockAt: Date | null;
  testSeries: { name: string };
  test: { title: string | null; branchSchedules: BranchTiming[] };
}): BranchTestRow {
  const schedule = row.test.branchSchedules[0];
  return {
    testId: row.testId,
    title: row.test.title,
    testSeriesId: row.testSeriesId,
    seriesName: row.testSeries.name,
    order: row.order,
    unlockAt: row.unlockAt?.toISOString() ?? null,
    lateEntrySec: schedule?.lateEntrySec ?? null,
    extraTimeSec: schedule?.extraTimeSec ?? null,
  };
}

interface BranchTiming {
  lateEntrySec: number | null;
  extraTimeSec: number | null;
}

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
      await this.mirrorTimingOntoTest(tx, testId);
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
      await this.mirrorTimingOntoTest(tx, testId);
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
    await tx.test.update({
      where: { id: testId },
      data: {
        testSeriesId: first?.testSeriesId ?? null,
        seriesOrder: first?.order ?? null,
        opensAt: first?.unlockAt ?? null,
      },
    });
  }

  /** Every branch this test reaches, with whatever that branch does differently for it. */
  async branchTiming(testId: string): Promise<BranchTestScheduleRow[]> {
    await this.requireTest(testId);

    const configs = await this.branchesReaching(this.prisma, testId);
    const held = await this.prisma.branchTestSchedule.findMany({ where: { testId } });
    const byBranch = new Map(held.map((row) => [row.branchId, row]));

    // A branch reached through two of this test's series is still one branch, and one row.
    const seen = new Set<string>();
    return configs.flatMap(({ branch }) => {
      if (seen.has(branch.id)) return [];
      seen.add(branch.id);
      const schedule = byBranch.get(branch.id);
      return [
        {
          branchId: branch.id,
          branch,
          lateEntrySec: schedule?.lateEntrySec ?? null,
          extraTimeSec: schedule?.extraTimeSec ?? null,
        },
      ];
    });
  }

  /** The same rows from the BRANCH's side: what it runs, when each opens, what it changes. */
  async testsForBranch(
    branchId: string,
    query: BranchTestListQuery,
  ): Promise<Paginated<BranchTestRow>> {
    await this.requireBranch(branchId);
    const where: Prisma.TestSeriesTestWhereInput = {
      testSeries: {
        branchConfigs: { some: { branchId, enabled: true } },
        ...(query.testSeriesId ? { id: { in: query.testSeriesId } } : {}),
      },
      ...(query.q ? { test: { title: { contains: query.q, mode: 'insensitive' } } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.testSeriesTest.findMany({
        where,
        select: {
          testSeriesId: true,
          testId: true,
          order: true,
          unlockAt: true,
          testSeries: { select: { name: true } },
          test: {
            select: {
              title: true,
              branchSchedules: {
                where: { branchId },
                select: { lateEntrySec: true, extraTimeSec: true },
              },
            },
          },
        },
        orderBy: [{ testSeries: { name: 'asc' } }, { order: 'asc' }, { testId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.testSeriesTest.count({ where }),
    ]);

    return { items: rows.map(toBranchTestRow), page: query.page, pageSize: query.pageSize, total };
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

  /** One branch's timing on one test. Both fields null deletes the row rather than storing them. */
  async setBranchSchedule(
    branchId: string,
    testId: string,
    input: SetBranchTestScheduleBody,
  ): Promise<BranchTestSchedule> {
    await this.requireBranch(branchId);
    await this.requireTestAtBranch(branchId, testId);

    const cleared = input.lateEntrySec === null && input.extraTimeSec === null;
    await this.prisma.$transaction(async (tx) => {
      if (cleared) {
        await tx.branchTestSchedule.deleteMany({ where: { branchId, testId } });
      } else {
        await tx.branchTestSchedule.upsert({
          where: { branchId_testId: { branchId, testId } },
          update: input,
          create: { ...input, branchId, testId },
        });
      }
      await this.mirrorTimingOntoTest(tx, testId);
    });

    await this.announceTest(testId);
    return { testId, ...input };
  }

  private async requireBranch(branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new AppException(ErrorCodes.NOT_FOUND, 'No such branch');
  }

  /** A test this branch cannot reach is not a test it has timings for, so it reads as missing. */
  private async requireTestAtBranch(branchId: string, testId: string): Promise<void> {
    const link = await this.prisma.testSeriesTest.findFirst({
      where: { testId, testSeries: { branchConfigs: { some: { branchId, enabled: true } } } },
      select: { testId: true },
    });
    if (!link) throw new AppException(ErrorCodes.NOT_FOUND, 'This branch does not run that test');
  }

  /** Nothing set is no row: the plain rules are the absence of one, never a row full of nulls. */
  async setBranchTiming(
    testId: string,
    input: SetBranchTestSchedulesBody,
  ): Promise<BranchTestScheduleRow[]> {
    await this.requireTest(testId);
    const [set, cleared] = partitionBySet(input.branches);

    await this.prisma.$transaction(async (tx) => {
      if (cleared.length > 0) {
        await tx.branchTestSchedule.deleteMany({ where: { testId, branchId: { in: cleared } } });
      }
      for (const row of set) {
        const where = { branchId_testId: { branchId: row.branchId, testId } };
        const values = { lateEntrySec: row.lateEntrySec, extraTimeSec: row.extraTimeSec };
        await tx.branchTestSchedule.upsert({
          where,
          update: values,
          create: { ...values, testId, branchId: row.branchId },
        });
      }
      await this.mirrorTimingOntoTest(tx, testId);
    });

    await this.announceTest(testId);
    return this.branchTiming(testId);
  }

  /** The branches that reach this test, in name order — every enabled config on a series it is in. */
  private async branchesReaching(
    tx: Prisma.TransactionClient,
    testId: string,
  ): Promise<{ branch: { id: string; name: string } }[]> {
    const links = await tx.testSeriesTest.findMany({
      where: { testId },
      select: { testSeriesId: true },
    });
    return tx.branchTestConfig.findMany({
      where: { enabled: true, testSeriesId: { in: links.map((row) => row.testSeriesId) } },
      select: { branch: { select: { id: true, name: true } } },
      orderBy: { branch: { name: 'asc' } },
    });
  }

  /** The per-branch rows still hold the timings; the test's own columns are collapsed from them. */
  private async mirrorTimingOntoTest(tx: Prisma.TransactionClient, testId: string): Promise<void> {
    const rows = await tx.branchTestSchedule.findMany({
      where: { testId },
      select: { branchId: true, lateEntrySec: true, extraTimeSec: true },
    });
    const capped = new Set(
      rows.filter((row) => row.lateEntrySec !== null).map((row) => row.branchId),
    );
    const reaching = await this.branchesReaching(tx, testId);
    // A grant reaches past the branch gate, so a granted student's branch may cap nothing at all.
    const granted = await tx.studentGrant.count({
      where: { testSeries: { tests: { some: { testId } } } },
    });
    const uncapped = granted > 0 || reaching.some(({ branch }) => !capped.has(branch.id));

    await tx.test.update({
      where: { id: testId },
      data: {
        lateEntrySec: collapsedLateEntry(
          rows.map((row) => row.lateEntrySec),
          uncapped,
        ),
        extraTimeSec: highestOrNull(rows.map((row) => row.extraTimeSec)),
      },
    });
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
