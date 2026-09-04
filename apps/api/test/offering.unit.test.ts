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
  makeBranch,
  makeBranchConfig,
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

/** One test in one series, run at br_1 and switched off at br_2. */
const timingService = (
  branchSchedules: {
    branchId: string;
    testId: string;
    lateEntrySec: number | null;
    extraTimeSec: number | null;
  }[] = [],
) => {
  const prisma = new FakeTestsPrisma(
    [makeTest({ id: 'tst_1' })],
    [makeBaseConfig({ id: 'cfg_1' })],
    [makeSection({ id: 'sec_1', baseConfigId: 'cfg_1' })],
    [],
    [{ testSeriesId: 'srs_1', testId: 'tst_1', order: 1 }],
    [],
    [],
    [makeSeries({ id: 'srs_1' })],
    [],
    [],
    [],
    [
      {
        id: 'btc_1',
        branchId: 'br_1',
        testSeriesId: 'srs_1',
        enabled: true,
        createdAt: new Date(),
      },
      {
        id: 'btc_2',
        branchId: 'br_2',
        testSeriesId: 'srs_1',
        enabled: false,
        createdAt: new Date(),
      },
    ],
    branchSchedules,
    [makeBranch({ id: 'br_1', name: 'AMEERPET' }), makeBranch({ id: 'br_2', name: 'ONLINE' })],
  );
  return {
    prisma,
    service: new OfferingService(
      prisma.asService(),
      new FakeEventBus().asService(),
      new AuditContext(),
    ),
  };
};

describe('OfferingService — what a branch does differently for one test', () => {
  it('lists only the branches that actually reach the test', async () => {
    const { service } = timingService();

    const rows = await service.branchTiming('tst_1');

    assert.deepEqual(
      rows.map((row) => row.branch.name),
      ['AMEERPET'],
    );
    assert.deepEqual([rows[0]?.lateEntrySec, rows[0]?.extraTimeSec], [null, null]);
  });

  it('stores what a branch sets, in seconds', async () => {
    const { service, prisma } = timingService();

    const rows = await service.setBranchTiming('tst_1', {
      branches: [{ branchId: 'br_1', lateEntrySec: 1800, extraTimeSec: 600 }],
    });

    assert.deepEqual([rows[0]?.lateEntrySec, rows[0]?.extraTimeSec], [1800, 600]);
    assert.equal(prisma.branchSchedules.length, 1);
  });

  /** The failure this prevents: a table of rows full of nulls, each of which means nothing. */
  it('keeps no row for a branch that sets neither', async () => {
    const { service, prisma } = timingService([
      { branchId: 'br_1', testId: 'tst_1', lateEntrySec: 1800, extraTimeSec: null },
    ]);

    await service.setBranchTiming('tst_1', {
      branches: [{ branchId: 'br_1', lateEntrySec: null, extraTimeSec: null }],
    });

    assert.equal(prisma.branchSchedules.length, 0);
  });

  it('overwrites what a branch had rather than adding beside it', async () => {
    const { service, prisma } = timingService([
      { branchId: 'br_1', testId: 'tst_1', lateEntrySec: 1800, extraTimeSec: null },
    ]);

    await service.setBranchTiming('tst_1', {
      branches: [{ branchId: 'br_1', lateEntrySec: 600, extraTimeSec: 300 }],
    });

    assert.equal(prisma.branchSchedules.length, 1);
    assert.equal(prisma.branchSchedules[0]?.lateEntrySec, 600);
  });
});

describe('OfferingService — the test carries the clock the branches still set', () => {
  it('takes the largest extra time any branch gives, because a null gives none', async () => {
    const { service, prisma } = timingService();

    await service.setBranchTiming('tst_1', {
      branches: [
        { branchId: 'br_1', lateEntrySec: 1800, extraTimeSec: 600 },
        { branchId: 'br_2', lateEntrySec: 1200, extraTimeSec: null },
      ],
    });

    assert.equal(prisma.tests[0]?.extraTimeSec, 600);
  });

  /** br_2 is switched off, so only br_1 reaches the test and only br_1's cap has to be honoured. */
  it('caps late entry at the largest cap when every branch that reaches it has one', async () => {
    const { service, prisma } = timingService();

    await service.setBranchTiming('tst_1', {
      branches: [{ branchId: 'br_1', lateEntrySec: 1800, extraTimeSec: null }],
    });

    assert.equal(prisma.tests[0]?.lateEntrySec, 1800);
  });

  /** Null is NO CAP, so the branch with no row is exactly who max() would shut out. */
  it('leaves the test uncapped when a branch that reaches it caps nothing', async () => {
    const { service, prisma } = timingService();
    prisma.branchConfigRows.push(
      makeBranchConfig({ id: 'btc_3', branchId: 'br_2', testSeriesId: 'srs_1', enabled: true }),
    );

    await service.setBranchTiming('tst_1', {
      branches: [{ branchId: 'br_1', lateEntrySec: 1800, extraTimeSec: null }],
    });

    assert.equal(prisma.tests[0]?.lateEntrySec, null);
  });

  it('leaves the test uncapped while a grant reaches past the branches entirely', async () => {
    const { service, prisma } = timingService();
    prisma.seriesGrants.push({ studentId: 'stu_1', testSeriesId: 'srs_1' });

    await service.setBranchTiming('tst_1', {
      branches: [{ branchId: 'br_1', lateEntrySec: 1800, extraTimeSec: null }],
    });

    assert.equal(prisma.tests[0]?.lateEntrySec, null);
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
      [{ testSeriesId: 'srs_1', testId: 'tst_1', order: 1 }],
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

  it('takes the unlock back, leaving the cohort with the test’s own opening', async () => {
    const { service, prisma } = unlockService();
    await service.setProgramUnlock('tst_1', 'FOUNDATION', { opensAt: EARLIER.toISOString() });

    const rows = await service.clearProgramUnlock('tst_1', 'FOUNDATION');

    assert.deepEqual(rows, []);
    assert.equal(prisma.programUnlocks.length, 0);
  });
});

describe('OfferingService — one branch, and everything it runs', () => {
  const branchService = (
    branchSchedules: {
      branchId: string;
      testId: string;
      lateEntrySec: number | null;
      extraTimeSec: number | null;
    }[] = [],
  ) => {
    const prisma = new FakeTestsPrisma(
      [
        makeTest({ id: 'tst_1', title: 'Tier 1 mock' }),
        makeTest({ id: 'tst_2', title: 'Tier 2 mock' }),
      ],
      [makeBaseConfig({ id: 'cfg_1' })],
      [makeSection({ id: 'sec_1', baseConfigId: 'cfg_1' })],
      [],
      [
        { testSeriesId: 'srs_1', testId: 'tst_1', order: 1, unlockAt: OPENS_AT },
        { testSeriesId: 'srs_2', testId: 'tst_2', order: 1 },
      ],
      [],
      [],
      [
        makeSeries({ id: 'srs_1', name: 'Full length' }),
        makeSeries({ id: 'srs_2', name: 'Sectionals' }),
      ],
      [],
      [],
      [],
      [
        makeBranchConfig({ id: 'btc_1', branchId: 'br_1', testSeriesId: 'srs_1', enabled: true }),
        makeBranchConfig({ id: 'btc_2', branchId: 'br_1', testSeriesId: 'srs_2', enabled: false }),
      ],
      branchSchedules,
      [makeBranch({ id: 'br_1', name: 'AMEERPET' })],
    );
    return {
      prisma,
      service: new OfferingService(
        prisma.asService(),
        new FakeEventBus().asService(),
        new AuditContext(),
      ),
    };
  };

  const listAt = (branchId: string, service: OfferingService) =>
    service.testsForBranch(branchId, { page: 1, pageSize: 20, q: undefined });

  it('lists a test with the series that carries it here, and when it opens', async () => {
    const { service } = branchService([
      { branchId: 'br_1', testId: 'tst_1', lateEntrySec: 1800, extraTimeSec: 600 },
    ]);

    const page = await listAt('br_1', service);

    assert.equal(page.total, 1);
    assert.deepEqual(
      page.items.map((row) => [row.testId, row.seriesName, row.unlockAt]),
      [['tst_1', 'Full length', OPENS_AT.toISOString()]],
    );
    assert.deepEqual([page.items[0]?.lateEntrySec, page.items[0]?.extraTimeSec], [1800, 600]);
  });

  /** The failure this prevents: a branch configuring timings on a test its students cannot reach. */
  it('leaves out a test whose only series is switched off here', async () => {
    const { service } = branchService();

    const page = await listAt('br_1', service);

    assert.deepEqual(
      page.items.map((row) => row.testId),
      ['tst_1'],
    );
  });

  it('reads a branch that is not there as missing', async () => {
    const { service } = branchService();

    await assert.rejects(() => listAt('br_nope', service), AppException.is);
  });

  it('stores what one branch sets on one test', async () => {
    const { service, prisma } = branchService();

    const saved = await service.setBranchSchedule('br_1', 'tst_1', {
      lateEntrySec: 900,
      extraTimeSec: null,
    });

    assert.deepEqual(saved, { testId: 'tst_1', lateEntrySec: 900, extraTimeSec: null });
    assert.equal(prisma.branchSchedules.length, 1);
  });

  /** The failure this prevents: a row of nulls saying "the plain rules" a second time. */
  it('deletes the row when both fields are cleared', async () => {
    const { service, prisma } = branchService([
      { branchId: 'br_1', testId: 'tst_1', lateEntrySec: 1800, extraTimeSec: 600 },
    ]);

    await service.setBranchSchedule('br_1', 'tst_1', { lateEntrySec: null, extraTimeSec: null });

    assert.equal(prisma.branchSchedules.length, 0);
  });

  it('refuses a test this branch does not run', async () => {
    const { service } = branchService();

    await assert.rejects(
      () => service.setBranchSchedule('br_1', 'tst_2', { lateEntrySec: 60, extraTimeSec: null }),
      AppException.is,
    );
  });
});
