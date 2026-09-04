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
import { assertBranchInScope, branchScopeWhere, type BranchScope } from '../common/security';
import { PrismaService } from '../prisma/prisma.service';
import { reachableBy } from './access-resolver.service';
import { AuditContext } from '../audit';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { ExamStagesService } from '../configs';
import { ProgramsService } from './programs.service';
import { mirrorSwitchOntoSeries, startsSwitchedOn } from './series-switch';

/** What the four CHECKs on `TestSeries` refuse, in the words the form uses for the fields. */
const KIND_PAIRING_MESSAGES = {
  NEEDS_A_STAGE:
    'Only a free series spans a whole course. Choose the stage this one belongs to, or make it free.',
  PROGRAM_NEEDS_ITS_PROGRAM:
    'A program series is reached only by students carrying a program, so it has to name one.',
  PROGRAM_IS_ITS_OWN_KIND:
    'A series naming a program is reached only by students carrying it, which is what the Program kind is. Choose Program, or clear the program.',
  EVENT_NEEDS_ITS_EVENT:
    'An event series is reached only by the candidates on its event, so it has to name one.',
  EVENT_IS_ITS_OWN_KIND:
    'A series naming an event is reached only by its candidates, which is what the Event kind is. Choose Event, or clear the event.',
} as const;

const branchesAreStandardOnly = (count: number) =>
  `Only a standard series reaches students branch by branch. This one is switched on at ${count} ${count === 1 ? 'branch' : 'branches'} and carries a branch list no other kind can hold, so its kind cannot change.`;

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
  'progressive',
  'kind',
  'eventId',
  'isEnabled',
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
  private async outOfReachOf(
    scope: BranchScope,
    studentId?: string,
  ): Promise<Prisma.TestSeriesWhereInput[]> {
    if (studentId === undefined) return [];

    // Scoped, or this answers what a student every other route calls missing already reaches.
    const reachable = branchScopeWhere(scope);
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        deletedAt: null,
        ...(reachable ? { currentBranchId: reachable } : {}),
      },
      select: {
        currentBranchId: true,
        programs: true,
        enrolledCourses: true,
      },
    });
    if (!student) return [];

    return [{ NOT: reachableBy(studentId, student) }];
  }

  async list(
    query: TestSeriesListQuery,
    scope: BranchScope,
  ): Promise<Paginated<TestSeriesSummary>> {
    const chosen: Prisma.TestSeriesWhereInput[] = [
      ...(query.examStageId ? [{ examStageId: { in: query.examStageId } }] : []),
      ...(query.forExamStageId
        ? [{ OR: [{ examStageId: query.forExamStageId }, { examStageId: null }] }]
        : []),
      ...(query.programCode ? [{ programCode: query.programCode }] : []),
      ...(query.kind === undefined ? [] : [{ kind: query.kind }]),
      ...(query.isEnabled === undefined ? [] : [{ isEnabled: query.isEnabled }]),
    ];
    const always: Prisma.TestSeriesWhereInput[] = query.q
      ? [{ name: { contains: query.q, mode: 'insensitive' } }]
      : [];

    // Not a filter: it stands outside `match`, which is the reader's All/Any over THEIR choices.
    const complement = await this.outOfReachOf(scope, query.notReachedBy);
    const and = [...matchFilters(always, chosen, query.match), ...complement];
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

    const branchCounts = await this.branchRowsFor(rows.map((row) => row.id));

    return {
      items: rows.map((row) => toSummary(row, branchCounts.get(row.id))),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async detail(id: string): Promise<TestSeriesSummary> {
    const row = await this.requireSeries(id);
    const counts = await this.branchRowsFor([id]);
    return toSummary(row, counts.get(id));
  }

  /**
   * Creating a series gives EVERY branch a row. "Not offered here" is `enabled: false` on a row
   * that exists, never a missing one — an absent row would have to be read as a default, and a
   * default is exactly what nobody can audit or see on a screen.
   */
  async create(input: CreateTestSeriesBody): Promise<TestSeriesSummary> {
    await this.assertTargetsUsable(input);
    // Every branch row starts off, so a new series carries no branch whatever its kind.
    this.assertKindHoldsTogether({
      kind: input.kind ?? TEST_SERIES_KIND.STANDARD,
      examStageId: input.examStageId ?? null,
      programCode: input.programCode ?? null,
      eventId: input.eventId ?? null,
      branchIds: [],
    });

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

      await mirrorSwitchOntoSeries(
        tx,
        [series.id],
        input.isEnabled ?? startsSwitchedOn(series.kind),
      );
      return series.id;
    });

    // No `:id` in the path and a summary coming back, so the row is named explicitly. Who did
    // it is the audit row's actor — `TestSeries` has no `createdById` column of its own.
    this.auditContext.setEntityId(id);
    // A kind that reaches past every branch is switched on the moment it saves, cached catalogs and all.
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });

    return this.detail(id);
  }

  async update(id: string, input: UpdateTestSeriesBody): Promise<TestSeriesSummary> {
    const series = await this.requireSeries(id);
    await this.assertTargetsUsable(input);
    // Against what the row WILL hold: branchIds moves through BranchTestConfig, so it is its own.
    this.assertKindHoldsTogether({
      kind: input.kind ?? series.kind,
      examStageId: settledValue(input.examStageId, series.examStageId),
      programCode: settledValue(input.programCode, series.programCode),
      eventId: settledValue(input.eventId, series.eventId),
      branchIds: series.branchIds,
    });

    // Only STANDARD carries branches, so a kind change empties the list the CHECK reads.
    await this.prisma.$transaction(async (tx) => {
      await tx.testSeries.update({ where: { id }, data: columnsOf(input) });
      await mirrorSwitchOntoSeries(tx, [id], input.isEnabled);
    });

    const updated = await this.requireSeries(id);
    this.auditContext.setChanged(fieldDiff(series, updated, AUDITED_SERIES_FIELDS));
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });

    return toSummary(updated, (await this.branchRowsFor([id])).get(id));
  }

  async remove(id: string): Promise<void> {
    await this.requireSeries(id);

    // Both routes, because `Test.testSeriesId` is a RESTRICT key the join-table count cannot see.
    const held = await this.prisma.test.count({
      where: { OR: [{ testSeriesId: id }, { series: { some: { testSeriesId: id } } }] },
    });
    if (held > 0) {
      const tests = `${held} test${held === 1 ? '' : 's'}`;
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

  /** Every branch's row for this series the CALLER may see, in branch order. */
  async branchConfigs(id: string, scope: BranchScope): Promise<BranchTestConfigRow[]> {
    await this.requireSeries(id);

    const reachable = branchScopeWhere(scope);
    const rows = await this.prisma.branchTestConfig.findMany({
      where: { testSeriesId: id, ...(reachable ? { branchId: reachable } : {}) },
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
    scope: BranchScope,
  ): Promise<BranchTestConfigRow[]> {
    // EVERY branch, including ones the caller cannot see, so only somebody who reaches all may.
    if (!scope.all) throw new AppException(ErrorCodes.FORBIDDEN, EVERY_BRANCH_IS_NOT_YOURS);
    await this.requireSeries(id);
    if (input.enabled === undefined) return this.branchConfigs(id, scope);

    await this.prisma.$transaction(async (tx) => {
      await tx.branchTestConfig.updateMany({
        where: { testSeriesId: id },
        data: { enabled: input.enabled },
      });
      await mirrorSwitchOntoSeries(tx, [id]);
    });

    this.auditContext.setEntityId(id);
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });
    return this.branchConfigs(id, scope);
  }

  async updateBranchConfig(
    id: string,
    branchId: string,
    input: UpdateBranchTestConfigBody,
    scope: BranchScope,
  ): Promise<BranchTestConfigRow> {
    assertBranchInScope(scope, branchId);
    const existing = await this.prisma.branchTestConfig.findUnique({
      where: { branchId_testSeriesId: { branchId, testSeriesId: id } },
      select: { id: true },
    });
    if (!existing) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'That branch has no row for this series');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const config = await tx.branchTestConfig.update({
        where: { id: existing.id },
        data: { ...(input.enabled === undefined ? {} : { enabled: input.enabled }) },
        include: { branch: { select: { id: true, name: true } } },
      });
      await mirrorSwitchOntoSeries(tx, [id]);
      return config;
    });

    this.auditContext.setEntityId(id);
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });
    return toBranchConfig(row);
  }

  /** Answered here so a form marks the field: a raw CHECK violation can only leave as a 500. */
  private assertKindHoldsTogether(shape: SeriesPairing): void {
    const fieldErrors = kindPairingErrors(shape);
    const message = Object.values(fieldErrors)[0]?.[0];
    if (message === undefined) return;
    throw new AppException(ErrorCodes.VALIDATION_ERROR, message, { fieldErrors });
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

  /** How many branches each series has a row for — how many RUN it is `branchIds`, on the row itself. */
  private async branchRowsFor(seriesIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (seriesIds.length === 0) return counts;

    const rows = await this.prisma.branchTestConfig.findMany({
      where: { testSeriesId: { in: seriesIds } },
      select: { testSeriesId: true },
    });

    for (const row of rows) counts.set(row.testSeriesId, (counts.get(row.testSeriesId) ?? 0) + 1);
    return counts;
  }
}

/** The columns a series' kind implies something about, plus what its branch switch says today. */
interface SeriesPairing {
  kind: TestSeriesKind;
  examStageId: string | null;
  programCode: string | null;
  eventId: string | null;
  branchIds: readonly string[];
}

/** An absent key keeps what the column holds; an explicit null clears it. */
function settledValue(next: string | null | undefined, held: string | null): string | null {
  return next === undefined ? held : (next ?? null);
}

/** Every disagreement at once, so a form marks each field rather than one save at a time. */
function kindPairingErrors(shape: SeriesPairing): Record<string, string[]> {
  const found: [field: string, message: string][] = [];

  if (shape.kind !== TEST_SERIES_KIND.FREE && shape.examStageId === null)
    found.push(['examStageId', KIND_PAIRING_MESSAGES.NEEDS_A_STAGE]);

  const isProgram = shape.kind === TEST_SERIES_KIND.PROGRAM;
  if (isProgram && shape.programCode === null)
    found.push(['programCode', KIND_PAIRING_MESSAGES.PROGRAM_NEEDS_ITS_PROGRAM]);
  if (!isProgram && shape.programCode !== null)
    found.push(['kind', KIND_PAIRING_MESSAGES.PROGRAM_IS_ITS_OWN_KIND]);

  const isEvent = shape.kind === TEST_SERIES_KIND.EVENT;
  if (isEvent && shape.eventId === null)
    found.push(['eventId', KIND_PAIRING_MESSAGES.EVENT_NEEDS_ITS_EVENT]);
  if (!isEvent && shape.eventId !== null)
    found.push(['kind', KIND_PAIRING_MESSAGES.EVENT_IS_ITS_OWN_KIND]);

  if (shape.kind !== TEST_SERIES_KIND.STANDARD && shape.branchIds.length > 0)
    found.push(['kind', branchesAreStandardOnly(shape.branchIds.length)]);

  const errors: Record<string, string[]> = {};
  for (const [field, message] of found) errors[field] = [...(errors[field] ?? []), message];
  return errors;
}

function columnsOf(input: Partial<CreateTestSeriesBody>) {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.description === undefined ? {} : { description: input.description ?? null }),
    ...(input.examStageId === undefined ? {} : { examStageId: input.examStageId ?? null }),
    ...(input.programCode === undefined ? {} : { programCode: input.programCode ?? null }),
    ...(input.sequentialTests === undefined ? {} : { sequentialTests: input.sequentialTests }),
    ...(input.progressive === undefined ? {} : { progressive: input.progressive }),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.eventId === undefined ? {} : { eventId: input.eventId ?? null }),
  } satisfies Prisma.TestSeriesUncheckedUpdateInput;
}

function toSummary(row: SeriesRow, branchCount: number | undefined): TestSeriesSummary {
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
    progressive: row.progressive,
    kind: row.kind,
    branchIds: row.branchIds,
    isEnabled: row.isEnabled,
    eventId: row.eventId,
    testCount: row._count.tests,
    enabledBranchCount: row.branchIds.length,
    branchCount: branchCount ?? 0,
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

const EVERY_BRANCH_IS_NOT_YOURS =
  'Switching a series for every branch is for an admin who reaches every branch.';
