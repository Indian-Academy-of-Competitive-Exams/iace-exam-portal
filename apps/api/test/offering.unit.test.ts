import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes, EVALUATION_MODE, TEST_STATUS } from '@iace/contracts';
import { OfferingService } from '../src/tests/offering.service';
import { DOMAIN_EVENTS } from '../src/common/events';
import { AuditContext } from '../src/audit';
import {
  FakeEventBus,
  FakeTestsPrisma,
  makeBaseConfig,
  makeSection,
  makeSeries,
  makeTest,
} from './support/fakes';

function serviceWith(test = makeTest({ id: 'tst_1' }), attempts: { testId: string }[] = []) {
  const prisma = new FakeTestsPrisma(
    [test],
    [makeBaseConfig({ id: 'cfg_1' })],
    [makeSection({ id: 'sec_1', baseConfigId: 'cfg_1' })],
    attempts,
  );
  prisma.series.push(
    makeSeries({ id: 'srs_1', name: 'SSC CGL 2026 — Full length' }),
    makeSeries({ id: 'srs_2', name: 'SSC CGL 2026 — Sectionals' }),
  );
  const events = new FakeEventBus();
  return {
    prisma,
    events,
    service: new OfferingService(prisma.asService(), events.asService(), new AuditContext()),
  };
}

const inSeries = (over: Parameters<typeof makeTest>[0] = {}) =>
  makeTest({ id: 'tst_1', testSeriesId: 'srs_1', seriesOrder: 1, ...over });

const OPENS_AT = new Date('2026-09-01T04:30:00.000Z');

describe('OfferingService — a test belongs to one series', () => {
  it('replaces the series on the test itself and names the new one back', async () => {
    const { service, prisma } = serviceWith(inSeries());

    const link = await service.moveToSeries('tst_1', { testSeriesId: 'srs_2' });

    assert.deepEqual(link, {
      testSeriesId: 'srs_2',
      name: 'SSC CGL 2026 — Sectionals',
      order: null,
    });
    assert.equal(prisma.tests[0]?.testSeriesId, 'srs_2');
  });

  /** The position is the series' own, so carrying it across would claim a place nothing gave. */
  it('drops the position that only meant something inside the series it left', async () => {
    const { service, prisma } = serviceWith(inSeries());

    await service.moveToSeries('tst_1', { testSeriesId: 'srs_2' });

    assert.equal(prisma.tests[0]?.seriesOrder, null);
  });

  it('reads back the series a test is already in', async () => {
    const { service } = serviceWith(inSeries());

    assert.deepEqual(await service.series('tst_1'), {
      testSeriesId: 'srs_1',
      name: 'SSC CGL 2026 — Full length',
      order: 1,
    });
  });

  it('tells the catalog cache about the series it left AND the one it joined', async () => {
    const { service, events } = serviceWith(inSeries());

    await service.moveToSeries('tst_1', { testSeriesId: 'srs_2' });

    // A student who could reach it through srs_1 has a cached catalog that no longer holds.
    const touched = events
      .of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED)
      .map((payload) => payload.testSeriesId);
    assert.deepEqual(new Set(touched), new Set(['srs_1', 'srs_2']));
  });

  it('says nothing to the cache when the series it was given is the one it holds', async () => {
    const { service, events } = serviceWith(inSeries());

    await service.moveToSeries('tst_1', { testSeriesId: 'srs_1' });

    assert.equal(events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED).length, 0);
  });

  it('refuses a series that no longer exists', async () => {
    const { service, prisma } = serviceWith();

    const error = await service
      .moveToSeries('tst_1', { testSeriesId: 'srs_gone' })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal(prisma.tests[0]?.testSeriesId, 'srs_1');
  });

  /** The failure this prevents: another stage's series serving this paper to its students. */
  it('refuses a series whose stage the test does not sit on', async () => {
    const { service, prisma } = serviceWith();
    prisma.series.push(makeSeries({ id: 'srs_rrb', name: 'RRB JE mocks', examStageId: 'stage_9' }));

    const error = await service
      .moveToSeries('tst_1', { testSeriesId: 'srs_rrb' })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.match(error.message, /different exam stage/);
    assert.equal(prisma.tests[0]?.testSeriesId, 'srs_1');
  });

  it('carries a stage-agnostic series, which belongs to no stage and so fits any test', async () => {
    const { service, prisma } = serviceWith();
    prisma.series.push(makeSeries({ id: 'srs_free', name: 'Free mocks', examStageId: null }));

    await service.moveToSeries('tst_1', { testSeriesId: 'srs_free' });

    assert.equal(prisma.tests[0]?.testSeriesId, 'srs_free');
  });

  /** The failure this prevents: a driver error where the composite key refuses the write. */
  it('refuses a series that judges its tests the other way, naming both modes', async () => {
    const { service, prisma } = serviceWith(inSeries());
    prisma.series.push(
      makeSeries({
        id: 'srs_drills',
        name: 'SSC CGL 2026 — Drills',
        evaluationMode: EVALUATION_MODE.PRACTICE,
      }),
    );

    const error = await service
      .moveToSeries('tst_1', { testSeriesId: 'srs_drills' })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.match(error.message, /Practice/);
    assert.match(error.message, /Ranked/);
    assert.equal(prisma.tests[0]?.testSeriesId, 'srs_1');
  });

  it('carries a practice test into another practice series', async () => {
    const { service, prisma } = serviceWith(
      inSeries({ evaluationMode: EVALUATION_MODE.PRACTICE, testSeriesId: 'srs_drills' }),
    );
    prisma.series.push(
      makeSeries({ id: 'srs_drills', evaluationMode: EVALUATION_MODE.PRACTICE }),
      makeSeries({ id: 'srs_more_drills', evaluationMode: EVALUATION_MODE.PRACTICE }),
    );

    await service.moveToSeries('tst_1', { testSeriesId: 'srs_more_drills' });

    assert.equal(prisma.tests[0]?.testSeriesId, 'srs_more_drills');
  });

  /** Moving a sat test would take it out of a series students' results already point through. */
  it('refuses to move a test that has been sat', async () => {
    const { service, prisma } = serviceWith(inSeries(), [{ testId: 'tst_1' }]);

    const error = await service
      .moveToSeries('tst_1', { testSeriesId: 'srs_2' })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.equal(prisma.tests[0]?.testSeriesId, 'srs_1');
  });

  it('leaves a sat test alone when the series it is given is the one it holds', async () => {
    const { service, prisma } = serviceWith(inSeries(), [{ testId: 'tst_1' }]);

    await service.moveToSeries('tst_1', { testSeriesId: 'srs_1' });

    assert.equal(prisma.tests[0]?.testSeriesId, 'srs_1');
  });
});

/** The defect this closes: the old whole-set save rebuilt the link and dropped `unlockAt` with it. */
describe('OfferingService — a re-save cannot wipe the clock', () => {
  it('moves a test from one series to another without losing its opening', async () => {
    const { service, prisma } = serviceWith(
      inSeries({ opensAt: OPENS_AT, lateEntrySec: 1800, extraTimeSec: 600 }),
    );

    await service.moveToSeries('tst_1', { testSeriesId: 'srs_2' });

    assert.deepEqual(prisma.tests[0]?.opensAt, OPENS_AT);
    assert.equal(prisma.tests[0]?.lateEntrySec, 1800);
    assert.equal(prisma.tests[0]?.extraTimeSec, 600);
  });

  /** The opening survived, so the rows it overtook have to survive with it. */
  it('leaves the program openings the test had alone', async () => {
    const { service, prisma } = serviceWith(inSeries({ opensAt: OPENS_AT }));
    prisma.programCatalog.push({ code: 'FOUNDATION' });
    await service.setProgramUnlock('tst_1', 'FOUNDATION', {
      opensAt: new Date(OPENS_AT.getTime() - 3_600_000).toISOString(),
    });

    await service.moveToSeries('tst_1', { testSeriesId: 'srs_2' });

    assert.equal(prisma.programUnlocks.length, 1);
  });
});

describe('OfferingService — offering a test', () => {
  it('offers a finalized test that a series carries', async () => {
    const { service, prisma } = serviceWith(inSeries({ isLocked: true }));

    const status = await service.setStatus('tst_1', TEST_STATUS.ACTIVE);

    assert.equal(status, TEST_STATUS.ACTIVE);
    assert.equal(prisma.tests[0]?.status, TEST_STATUS.ACTIVE);
  });

  it('refuses to offer a test whose paper is not frozen', async () => {
    const { service, prisma } = serviceWith(inSeries());

    const error = await service.setStatus('tst_1', TEST_STATUS.ACTIVE).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.match(error.message, /Finalize this test/);
    assert.equal(prisma.tests[0]?.status, TEST_STATUS.DRAFT);
  });

  it('retires a test without asking anything of it', async () => {
    const { service, prisma } = serviceWith(
      makeTest({ id: 'tst_1', status: TEST_STATUS.ACTIVE, isLocked: true }),
    );

    // Withdrawing an offer asks nothing of a test — only offering does.
    await service.setStatus('tst_1', TEST_STATUS.INACTIVE);

    assert.equal(prisma.tests[0]?.status, TEST_STATUS.INACTIVE);
  });

  it('tells the catalog cache when a test stops being offered', async () => {
    const { service, events } = serviceWith(
      inSeries({ status: TEST_STATUS.ACTIVE, isLocked: true }),
    );

    await service.setStatus('tst_1', TEST_STATUS.INACTIVE);

    assert.deepEqual(
      events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED).map((p) => p.testSeriesId),
      ['srs_1'],
    );
  });

  it('says nothing to the cache when the status did not move', async () => {
    const { service, events } = serviceWith(inSeries({ isLocked: true }));

    await service.setStatus('tst_1', TEST_STATUS.DRAFT);

    assert.equal(events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED).length, 0);
  });
});

describe('OfferingService — a series and the tests it holds', () => {
  it('lists what a series holds — its times, its state and whether it has been sat', async () => {
    const { service } = serviceWith(
      inSeries({ title: 'Mock 1', opensAt: OPENS_AT, isLocked: true, status: TEST_STATUS.ACTIVE }),
      [{ testId: 'tst_1' }],
    );

    const rows = await service.testsIn('srs_1');

    assert.deepEqual(rows, [
      {
        testId: 'tst_1',
        title: 'Mock 1',
        order: 1,
        unlockAt: OPENS_AT.toISOString(),
        status: TEST_STATUS.ACTIVE,
        isLocked: true,
        attemptCount: 1,
      },
    ]);
  });

  it('sets when a test opens inside a series, and busts that catalog', async () => {
    const { service, events } = serviceWith(inSeries());

    const rows = await service.setUnlock('srs_1', 'tst_1', {
      unlockAt: OPENS_AT.toISOString(),
    });

    assert.equal(rows[0]?.unlockAt, OPENS_AT.toISOString());
    assert.deepEqual(events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED), [{ testSeriesId: 'srs_1' }]);
  });

  /** The resolver reads `Test.opensAt`, so the series' opening IS the test's own column. */
  it('clears the opening time back to null', async () => {
    const { service, prisma } = serviceWith(inSeries({ opensAt: OPENS_AT }));

    const rows = await service.setUnlock('srs_1', 'tst_1', { unlockAt: null });

    assert.equal(rows[0]?.unlockAt, null);
    assert.equal(prisma.tests[0]?.opensAt, null);
  });

  /** The failure this prevents: a sat test detached, and a student's result with nowhere to sit. */
  it('names the count when it refuses to move one that has been sat', async () => {
    const { service, prisma } = serviceWith(inSeries(), [{ testId: 'tst_1' }, { testId: 'tst_1' }]);

    const error = await service
      .moveToSeries('tst_1', { testSeriesId: 'srs_2' })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /2 attempts/);
    assert.equal(prisma.tests[0]?.testSeriesId, 'srs_1');
  });

  it('refuses to set an opening through a series the test is not in', async () => {
    const { service } = serviceWith(inSeries());

    await assert.rejects(
      () => service.setUnlock('srs_2', 'tst_1', { unlockAt: null }),
      AppException.is,
    );
  });
});

describe('OfferingService — a practice test opens once, for everybody', () => {
  const practice = () =>
    makeTest({ id: 'tst_1', opensAt: OPENS_AT, evaluationMode: EVALUATION_MODE.PRACTICE });

  const refusedField = (field: string) => (error: unknown) =>
    AppException.is(error) && error.fieldErrors?.[field] !== undefined;

  /** The failure this prevents: one cohort put ahead of another on a paper that ranks neither. */
  it('refuses a program opening on a practice test', async () => {
    const { service, prisma } = serviceWith(practice());
    prisma.programCatalog.push({ code: 'FOUNDATION' });
    const earlier = new Date(OPENS_AT.getTime() - 3_600_000).toISOString();

    await assert.rejects(
      () => service.setProgramUnlock('tst_1', 'FOUNDATION', { opensAt: earlier }),
      refusedField('opensAt'),
    );
    assert.equal(prisma.programUnlocks.length, 0);
  });
});

describe('OfferingService — a program opens a test earlier, never later', () => {
  const EARLIER = new Date(OPENS_AT.getTime() - 3_600_000);

  const unlockService = (opensAt: Date | null = OPENS_AT) => {
    const held = serviceWith(inSeries({ opensAt }));
    held.prisma.programCatalog.push({ code: 'FOUNDATION' });
    return held;
  };

  it('stores an unlock that opens the test earlier for one program', async () => {
    const { service, prisma } = unlockService();

    const rows = await service.setProgramUnlock('tst_1', 'FOUNDATION', {
      opensAt: EARLIER.toISOString(),
    });

    assert.deepEqual(rows, [{ programCode: 'FOUNDATION', opensAt: EARLIER.toISOString() }]);
    assert.equal(prisma.programUnlocks.length, 1);
  });

  /** Entry closes at one instant for everyone, so a later opening only shortens this cohort's window. */
  it('refuses a program unlock later than the test opens', async () => {
    const { service, prisma } = unlockService();
    const later = new Date(OPENS_AT.getTime() + 1000).toISOString();

    const error = await service
      .setProgramUnlock('tst_1', 'FOUNDATION', { opensAt: later })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.opensAt);
    assert.equal(prisma.programUnlocks.length, 0);
  });

  it('refuses one on a test that has no opening time of its own to be earlier than', async () => {
    const { service } = unlockService(null);

    const error = await service
      .setProgramUnlock('tst_1', 'FOUNDATION', { opensAt: EARLIER.toISOString() })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
  });

  it('refuses a program the catalog does not hold', async () => {
    const { service } = unlockService();

    const error = await service
      .setProgramUnlock('tst_1', 'NO SUCH PROGRAM', { opensAt: EARLIER.toISOString() })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  /** The rule inverts if nothing revalidates: 03:30 was an hour EARLY, and is an hour LATE at 02:30. */
  it('drops an unlock the series opening overtakes when the test is moved earlier', async () => {
    const { service, prisma } = unlockService();
    await service.setProgramUnlock('tst_1', 'FOUNDATION', { opensAt: EARLIER.toISOString() });

    await service.setUnlock('srs_1', 'tst_1', {
      unlockAt: new Date(EARLIER.getTime() - 3_600_000).toISOString(),
    });

    assert.deepEqual(prisma.programUnlocks, []);
  });

  it('leaves it alone when the test is moved LATER and it still opens the cohort early', async () => {
    const { service, prisma } = unlockService();
    await service.setProgramUnlock('tst_1', 'FOUNDATION', { opensAt: EARLIER.toISOString() });

    await service.setUnlock('srs_1', 'tst_1', {
      unlockAt: new Date(OPENS_AT.getTime() + 3_600_000).toISOString(),
    });

    assert.equal(prisma.programUnlocks.length, 1);
  });

  /** `setProgramUnlock` refuses to CREATE a row against a cleared opening, so none may survive one. */
  it('leaves no orphan behind when the opening is cleared entirely', async () => {
    const { service, prisma } = unlockService();
    await service.setProgramUnlock('tst_1', 'FOUNDATION', { opensAt: EARLIER.toISOString() });

    await service.setUnlock('srs_1', 'tst_1', { unlockAt: null });

    assert.equal(prisma.tests[0]?.opensAt, null);
    assert.deepEqual(prisma.programUnlocks, []);
  });

  it('takes the unlock back, leaving the cohort with the test’s own opening', async () => {
    const { service, prisma } = unlockService();
    await service.setProgramUnlock('tst_1', 'FOUNDATION', { opensAt: EARLIER.toISOString() });

    const rows = await service.clearProgramUnlock('tst_1', 'FOUNDATION');

    assert.deepEqual(rows, []);
    assert.equal(prisma.programUnlocks.length, 0);
  });
});
