import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { TEST_STATUS, type TestStatus } from '@iace/contracts';
import { type BroadcastPush } from '../src/notifications/push.service';
import { OPENED_TITLE, TestOpeningService } from '../src/notifications/test-opening.service';
import { makeCatalog, makeStudent, makeTest, resetDatabase, testPrisma } from './support/database';

/** A test opens by the CLOCK, so the sweep is the producer and `announcedAt` is what bounds it. */

const NOW = new Date('2026-09-10T05:00:00.000Z');
const LATER = new Date('2026-09-10T06:00:00.000Z');

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** The series reaches this many real students; the push records who it was asked to reach. */
async function build(reaching = 3) {
  const cohort: string[] = [];
  for (let at = 0; at < reaching; at += 1) cohort.push((await makeStudent(prisma)).id);
  const access = { studentsReaching: () => Promise.resolve(cohort) } as never;
  const pushed: { studentIds: string[]; message: BroadcastPush }[] = [];
  const push = {
    broadcast: (studentIds: readonly string[], message: BroadcastPush) => {
      pushed.push({ studentIds: [...studentIds], message });
      return Promise.resolve();
    },
  } as never;
  return { service: new TestOpeningService(prisma, access, push), cohort: cohort.sort(), pushed };
}

async function openingTest(
  over: { title?: string | null; status?: TestStatus; opensAt?: Date | null } = {},
) {
  return makeTest(prisma, await makeCatalog(prisma), {
    title: over.title === undefined ? 'Mock 1' : over.title,
    status: over.status ?? TEST_STATUS.ACTIVE,
    opensAt: over.opensAt ?? null,
  });
}

const announcedAt = async (id: string) =>
  (await prisma.test.findUniqueOrThrow({ where: { id } })).announcedAt;

describe('Telling a cohort a test has opened', () => {
  /** THE failure this prevents: one bell row per student for every test that opens. */
  it('pushes everybody the series reaches, and writes no row per student', async () => {
    const { service, cohort, pushed } = await build();
    const test = await openingTest({ title: 'Mock 4' });

    assert.equal(await service.sweep(NOW), 1);

    assert.deepEqual(pushed, [
      { studentIds: cohort, message: { broadcastId: test.id, title: 'Mock 4' } },
    ]);
    assert.equal(await prisma.notification.count(), 0);
  });

  it('names a test with no title as a new test', async () => {
    const { service, pushed } = await build(1);
    await openingTest({ title: null });

    await service.sweep(NOW);

    assert.equal(pushed[0]?.message.title, OPENED_TITLE);
  });

  /** The failure this prevents: a sweep every five minutes telling the same cohort for ever. */
  it('says it once however many times the sweep runs', async () => {
    const { service, pushed } = await build();
    await openingTest();

    await service.sweep(NOW);
    const again = await service.sweep(LATER);

    assert.equal(again, 0);
    assert.equal(pushed.length, 1);
  });

  it('stamps the watermark, which is what lists it in the bell', async () => {
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
    const { service, pushed } = await build(0);
    const test = await openingTest();

    await service.sweep(NOW);

    assert.deepEqual(pushed, []);
    assert.deepEqual(await announcedAt(test.id), NOW);
  });
});
