import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NOTIFICATION_TYPE } from '@iace/contracts';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { TestOpeningService } from '../src/notifications/test-opening.service';
import { FakeNotificationsPrisma, FakeQueue, makeOpeningTest } from './support/fakes';

/** A test opens by the CLOCK, so the sweep is the producer and `announcedAt` is what bounds it. */

const NOW = new Date('2026-09-10T05:00:00.000Z');
const LATER = new Date('2026-09-10T06:00:00.000Z');
const COHORT = ['stu_1', 'stu_2', 'stu_3'];

function build(reaching: string[] = COHORT) {
  const prisma = new FakeNotificationsPrisma();
  const outbox = new NotificationOutbox(prisma.asService(), new FakeQueue().asQueue());
  const access = { studentsReaching: () => Promise.resolve(reaching) } as never;

  return { prisma, service: new TestOpeningService(prisma.asService(), access, outbox) };
}

const told = (prisma: FakeNotificationsPrisma) =>
  prisma.outboxEvents.map((row) => (row.payload as { studentId: string }).studentId);

describe('Telling a cohort a test has opened', () => {
  it('tells everybody the series reaches, once each', async () => {
    const { prisma, service } = build();
    prisma.tests.push(makeOpeningTest());

    const spoken = await service.sweep(NOW);

    assert.equal(spoken, 1);
    assert.deepEqual(told(prisma), COHORT);
  });

  it('carries the test on the notification, so the bell can open it', async () => {
    const { prisma, service } = build(['stu_1']);
    prisma.tests.push(makeOpeningTest({ id: 'tst_9', title: 'Mock 4' }));

    await service.sweep(NOW);

    const payload = prisma.outboxEvents[0]?.payload as Record<string, unknown>;
    assert.equal(payload.type, NOTIFICATION_TYPE.TEST_ASSIGNED);
    assert.equal(payload.testId, 'tst_9');
    assert.equal(payload.title, 'Mock 4');
    assert.equal(payload.dedupeKey, 'test-open:tst_9');
  });

  /** The failure this prevents: a sweep every five minutes telling the same cohort for ever. */
  it('says it once however many times the sweep runs', async () => {
    const { prisma, service } = build();
    prisma.tests.push(makeOpeningTest());

    await service.sweep(NOW);
    const again = await service.sweep(LATER);

    assert.equal(again, 0);
    assert.equal(prisma.outboxEvents.length, COHORT.length);
  });

  it('stamps the watermark, which is what makes that true', async () => {
    const { prisma, service } = build();
    prisma.tests.push(makeOpeningTest());

    await service.sweep(NOW);

    assert.deepEqual(prisma.tests[0]?.announcedAt, NOW);
  });
});

describe('What the sweep leaves alone', () => {
  it('says nothing about a test that has not opened yet', async () => {
    const { prisma, service } = build();
    prisma.tests.push(makeOpeningTest({ opensAt: LATER }));

    assert.equal(await service.sweep(NOW), 0);
    assert.equal(prisma.outboxEvents.length, 0);
  });

  it('speaks the moment it does open', async () => {
    const { prisma, service } = build();
    prisma.tests.push(makeOpeningTest({ opensAt: LATER }));

    await service.sweep(NOW);

    assert.equal(await service.sweep(LATER), 1);
  });

  /** A draft is not a paper anybody can sit, so it is not one the sweep has missed. */
  it('says nothing about a test that is not being offered', async () => {
    const { prisma, service } = build();
    prisma.tests.push(makeOpeningTest({ status: 'DRAFT' }));

    assert.equal(await service.sweep(NOW), 0);
  });

  /** The watermark is still stamped: a series nobody reaches is answered, not retried for ever. */
  it('marks a test nobody reaches as spoken about', async () => {
    const { prisma, service } = build([]);
    prisma.tests.push(makeOpeningTest());

    await service.sweep(NOW);

    assert.equal(prisma.outboxEvents.length, 0);
    assert.deepEqual(prisma.tests[0]?.announcedAt, NOW);
  });
});
