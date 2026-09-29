import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  OPENING_HAS_PASSED,
  TEST_STATUS,
  programOpeningField,
  testIsOpen,
  type SaveOfferingBody,
  type SeriesTestRow,
  type SetTestSeriesBody,
  type TestOffering,
  type TestProgramUnlock,
  type TestSeriesLink,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { AuditContext } from '../audit';
import {
  attemptsLabel,
  seriesFitIssue,
  seriesRefused,
  SERIES_GONE_MESSAGE,
  testShapeOf,
} from './test-rules';
import { formRefusal } from '../common/form-refusal';
import { beginPaperEdit } from './begin-paper-edit';
import { FinalizeService, FREEZE_LIMITS } from './finalize.service';

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
  _count: { select: { attempts: true } },
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
  _count: { select: { attempts: true } },
} as const satisfies Prisma.TestSelect;

const dateOrNull = (value: string | null | undefined): Date | null =>
  value === null || value === undefined ? null : new Date(value);

const OPENS_BEFORE_THE_TEST_DOES =
  'A program opens a test earlier, never later. A later opening would hold this program’s students back after the test has opened for everyone else.';

const OPENS_AT_FIELD = 'opensAt';

const DUPLICATE_PROGRAM_OPENING = 'Each program opens a test once. Give each program one opening.';

const OFFER_CHANGED_ELSEWHERE =
  'Somebody else saved this test’s offer after you opened it. Reload it to see theirs before saving yours.';

const MINUTE_MS = 60_000;

/** The Offer step speaks minutes, so a stored time is unchanged when a save names the same minute. */
const sameMinute = (left: Date | null, right: Date | null): boolean =>
  left === null || right === null
    ? left === right
    : Math.floor(left.getTime() / MINUTE_MS) === Math.floor(right.getTime() / MINUTE_MS);

type OfferingClient = Pick<Prisma.TransactionClient, 'test' | 'program' | 'testProgramUnlock'>;

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

/** An unpositioned test sorts last, exactly as the student catalog sorts it. */
const ORDERED_LAST = Number.MAX_SAFE_INTEGER;

const byOrderThenId = (left: SeriesPosition, right: SeriesPosition): number =>
  (left.seriesOrder ?? ORDERED_LAST) - (right.seriesOrder ?? ORDERED_LAST) ||
  left.id.localeCompare(right.id);

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
    const place = byOrderThenId(sibling, test);
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

  async series(testId: string): Promise<TestSeriesLink> {
    return linkOf(await this.requireTest(testId));
  }

  /** One column, so the test's own clock is untouched by a move and cannot be re-saved away. */
  async moveToSeries(testId: string, input: SetTestSeriesBody): Promise<TestSeriesLink> {
    const test = await this.requireTest(testId);
    const next = input.testSeriesId;
    if (next === test.testSeriesId) return linkOf(test);

    // A test students have sat is part of their record wherever it was offered.
    this.assertUnsat(test, 'it cannot be moved to another series');
    const series = await this.assertSeriesUsable(test, next);
    await this.assertTitleFreeIn(next, series.name, test);
    const opensAt = test.opensAt;
    if (series.sequentialTests && opensAt !== null) {
      await this.assertOpeningFitsOrder(this.prisma, next, FORM_LEVEL_FIELD, (siblings) =>
        arrivalClash(opensAt, siblings),
      );
    }

    const moved = await this.prisma.test.update({
      where: { id: testId },
      data: { testSeriesId: next, seriesOrder: null },
      select: OFFERING_SELECT,
    });

    // Both sides: the catalog a student reads is cached against the series it moved between.
    for (const testSeriesId of [test.testSeriesId, next]) {
      this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId });
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
    await this.prisma.$transaction(async (tx) => {
      await beginPaperEdit(tx, testId);
      const test = await this.requireTest(testId, tx);
      if (test.version !== body.expectedVersion) {
        throw formRefusal(ErrorCodes.CONFLICT, OFFER_CHANGED_ELSEWHERE);
      }
      const opensAt = dateOrNull(body.opensAt);
      await this.writeOpening(tx, test, opensAt, now);
      await this.writeProgramOpenings(tx, test.id, body.programOpenings, opensAt, now);

      if (body.offered && test.status !== TEST_STATUS.ACTIVE) {
        await this.finalizer.offerWithin(tx, test.id, isSuperAdmin);
      }
      if (!body.offered && test.status === TEST_STATUS.ACTIVE) {
        await tx.test.update({ where: { id: test.id }, data: { status: TEST_STATUS.INACTIVE } });
      }
      await tx.test.update({ where: { id: test.id }, data: { version: { increment: 1 } } });
    }, FREEZE_LIMITS);

    const saved = await this.requireTest(testId);
    this.announce(saved);
    return {
      status: saved.status,
      opensAt: saved.opensAt?.toISOString() ?? null,
      programUnlocks: await this.programUnlocks(this.prisma, testId),
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
    this.assertUnsat(test, 'when it opens can no longer move');
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
    testOpensAt: Date | null,
    now: Date,
  ): Promise<void> {
    const codes = rows.map((row) => row.programCode);
    if (new Set(codes).size !== codes.length) {
      throw formRefusal(ErrorCodes.VALIDATION_ERROR, DUPLICATE_PROGRAM_OPENING);
    }
    const stored = new Map(
      (await this.programUnlocks(tx, testId)).map((row) => [row.programCode, row.opensAt]),
    );

    const kept: { programCode: string; opensAt: Date }[] = [];
    for (const row of rows) {
      const opensAt = new Date(row.opensAt);
      const held = stored.get(row.programCode);
      const untouched = held !== undefined && sameMinute(new Date(held), opensAt);
      const late = noLaterThanTheTest(testOpensAt, opensAt);
      if (untouched && late === null) kept.push({ programCode: row.programCode, opensAt });
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

    return rows.map((row) => ({
      testId: row.id,
      title: row.title,
      order: row.seriesOrder,
      unlockAt: row.opensAt?.toISOString() ?? null,
      status: row.status,
      finalizedAt: row.finalizedAt?.toISOString() ?? null,
      ...testShapeOf(row),
      attemptCount: row._count.attempts,
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
  private assertUnsat(test: OfferingRow, consequence: string): void {
    if (test._count.attempts === 0) return;

    const message = `This test has ${attemptsLabel(test._count.attempts)} on it, so ${consequence}.`;
    throw formRefusal(ErrorCodes.CONFLICT, message);
  }

  private async requireTest(id: string, db: OfferingClient = this.prisma): Promise<OfferingRow> {
    const test = await db.test.findUnique({ where: { id }, select: OFFERING_SELECT });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    return test;
  }
}
