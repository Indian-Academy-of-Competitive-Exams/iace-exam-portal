import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ATTEMPT_STATUS } from '@iace/contracts';
import {
  AttemptSweeperProcessor,
  SWEEP_BATCH,
  SWEEP_LANES,
} from '../src/attempts/attempt-sweeper.processor';
import { FakeTestsPrisma, makeAttempt } from './support/fakes';

const LATE = new Date(Date.now() - 60 * 60 * 1000);
const NO_MORE_WORK = { relay: () => Promise.resolve(0) } as never;

function strandedRows(count: number) {
  return Array.from({ length: count }, (_, index) =>
    makeAttempt({ id: `att_${index + 1}`, studentId: `stu_${index + 1}`, endsAt: LATE }),
  );
}

/** A hand-rolled `expire()` double: records which ids it was asked to end, and can fail on some. */
function build(count: number, refuse: (attemptId: string) => boolean = () => false) {
  const prisma = new FakeTestsPrisma([], undefined, undefined, [], [], [], [], strandedRows(count));
  const asked: string[] = [];
  const submit = {
    expire: (attemptId: string) => {
      asked.push(attemptId);
      if (refuse(attemptId)) return Promise.reject(new Error('expire refused'));
      const row = prisma.attemptRows.find((candidate) => candidate.id === attemptId);
      if (row) row.status = ATTEMPT_STATUS.SUBMITTED;
      return Promise.resolve();
    },
  } as never;
  const sweeper = new AttemptSweeperProcessor(
    prisma.asService(),
    submit,
    NO_MORE_WORK,
    NO_MORE_WORK,
  );
  return { prisma, asked, sweeper };
}

describe('AttemptSweeperProcessor — one sweep, many stranded sittings', () => {
  /** The bug this prevents: a batching loop that only ever touches its first lane. */
  it('ends every stranded sitting, not just the first lane of them', async () => {
    const count = SWEEP_LANES * 2 + 3;
    const { prisma, sweeper } = build(count);

    await sweeper.process();

    const ended = prisma.attemptRows.filter((row) => row.status === ATTEMPT_STATUS.SUBMITTED);
    assert.equal(ended.length, count);
  });

  /** The bug this prevents: one student's failed expire taking every other lane down with it. */
  it('keeps ending the rest when one expire in the batch is refused', async () => {
    const count = SWEEP_LANES + 2;
    const { prisma, asked, sweeper } = build(count, (id) => id === 'att_1');

    await sweeper.process();

    assert.equal(asked.length, count, 'every stranded sitting must still have been asked about');
    assert.equal(
      prisma.attemptRows.find((row) => row.id === 'att_1')?.status,
      ATTEMPT_STATUS.IN_PROGRESS,
    );
    const ended = prisma.attemptRows.filter((row) => row.status === ATTEMPT_STATUS.SUBMITTED);
    assert.equal(ended.length, count - 1);
  });

  /** The bug this prevents: a cap on the read becoming a cap on the rate under a mass failure. */
  it('keeps reading until the backlog is gone, not one batch a sweep', async () => {
    const count = SWEEP_BATCH * 2 + 7;
    const { prisma, sweeper } = build(count);

    await sweeper.process();

    const ended = prisma.attemptRows.filter((row) => row.status === ATTEMPT_STATUS.SUBMITTED);
    assert.equal(ended.length, count);
  });

  /** The bug this prevents: a full batch nothing can end, read and refused for ever. */
  it('stops rather than re-reading a batch it made no progress on', async () => {
    const { asked, sweeper } = build(SWEEP_BATCH + 5, () => true);

    await sweeper.process();

    assert.equal(asked.length, SWEEP_BATCH, 'a second read of the same rows is the loop');
  });
});
