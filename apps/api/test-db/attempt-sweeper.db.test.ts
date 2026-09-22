import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { ATTEMPT_STATUS, STUDENT_TYPE } from '@iace/contracts';
import {
  AttemptSweeperProcessor,
  SWEEP_BATCH,
  SWEEP_LANES,
} from '../src/attempts/attempt-sweeper.processor';
import { ROLLUP_REQUEST, RollupOutbox } from '../src/attempts/rollup-outbox';
import { FOLD_PENDING_JOB_ID, ROLLUP_JOBS } from '../src/queue/queues';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { FakeQueue, FakeRedis, fakeQueueFailures } from '../test/support/fakes';
import { makeCatalog, makeTest, resetDatabase, testPrisma, uid } from './support/database';

const HOUR_MS = 60 * 60 * 1000;
const NO_MORE_WORK = { relay: () => Promise.resolve(0) } as never;

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** `count` sittings of one test, by as many students, whose clock ran out an hour ago. */
async function stranded(count: number): Promise<string[]> {
  const test = await makeTest(prisma, await makeCatalog(prisma));
  const students = Array.from({ length: count }, () => uid());
  await prisma.student.createMany({
    data: students.map((id) => ({ id, mobile: uid(), studentType: STUDENT_TYPE.ONLINE })),
  });
  const endsAt = new Date(Date.now() - HOUR_MS);
  const attempts = students.map((studentId) => ({
    id: uid(),
    testId: test.id,
    studentId,
    attemptNo: 1,
    startedAt: new Date(endsAt.getTime() - HOUR_MS),
    endsAt,
    shuffleSeed: 1,
  }));
  await prisma.attempt.createMany({ data: attempts });
  return attempts.map((attempt) => attempt.id);
}

/** A hand-rolled `expire()` double: ends the sitting it is asked to, unless told to refuse it. */
function build(refuse: (attemptId: string) => boolean = () => false) {
  const asked: string[] = [];
  const submit = {
    expire: async (attemptId: string) => {
      asked.push(attemptId);
      if (refuse(attemptId)) throw new Error('expire refused');
      await prisma.attempt.update({
        where: { id: attemptId },
        data: { status: ATTEMPT_STATUS.SUBMITTED, submittedAt: new Date() },
      });
    },
  } as never;
  const rollupQueue = new FakeQueue();
  const redis = new FakeRedis();
  const state = new AttemptStateService(prisma, redis.asService());
  const sweeper = new AttemptSweeperProcessor(
    prisma,
    state,
    submit,
    NO_MORE_WORK,
    new RollupOutbox(rollupQueue.asQueue()),
    fakeQueueFailures(),
  );
  return { asked, sweeper, rollupQueue, state };
}

const ended = () => prisma.attempt.count({ where: { status: ATTEMPT_STATUS.SUBMITTED } });

describe('AttemptSweeperProcessor — a paper put down is not a paper abandoned', () => {
  /** The failure this prevents: closing the laptop for an hour ending the sitting at its old deadline. */
  it('leaves a sitting whose live key is still there', async () => {
    const [attemptId = ''] = await stranded(1);
    const { sweeper, state, asked } = build();
    const attempt = await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    await state.open(attempt, 'tab-1');

    await sweeper.process();

    assert.deepEqual(asked, [], 'nothing was asked to expire');
    assert.equal(await ended(), 0);
  });

  it('ends one whose key has gone, which is what past the limit looks like', async () => {
    const [attemptId = ''] = await stranded(1);
    const { sweeper, asked } = build();

    await sweeper.process();

    assert.deepEqual(asked, [attemptId]);
    assert.equal(await ended(), 1);
  });
});

describe('AttemptSweeperProcessor — one sweep, many stranded sittings', () => {
  /** The bug this prevents: a batching loop that only ever touches its first lane. */
  it('ends every stranded sitting, not just the first lane of them', async () => {
    const count = SWEEP_LANES * 2 + 3;
    await stranded(count);

    await build().sweeper.process();

    assert.equal(await ended(), count);
  });

  /** The bug this prevents: one student's failed expire taking every other lane down with it. */
  it('keeps ending the rest when one expire in the batch is refused', async () => {
    const count = SWEEP_LANES + 2;
    const [refused] = await stranded(count);
    const { asked, sweeper } = build((id) => id === refused);

    await sweeper.process();

    assert.equal(asked.length, count, 'every stranded sitting must still have been asked about');
    const kept = await prisma.attempt.findUniqueOrThrow({ where: { id: refused ?? '' } });
    assert.equal(kept.status, ATTEMPT_STATUS.IN_PROGRESS);
    assert.equal(await ended(), count - 1);
  });

  /** The bug this prevents: a cap on the read becoming a cap on the rate under a mass failure. */
  it('keeps reading until the backlog is gone, not one batch a sweep', async () => {
    const count = SWEEP_BATCH * 2 + 7;
    await stranded(count);

    await build().sweeper.process();

    assert.equal(await ended(), count);
  });

  /** The bug this prevents: a full batch nothing can end, read and refused for ever. */
  it('stops rather than re-reading a batch it made no progress on', async () => {
    await stranded(SWEEP_BATCH + 5);
    const { asked, sweeper } = build(() => true);

    await sweeper.process();

    assert.equal(asked.length, SWEEP_BATCH, 'a second read of the same rows is the loop');
  });
});

describe('AttemptSweeperProcessor — backstop for a died counting pass', () => {
  /** A pass that died leaves its rows pending, and the sweep is what asks for another one. */
  it('asks for another counting pass while a row is still pending', async () => {
    const pending = await prisma.outboxEvent.create({
      data: {
        aggregateType: ROLLUP_REQUEST.AGGREGATE_TYPE,
        aggregateId: uid(),
        eventType: ROLLUP_REQUEST.EVENT_TYPE,
        payload: { testId: 'test_1' },
        createdAt: new Date(1),
      },
    });
    const { sweeper, rollupQueue } = build();

    await sweeper.process();

    const job = rollupQueue.jobs.find((queued) => queued.name === ROLLUP_JOBS.FOLD_PENDING);
    assert.ok(job, 'the sweep asks for a fold pass');
    assert.equal(job?.jobId, FOLD_PENDING_JOB_ID);
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: pending.id } });
    assert.equal(row.processedAt, null, 'asking for the pass is not the same as counting the row');
  });
});
