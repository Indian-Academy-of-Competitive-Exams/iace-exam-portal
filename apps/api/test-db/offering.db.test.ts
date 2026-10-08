import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  OPENING_HAS_PASSED,
  TEST_SERIES_KIND,
  TEST_STATUS,
  programOpeningField,
  type SaveOfferingBody,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { DOMAIN_EVENTS } from '../src/common/events';
import { FinalizeService } from '../src/tests/finalize.service';
import { OfferingService } from '../src/tests/offering.service';
import { FakeEventBus } from '../test/support/fakes';
import {
  BUILDER,
  makeBuilder,
  makeSitting,
  makeStudent,
  resetDatabase,
  testPrisma,
} from './support/database';

/** One uuid per label, shared across the file so a test can name an id by what it means. */
const idCache = new Map<string, string>();
const idFor = (label: string): string => {
  const cached = idCache.get(label);
  if (cached) return cached;
  const id = randomUUID();
  idCache.set(label, id);
  return id;
};

const TEST = idFor('tst_1');
const PROGRAM = 'FOUNDATION';
const HOUR_MS = 3_600_000;
const OPENS_AT = new Date('2026-09-01T04:30:00.000Z');
const A_DAY_LATER_DATE = new Date('2026-09-02T04:30:00.000Z');
const A_DAY_LATER = A_DAY_LATER_DATE.toISOString();
/** Before every instant these tests set, so no opening is refused for having passed by accident. */
const NOW = new Date('2026-08-01T00:00:00.000Z');

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

type TestFields = Partial<Prisma.TestUncheckedCreateInput>;

const testIn = (data: TestFields & { id: string }) =>
  prisma.test.create({
    data: {
      title: 'Mock 2',
      baseConfigId: BUILDER.CONFIG,
      examStageId: BUILDER.STAGE,
      testSeriesId: idFor('srs_1'),
      ...data,
    },
  });

/** Two series on the config's stage, one test first in the first of them, and the FOUNDATION program. */
async function serviceWith(test: TestFields = {}, sittings = 0) {
  await makeBuilder(prisma, [{ id: idFor('sec_1'), name: 'Reasoning', questionCount: 100 }]);
  await prisma.testSeries.createMany({
    data: [
      { id: idFor('srs_1'), name: 'SSC CGL 2026 — Full length', examStageId: BUILDER.STAGE },
      { id: idFor('srs_2'), name: 'SSC CGL 2026 — Sectionals', examStageId: BUILDER.STAGE },
    ],
  });
  await prisma.program.create({ data: { code: PROGRAM, name: 'Foundation' } });
  await testIn({ id: TEST, seriesOrder: 1, ...test });
  for (let at = 0; at < sittings; at += 1) {
    await makeSitting(prisma, {
      testId: TEST,
      studentId: (await makeStudent(prisma)).id,
      score: 0,
    });
  }
  const events = new FakeEventBus();
  const audit = new AuditContext();
  const finalizer = new FinalizeService();
  return {
    events,
    audit,
    service: new OfferingService(prisma, events.asService(), audit, finalizer),
  };
}

const FROZEN = { finalizedAt: new Date('2026-08-01T00:00:00.000Z') };

const testRow = () => prisma.test.findUniqueOrThrow({ where: { id: TEST } });

/** The series' own switch, which is what makes the openings a sequence rather than a set. */
const inOrder = (id = idFor('srs_1')) =>
  prisma.testSeries.update({ where: { id }, data: { sequentialTests: true } });

const catalogBusts = (events: FakeEventBus) =>
  events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED).map((payload) => payload.testSeriesId);

/** The Offer step as the screen saves it: whatever the test holds, with the changes given. */
async function save(
  service: OfferingService,
  over: Partial<SaveOfferingBody> = {},
  now: Date = NOW,
) {
  const row = await testRow();
  const unlocks = await prisma.testProgramUnlock.findMany({ where: { testId: TEST } });
  return service.saveOffering(
    TEST,
    {
      opensAt: row.opensAt?.toISOString() ?? null,
      programOpenings: unlocks.map((unlock) => ({
        programCode: unlock.programCode,
        opensAt: unlock.opensAt.toISOString(),
      })),
      offered: row.status === TEST_STATUS.ACTIVE,
      expectedVersion: row.version,
      ...over,
    },
    false,
    now,
  );
}

const programOpening = (opensAt: Date) =>
  prisma.testProgramUnlock.create({ data: { testId: TEST, programCode: PROGRAM, opensAt } });

const refused = async (attempt: Promise<unknown>) => {
  const error = await attempt.catch((caught: unknown) => caught);
  assert.ok(AppException.is(error));
  return error;
};

describe('OfferingService — a test belongs to one series', () => {
  it('replaces the series on the test itself, names the new one back, and drops the old position', async () => {
    const { service } = await serviceWith();

    const link = await service.moveToSeries(TEST, { testSeriesId: idFor('srs_2') });

    assert.deepEqual(link, {
      testSeriesId: idFor('srs_2'),
      name: 'SSC CGL 2026 — Sectionals',
      order: null,
    });
    const row = await testRow();
    assert.deepEqual([row.testSeriesId, row.seriesOrder], [idFor('srs_2'), null]);
  });

  /** A student who could reach it through srs_1 has a held catalog that no longer holds. */
  it('tells the catalog cache once when an offered test moves', async () => {
    const { service, events } = await serviceWith({ ...FROZEN, status: TEST_STATUS.ACTIVE });

    await service.moveToSeries(TEST, { testSeriesId: idFor('srs_2') });

    assert.deepEqual(catalogBusts(events), [idFor('srs_2')]);
  });

  /** The held catalog carries offered tests alone, so a draft's move rebuilds nothing. */
  it('says nothing to the cache when a draft moves', async () => {
    const { service, events } = await serviceWith();

    await service.moveToSeries(TEST, { testSeriesId: idFor('srs_2') });

    assert.deepEqual(catalogBusts(events), []);
  });

  it('says nothing to the cache when the series it was given is the one it holds', async () => {
    const { service, events } = await serviceWith();

    await service.moveToSeries(TEST, { testSeriesId: idFor('srs_1') });

    assert.deepEqual(catalogBusts(events), []);
  });

  it('refuses a series that no longer exists', async () => {
    const { service } = await serviceWith();

    const error = await refused(service.moveToSeries(TEST, { testSeriesId: idFor('srs_gone') }));

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal((await testRow()).testSeriesId, idFor('srs_1'));
  });

  /** The failure this prevents: another stage's series serving this paper to its students. */
  it('refuses a series whose stage the test does not sit on', async () => {
    const { service } = await serviceWith();
    await prisma.testSeries.create({
      data: { id: idFor('srs_rrb'), name: 'RRB JE mocks', examStageId: BUILDER.OTHER_STAGE },
    });

    const error = await refused(service.moveToSeries(TEST, { testSeriesId: idFor('srs_rrb') }));

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.match(error.message, /different exam stage/);
    assert.equal((await testRow()).testSeriesId, idFor('srs_1'));
  });

  it('carries a stage-agnostic series, which belongs to no stage and so fits any test', async () => {
    const { service } = await serviceWith();
    await prisma.testSeries.create({
      data: { id: idFor('srs_free'), name: 'Free mocks', kind: TEST_SERIES_KIND.FREE },
    });

    await service.moveToSeries(TEST, { testSeriesId: idFor('srs_free') });

    assert.equal((await testRow()).testSeriesId, idFor('srs_free'));
  });

  /** Moving a sat test would take it out of a series students' results already point through. */
  it('refuses to move a test that has been sat, naming the count, and leaves it where it is', async () => {
    const { service } = await serviceWith({}, 2);

    const error = await refused(service.moveToSeries(TEST, { testSeriesId: idFor('srs_2') }));
    await service.moveToSeries(TEST, { testSeriesId: idFor('srs_1') });

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /2 attempts/);
    assert.equal((await testRow()).testSeriesId, idFor('srs_1'));
  });

  /** The defect this closes: the old whole-set save rebuilt the link and dropped the opening with it. */
  it('moves a test to another series without losing its opening or its program openings', async () => {
    const { service } = await serviceWith({ opensAt: OPENS_AT });
    await programOpening(new Date(OPENS_AT.getTime() - HOUR_MS));

    await service.moveToSeries(TEST, { testSeriesId: idFor('srs_2') });

    assert.deepEqual((await testRow()).opensAt, OPENS_AT);
    assert.equal(await prisma.testProgramUnlock.count(), 1);
  });

  /** The failure this prevents: a move smuggles a duplicate name past the check the create path makes. */
  it('refuses a move into a series that already holds a test of that name', async () => {
    const { service } = await serviceWith({ title: 'Mock 1' });
    await testIn({ id: idFor('tst_9'), title: 'mock 1', testSeriesId: idFor('srs_2') });

    const error = await refused(service.moveToSeries(TEST, { testSeriesId: idFor('srs_2') }));

    assert.match(error.fieldErrors?.testSeriesId?.[0] ?? '', /already has a test called Mock 1/);
    assert.equal((await testRow()).testSeriesId, idFor('srs_1'));
  });

  /** The failure this prevents: an opening walks into an ordered series behind one already there. */
  it('refuses a move that would land an opening before one the ordered series already holds', async () => {
    const { service } = await serviceWith({ opensAt: OPENS_AT });
    await inOrder(idFor('srs_2'));
    await testIn({
      id: idFor('tst_9'),
      title: 'Mock 1',
      testSeriesId: idFor('srs_2'),
      seriesOrder: 1,
      opensAt: A_DAY_LATER_DATE,
    });

    const error = await refused(service.moveToSeries(TEST, { testSeriesId: idFor('srs_2') }));

    assert.match(error.fieldErrors?.[FORM_LEVEL_FIELD]?.[0] ?? '', /Mock 1 comes before it/);
    assert.equal((await testRow()).testSeriesId, idFor('srs_1'));
  });
});

describe('OfferingService — the Offer step saves in one piece', () => {
  it('offers again a test retired after it was offered', async () => {
    const { service } = await serviceWith({ ...FROZEN, status: TEST_STATUS.INACTIVE });

    const saved = await save(service, { offered: true });

    assert.equal(saved.status, TEST_STATUS.ACTIVE);
    assert.equal((await testRow()).status, TEST_STATUS.ACTIVE);
  });

  /** Withdrawing an offer asks nothing of a test — only offering does — but the catalog must hear of it. */
  it('retires a test without asking anything of it, and tells the catalog cache', async () => {
    const { service, events } = await serviceWith({ ...FROZEN, status: TEST_STATUS.ACTIVE });

    await save(service, { offered: false });

    assert.equal((await testRow()).status, TEST_STATUS.INACTIVE);
    assert.deepEqual(catalogBusts(events), [idFor('srs_1')]);
  });

  /** The failure this prevents: an opening saved while the offer beside it was refused, half a Done. */
  it('writes neither the opening nor the offer when the offer is refused', async () => {
    const { service } = await serviceWith();

    await refused(save(service, { opensAt: OPENS_AT.toISOString(), offered: true }));

    const row = await testRow();
    assert.deepEqual([row.opensAt, row.status], [null, TEST_STATUS.DRAFT]);
  });

  /** The failure this prevents: a draft opened before another admin's save quietly undoing it. */
  it('refuses a save made from a version another save has since moved on from', async () => {
    const { service } = await serviceWith();
    const { version } = await testRow();
    await save(service, { opensAt: A_DAY_LATER });

    const error = await refused(
      save(service, { opensAt: OPENS_AT.toISOString(), expectedVersion: version }),
    );

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.equal((await testRow()).opensAt?.toISOString(), A_DAY_LATER);
  });

  /** The failure this prevents: a step opened on one series offering the test through the one it moved to. */
  it('refuses a save opened before the test moved to another series', async () => {
    const { service } = await serviceWith();
    const { version } = await testRow();
    await service.moveToSeries(TEST, { testSeriesId: idFor('srs_2') });

    const error = await refused(save(service, { expectedVersion: version }));

    assert.equal(error.code, ErrorCodes.CONFLICT);
  });

  /** The screen speaks minutes, so a stored time a few seconds past one is the time it shows. */
  it('reads an opening named to the same minute as unmoved', async () => {
    const { service } = await serviceWith({ opensAt: new Date(OPENS_AT.getTime() + 30_000) }, 1);

    await save(service, { opensAt: OPENS_AT.toISOString(), offered: false });

    assert.equal((await testRow()).opensAt?.getTime(), OPENS_AT.getTime() + 30_000);
  });

  /** The failure this prevents: going live, retiring and a moved opening each filed as a bare "Updated". */
  it('files what each save changed: the status, the opening, a program let in early', async () => {
    const { service, audit } = await serviceWith({ ...FROZEN, status: TEST_STATUS.INACTIVE });
    const changedBy = (over: Partial<SaveOfferingBody>) =>
      audit.run(async () => {
        await save(service, over);
        return audit.current()?.changed;
      });
    const early = [{ programCode: PROGRAM, opensAt: OPENS_AT.toISOString() }];

    assert.deepEqual(await changedBy({ offered: true }), {
      status: { from: TEST_STATUS.INACTIVE, to: TEST_STATUS.ACTIVE },
    });
    assert.deepEqual(await changedBy({ offered: false }), {
      status: { from: TEST_STATUS.ACTIVE, to: TEST_STATUS.INACTIVE },
    });
    assert.deepEqual(await changedBy({ opensAt: A_DAY_LATER }), {
      opensAt: { from: null, to: A_DAY_LATER_DATE },
    });
    assert.deepEqual(await changedBy({ programOpenings: early }), {
      programUnlocks: { from: [], to: early },
    });
  });

  it('writes neither the opening nor any program opening when one program opening is refused', async () => {
    const { service } = await serviceWith();
    const late = new Date(A_DAY_LATER_DATE.getTime() + HOUR_MS).toISOString();

    const error = await refused(
      save(service, {
        opensAt: A_DAY_LATER,
        programOpenings: [{ programCode: PROGRAM, opensAt: late }],
      }),
    );

    assert.ok(error.fieldErrors?.[programOpeningField(PROGRAM)]);
    assert.equal((await testRow()).opensAt, null);
    assert.equal(await prisma.testProgramUnlock.count(), 0);
  });
});

describe('OfferingService — a series and the tests it holds', () => {
  it('lists what a series holds — its times, its state and whether it has been sat', async () => {
    const { service } = await serviceWith(
      { title: 'Mock 1', opensAt: OPENS_AT, ...FROZEN, status: TEST_STATUS.ACTIVE },
      1,
    );

    assert.deepEqual(await service.testsIn(idFor('srs_1')), [
      {
        testId: TEST,
        title: 'Mock 1',
        order: 1,
        unlockAt: OPENS_AT.toISOString(),
        status: TEST_STATUS.ACTIVE,
        finalizedAt: FROZEN.finalizedAt.toISOString(),
        totalQuestions: 100,
        durationSec: 3600,
        attemptCount: 1,
        paperSource: null,
      },
    ]);
  });

  /** The failure this prevents: a series deleted in another tab reading as one that holds no tests yet. */
  it('answers that a series is gone, where one holding nothing answers an empty list', async () => {
    const { service } = await serviceWith();

    assert.deepEqual(await service.testsIn(idFor('srs_2')), []);
    const error = await refused(service.testsIn(randomUUID()));

    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  it('sets when a test opens, and busts that catalog', async () => {
    const { service, events } = await serviceWith();

    const saved = await save(service, { opensAt: OPENS_AT.toISOString() });

    assert.equal(saved.opensAt, OPENS_AT.toISOString());
    assert.deepEqual(catalogBusts(events), [idFor('srs_1')]);
  });

  /** The failure this prevents: a time already gone is saved, and the test opens the moment it lands. */
  it('refuses an opening that is not ahead of now, down to the instant', async () => {
    const { service, events } = await serviceWith();

    const error = await refused(save(service, { opensAt: OPENS_AT.toISOString() }, OPENS_AT));

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.deepEqual(error.fieldErrors?.opensAt, [OPENING_HAS_PASSED]);
    assert.equal((await testRow()).opensAt, null);
    assert.deepEqual(catalogBusts(events), []);
  });

  /** `Test.opensAt` is a frozen field once sat; the Offer step must refuse to move it the same. */
  it('refuses to move or clear when a sat test opens', async () => {
    const { service } = await serviceWith({ opensAt: OPENS_AT }, 1);

    const moved = await refused(save(service, { opensAt: '2026-10-01T04:30:00.000Z' }));
    const cleared = await refused(save(service, { opensAt: null }));

    assert.equal(moved.code, ErrorCodes.CONFLICT);
    assert.equal(cleared.code, ErrorCodes.CONFLICT);
    assert.deepEqual((await testRow()).opensAt, OPENS_AT);
  });

  it('opens a test after the one it follows, in a series that opens them in order', async () => {
    const { service } = await serviceWith({ seriesOrder: 2 });
    await inOrder();
    await testIn({ id: idFor('tst_0'), title: 'Mock 1', seriesOrder: 1, opensAt: OPENS_AT });

    const saved = await save(service, { opensAt: A_DAY_LATER });

    assert.equal(saved.opensAt, A_DAY_LATER);
  });

  /** The failure this prevents: paper 2 opens before paper 1, and the order the series promises is a lie. */
  it('refuses an opening no later than a test earlier in the order', async () => {
    const { service, events } = await serviceWith({ seriesOrder: 2 });
    await inOrder();
    await testIn({ id: idFor('tst_0'), title: 'Mock 1', seriesOrder: 1, opensAt: OPENS_AT });

    const error = await refused(save(service, { opensAt: OPENS_AT.toISOString() }));

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.match(error.fieldErrors?.opensAt?.[0] ?? '', /Mock 1 comes before it/);
    assert.equal((await testRow()).opensAt, null);
    assert.deepEqual(catalogBusts(events), []);
  });

  it('refuses an opening no earlier than a test later in the order', async () => {
    const { service } = await serviceWith({ seriesOrder: 2 });
    await inOrder();
    await testIn({ id: idFor('tst_2'), title: 'Mock 3', seriesOrder: 3, opensAt: OPENS_AT });

    const error = await refused(save(service, { opensAt: A_DAY_LATER }));

    assert.match(error.fieldErrors?.opensAt?.[0] ?? '', /Mock 3 comes after it/);
  });

  /** Together is the other rule: without the order, the openings are each the admin's own business. */
  it('lets a series that opens its tests together put them in any order', async () => {
    const { service } = await serviceWith({ seriesOrder: 2 });
    await testIn({
      id: idFor('tst_0'),
      title: 'Mock 1',
      seriesOrder: 1,
      opensAt: A_DAY_LATER_DATE,
    });

    const saved = await save(service, { opensAt: OPENS_AT.toISOString() });

    assert.equal(saved.opensAt, OPENS_AT.toISOString());
  });

  /** The resolver reads `Test.opensAt`, so the series' opening IS the test's own column. */
  it('clears the opening time back to null', async () => {
    const { service } = await serviceWith({ opensAt: OPENS_AT });

    const saved = await save(service, { opensAt: null });

    assert.equal(saved.opensAt, null);
    assert.equal((await testRow()).opensAt, null);
  });
});

describe('OfferingService — a program opens a test earlier, never later', () => {
  const EARLIER = new Date(OPENS_AT.getTime() - HOUR_MS);
  const earlier = [{ programCode: PROGRAM, opensAt: EARLIER.toISOString() }];

  /** The failure this prevents: a test that opens once for everybody because of the series holding it. */
  it('stores a program opening whichever series the test sits in', async () => {
    for (const testSeriesId of [idFor('srs_1'), idFor('srs_2')]) {
      await resetDatabase(prisma);
      const { service } = await serviceWith({ opensAt: OPENS_AT, testSeriesId });

      const saved = await save(service, { programOpenings: earlier });

      assert.deepEqual(saved.programUnlocks, earlier, testSeriesId);
      assert.equal(await prisma.testProgramUnlock.count(), 1);
    }
  });

  it('refuses a program opening that has already passed', async () => {
    const { service } = await serviceWith({ opensAt: OPENS_AT });

    const error = await refused(
      save(service, { programOpenings: earlier }, new Date(EARLIER.getTime() + 60_000)),
    );

    assert.deepEqual(error.fieldErrors?.[programOpeningField(PROGRAM)], [OPENING_HAS_PASSED]);
    assert.equal(await prisma.testProgramUnlock.count(), 0);
  });

  /** A later opening would hold this program's students back after the test opened for everyone. */
  it('refuses a program opening later than the test opens, or on a test with no opening of its own', async () => {
    const later = new Date(OPENS_AT.getTime() + 1000).toISOString();
    const { service } = await serviceWith({ opensAt: OPENS_AT });

    const late = await refused(
      save(service, { programOpenings: [{ programCode: PROGRAM, opensAt: later }] }),
    );
    await prisma.test.update({ where: { id: TEST }, data: { opensAt: null } });
    const unopened = await refused(save(service, { programOpenings: earlier }));

    assert.equal(late.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(late.fieldErrors?.[programOpeningField(PROGRAM)]);
    assert.equal(unopened.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal(await prisma.testProgramUnlock.count(), 0);
  });

  it('refuses a program the catalog does not hold', async () => {
    const { service } = await serviceWith({ opensAt: OPENS_AT });

    const error = await refused(
      save(service, {
        programOpenings: [{ programCode: 'NO SUCH PROGRAM', opensAt: EARLIER.toISOString() }],
      }),
    );

    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  /** With the program opening held, then the test's own opening moved to the instant given. */
  const movedTo = async (opensAt: Date | null) => {
    const { service } = await serviceWith({ opensAt: OPENS_AT });
    await programOpening(EARLIER);
    await save(service, { opensAt: opensAt?.toISOString() ?? null });
    return prisma.testProgramUnlock.count();
  };

  /** The rule inverts if nothing revalidates: 03:30 was an hour EARLY, and is an hour LATE at 02:30. */
  it('drops a program opening the test’s own opening overtakes when it moves earlier', async () => {
    assert.equal(await movedTo(new Date(EARLIER.getTime() - HOUR_MS)), 0);
  });

  it('keeps it when the test moves LATER and it still opens the cohort early', async () => {
    assert.equal(await movedTo(new Date(OPENS_AT.getTime() + HOUR_MS)), 1);
  });

  it('leaves no orphan behind when the opening is cleared entirely', async () => {
    assert.equal(await movedTo(null), 0);
    assert.equal((await testRow()).opensAt, null);
  });

  it('takes a program opening back when the save leaves it out', async () => {
    const { service } = await serviceWith({ opensAt: OPENS_AT });
    await programOpening(EARLIER);

    const saved = await save(service, { programOpenings: [] });

    assert.deepEqual(saved.programUnlocks, []);
    assert.equal(await prisma.testProgramUnlock.count(), 0);
  });
});
