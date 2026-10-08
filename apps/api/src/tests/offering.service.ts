import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  OPENING_HAS_PASSED,
  TEST_STATUS,
  fieldDiff,
  programOpeningField,
  testIsOpen,
  type SaveOfferingBody,
  type SeriesTestRow,
  type SetTestSeriesBody,
  type TestOffering,
  type TestProgramUnlock,
  type TestSeriesLink,
} from '@iace/contracts';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import { countsBy } from '../common/relation-counts';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { AuditContext } from '../audit';
import {
  attemptsLabel,
  inTheCatalog,
  seriesFitIssue,
  seriesRefused,
  SERIES_GONE_MESSAGE,
  testShapeOf,
} from './test-rules';
import { formRefusal } from '../common/form-refusal';
import { beginPaperEdit } from '../common/paper-edit';
import { FinalizeService } from './finalize.service';
import { MS_PER_MINUTE } from '../common/time/units';
import { byOrderThenId } from '../common/series-order';

const OFFERING_SELECT = {
  id: true,
  title: true,
  status: true,
  version: true,
  finalizedAt: true,
  examStageId: true,
  opensAt: true,
  testSeriesId: true,
  seriesOrder: true,
  testSeries: { select: { name: true, sequentialTests: true } },
} as const satisfies Prisma.TestSelect;

const SERIES_TEST_SELECT = {
  id: true,
  title: true,
  seriesOrder: true,
  opensAt: true,
  status: true,
  finalizedAt: true,
  paperSource: true,
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
} as const satisfies Prisma.TestSelect;

const dateOrNull = (value: string | null | undefined): Date | null =>
  value === null || value === undefined ? null : new Date(value);

const OPENS_BEFORE_THE_TEST_DOES =
  'A program opens a test earlier, never later. A later opening would hold this program’s students back after the test has opened for everyone else.';

const OPENS_AT_FIELD = 'opensAt';

const DUPLICATE_PROGRAM_OPENING = 'Each program opens a test once. Give each program one opening.';

const CANNOT_CHANGE_SERIES = 'it cannot be moved to another series';

/** What the Offer step's audit diff covers: whether students get the test, and when it opens for whom. */
const AUDITED_OFFERING_FIELDS = ['status', 'opensAt', 'programUnlocks'] as const;

const OFFER_CHANGED_ELSEWHERE =
  'This test changed after you opened its Offer step. Reload it to see what changed before saving.';

/** The Offer step speaks minutes, so a stored time is unchanged when a save names the same minute. */
const sameMinute = (left: Date | null, right: Date | null): boolean =>
  left === null || right === null
    ? left === right
    : Math.floor(left.getTime() / MS_PER_MINUTE) === Math.floor(right.getTime() / MS_PER_MINUTE);

type OfferingClient = Pick<
  Prisma.TransactionClient,
  'test' | 'program' | 'testProgramUnlock' | 'attempt'
>;

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

/** A program opening the admin set must open the test earlier; one they left alone may simply be overtaken. */
function noLaterThanTheTest(testOpensAt: Date | null, opensAt: Date): string | null {
  if (testOpensAt !== null && opensAt <= testOpensAt) return null;
  return testOpensAt === null ? TEST_HAS_NO_OPENING : OPENS_BEFORE_THE_TEST_DOES;
}

function programRefused(
  code: (typeof ErrorCodes)[keyof typeof ErrorCodes],
  programCode: string,
  message: string,
): AppException {
  return new AppException(code, message, {
    fieldErrors: { [programOpeningField(programCode)]: [message] },
  });
}

/** The catalog's own order, over the column a `Test` row names its position with. */
const byPosition = (left: SeriesPosition, right: SeriesPosition): number =>
  byOrderThenId(
    { id: left.id, order: left.seriesOrder },
    { id: right.id, order: right.seriesOrder },
  );

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
    const place = byPosition(sibling, test);
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
    private readonly finalizer: FinalizeService,
  ) {}

  /** One column, so the test's own clock is untouched by a move and cannot be re-saved away. */
  async moveToSeries(testId: string, input: SetTestSeriesBody): Promise<TestSeriesLink> {
    const test = await this.requireTest(testId);
    const next = input.testSeriesId;
    if (next === test.testSeriesId) return linkOf(test);

    // A test students have sat is part of their record wherever it was offered.
    await this.assertUnsat(this.prisma, test, CANNOT_CHANGE_SERIES);
    const series = await this.assertSeriesUsable(test, next);
    await this.assertTitleFreeIn(next, series.name, test);
    const opensAt = test.opensAt;
    if (series.sequentialTests && opensAt !== null) {
      await this.assertOpeningFitsOrder(this.prisma, next, FORM_LEVEL_FIELD, (siblings) =>
        arrivalClash(opensAt, siblings),
      );
    }

    const moved = await this.prisma.$transaction(async (tx) => {
      await beginPaperEdit(tx, testId);
      // Asked again under the Test lock: a first sitting started since has landed, or waits behind the move.
      await this.assertUnsat(tx, test, CANNOT_CHANGE_SERIES);
      return tx.test.update({
        where: { id: testId },
        // An Offer step opened before the move names the series it left, so it must be refused.
        data: { testSeriesId: next, seriesOrder: null, version: { increment: 1 } },
        select: OFFERING_SELECT,
      });
    }, TX_LIMITS.SHORT);

    // One bump rebuilds every held series, the one it left included.
    if (inTheCatalog(test)) {
      this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: next });
    }

    return linkOf(moved);
  }

  /** The Offer step in one transaction, the Test row held first: a refusal anywhere leaves the test as it was. */
  async saveOffering(
    testId: string,
    body: SaveOfferingBody,
    isSuperAdmin: boolean,
    now: Date = new Date(),
  ): Promise<TestOffering> {
    const held = await this.prisma.$transaction(async (tx) => {
      await beginPaperEdit(tx, testId);
      const test = await this.requireTest(testId, tx);
      if (test.version !== body.expectedVersion) {
        throw formRefusal(ErrorCodes.CONFLICT, OFFER_CHANGED_ELSEWHERE);
      }
      const programUnlocks = await this.programUnlocks(tx, testId);
      const opensAt = dateOrNull(body.opensAt);
      await this.writeOpening(tx, test, opensAt, now);
      await this.writeProgramOpenings(
        tx,
        test.id,
        body.programOpenings,
        programUnlocks,
        opensAt,
        now,
      );

      if (body.offered && test.status !== TEST_STATUS.ACTIVE) {
        await this.finalizer.offerWithin(tx, test.id, isSuperAdmin);
      }
      if (!body.offered && test.status === TEST_STATUS.ACTIVE) {
        await tx.test.update({ where: { id: test.id }, data: { status: TEST_STATUS.INACTIVE } });
      }
      await tx.test.update({ where: { id: test.id }, data: { version: { increment: 1 } } });
      return { status: test.status, opensAt: test.opensAt, programUnlocks };
    }, TX_LIMITS.MEDIUM);

    const saved = await this.requireTest(testId);
    const programUnlocks = await this.programUnlocks(this.prisma, testId);
    this.auditContext.setChanged(
      fieldDiff(
        held,
        { status: saved.status, opensAt: saved.opensAt, programUnlocks },
        AUDITED_OFFERING_FIELDS,
      ),
    );
    this.announce(saved);
    return {
      status: saved.status,
      opensAt: saved.opensAt?.toISOString() ?? null,
      programUnlocks,
    };
  }

  /** Only a new time is judged; a sat test's opening is part of its history and no longer moves. */
  private async writeOpening(
    tx: Prisma.TransactionClient,
    test: OfferingRow,
    opensAt: Date | null,
    now: Date,
  ): Promise<void> {
    if (sameMinute(opensAt, test.opensAt)) return;
    await this.assertUnsat(tx, test, 'when it opens can no longer move');
    if (opensAt !== null) {
      assertOpeningAhead(opensAt, now, OPENS_AT_FIELD);
      if (test.testSeries.sequentialTests) {
        await this.assertOpeningFitsOrder(tx, test.testSeriesId, OPENS_AT_FIELD, (siblings) =>
          orderClash(test, opensAt, siblings),
        );
      }
    }
    await tx.test.update({ where: { id: test.id }, data: { opensAt } });
  }

  /** The kept set replaces the stored one; a row the admin set is judged, one they left and the opening overtook is dropped. */
  private async writeProgramOpenings(
    tx: Prisma.TransactionClient,
    testId: string,
    rows: SaveOfferingBody['programOpenings'],
    held: readonly TestProgramUnlock[],
    testOpensAt: Date | null,
    now: Date,
  ): Promise<void> {
    const codes = rows.map((row) => row.programCode);
    if (new Set(codes).size !== codes.length) {
      throw formRefusal(ErrorCodes.VALIDATION_ERROR, DUPLICATE_PROGRAM_OPENING);
    }
    const stored = new Map(held.map((row) => [row.programCode, row.opensAt]));

    const kept: { programCode: string; opensAt: Date }[] = [];
    for (const row of rows) {
      const opensAt = new Date(row.opensAt);
      const before = stored.get(row.programCode);
      const untouched = before !== undefined && sameMinute(new Date(before), opensAt);
      const late = noLaterThanTheTest(testOpensAt, opensAt);
      if (untouched && late === null)
        kept.push({ programCode: row.programCode, opensAt: new Date(before) });
      if (untouched) continue;

      await this.requireProgram(tx, row.programCode);
      if (testIsOpen(opensAt.toISOString(), now)) {
        throw programRefused(ErrorCodes.VALIDATION_ERROR, row.programCode, OPENING_HAS_PASSED);
      }
      if (late !== null) throw programRefused(ErrorCodes.VALIDATION_ERROR, row.programCode, late);
      kept.push({ programCode: row.programCode, opensAt });
    }

    await tx.testProgramUnlock.deleteMany({
      where: { testId, programCode: { notIn: kept.map((row) => row.programCode) } },
    });
    for (const { programCode, opensAt } of kept) {
      await tx.testProgramUnlock.upsert({
        where: { testId_programCode: { testId, programCode } },
        update: { opensAt },
        create: { testId, programCode, opensAt },
      });
    }
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
    // A series holding a test exists by its foreign key, so only an empty answer needs the look.
    if (rows.length === 0) await this.requireSeries(testSeriesId);
    // The series' own tests, not a `_count` that groups every attempt ever sat on any paper.
    const sat = countsBy(
      await this.prisma.attempt.groupBy({
        by: ['testId'],
        where: { testId: { in: rows.map((row) => row.id) } },
        _count: true,
      }),
      'testId',
    );

    return rows.map((row) => ({
      testId: row.id,
      title: row.title,
      order: row.seriesOrder,
      unlockAt: row.opensAt?.toISOString() ?? null,
      status: row.status,
      finalizedAt: row.finalizedAt?.toISOString() ?? null,
      ...testShapeOf(row),
      attemptCount: sat.get(row.id) ?? 0,
      paperSource: row.paperSource,
    }));
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
    db: OfferingClient,
    testSeriesId: string,
    field: string,
    clashOf: (siblings: readonly SeriesSibling[]) => string | null,
  ): Promise<void> {
    const siblings = await db.test.findMany({
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
  private async programUnlocks(db: OfferingClient, testId: string): Promise<TestProgramUnlock[]> {
    const rows = await db.testProgramUnlock.findMany({
      where: { testId },
      orderBy: [{ programCode: 'asc' }],
    });
    return rows.map((row) => ({
      programCode: row.programCode,
      opensAt: row.opensAt.toISOString(),
    }));
  }

  private async requireProgram(db: OfferingClient, programCode: string): Promise<void> {
    const program = await db.program.findUnique({
      where: { code: programCode },
      select: { code: true },
    });
    if (!program) throw programRefused(ErrorCodes.NOT_FOUND, programCode, 'No such program');
  }

  /** Filed against the test, and the series carrying it loses its cached catalog. */
  private announce(test: OfferingRow): void {
    this.auditContext.setEntityId(test.id);
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: test.testSeriesId });
  }

  /** A sat test's history is fixed: `consequence` names what its attempts forbid. */
  private async assertUnsat(
    db: OfferingClient,
    test: OfferingRow,
    consequence: string,
  ): Promise<void> {
    const sat = await db.attempt.count({ where: { testId: test.id } });
    if (sat === 0) return;

    throw formRefusal(
      ErrorCodes.CONFLICT,
      `This test has ${attemptsLabel(sat)} on it, so ${consequence}.`,
    );
  }

  private async requireSeries(id: string): Promise<void> {
    const series = await this.prisma.testSeries.findUnique({ where: { id }, select: { id: true } });
    if (!series) throw new AppException(ErrorCodes.NOT_FOUND, 'No such series');
  }

  private async requireTest(id: string, db: OfferingClient = this.prisma): Promise<OfferingRow> {
    const test = await db.test.findUnique({ where: { id }, select: OFFERING_SELECT });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    return test;
  }
}
