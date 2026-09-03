import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  fieldDiff,
  TEST_SERIES_KIND,
  type BranchSeriesListQuery,
  type BranchSeriesRow,
  type BranchTestConfigRow,
  type CreateTestSeriesBody,
  type Paginated,
  type TestSeriesListQuery,
  type SetBranchSeriesBody,
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

const FREE_WAITS_ON_NOTHING_MESSAGE =
  'A free series is offered to every enrolled student, so it cannot wait on another series. Clear the prerequisite, or make this a standard series.';

/** What the four CHECKs on `TestSeries` refuse, in the words the form uses for the fields. */
const KIND_PAIRING_MESSAGES = {
  NEEDS_A_STAGE:
    'Only a free series spans a whole course. Choose the stage this one belongs to, or make it free.',
  PROGRAM_NEEDS_ITS_PROGRAM:
    'A program series is reached only by students carrying a program, so it has to name one.',
  PROGRAM_IS_ITS_OWN_KIND:
    'A series naming a program is reached only by students carrying it, which is what the Program kind is. Choose Program, or clear the program.',
  EVENT_CANNOT_BE_CHOSEN:
    'An event series is reached only by the candidates on its event, and a series is joined to an event by importing them rather than here. Choose another kind.',
  EVENT_IS_ITS_OWN_KIND: 'This series is joined to an event, so its kind stays Event.',
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
        enrolledExams: true,
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
    // A new series carries neither yet: there is no way to write an event or a branch here.
    this.assertKindHoldsTogether({
      kind: input.kind ?? TEST_SERIES_KIND.STANDARD,
      examStageId: input.examStageId ?? null,
      programCode: input.programCode ?? null,
      eventId: null,
      branchIds: [],
      enabledBranches: 0,
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
    // Against what the row WILL hold: eventId and branchIds are not writable, so they are its own.
    const counts = await this.branchCountsFor([id]);
    this.assertKindHoldsTogether({
      kind: input.kind ?? series.kind,
      examStageId: settledValue(input.examStageId, series.examStageId),
      programCode: settledValue(input.programCode, series.programCode),
      eventId: series.eventId,
      branchIds: series.branchIds,
      enabledBranches: counts.get(id)?.enabled ?? 0,
    });

    const changes = columnsOf(input);
    const updated = await this.prisma.testSeries.update({
      where: { id },
      data: changes,
      include: SERIES_INCLUDE,
    });

    this.auditContext.setChanged(fieldDiff(series, updated, AUDITED_SERIES_FIELDS));
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });

    return toSummary(updated, counts.get(id));
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

  /** Every series as ONE branch sees it, read from `TestSeries` so none can go missing. */
  async seriesForBranch(
    branchId: string,
    query: BranchSeriesListQuery,
  ): Promise<Paginated<BranchSeriesRow>> {
    await this.requireBranch(branchId);
    const chosen: Prisma.TestSeriesWhereInput[] = [
      ...(query.examStageId ? [{ examStageId: { in: query.examStageId } }] : []),
      ...(query.kind === undefined ? [] : [{ kind: query.kind }]),
      ...(query.enabled === undefined ? [] : [enabledAtBranch(branchId, query.enabled)]),
    ];
    const always: Prisma.TestSeriesWhereInput[] = query.q
      ? [{ name: { contains: query.q, mode: 'insensitive' as const } }]
      : [];

    // No match toggle here: three narrowings of one branch's list, all of them ANDed.
    const and = [...always, ...chosen];
    const where: Prisma.TestSeriesWhereInput = and.length > 0 ? { AND: and } : {};

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.testSeries.findMany({
        where,
        include: {
          examStage: { select: { id: true, name: true, exam: { select: { code: true } } } },
          _count: { select: { tests: true } },
          branchConfigs: { where: { branchId }, select: { enabled: true } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.testSeries.count({ where }),
    ]);

    return {
      items: rows.map(toBranchSeriesRow),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** The screen's whole draft in one write: one confirm, one request, two statements. */
  async setSeriesForBranch(branchId: string, input: SetBranchSeriesBody): Promise<number> {
    await this.requireBranch(branchId);
    const wanted = new Map<string, boolean>(
      input.changes.map((row) => [row.testSeriesId, row.enabled]),
    );
    const named = [...wanted.keys()];
    const rows = await this.prisma.branchTestConfig.findMany({
      where: { branchId, testSeriesId: { in: named } },
      select: { testSeriesId: true, enabled: true },
    });

    const held = new Map(rows.map((row) => [row.testSeriesId, row.enabled]));
    await this.giveThisBranchARow(
      branchId,
      named.filter((id) => !held.has(id)),
    );

    // By VALUE, not by diff: two statements, and a row flipped since the read still lands right.
    const [on, off] = partitionWanted(wanted);
    await this.prisma.$transaction([
      ...(on.length > 0
        ? [
            this.prisma.branchTestConfig.updateMany({
              where: { branchId, testSeriesId: { in: on } },
              data: { enabled: true },
            }),
          ]
        : []),
      ...(off.length > 0
        ? [
            this.prisma.branchTestConfig.updateMany({
              where: { branchId, testSeriesId: { in: off } },
              data: { enabled: false },
            }),
          ]
        : []),
    ]);

    // A row that was missing read as OFF on the screen, so that is what it moved FROM.
    const moved = named.filter((id) => wanted.get(id) !== (held.get(id) ?? false));
    if (moved.length === 0) return 0;

    this.auditContext.setEntityId(branchId);
    this.auditContext.setChanged(
      Object.fromEntries(
        moved.map((id) => [id, { from: held.get(id) ?? false, to: wanted.get(id) }]),
      ),
    );
    // ONE event, naming no series: the listener busts the whole catalog whatever it is handed.
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: null });
    return moved.length;
  }

  /** The list shows a series with no row here switched OFF, so the write writes one rather than refusing. */
  private async giveThisBranchARow(branchId: string, testSeriesIds: string[]): Promise<void> {
    if (testSeriesIds.length === 0) return;

    const real = await this.prisma.testSeries.findMany({
      where: { id: { in: testSeriesIds } },
      select: { id: true },
    });
    if (real.length !== testSeriesIds.length) {
      // Refused BEFORE anything is written: a half-applied draft leaves the screen disagreeing.
      throw new AppException(ErrorCodes.VALIDATION_ERROR, NO_SUCH_SERIES_HERE, {
        fieldErrors: { changes: [NO_SUCH_SERIES_HERE] },
      });
    }

    await this.prisma.branchTestConfig.createMany({
      data: testSeriesIds.map((testSeriesId) => ({ branchId, testSeriesId, enabled: false })),
      skipDuplicates: true,
    });
  }

  /** A branch that is not there is not one to configure, and it reads as missing rather than empty. */
  private async requireBranch(branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new AppException(ErrorCodes.NOT_FOUND, 'No such branch');
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

    await this.prisma.branchTestConfig.updateMany({
      where: { testSeriesId: id },
      data: { enabled: input.enabled },
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

    const row = await this.prisma.branchTestConfig.update({
      where: { id: existing.id },
      data: { ...(input.enabled === undefined ? {} : { enabled: input.enabled }) },
      include: { branch: { select: { id: true, name: true } } },
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

/** The columns a series' kind implies something about, plus what its branch switch says today. */
interface SeriesPairing {
  kind: TestSeriesKind;
  examStageId: string | null;
  programCode: string | null;
  eventId: string | null;
  branchIds: readonly string[];
  enabledBranches: number;
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
    found.push(['kind', KIND_PAIRING_MESSAGES.EVENT_CANNOT_BE_CHOSEN]);
  if (!isEvent && shape.eventId !== null)
    found.push(['kind', KIND_PAIRING_MESSAGES.EVENT_IS_ITS_OWN_KIND]);

  // The CHECK is on the list, so that is what refuses; the count is what the sentence says.
  if (shape.kind !== TEST_SERIES_KIND.STANDARD && shape.branchIds.length > 0)
    found.push(['kind', branchesAreStandardOnly(shape.enabledBranches)]);

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
    progressive: row.progressive,
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

const EVERY_BRANCH_IS_NOT_YOURS =
  'Switching a series for every branch is for an admin who reaches every branch.';

const NO_SUCH_SERIES_HERE = 'One of those series no longer exists. Reload and try again.';

/** The draft split by the value it asks for, so each half is one statement. */
function partitionWanted(wanted: ReadonlyMap<string, boolean>): [string[], string[]] {
  const on: string[] = [];
  const off: string[] = [];
  for (const [testSeriesId, enabled] of wanted) (enabled ? on : off).push(testSeriesId);
  return [on, off];
}

/** The branch's own switch, expressed as a filter on the series rather than on its config rows. */
function enabledAtBranch(branchId: string, enabled: boolean): Prisma.TestSeriesWhereInput {
  const some = { branchConfigs: { some: { branchId, enabled: true } } };
  return enabled ? some : { NOT: some };
}

function toBranchSeriesRow(row: {
  id: string;
  name: string;
  kind: TestSeriesKind;
  examStage: { id: string; name: string; exam: { code: string } } | null;
  _count: { tests: number };
  branchConfigs: { enabled: boolean }[];
}): BranchSeriesRow {
  return {
    testSeriesId: row.id,
    name: row.name,
    kind: row.kind,
    examStage: row.examStage
      ? { id: row.examStage.id, name: row.examStage.name, examCode: row.examStage.exam.code }
      : null,
    testCount: row._count.tests,
    // No row reads as off. It cannot happen — both fan-outs write one — and off is the safe answer.
    enabled: row.branchConfigs[0]?.enabled ?? false,
  };
}
