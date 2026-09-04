import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes, TEST_STATUS } from '@iace/contracts';
import { OfferingService } from '../src/tests/offering.service';
import { DOMAIN_EVENTS } from '../src/common/events';
import { AuditContext } from '../src/audit';
import {
  type FakeSeriesTestRow,
  FakeEventBus,
  FakeTestsPrisma,
  makeBaseConfig,
  makeSection,
  makeSeries,
  makeTest,
} from './support/fakes';

function serviceWith(
  test = makeTest({ id: 'tst_1' }),
  seriesTests: FakeSeriesTestRow[] = [],
  attempts: { testId: string }[] = [],
) {
  const prisma = new FakeTestsPrisma(
    [test],
    [makeBaseConfig({ id: 'cfg_1' })],
    [makeSection({ id: 'sec_1', baseConfigId: 'cfg_1' })],
    attempts,
    seriesTests,
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

const finalized = () => makeTest({ id: 'tst_1', isLocked: true });

const OPENS_AT = new Date('2026-09-01T04:30:00.000Z');

describe('OfferingService — attaching a test to a series', () => {
  it('stores the whole set the screen holds, in order', async () => {
    const { service, prisma } = serviceWith();

    const links = await service.setSeries('tst_1', {
      series: [
        { testSeriesId: 'srs_1', order: 1 },
        { testSeriesId: 'srs_2', order: 2 },
      ],
    });

    assert.deepEqual(
      links.map((link) => [link.testSeriesId, link.order]),
      [
        ['srs_1', 1],
        ['srs_2', 2],
      ],
    );
    assert.equal(prisma.seriesTests.length, 2);
  });

  it('replaces what was there rather than adding to it', async () => {
    const { service, prisma } = serviceWith(makeTest({ id: 'tst_1' }), [
      { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
    ]);

    await service.setSeries('tst_1', { series: [{ testSeriesId: 'srs_2', order: 1 }] });

    assert.deepEqual(
      prisma.seriesTests.map((row) => row.testSeriesId),
      ['srs_2'],
    );
  });

  it('tells the catalog cache about the series it left AND the one it joined', async () => {
    const { service, events } = serviceWith(makeTest({ id: 'tst_1' }), [
      { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
    ]);

    await service.setSeries('tst_1', { series: [{ testSeriesId: 'srs_2', order: 1 }] });

    // A student who could reach it through srs_1 has a cached catalog that no longer holds.
    const touched = events
      .of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED)
      .map((payload) => payload.testSeriesId);
    assert.deepEqual(new Set(touched), new Set(['srs_1', 'srs_2']));
  });

  it('refuses a series that no longer exists', async () => {
    const { service, prisma } = serviceWith();

    const error = await service
      .setSeries('tst_1', { series: [{ testSeriesId: 'srs_gone', order: 1 }] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal(prisma.seriesTests.length, 0);
  });

  it('refuses a series built for another exam stage', async () => {
    const { service, prisma } = serviceWith();
    prisma.series.push(makeSeries({ id: 'srs_rrb', name: 'RRB JE mocks', examStageId: 'stage_9' }));

    const error = await service
      .setSeries('tst_1', { series: [{ testSeriesId: 'srs_rrb', order: 1 }] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal(prisma.seriesTests.length, 0);
  });

  it('carries a stage-agnostic series, which belongs to no stage and so fits any test', async () => {
    const { service, prisma } = serviceWith();
    prisma.series.push(makeSeries({ id: 'srs_free', name: 'Free mocks', examStageId: null }));

    const links = await service.setSeries('tst_1', {
      series: [
        { testSeriesId: 'srs_1', order: 1 },
        { testSeriesId: 'srs_free', order: 2 },
      ],
    });

    assert.deepEqual(
      new Set(links.map((link) => link.testSeriesId)),
      new Set(['srs_1', 'srs_free']),
    );
  });

  it('refuses to take an OFFERED test out of its last series', async () => {
    const { service, prisma } = serviceWith(
      makeTest({ id: 'tst_1', status: TEST_STATUS.ACTIVE, isLocked: true }),
      [{ testSeriesId: 'srs_1', testId: 'tst_1', order: 1 }],
    );

    // The mirror of the activation rule: otherwise an ACTIVE test ends up with no route to it.
    const error = await service.setSeries('tst_1', { series: [] }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.equal(prisma.seriesTests.length, 1);
  });

  it('takes an empty set as taking the test out of every series', async () => {
    const { service, prisma } = serviceWith(makeTest({ id: 'tst_1' }), [
      { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
    ]);

    await service.setSeries('tst_1', { series: [] });

    assert.equal(prisma.seriesTests.length, 0);
  });
});

/** `Test.testSeriesId` is a RESTRICT key nothing else writes, so the link has to carry it. */
describe('OfferingService — the series column follows the link that set it', () => {
  it('writes the series onto the test itself', async () => {
    const { service, prisma } = serviceWith();

    await service.setSeries('tst_1', { series: [{ testSeriesId: 'srs_1', order: 3 }] });

    assert.deepEqual([prisma.tests[0]?.testSeriesId, prisma.tests[0]?.seriesOrder], ['srs_1', 3]);
  });

  it('takes the earliest of a set the screen holds', async () => {
    const { service, prisma } = serviceWith();

    await service.setSeries('tst_1', {
      series: [
        { testSeriesId: 'srs_1', order: 2 },
        { testSeriesId: 'srs_2', order: 1 },
      ],
    });

    assert.equal(prisma.tests[0]?.testSeriesId, 'srs_2');
  });

  /** The failure this prevents: a series nothing says holds the test, refusing to be deleted. */
  it('clears the column when the last link goes', async () => {
    const { service, prisma } = serviceWith(
      makeTest({ id: 'tst_1', testSeriesId: 'srs_1', seriesOrder: 1 }),
      [{ testSeriesId: 'srs_1', testId: 'tst_1', order: 1 }],
    );

    await service.setSeries('tst_1', { series: [] });

    assert.deepEqual([prisma.tests[0]?.testSeriesId, prisma.tests[0]?.seriesOrder], [null, null]);
  });

  it('clears the column when the series drops the test from its own side', async () => {
    const { service, prisma } = serviceWith(
      makeTest({ id: 'tst_1', testSeriesId: 'srs_1', seriesOrder: 1 }),
      [{ testSeriesId: 'srs_1', testId: 'tst_1', order: 1 }],
    );

    await service.removeFromSeries('srs_1', 'tst_1');

    assert.deepEqual([prisma.tests[0]?.testSeriesId, prisma.tests[0]?.seriesOrder], [null, null]);
  });

  it('repoints the column at what is left rather than clearing it', async () => {
    const { service, prisma } = serviceWith(
      makeTest({ id: 'tst_1', testSeriesId: 'srs_1', seriesOrder: 1 }),
      [
        { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
        { testSeriesId: 'srs_2', testId: 'tst_1', order: 2 },
      ],
    );

    await service.removeFromSeries('srs_1', 'tst_1');

    assert.deepEqual([prisma.tests[0]?.testSeriesId, prisma.tests[0]?.seriesOrder], ['srs_2', 2]);
  });

  it('leaves the column alone when the removal is refused', async () => {
    const { service, prisma } = serviceWith(
      makeTest({ id: 'tst_1', testSeriesId: 'srs_1', seriesOrder: 1 }),
      [{ testSeriesId: 'srs_1', testId: 'tst_1', order: 1 }],
      [{ testId: 'tst_1' }],
    );

    await service.removeFromSeries('srs_1', 'tst_1').catch(() => undefined);

    assert.equal(prisma.tests[0]?.testSeriesId, 'srs_1');
  });
});

describe('OfferingService — offering a test', () => {
  it('offers a finalized test that a series carries', async () => {
    const { service, prisma } = serviceWith(finalized(), [
      { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
    ]);

    const status = await service.setStatus('tst_1', TEST_STATUS.ACTIVE);

    assert.equal(status, TEST_STATUS.ACTIVE);
    assert.equal(prisma.tests[0]?.status, TEST_STATUS.ACTIVE);
  });

  it('refuses to offer a test no series carries', async () => {
    const { service, prisma } = serviceWith(finalized());

    // The failure this prevents: an ACTIVE test no student has any route to.
    const error = await service.setStatus('tst_1', TEST_STATUS.ACTIVE).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /only through a series/);
    assert.equal(prisma.tests[0]?.status, TEST_STATUS.DRAFT);
  });

  it('refuses to offer a test whose paper is not frozen', async () => {
    const { service, prisma } = serviceWith(makeTest({ id: 'tst_1' }), [
      { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
    ]);

    const error = await service.setStatus('tst_1', TEST_STATUS.ACTIVE).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.match(error.message, /Finalize this test/);
    assert.equal(prisma.tests[0]?.status, TEST_STATUS.DRAFT);
  });

  it('retires a test without asking anything of it', async () => {
    const { service, prisma } = serviceWith(
      makeTest({ id: 'tst_1', status: TEST_STATUS.ACTIVE, isLocked: true }),
    );

    // Withdrawing an offer needs no series and no frozen paper — only offering does.
    await service.setStatus('tst_1', TEST_STATUS.INACTIVE);

    assert.equal(prisma.tests[0]?.status, TEST_STATUS.INACTIVE);
  });

  it('tells the catalog cache when a test stops being offered', async () => {
    const { service, events } = serviceWith(
      makeTest({ id: 'tst_1', status: TEST_STATUS.ACTIVE, isLocked: true }),
      [{ testSeriesId: 'srs_1', testId: 'tst_1', order: 1 }],
    );

    await service.setStatus('tst_1', TEST_STATUS.INACTIVE);

    assert.deepEqual(
      events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED).map((p) => p.testSeriesId),
      ['srs_1'],
    );
  });

  it('says nothing to the cache when the status did not move', async () => {
    const { service, events } = serviceWith(finalized(), [
      { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
    ]);

    await service.setStatus('tst_1', TEST_STATUS.DRAFT);

    assert.equal(events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED).length, 0);
  });
});

describe('OfferingService — a series and the tests it holds', () => {
  const link = (testSeriesId: string, order: number | null = 1): FakeSeriesTestRow => ({
    testSeriesId,
    testId: 'tst_1',
    order,
  });

  it('lists what a series holds, with the times and whether it has been sat', async () => {
    const { service } = serviceWith(
      makeTest({ id: 'tst_1', title: 'Mock 1' }),
      [link('srs_1')],
      [{ testId: 'tst_1' }],
    );

    const rows = await service.testsIn('srs_1');

    assert.deepEqual(rows, [
      { testId: 'tst_1', title: 'Mock 1', order: 1, unlockAt: null, attemptCount: 1 },
    ]);
  });

  it('sets when a test opens inside a series, and busts that catalog', async () => {
    const { service, events } = serviceWith(makeTest({ id: 'tst_1' }), [link('srs_1')]);

    const rows = await service.setUnlock('srs_1', 'tst_1', {
      unlockAt: '2026-09-01T04:30:00.000Z',
    });

    assert.equal(rows[0]?.unlockAt, '2026-09-01T04:30:00.000Z');
    assert.deepEqual(events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED), [{ testSeriesId: 'srs_1' }]);
  });

  it('clears the opening time back to null', async () => {
    const { service } = serviceWith(makeTest({ id: 'tst_1' }), [
      { testSeriesId: 'srs_1', testId: 'tst_1', order: 1, unlockAt: new Date() },
    ]);

    const rows = await service.setUnlock('srs_1', 'tst_1', { unlockAt: null });

    assert.equal(rows[0]?.unlockAt, null);
  });

  /** The resolver reads `Test.opensAt`, so a time only the join row holds opens nothing. */
  it('writes the test its own opensAt when a series unlock time is set', async () => {
    const { service, prisma } = serviceWith(makeTest({ id: 'tst_1' }), [link('srs_1')]);

    await service.setUnlock('srs_1', 'tst_1', { unlockAt: OPENS_AT.toISOString() });
    assert.deepEqual(prisma.tests[0]?.opensAt, OPENS_AT);

    await service.setUnlock('srs_1', 'tst_1', { unlockAt: null });

    assert.equal(prisma.tests[0]?.opensAt, null);
  });

  it('takes a test nobody has sat back out of a series', async () => {
    const { service, prisma } = serviceWith(makeTest({ id: 'tst_1' }), [
      link('srs_1'),
      link('srs_2', 2),
    ]);

    const rows = await service.removeFromSeries('srs_1', 'tst_1');

    assert.deepEqual(rows, []);
    assert.deepEqual(
      prisma.seriesTests.map((row) => row.testSeriesId),
      ['srs_2'],
    );
  });

  /** The failure this prevents: a sat test detached, and a student's result with nowhere to sit. */
  it('refuses to take out one that has been sat, and leaves the link alone', async () => {
    const { service, prisma } = serviceWith(
      makeTest({ id: 'tst_1' }),
      [link('srs_1')],
      [{ testId: 'tst_1' }, { testId: 'tst_1' }],
    );

    const error = await service.removeFromSeries('srs_1', 'tst_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /2 attempts/);
    assert.equal(prisma.seriesTests.length, 1);
  });

  /** Unticking a series on the test screen is the same removal, so it answers to the same rule. */
  it('refuses to drop a link through the whole-set save once it has been sat', async () => {
    const { service, prisma } = serviceWith(
      makeTest({ id: 'tst_1', status: TEST_STATUS.ACTIVE, isLocked: true }),
      [link('srs_1'), link('srs_2', 2)],
      [{ testId: 'tst_1' }],
    );

    const error = await service
      .setSeries('tst_1', { series: [{ testSeriesId: 'srs_1', order: 1 }] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.equal(prisma.seriesTests.length, 2);
  });

  it('still lets a sat test be ADDED to another series', async () => {
    const { service, prisma } = serviceWith(
      makeTest({ id: 'tst_1', status: TEST_STATUS.ACTIVE, isLocked: true }),
      [link('srs_1')],
      [{ testId: 'tst_1' }],
    );

    await service.setSeries('tst_1', {
      series: [
        { testSeriesId: 'srs_1', order: 1 },
        { testSeriesId: 'srs_2', order: 2 },
      ],
    });

    assert.equal(prisma.seriesTests.length, 2);
  });

  it('refuses a link the series does not hold', async () => {
    const { service } = serviceWith();

    await assert.rejects(() => service.removeFromSeries('srs_1', 'tst_1'), AppException.is);
  });
});

describe('OfferingService — the test carries its own clock', () => {
  const opened = () => makeTest({ id: 'tst_1', opensAt: OPENS_AT });

  it('stores late entry and extra time on the test itself, in seconds', async () => {
    const { service, prisma } = serviceWith(opened());

    const saved = await service.setSchedule('tst_1', { lateEntrySec: 1800, extraTimeSec: 600 });

    assert.deepEqual(saved, { lateEntrySec: 1800, extraTimeSec: 600 });
    assert.deepEqual([prisma.tests[0]?.lateEntrySec, prisma.tests[0]?.extraTimeSec], [1800, 600]);
  });

  /** The failure this prevents: the old writer went through the branches, so none meant no write. */
  it('stores the clock of a test no branch reaches', async () => {
    const { service, prisma } = serviceWith(opened());

    await service.setSchedule('tst_1', { lateEntrySec: null, extraTimeSec: 900 });

    assert.equal(prisma.tests[0]?.extraTimeSec, 900);
  });

  /** The failure this prevents: a cap counted from nothing would silently never close entry. */
  it('refuses late entry on a test with no opening', async () => {
    const { service, prisma } = serviceWith();

    await assert.rejects(
      () => service.setSchedule('tst_1', { lateEntrySec: 1800, extraTimeSec: null }),
      AppException.is,
    );
    assert.equal(prisma.tests[0]?.lateEntrySec, null);
  });

  it('takes extra time on a test with no opening, which needs nothing to count from', async () => {
    const { service, prisma } = serviceWith();

    await service.setSchedule('tst_1', { lateEntrySec: null, extraTimeSec: 300 });

    assert.equal(prisma.tests[0]?.extraTimeSec, 300);
  });

  /** The failure this prevents: `mirrorTimingOntoTest` used to collapse these back from branch rows. */
  it('leaves the clock alone when the test is moved between series', async () => {
    const { service, prisma } = serviceWith(opened());
    await service.setSchedule('tst_1', { lateEntrySec: 1800, extraTimeSec: 600 });

    await service.setSeries('tst_1', { series: [{ testSeriesId: 'srs_1', order: 1 }] });

    assert.deepEqual([prisma.tests[0]?.lateEntrySec, prisma.tests[0]?.extraTimeSec], [1800, 600]);
  });

  it('leaves the clock alone when the last series drops the test', async () => {
    const { service, prisma } = serviceWith(opened(), [
      { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
    ]);
    await service.setSchedule('tst_1', { lateEntrySec: 1800, extraTimeSec: 600 });

    await service.removeFromSeries('srs_1', 'tst_1');

    assert.deepEqual([prisma.tests[0]?.lateEntrySec, prisma.tests[0]?.extraTimeSec], [1800, 600]);
  });
});

describe('OfferingService — a program opens a test earlier, never later', () => {
  const EARLIER = new Date(OPENS_AT.getTime() - 3_600_000);

  const unlockService = (opensAt: Date | null = OPENS_AT) => {
    const prisma = new FakeTestsPrisma(
      [makeTest({ id: 'tst_1', opensAt })],
      [makeBaseConfig({ id: 'cfg_1' })],
      [makeSection({ id: 'sec_1', baseConfigId: 'cfg_1' })],
      [],
      [{ testSeriesId: 'srs_1', testId: 'tst_1', order: 1, unlockAt: opensAt }],
    );
    prisma.series.push(makeSeries({ id: 'srs_1' }));
    prisma.programCatalog.push({ code: 'FOUNDATION' });
    return {
      prisma,
      service: new OfferingService(
        prisma.asService(),
        new FakeEventBus().asService(),
        new AuditContext(),
      ),
    };
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

  it('drops one when the test is taken out of the series that opened it', async () => {
    const { service, prisma } = unlockService();
    await service.setProgramUnlock('tst_1', 'FOUNDATION', { opensAt: EARLIER.toISOString() });

    await service.removeFromSeries('srs_1', 'tst_1');

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
