import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { type Prisma } from '@prisma/client';
import { NOTIFICATION_TYPE, TEST_STATUS, type TestStatus } from '@iace/contracts';
import { NotificationsService } from '../src/notifications/notifications.service';
import { TestOpeningService } from '../src/notifications/test-opening.service';
import { makeCatalog, makeStudent, makeTest, resetDatabase, testPrisma } from './support/database';

/** A test opens by the CLOCK, so the sweep is the producer and `announcedAt` is what bounds it. */

const NOW = new Date('2026-09-10T05:00:00.000Z');
const LATER = new Date('2026-09-10T06:00:00.000Z');

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** The series reaches this many real students: a notification row names one by foreign key. */
async function build(reaching = 3) {
  const cohort: string[] = [];
  for (let at = 0; at < reaching; at += 1) cohort.push((await makeStudent(prisma)).id);
  const access = { studentsReaching: () => Promise.resolve(cohort) } as never;
  return {
    service: new TestOpeningService(prisma, access, new NotificationsService(prisma)),
    cohort: cohort.sort(),
  };
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

const requests = () => prisma.notification.findMany();

const told = async () => (await requests()).map((row) => row.studentId).sort();

const announcedAt = async (id: string) =>
  (await prisma.test.findUniqueOrThrow({ where: { id } })).announcedAt;

describe('Telling a cohort a test has opened', () => {
  it('tells everybody the series reaches, once each', async () => {
    const { service, cohort } = await build();
    await openingTest();

    const spoken = await service.sweep(NOW);

    assert.equal(spoken, 1);
    assert.deepEqual(await told(), cohort);
  });

  it('carries the test and its series on the notification, so the bell can open either', async () => {
    const { service } = await build(1);
    const test = await openingTest({ title: 'Mock 4' });
    const { testSeriesId } = await prisma.test.findUniqueOrThrow({ where: { id: test.id } });

    await service.sweep(NOW);

    const [row] = await requests();
    assert.ok(row);
    assert.equal(row.type, NOTIFICATION_TYPE.TEST_ASSIGNED);
    assert.equal(row.testId, test.id);
    assert.equal(row.testSeriesId, testSeriesId);
    assert.equal(row.title, 'Mock 4');
    assert.equal(row.dedupeKey, `test-open:${test.id}`);
  });

  /** The failure this prevents: a sweep every five minutes telling the same cohort for ever. */
  it('says it once however many times the sweep runs', async () => {
    const { service, cohort } = await build();
    await openingTest();

    await service.sweep(NOW);
    const again = await service.sweep(LATER);

    assert.equal(again, 0);
    assert.equal((await requests()).length, cohort.length);
  });

  it('stamps the watermark, which is what makes that true', async () => {
    const { service } = await build();
    const test = await openingTest();

    await service.sweep(NOW);

    assert.deepEqual(await announcedAt(test.id), NOW);
  });
});

describe('What the sweep leaves alone', () => {
  it('says nothing about a test that has not opened yet', async () => {
    const { service } = await build();
    await openingTest({ opensAt: LATER });

    assert.equal(await service.sweep(NOW), 0);
    assert.equal((await requests()).length, 0);
  });

  it('speaks the moment it does open', async () => {
    const { service } = await build();
    await openingTest({ opensAt: LATER });

    await service.sweep(NOW);

    assert.equal(await service.sweep(LATER), 1);
  });

  /** A draft is not a paper anybody can sit, so it is not one the sweep has missed. */
  it('says nothing about a test that is not being offered', async () => {
    const { service } = await build();
    await openingTest({ status: TEST_STATUS.DRAFT });

    assert.equal(await service.sweep(NOW), 0);
  });

  /** The watermark is still stamped: a series nobody reaches is answered, not retried for ever. */
  it('marks a test nobody reaches as spoken about', async () => {
    const { service } = await build(0);
    const test = await openingTest();

    await service.sweep(NOW);

    assert.equal((await requests()).length, 0);
    assert.deepEqual(await announcedAt(test.id), NOW);
  });
});

describe('When the fan-out dies part-way through', () => {
  /** Only the first row lands, then the write throws — what a timeout or a lost connection looks like. */
  function diesAfterOne(cohort: string[]) {
    const access = { studentsReaching: () => Promise.resolve(cohort) } as never;
    const dying = new Proxy(prisma, {
      get(target, key: string | symbol) {
        if (key !== 'notification') return Reflect.get(target, key) as unknown;
        return new Proxy(target.notification, {
          get(delegate, method: string | symbol) {
            if (method !== 'createMany') return Reflect.get(delegate, method) as unknown;
            return async (args: Prisma.NotificationCreateManyArgs) => {
              await delegate.createMany({
                ...args,
                data: (args.data as Prisma.NotificationCreateManyInput[]).slice(0, 1),
              });
              throw new Error('the fan-out died');
            };
          },
        });
      },
    });
    return new TestOpeningService(dying, access, new NotificationsService(dying));
  }

  it('leaves the watermark unstamped, so the next sweep still owes the cohort', async () => {
    const { cohort } = await build();
    const test = await openingTest();

    assert.equal(await diesAfterOne(cohort).sweep(NOW), 0);

    assert.equal((await requests()).length, 1);
    assert.equal(await announcedAt(test.id), null);
  });

  /** The failure this prevents: a part-told cohort either never finished, or told somebody twice. */
  it('tells the rest on the next sweep, and nobody a second time', async () => {
    const { service, cohort } = await build();
    const test = await openingTest();
    await diesAfterOne(cohort).sweep(NOW);

    assert.equal(await service.sweep(LATER), 1);

    assert.deepEqual(await told(), cohort);
    assert.deepEqual(await announcedAt(test.id), LATER);
  });
});
