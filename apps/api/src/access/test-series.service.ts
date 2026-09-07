import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  EVALUATION_MODE_LABELS,
  fieldDiff,
  TEST_SERIES_KIND,
  type CreateTestSeriesBody,
  type EvaluationMode,
  type Paginated,
  type SeriesBranch,
  type TestSeriesListQuery,
  type TestSeriesKind,
  type TestSeriesSummary,
  type UpdateSeriesBranchesBody,
  type UpdateTestSeriesBody,
} from '@iace/contracts';
import { matchFilters } from '../common/match-filters';
import { PrismaService } from '../prisma/prisma.service';
import { reachableBy } from './access-resolver.service';
import { AuditContext } from '../audit';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { ExamStagesService } from '../configs';
import { ProgramsService } from './programs.service';
import { isEnabledPatch, startsSwitchedOn } from './series-switch';

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

const NO_SUCH_BRANCH_MESSAGE = 'One of those branches does not exist.';

const modeIsSettledBy = (count: number, mode: EvaluationMode) =>
  `This series holds ${count} ${count === 1 ? 'test' : 'tests'} built as ${EVALUATION_MODE_LABELS[mode]}, and its tests are judged the way it says. Move them to another series first, or make a new one.`;

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
  'evaluationMode',
  'eventId',
  'isEnabled',
] as const;

/** Owns `TestSeries`. A test reaches a student only through a series, a STANDARD one only through `branchIds`. */
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
        enrolledCourses: true,
      },
    });
    if (!student) return [];

    return [{ NOT: reachableBy(studentId, student) }];
  }

  async list(query: TestSeriesListQuery): Promise<Paginated<TestSeriesSummary>> {
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
    const complement = await this.outOfReachOf(query.notReachedBy);
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

    const branchCount = await this.liveBranchCount();

    return {
      items: rows.map((row) => toSummary(row, branchCount)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async detail(id: string): Promise<TestSeriesSummary> {
    const row = await this.requireSeries(id);
    return toSummary(row, await this.liveBranchCount());
  }

  /** A new series reaches no branch until an admin names one — `branchIds` starts empty. */
  async create(input: CreateTestSeriesBody): Promise<TestSeriesSummary> {
    await this.assertTargetsUsable(input);
    const kind = input.kind ?? TEST_SERIES_KIND.STANDARD;
    this.assertKindHoldsTogether({
      kind,
      examStageId: input.examStageId ?? null,
      programCode: input.programCode ?? null,
      eventId: input.eventId ?? null,
      branchIds: [],
    });

    const series = await this.prisma.testSeries.create({
      data: {
        ...columnsOf(input),
        name: input.name,
        isEnabled: input.isEnabled ?? startsSwitchedOn(kind),
      },
    });

    // No `:id` in the path and a summary coming back, so the row is named explicitly. Who did
    // it is the audit row's actor — `TestSeries` has no `createdById` column of its own.
    this.auditContext.setEntityId(series.id);
    // A kind that reaches past every branch is switched on the moment it saves, cached catalogs and all.
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: series.id });

    return this.detail(series.id);
  }

  async update(id: string, input: UpdateTestSeriesBody): Promise<TestSeriesSummary> {
    const series = await this.requireSeries(id);
    await this.assertTargetsUsable(input);
    this.assertModeIsStillOpen(series, input.evaluationMode);
    // `branchIds` is untouched here — only `setBranches` moves it, so this reads what it already holds.
    this.assertKindHoldsTogether({
      kind: input.kind ?? series.kind,
      examStageId: settledValue(input.examStageId, series.examStageId),
      programCode: settledValue(input.programCode, series.programCode),
      eventId: settledValue(input.eventId, series.eventId),
      branchIds: series.branchIds,
    });

    await this.prisma.testSeries.update({
      where: { id },
      data: { ...columnsOf(input), ...isEnabledPatch(input.isEnabled) },
    });

    const updated = await this.requireSeries(id);
    this.auditContext.setChanged(fieldDiff(series, updated, AUDITED_SERIES_FIELDS));
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });

    return this.detail(id);
  }

  async remove(id: string): Promise<void> {
    await this.requireSeries(id);

    const held = await this.prisma.test.count({ where: { testSeriesId: id } });
    if (held > 0) {
      const tests = `${held} test${held === 1 ? '' : 's'}`;
      throw new AppException(
        ErrorCodes.CONFLICT,
        `${tests} are offered through this series, and deleting it would take away the only route to them. Remove them from the series first.`,
      );
    }

    await this.prisma.testSeries.delete({ where: { id } });
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });
  }

  /** Every branch, and whether this series reaches it. */
  async branches(id: string): Promise<SeriesBranch[]> {
    const series = await this.requireSeries(id);
    const rows = await this.prisma.branch.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }],
    });

    const enabled = new Set(series.branchIds);
    return rows.map((row) => ({ id: row.id, name: row.name, enabled: enabled.has(row.id) }));
  }

  /** The whole list at once — the array itself, never a delta against what is stored. */
  async setBranches(id: string, input: UpdateSeriesBranchesBody): Promise<SeriesBranch[]> {
    const series = await this.requireSeries(id);
    const chosen = [...new Set(input.branchIds)];
    this.assertKindHoldsTogether({
      kind: series.kind,
      examStageId: series.examStageId,
      programCode: series.programCode,
      eventId: series.eventId,
      branchIds: chosen,
    });
    await this.assertBranchesLive(chosen);

    await this.prisma.testSeries.update({ where: { id }, data: { branchIds: chosen } });

    this.auditContext.setEntityId(id);
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });
    return this.branches(id);
  }

  /** A series decides how its tests are judged, so it can only decide while it holds none. */
  private assertModeIsStillOpen(series: SeriesRow, next: EvaluationMode | undefined): void {
    const held = series._count.tests;
    if (next === undefined || next === series.evaluationMode || held === 0) return;
    const message = modeIsSettledBy(held, series.evaluationMode);
    throw new AppException(ErrorCodes.CONFLICT, message, {
      fieldErrors: { evaluationMode: [message] },
    });
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

  /** Nothing in `branchIds` may name a branch that is not really there — the array carries no FK. */
  private async assertBranchesLive(branchIds: readonly string[]): Promise<void> {
    if (branchIds.length === 0) return;
    const found = await this.prisma.branch.count({
      where: { id: { in: [...branchIds] }, deletedAt: null },
    });
    if (found === branchIds.length) return;
    throw new AppException(ErrorCodes.VALIDATION_ERROR, NO_SUCH_BRANCH_MESSAGE, {
      fieldErrors: { branchIds: [NO_SUCH_BRANCH_MESSAGE] },
    });
  }

  private async requireSeries(id: string): Promise<SeriesRow> {
    const series = await this.prisma.testSeries.findUnique({
      where: { id },
      include: SERIES_INCLUDE,
    });
    if (!series) throw new AppException(ErrorCodes.NOT_FOUND, 'No such series');
    return series;
  }

  /** Out of how many branches could run one — every live branch, the same number for every series. */
  private async liveBranchCount(): Promise<number> {
    return this.prisma.branch.count({ where: { deletedAt: null } });
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
    ...(input.evaluationMode === undefined ? {} : { evaluationMode: input.evaluationMode }),
    ...(input.eventId === undefined ? {} : { eventId: input.eventId ?? null }),
  } satisfies Prisma.TestSeriesUncheckedUpdateInput;
}

function toSummary(row: SeriesRow, branchCount: number): TestSeriesSummary {
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
    evaluationMode: row.evaluationMode,
    branchIds: row.branchIds,
    isEnabled: row.isEnabled,
    eventId: row.eventId,
    testCount: row._count.tests,
    enabledBranchCount: row.branchIds.length,
    branchCount,
    createdAt: row.createdAt.toISOString(),
  };
}
