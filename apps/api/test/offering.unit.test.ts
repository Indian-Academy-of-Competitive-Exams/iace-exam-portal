import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes, TEST_STATUS } from '@iace/contracts';
import { OfferingService } from '../src/tests/offering.service';
import { DOMAIN_EVENTS } from '../src/common/events';
import {
  type FakeSeriesTestRow,
  FakeEventBus,
  FakeTestsPrisma,
  makeBaseConfig,
  makeSection,
  makeSeries,
  makeTest,
} from './support/fakes';

function serviceWith(test = makeTest({ id: 'tst_1' }), seriesTests: FakeSeriesTestRow[] = []) {
  const prisma = new FakeTestsPrisma(
    [test],
    [makeBaseConfig({ id: 'cfg_1' })],
    [makeSection({ id: 'sec_1', baseConfigId: 'cfg_1' })],
    [],
    seriesTests,
  );
  prisma.series.push(
    makeSeries({ id: 'srs_1', name: 'SSC CGL 2026 — Full length' }),
    makeSeries({ id: 'srs_2', name: 'SSC CGL 2026 — Sectionals' }),
  );
  const events = new FakeEventBus();
  return { prisma, events, service: new OfferingService(prisma.asService(), events.asService()) };
}

const finalized = () => makeTest({ id: 'tst_1', isLocked: true });

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

describe('OfferingService — offering a test', () => {
  it('offers a finalized test that a series carries', async () => {
    const { service, prisma } = serviceWith(finalized(), [
      { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
    ]);

    const status = await service.setStatus('tst_1', TEST_STATUS.ACTIVE);

    assert.equal(status, TEST_STATUS.ACTIVE);
    assert.equal(prisma.tests[0]!.status, TEST_STATUS.ACTIVE);
  });

  it('refuses to offer a test no series carries', async () => {
    const { service, prisma } = serviceWith(finalized());

    // The failure this prevents: an ACTIVE test no student has any route to.
    const error = await service.setStatus('tst_1', TEST_STATUS.ACTIVE).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /only through a series/);
    assert.equal(prisma.tests[0]!.status, TEST_STATUS.DRAFT);
  });

  it('refuses to offer a test whose paper is not frozen', async () => {
    const { service, prisma } = serviceWith(makeTest({ id: 'tst_1' }), [
      { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
    ]);

    const error = await service.setStatus('tst_1', TEST_STATUS.ACTIVE).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.match(error.message, /Finalize this test/);
    assert.equal(prisma.tests[0]!.status, TEST_STATUS.DRAFT);
  });

  it('retires a test without asking anything of it', async () => {
    const { service, prisma } = serviceWith(
      makeTest({ id: 'tst_1', status: TEST_STATUS.ACTIVE, isLocked: true }),
    );

    // Withdrawing an offer needs no series and no frozen paper — only offering does.
    await service.setStatus('tst_1', TEST_STATUS.INACTIVE);

    assert.equal(prisma.tests[0]!.status, TEST_STATUS.INACTIVE);
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
