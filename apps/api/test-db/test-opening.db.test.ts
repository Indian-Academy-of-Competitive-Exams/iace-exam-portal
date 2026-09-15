import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { NOTIFICATION_TYPE, TEST_STATUS, type TestStatus } from '@iace/contracts';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { TestOpeningService } from '../src/notifications/test-opening.service';
import { FakeQueue } from '../test/support/fakes';
import { makeCatalog, makeTest, resetDatabase, testPrisma } from './support/database';

/** A test opens by the CLOCK, so the sweep is the producer and `announcedAt` is what bounds it. */

const NOW = new Date('2026-09-10T05:00:00.000Z');
const LATER = new Date('2026-09-10T06:00:00.000Z');
const COHORT = ['stu_1', 'stu_2', 'stu_3'];

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function build(reaching: string[] = COHORT) {
  const outbox = new NotificationOutbox(new FakeQueue().asQueue());
  const access = { studentsReaching: () => Promise.resolve(reaching) } as never;
  return new TestOpeningService(prisma, access, outbox);
}

async function openingTest(
  over: { title?: string; status?: TestStatus; opensAt?: Date | null } = {},
) {
  return makeTest(prisma, await makeCatalog(prisma), {
    title: over.title ?? 'Mock 1',
    status: over.status ?? TEST_STATUS.ACTIVE,
    opensAt: over.opensAt ?? null,
  });
}

const requests = () => prisma.outboxEvent.findMany();

const told = async () =>
  (await requests()).map((row) => (row.payload as { studentId: string }).studentId).sort();

const announcedAt = async (id: string) =>
  (await prisma.test.findUniqueOrThrow({ where: { id } })).announcedAt;

describe('Telling a cohort a test has opened', () => {
  it('tells everybody the series reaches, once each', async () => {
    const service = build();
    await openingTest();

    const spoken = await service.sweep(NOW);

    assert.equal(spoken, 1);
    assert.deepEqual(await told(), COHORT);
  });

  it('carries the test on the notification, so the bell can open it', async () => {
    const service = build(['stu_1']);
    const test = await openingTest({ title: 'Mock 4' });

    await service.sweep(NOW);

    const payload = (await requests())[0]?.payload as Record<string, unknown>;
    assert.equal(payload.type, NOTIFICATION_TYPE.TEST_ASSIGNED);
    assert.equal(payload.testId, test.id);
    assert.equal(payload.title, 'Mock 4');
    assert.equal(payload.dedupeKey, `test-open:${test.id}`);
  });

  /** The failure this prevents: a sweep every five minutes telling the same cohort for ever. */
  it('says it once however many times the sweep runs', async () => {
    const service = build();
    await openingTest();

    await service.sweep(NOW);
    const again = await service.sweep(LATER);

    assert.equal(again, 0);
    assert.equal((await requests()).length, COHORT.length);
  });

  it('stamps the watermark, which is what makes that true', async () => {
    const service = build();
    const test = await openingTest();

    await service.sweep(NOW);

    assert.deepEqual(await announcedAt(test.id), NOW);
  });
});

describe('What the sweep leaves alone', () => {
  it('says nothing about a test that has not opened yet', async () => {
    const service = build();
    await openingTest({ opensAt: LATER });

    assert.equal(await service.sweep(NOW), 0);
    assert.equal((await requests()).length, 0);
  });

  it('speaks the moment it does open', async () => {
    const service = build();
    await openingTest({ opensAt: LATER });

    await service.sweep(NOW);

    assert.equal(await service.sweep(LATER), 1);
  });

  /** A draft is not a paper anybody can sit, so it is not one the sweep has missed. */
  it('says nothing about a test that is not being offered', async () => {
    const service = build();
    await openingTest({ status: TEST_STATUS.DRAFT });

    assert.equal(await service.sweep(NOW), 0);
  });

  /** The watermark is still stamped: a series nobody reaches is answered, not retried for ever. */
  it('marks a test nobody reaches as spoken about', async () => {
    const service = build([]);
    const test = await openingTest();

    await service.sweep(NOW);

    assert.equal((await requests()).length, 0);
    assert.deepEqual(await announcedAt(test.id), NOW);
  });
});
