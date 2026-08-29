import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  fieldDiff,
  TEST_SERIES_KIND,
  type BranchTestConfigRow,
  type CreateTestSeriesBody,
  type Paginated,
  type TestSeriesListQuery,
  type TestSeriesKind,
  type TestSeriesSummary,
  type UpdateBranchTestConfigBody,
  type UpdateTestSeriesBody,
} from '@iace/contracts';
import { matchFilters } from '../common/match-filters';
import { PrismaService } from '../prisma/prisma.service';
import { reachableBy } from './access-resolver.service';
import { AuditContext } from '../audit';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { ExamStagesService } from '../configs';
import { ProgramsService } from './programs.service';

const FREE_WAITS_ON_NOTHING_MESSAGE =
  'A free series is offered to every enrolled student, so it cannot wait on another series. Clear the prerequisite, or make this a standard series.';

const SERIES_INCLUDE = {
  examStage: { select: { id: true, name: true, exam: { select: { code: true } } } },
  _count: { select: { tests: true } },
} as const satisfies Prisma.TestSeriesInclude;

type SeriesRow = Prisma.TestSeriesGetPayload<{ include: typeof SERIES_INCLUDE }>;

/** What a series' audit diff covers — every column an edit can change. */
export const AUDITED_SERIES_FIELDS = [
  'name',
  'description',
  'examStageId',
  'programCode',
  'sequentialTests',
  'prerequisiteSeriesId',
  'unlockMode',
  'kind',
] as const;

/**
 * Owns `TestSeries` and its `BranchTestConfig` fan-out. A test reaches a student only through a
 * series, and a series reaches a branch only through a row that says so.
 */
@Injectable()
export class TestSeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stages: ExamStagesService,
    private readonly programs: ProgramsService,
    private readonly auditContext: AuditContext,
    private readonly events: DomainEventBus,
  ) {}

  /** Prisma ANDs the keys inside NOT, so this is the exact complement of "already reaches it". */
  private async outOfReachOf(studentId?: string): Promise<Prisma.TestSeriesWhereInput[]> {
    if (studentId === undefined) return [];

    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: {
        currentBranchId: true,
        programs: true,
        enrolledExams: true,
      },
    });
    if (!student) return [];

    return [{ NOT: reachableBy(studentId, student) }];
  }

  async list(query: TestSeriesListQuery): Promise<Paginated<TestSeriesSummary>> {
    const chosen: Prisma.TestSeriesWhereInput[] = [
      ...(query.examStageId ? [{ examStageId: { in: query.examStageId } }] : []),
      ...(query.programCode ? [{ programCode: query.programCode }] : []),
      ...(query.kind === undefined ? [] : [{ kind: query.kind }]),
    ];
    const always: Prisma.TestSeriesWhereInput[] = query.q
      ? [{ name: { contains: query.q, mode: 'insensitive' } }]
      : [];

    // Scope, not a filter: it stands outside `match`, which is the reader's All/Any over THEIR choices.
    const scope = await this.outOfReachOf(query.notReachedBy);
    const and = [...matchFilters(always, chosen, query.match), ...scope];
    const where: Prisma.TestSeriesWhereInput = and.length > 0 ? { AND: and } : {};

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.testSeries.findMany({
        where,
        include: SERIES_INCLUDE,
        orderBy: [{ name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.testSeries.count({ where }),
    ]);

    const branchCounts = await this.branchCountsFor(rows.map((row) => row.id));

    return {
      items: rows.map((row) => toSummary(row, branchCounts.get(row.id))),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async detail(id: string): Promise<TestSeriesSummary> {
    const row = await this.requireSeries(id);
    const counts = await this.branchCountsFor([id]);
    return toSummary(row, counts.get(id));
  }

  /**
   * Creating a series gives EVERY branch a row. "Not offered here" is `enabled: false` on a row
   * that exists, never a missing one — an absent row would have to be read as a default, and a
   * default is exactly what nobody can audit or see on a screen.
   */
  async create(input: CreateTestSeriesBody): Promise<TestSeriesSummary> {
    await this.assertTargetsUsable(input);
    this.assertFreeWaitsOnNothing(input.kind, input.prerequisiteSeriesId ?? null);

    const id = await this.prisma.$transaction(async (tx) => {
      const series = await tx.testSeries.create({
        data: { ...columnsOf(input), name: input.name },
      });

      const branches = await tx.branch.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      await tx.branchTestConfig.createMany({
        data: branches.map((branch) => ({
          branchId: branch.id,
          testSeriesId: series.id,
          // Off until somebody says otherwise: a new series must not appear at every
          // centre in the country the moment it is saved.
          enabled: false,
        })),
      });

      return series.id;
    });

    // No `:id` in the path and a summary coming back, so the row is named explicitly. Who did
    // it is the audit row's actor — `TestSeries` has no `createdById` column of its own.
    this.auditContext.setEntityId(id);

    return this.detail(id);
  }

  async update(id: string, input: UpdateTestSeriesBody): Promise<TestSeriesSummary> {
    const series = await this.requireSeries(id);
    await this.assertTargetsUsable(input);
    if (input.prerequisiteSeriesId)
      this.assertNotItsOwnPrerequisite(id, input.prerequisiteSeriesId);
    // Judged against what the series WILL hold: either half of the pair may be the one moving.
    this.assertFreeWaitsOnNothing(
      input.kind ?? series.kind,
      input.prerequisiteSeriesId === undefined
        ? series.prerequisiteSeriesId
        : (input.prerequisiteSeriesId ?? null),
    );

    const changes = columnsOf(input);
    const updated = await this.prisma.testSeries.update({
      where: { id },
      data: changes,
      include: SERIES_INCLUDE,
    });

    this.auditContext.setChanged(fieldDiff(series, updated, AUDITED_SERIES_FIELDS));
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });

    const counts = await this.branchCountsFor([id]);
    return toSummary(updated, counts.get(id));
  }

  async remove(id: string): Promise<void> {
    const series = await this.requireSeries(id);

    if (series._count.tests > 0) {
      const tests = `${series._count.tests} test${series._count.tests === 1 ? '' : 's'}`;
      throw new AppException(
        ErrorCodes.CONFLICT,
        `${tests} are offered through this series, and deleting it would take away the only route to them. Remove them from the series first.`,
      );
    }

    const dependents = await this.prisma.testSeries.count({ where: { prerequisiteSeriesId: id } });
    if (dependents > 0) {
      throw new AppException(
        ErrorCodes.CONFLICT,
        `${dependents} other series wait on this one before they open. Point them elsewhere first.`,
      );
    }

    await this.prisma.testSeries.delete({ where: { id } });
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });
  }

  /**
   * The other half of the fan-out: a branch opened after a series exists still has to appear on
   * that series' scheduling screen, switched off. Without this, "every branch has a row" would
   * hold only for the branches that existed on the day the series was created.
   */
  async fanOutToBranch(branchId: string): Promise<void> {
    const series = await this.prisma.testSeries.findMany({ select: { id: true } });
    if (series.length === 0) return;

    await this.prisma.branchTestConfig.createMany({
      data: series.map((row) => ({ branchId, testSeriesId: row.id, enabled: false })),
      skipDuplicates: true,
    });
  }

  /** Every branch's row for this series, in branch order. There is always one per branch. */
  async branchConfigs(id: string): Promise<BranchTestConfigRow[]> {
    await this.requireSeries(id);

    const rows = await this.prisma.branchTestConfig.findMany({
      where: { testSeriesId: id },
      include: { branch: { select: { id: true, name: true } } },
      orderBy: [{ branch: { name: 'asc' } }],
    });

    return rows.map(toBranchConfig);
  }

  /** Switching a series on for a branch. The row is never created here, and it has no window. */
  /** Every row at once: a free series is switched on branch by branch otherwise, thirty times. */
  async updateEveryBranchConfig(
    id: string,
    input: UpdateBranchTestConfigBody,
  ): Promise<BranchTestConfigRow[]> {
    await this.requireSeries(id);
    if (input.enabled === undefined) return this.branchConfigs(id);

    await this.prisma.branchTestConfig.updateMany({
      where: { testSeriesId: id },
      data: { enabled: input.enabled },
    });

    this.auditContext.setEntityId(id);
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });
    return this.branchConfigs(id);
  }

  async updateBranchConfig(
    id: string,
    branchId: string,
    input: UpdateBranchTestConfigBody,
  ): Promise<BranchTestConfigRow> {
    const existing = await this.prisma.branchTestConfig.findUnique({
      where: { branchId_testSeriesId: { branchId, testSeriesId: id } },
      select: { id: true },
    });
    if (!existing) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'That branch has no row for this series');
    }

    const row = await this.prisma.branchTestConfig.update({
      where: { id: existing.id },
      data: { ...(input.enabled === undefined ? {} : { enabled: input.enabled }) },
      include: { branch: { select: { id: true, name: true } } },
    });

    this.auditContext.setEntityId(id);
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });
    return toBranchConfig(row);
  }

  /** FREE is offered to everyone enrolled, so one behind a prerequisite is offered and then refused. */
  private assertFreeWaitsOnNothing(
    kind: TestSeriesKind | undefined,
    prerequisiteSeriesId: string | null,
  ): void {
    if (kind !== TEST_SERIES_KIND.FREE || prerequisiteSeriesId === null) return;
    throw new AppException(ErrorCodes.VALIDATION_ERROR, FREE_WAITS_ON_NOTHING_MESSAGE, {
      fieldErrors: { prerequisiteSeriesId: [FREE_WAITS_ON_NOTHING_MESSAGE] },
    });
  }

  private assertNotItsOwnPrerequisite(id: string, prerequisiteSeriesId: string): void {
    if (prerequisiteSeriesId !== id) return;

    const message = 'A series cannot wait on itself';
    throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
      fieldErrors: { prerequisiteSeriesId: [message] },
    });
  }

  private async assertTargetsUsable(input: Partial<CreateTestSeriesBody>): Promise<void> {
    if (input.examStageId) await this.stages.assertUsable(input.examStageId);
    if (input.programCode) await this.programs.assertUsable([input.programCode], 'programCode');
  }

  private async requireSeries(id: string): Promise<SeriesRow> {
    const series = await this.prisma.testSeries.findUnique({
      where: { id },
      include: SERIES_INCLUDE,
    });
    if (!series) throw new AppException(ErrorCodes.NOT_FOUND, 'No such series');
    return series;
  }

  /** How many branches run each series, out of how many have a row — one query for the page. */
  private async branchCountsFor(
    seriesIds: string[],
  ): Promise<Map<string, { enabled: number; total: number }>> {
    const counts = new Map<string, { enabled: number; total: number }>();
    if (seriesIds.length === 0) return counts;

    const rows = await this.prisma.branchTestConfig.findMany({
      where: { testSeriesId: { in: seriesIds } },
      select: { testSeriesId: true, enabled: true },
    });

    for (const row of rows) {
      const current = counts.get(row.testSeriesId) ?? { enabled: 0, total: 0 };
      counts.set(row.testSeriesId, {
        enabled: current.enabled + (row.enabled ? 1 : 0),
        total: current.total + 1,
      });
    }
    return counts;
  }
}

function columnsOf(input: Partial<CreateTestSeriesBody>) {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.description === undefined ? {} : { description: input.description ?? null }),
    ...(input.examStageId === undefined ? {} : { examStageId: input.examStageId ?? null }),
    ...(input.programCode === undefined ? {} : { programCode: input.programCode ?? null }),
    ...(input.sequentialTests === undefined ? {} : { sequentialTests: input.sequentialTests }),
    ...(input.prerequisiteSeriesId === undefined
      ? {}
      : { prerequisiteSeriesId: input.prerequisiteSeriesId ?? null }),
    ...(input.unlockMode === undefined ? {} : { unlockMode: input.unlockMode }),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
  } satisfies Prisma.TestSeriesUncheckedUpdateInput;
}

function toSummary(
  row: SeriesRow,
  branches: { enabled: number; total: number } | undefined,
): TestSeriesSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    examStageId: row.examStageId,
    examStage: row.examStage
      ? { id: row.examStage.id, name: row.examStage.name, examCode: row.examStage.exam.code }
      : null,
    programCode: row.programCode,
    sequentialTests: row.sequentialTests,
    prerequisiteSeriesId: row.prerequisiteSeriesId,
    unlockMode: row.unlockMode,
    kind: row.kind,
    testCount: row._count.tests,
    enabledBranchCount: branches?.enabled ?? 0,
    branchCount: branches?.total ?? 0,
    createdAt: row.createdAt.toISOString(),
  };
}

function toBranchConfig(row: {
  id: string;
  branchId: string;
  testSeriesId: string;
  enabled: boolean;
  createdAt: Date;
  branch: { id: string; name: string };
}): BranchTestConfigRow {
  return {
    id: row.id,
    branchId: row.branchId,
    testSeriesId: row.testSeriesId,
    enabled: row.enabled,
    branch: row.branch,
    createdAt: row.createdAt.toISOString(),
  };
}
