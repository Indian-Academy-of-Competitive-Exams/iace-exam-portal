import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  fieldDiff,
  TEST_SERIES_KIND,
  type CreateTestSeriesBody,
  type Paginated,
  type SeriesBranch,
  type TestSeriesListQuery,
  type TestSeriesDetail,
  type TestSeriesKind,
  type TestSeriesSummary,
  type ToggleSeriesBranchBody,
  type UpdateSeriesBranchesBody,
  type UpdateTestSeriesBody,
} from '@iace/contracts';
import { matchFilters } from '../common/match-filters';
import { pageArgs, paged } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AccessResolverService } from './access-resolver.service';
import { AuditContext } from '../audit';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { ExamStagesService } from '../configs';
import { ProgramsService } from './programs.service';
import { everyTermMatches } from '../common/search-terms';
import { byOrderThenId } from '../common/series-order';
import { formRefusal } from '../common/form-refusal';

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

const SERIES_NAME_TAKEN = 'Another series already goes by that name.';

const SERIES_CHANGED_ELSEWHERE =
  'This series changed after you opened it. Reload it to see what changed before saving.';

const branchesAreStandardOnly = (count: number) =>
  `Only a standard series reaches students branch by branch. This one is switched on at ${count} ${count === 1 ? 'branch' : 'branches'} and carries a branch list no other kind can hold, so its kind cannot change.`;

const NO_SUCH_BRANCH_MESSAGE = 'One of those branches does not exist.';

const INACTIVE_EVENT_MESSAGE =
  'That event is no longer active. Pick another, or reactivate it first.';

const UNTITLED_TEST = 'An untitled test';

const heldForAnotherStage = (count: number) =>
  `This series holds ${count} ${count === 1 ? 'test' : 'tests'} built for another stage, and a series carries only tests built for its own. Move ${count === 1 ? 'it' : 'them'} to another series first.`;

const opensOutOfOrder = (later: string, earlier: string) =>
  `${later} comes after ${earlier} in this series and opens no later than it. Move one of the two openings before opening the tests in order.`;

const SERIES_INCLUDE = {
  examStage: { select: { id: true, name: true, exam: { select: { code: true } } } },
  event: { select: { name: true } },
  _count: { select: { tests: true, grants: true } },
} as const satisfies Prisma.TestSeriesInclude;

type SeriesRow = Prisma.TestSeriesGetPayload<{ include: typeof SERIES_INCLUDE }>;

/** What a series' audit diff covers — every column an edit can change. */
export const AUDITED_SERIES_FIELDS = [
  'name',
  'examStageId',
  'programCode',
  'sequentialTests',
  'kind',
  'eventId',
] as const;

/** Owns `TestSeries`. A test reaches a student only through a series, a STANDARD one only through `branchIds`. */
@Injectable()
export class TestSeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stages: ExamStagesService,
    private readonly programs: ProgramsService,
    private readonly access: AccessResolverService,
    private readonly auditContext: AuditContext,
    private readonly events: DomainEventBus,
  ) {}

  private async outOfReachOf(studentId?: string): Promise<Prisma.TestSeriesWhereInput[]> {
    if (studentId === undefined) return [];

    const reached = await this.access.seriesReachedBy(studentId);
    return reached ? [{ id: { notIn: reached.map((row) => row.id) } }] : [];
  }

  async list(query: TestSeriesListQuery): Promise<Paginated<TestSeriesSummary>> {
    const chosen: Prisma.TestSeriesWhereInput[] = [
      ...(query.examStageId ? [{ examStageId: { in: query.examStageId } }] : []),
      ...(query.forExamStageId
        ? [{ OR: [{ examStageId: query.forExamStageId }, { examStageId: null }] }]
        : []),
      ...(query.programCode ? [{ programCode: query.programCode }] : []),
      ...(query.kind === undefined ? [] : [{ kind: query.kind }]),
    ];
    const always: Prisma.TestSeriesWhereInput[] = query.q
      ? [
          everyTermMatches<Prisma.TestSeriesWhereInput>(query.q, (term) => [
            { name: { contains: term, mode: 'insensitive' } },
          ]),
        ]
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
        ...pageArgs(query),
      }),
      this.prisma.testSeries.count({ where }),
    ]);

    const live = await this.liveBranchIds();

    return paged(
      query,
      rows.map((row) => toSummary(row, live)),
      total,
    );
  }

  async detail(id: string): Promise<TestSeriesDetail> {
    const row = await this.requireSeries(id);
    const [live, reachedCount, satCount] = await Promise.all([
      this.liveBranchIds(),
      this.access.audienceCount(id),
      this.satCount(id),
    ]);

    return { ...toSummary(row, live), reachedCount, satCount };
  }

  /** Raw because a headcount is one row: Prisma's `distinct` would pull every sitting back to count it. */
  private async satCount(testSeriesId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ sat: bigint }[]>`
      SELECT COUNT(DISTINCT a."studentId") AS sat
      FROM "Attempt" a
      JOIN "Test" t ON t."id" = a."testId"
      WHERE t."testSeriesId" = ${testSeriesId}::uuid AND a."voidedAt" IS NULL
    `;
    return Number(rows[0]?.sat ?? 0);
  }

  /** A new series reaches no branch until an admin names one — `branchIds` starts empty. */
  async create(input: CreateTestSeriesBody): Promise<TestSeriesDetail> {
    await this.assertTargetsUsable(input);
    await this.assertNameFree(input.name);
    const kind = input.kind ?? TEST_SERIES_KIND.STANDARD;
    this.assertKindHoldsTogether({
      kind,
      examStageId: input.examStageId ?? null,
      programCode: input.programCode ?? null,
      eventId: input.eventId ?? null,
      branchIds: [],
    });
    await this.assertEventUsable(input.eventId);

    const series = await this.prisma.testSeries.create({
      data: { ...columnsOf(input), name: input.name },
    });

    // No `:id` in the path and a summary coming back, so the row is named explicitly. Who did it is the audit row's actor — `TestSeries` has no `createdById` column of its own.
    this.auditContext.setEntityId(series.id);
    // A free, program or event series reaches its students the moment it saves, and every held catalog must hear of it.
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: series.id });

    return this.detail(series.id);
  }

  async update(id: string, input: UpdateTestSeriesBody): Promise<TestSeriesDetail> {
    const series = await this.requireSeries(id);
    const opened = input.expectedUpdatedAt;
    if (opened !== undefined && opened !== series.updatedAt.toISOString()) {
      throw formRefusal(ErrorCodes.CONFLICT, SERIES_CHANGED_ELSEWHERE);
    }
    await this.assertTargetsUsable(input, series);
    if (input.name !== undefined) await this.assertNameFree(input.name, id);
    const kind = input.kind ?? series.kind;
    const standard = kind === TEST_SERIES_KIND.STANDARD;
    // `branchIds` carries no foreign key, so a branch deleted since may still be on it: only a live one holds the kind.
    this.assertKindHoldsTogether({
      kind,
      examStageId: settledValue(input.examStageId, series.examStageId),
      programCode: settledValue(input.programCode, series.programCode),
      eventId: settledValue(input.eventId, series.eventId),
      branchIds: standard ? series.branchIds : await this.liveAmong(series.branchIds),
    });
    await this.assertEventUsable(input.eventId, series.eventId);
    await this.assertTestsFit(series, input);

    // Conditional on the row the rules above judged: a save that lost the race is refused, not merged.
    const claimed = await this.prisma.testSeries.updateMany({
      where: { id, updatedAt: series.updatedAt },
      // Past the rule above, whatever a series of another kind still lists is a branch that is gone.
      data: { ...columnsOf(input), ...(standard ? {} : { branchIds: [] }), updatedAt: new Date() },
    });
    if (claimed.count !== 1) throw formRefusal(ErrorCodes.CONFLICT, SERIES_CHANGED_ELSEWHERE);

    const updated = await this.requireSeries(id);
    this.auditContext.setChanged(fieldDiff(series, updated, AUDITED_SERIES_FIELDS));
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });

    return this.detail(id);
  }

  async remove(id: string): Promise<void> {
    await this.requireSeries(id);

    const held = await this.prisma.test.count({ where: { testSeriesId: id } });
    if (held > 0) {
      const one = held === 1;
      throw new AppException(
        ErrorCodes.CONFLICT,
        `${held} ${one ? 'test is' : 'tests are'} offered through this series, and deleting it would take away the only route to ${one ? 'it' : 'them'}. Move ${one ? 'it' : 'them'} to another series first.`,
      );
    }

    await this.prisma.testSeries.delete({ where: { id } });
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });
  }

  /** Every branch, and whether this series reaches it. */
  async branches(id: string): Promise<SeriesBranch[]> {
    const series = await this.requireSeries(id);
    const rows = await this.prisma.branch.findMany({
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }],
    });

    const enabled = new Set(series.branchIds);
    return rows.map((row) => ({ id: row.id, name: row.name, enabled: enabled.has(row.id) }));
  }

  /** The whole list at once — the array itself, never a delta against what is stored. */
  async setBranches(id: string, input: UpdateSeriesBranchesBody): Promise<SeriesBranch[]> {
    const series = await this.requireSeries(id);
    if ('everyBranch' in input) return this.switchOnEverywhere(series);

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
    this.auditContext.setChanged(
      fieldDiff(series, { ...series, branchIds: chosen }, ['branchIds']),
    );
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });
    return this.branches(id);
  }

  /** "Every branch" is read by the statement that writes it, so one made a moment ago is on the list. */
  private async switchOnEverywhere(series: SeriesRow): Promise<SeriesBranch[]> {
    this.assertKindHoldsTogether({
      kind: series.kind,
      examStageId: series.examStageId,
      programCode: series.programCode,
      eventId: series.eventId,
      branchIds: [...(await this.liveBranchIds())],
    });

    const [moved] = await this.prisma.$queryRaw<{ before: string[]; after: string[] }[]>`
      UPDATE "TestSeries" AS s
      SET "branchIds" = (SELECT COALESCE(array_agg(b."id" ORDER BY b."name"), '{}') FROM "Branch" b),
          "updatedAt" = now()
      FROM (SELECT "id", "branchIds" FROM "TestSeries" WHERE "id" = ${series.id}::uuid FOR UPDATE) AS old
      WHERE s."id" = old."id"
      RETURNING old."branchIds" AS "before", s."branchIds" AS "after"`;

    this.auditContext.setEntityId(series.id);
    this.auditContext.setPatchDiff(
      moved ? { branchIds: { from: moved.before, to: moved.after } } : null,
    );
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: series.id });
    return this.branches(series.id);
  }

  /** One UPDATE against the stored list, so two toggles made from the same stale screen both land. */
  async toggleBranch(id: string, input: ToggleSeriesBranchBody): Promise<SeriesBranch[]> {
    const series = await this.requireSeries(id);
    await this.assertBranchesLive([input.branchId]);
    if (input.enabled) {
      this.assertKindHoldsTogether({
        kind: series.kind,
        examStageId: series.examStageId,
        programCode: series.programCode,
        eventId: series.eventId,
        branchIds: [...series.branchIds, input.branchId],
      });
    }

    const branch = Prisma.sql`${input.branchId}::uuid`;
    const held = Prisma.sql`${branch} = ANY(s."branchIds")`;
    const [next, moves] = input.enabled
      ? [Prisma.sql`array_append(s."branchIds", ${branch})`, Prisma.sql`NOT (${held})`]
      : [Prisma.sql`array_remove(s."branchIds", ${branch})`, held];
    const [moved] = await this.prisma.$queryRaw<{ before: string[]; after: string[] }[]>`
      UPDATE "TestSeries" AS s SET "branchIds" = ${next}, "updatedAt" = now()
      FROM (SELECT "id", "branchIds" FROM "TestSeries" WHERE "id" = ${id}::uuid FOR UPDATE) AS old
      WHERE s."id" = old."id" AND ${moves}
      RETURNING old."branchIds" AS "before", s."branchIds" AS "after"`;

    // Already on, or already off: nothing moved, so there is nothing to log and no catalog to bump.
    this.auditContext.setPatchDiff(
      moved ? { branchIds: { from: moved.before, to: moved.after } } : null,
    );
    if (moved) {
      this.auditContext.setEntityId(id);
      this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: id });
    }
    return this.branches(id);
  }

  /** Answered here so a form marks the field: a raw CHECK violation can only leave as a 500. */
  private assertKindHoldsTogether(shape: SeriesPairing): void {
    const fieldErrors = kindPairingErrors(shape);
    const message = Object.values(fieldErrors)[0]?.[0];
    if (message === undefined) return;
    throw new AppException(ErrorCodes.VALIDATION_ERROR, message, { fieldErrors });
  }

  /** A target is judged when it is chosen: one the series already holds is not this save's to refuse. */
  private async assertTargetsUsable(
    input: Partial<CreateTestSeriesBody>,
    held?: SeriesRow,
  ): Promise<void> {
    const { examStageId, programCode } = input;
    if (examStageId && examStageId !== held?.examStageId) {
      await this.stages.assertUsable(examStageId);
    }
    if (programCode && programCode !== held?.programCode) {
      await this.programs.assertUsable([programCode], 'programCode');
    }
  }

  /** Asked after the kind rule, which answers an event on the wrong kind; a deleted one would leave as the foreign key's generic refusal. */
  private async assertEventUsable(eventId?: string | null, held?: string | null): Promise<void> {
    if (!eventId || eventId === held) return;
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { isActive: true },
    });
    if (!event) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'No such event', {
        fieldErrors: { eventId: ['Pick an event'] },
      });
    }
    if (!event.isActive) throw refusedUnder('eventId', INACTIVE_EVENT_MESSAGE);
  }

  /** What an edit may not leave behind: a test of another stage, or an in-order series whose openings do not ascend. */
  private async assertTestsFit(series: SeriesRow, input: UpdateTestSeriesBody): Promise<void> {
    if (input.examStageId && input.examStageId !== series.examStageId) {
      const stray = await this.prisma.test.count({
        where: { testSeriesId: series.id, examStageId: { not: input.examStageId } },
      });
      if (stray > 0) throw refusedUnder('examStageId', heldForAnotherStage(stray));
    }
    if (input.sequentialTests && !series.sequentialTests) {
      const clash = await this.openingOutOfOrder(series.id);
      if (clash) throw refusedUnder('sequentialTests', clash);
    }
  }

  /** In order means the openings ascend with it. A series holds a handful of tests, so they are compared here. */
  private async openingOutOfOrder(testSeriesId: string): Promise<string | null> {
    const tests = await this.prisma.test.findMany({
      where: { testSeriesId, opensAt: { not: null } },
      select: { id: true, title: true, seriesOrder: true, opensAt: true },
    });
    const placed = tests.map((test) => ({ ...test, order: test.seriesOrder })).sort(byOrderThenId);

    for (const [index, later] of placed.entries()) {
      const earlier = placed[index - 1];
      if (earlier?.opensAt && later.opensAt && later.opensAt <= earlier.opensAt) {
        return opensOutOfOrder(later.title ?? UNTITLED_TEST, earlier.title ?? UNTITLED_TEST);
      }
    }
    return null;
  }

  /** Nothing in `branchIds` may name a branch that is not really there — the array carries no FK. */
  private async assertBranchesLive(branchIds: readonly string[]): Promise<void> {
    if (branchIds.length === 0) return;
    const found = await this.prisma.branch.count({
      where: { id: { in: [...branchIds] } },
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
  /** The unique index is the guarantee; this is so the refusal lands on the field that caused it. */
  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.testSeries.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId === undefined ? {} : { id: { not: exceptId } }),
      },
      select: { id: true },
    });
    if (clash === null) return;

    throw new AppException(ErrorCodes.CONFLICT, SERIES_NAME_TAKEN, {
      fieldErrors: { name: [SERIES_NAME_TAKEN] },
    });
  }

  private async liveBranchIds(): Promise<ReadonlySet<string>> {
    const rows = await this.prisma.branch.findMany({ select: { id: true } });
    return new Set(rows.map((row) => row.id));
  }

  /** Which of these ids still name a branch. */
  private async liveAmong(branchIds: readonly string[]): Promise<string[]> {
    if (branchIds.length === 0) return [];
    const rows = await this.prisma.branch.findMany({
      where: { id: { in: [...branchIds] } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
}

const refusedUnder = (field: string, message: string): AppException =>
  new AppException(ErrorCodes.VALIDATION_ERROR, message, { fieldErrors: { [field]: [message] } });

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
    ...(input.examStageId === undefined ? {} : { examStageId: input.examStageId ?? null }),
    ...(input.programCode === undefined ? {} : { programCode: input.programCode ?? null }),
    ...(input.sequentialTests === undefined ? {} : { sequentialTests: input.sequentialTests }),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.eventId === undefined ? {} : { eventId: input.eventId ?? null }),
  } satisfies Prisma.TestSeriesUncheckedUpdateInput;
}

function toSummary(row: SeriesRow, live: ReadonlySet<string>): TestSeriesSummary {
  // The list carries no foreign key, so a branch deleted since is still on it and must not be counted.
  const branchIds = row.branchIds.filter((id) => live.has(id));
  return {
    id: row.id,
    name: row.name,
    examStageId: row.examStageId,
    examStage: row.examStage
      ? { id: row.examStage.id, name: row.examStage.name, examCode: row.examStage.exam.code }
      : null,
    programCode: row.programCode,
    sequentialTests: row.sequentialTests,
    kind: row.kind,
    branchIds,
    eventId: row.eventId,
    eventName: row.event?.name ?? null,
    testCount: row._count.tests,
    grantCount: row._count.grants,
    enabledBranchCount: branchIds.length,
    branchCount: live.size,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
