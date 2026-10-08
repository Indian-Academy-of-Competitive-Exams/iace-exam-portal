import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import { ANSWER_STATE, ATTEMPT_STATUS, STUDENT_TYPE } from '@iace/contracts';
import { AttemptFlushProcessor } from '../src/attempts/attempt-flush.processor';
import { AttemptResolutionService } from '../src/attempts/attempt-resolution.service';
import { AttemptSheetService } from '../src/attempts/attempt-sheet.service';
import {
  AttemptSweeperProcessor,
  NEVER_SCORED_BATCH_CEILING,
  RESCORE_PAGE,
  SWEEP_BATCH,
  SWEEP_LANES,
} from '../src/attempts/attempt-sweeper.processor';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { ScoringQueue } from '../src/attempts/scoring-queue';
import { SubmitService } from '../src/attempts/submit.service';
import { AuditContext } from '../src/audit';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  COHORT_SWEEP_JOB_ID,
  ROLLUP_JOBS,
  SCORING_RETRY_AFTER_MS,
  rescoreJobId,
  scoringJobId,
} from '../src/queue/queues';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { FakeMetrics, FakeQueue, FakeRedis, fakeQueueFailures } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makeCatalog,
  makePaper,
  makeStudent,
  makeTest,
  resetDatabase,
  servedAnswers,
  sitPaper,
  testPrisma,
  uid,
} from './support/database';

const HOUR_MS = 60 * 60 * 1000;

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** `count` sittings of one test, by as many students, whose clock ran out an hour ago unless told. */
async function stranded(count: number, agoMs = HOUR_MS): Promise<string[]> {
  const test = await makeTest(prisma, await makeCatalog(prisma));
  const students = Array.from({ length: count }, () => uid());
  await prisma.student.createMany({
    data: students.map((id) => ({ id, mobile: uid(), studentType: STUDENT_TYPE.ONLINE })),
  });
  const endsAt = new Date(Date.now() - agoMs);
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

interface Hooks {
  /** Throws for a sitting the sweep must fail to end. */
  refuse?: (attemptId: string) => boolean;
  /** Runs once, after the sweep has listed the sitting and before it is claimed. */
  beforeClaim?: () => Promise<void>;
}

/** The real client, with the claim that ends each sitting open to a hook. */
function claimWatched(before: (attemptId: string) => Promise<void>): PrismaService {
  return new Proxy(prisma, {
    get(target, key: string | symbol) {
      if (key !== 'attempt') return Reflect.get(target, key) as unknown;
      return new Proxy(target.attempt, {
        get(delegate, method: string | symbol) {
          if (method !== 'updateMany') return Reflect.get(delegate, method) as unknown;
          return async (args: Prisma.AttemptUpdateManyArgs) => {
            await before(String(args.where?.id));
            return delegate.updateMany(args);
          };
        },
      });
    },
  });
}

function build(hooks: Hooks = {}) {
  const asked: string[] = [];
  const client = claimWatched(async (attemptId) => {
    asked.push(attemptId);
    const { beforeClaim } = hooks;
    delete hooks.beforeClaim;
    await beforeClaim?.();
    if (hooks.refuse?.(attemptId)) throw new Error('claim refused');
  });
  const rollupQueue = new FakeQueue();
  const redis = new FakeRedis();
  const state = new AttemptStateService(prisma, redis.asService(), new PaperSheetService(prisma));
  const metrics = new FakeMetrics();
  const scoring = new FakeQueue();
  const scoringQueue = new ScoringQueue(scoring.asQueue());
  const sheets = new AttemptSheetService(prisma, new PaperSheetService(prisma));
  const submit = new SubmitService(client, state, scoringQueue, metrics.asService(), sheets);
  const sweeper = new AttemptSweeperProcessor(
    prisma,
    state,
    submit,
    scoringQueue,
    new RollupQueue(rollupQueue.asQueue()),
    fakeQueueFailures(),
    metrics.asService(),
  );
  const support = new AttemptResolutionService(
    prisma,
    state,
    sheets,
    submit,
    new RollupQueue(new FakeQueue().asQueue()),
    new AuditContext(),
  );
  const flusher = new AttemptFlushProcessor(state, sheets, fakeQueueFailures());
  return { asked, sweeper, rollupQueue, scoring, state, metrics, support, flusher };
}

const ended = () => prisma.attempt.count({ where: { status: ATTEMPT_STATUS.SUBMITTED } });

/** `count` sittings already ended, unscored, and past the grace a scoring job gets to answer. */
async function unscored(count: number): Promise<string[]> {
  const test = await makeTest(prisma, await makeCatalog(prisma));
  const students = Array.from({ length: count }, () => uid());
  await prisma.student.createMany({
    data: students.map((id) => ({ id, mobile: uid(), studentType: STUDENT_TYPE.ONLINE })),
  });
  const submittedAt = new Date(Date.now() - SCORING_RETRY_AFTER_MS - HOUR_MS);
  const attempts = students.map((studentId) => ({
    id: uid(),
    testId: test.id,
    studentId,
    attemptNo: 1,
    status: ATTEMPT_STATUS.SUBMITTED,
    startedAt: new Date(submittedAt.getTime() - HOUR_MS),
    endsAt: submittedAt,
    submittedAt,
    shuffleSeed: 1,
  }));
  await prisma.attempt.createMany({ data: attempts });
  return attempts.map((attempt) => attempt.id);
}

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

  /** The failure this prevents: a sitting the sweep ended losing the answers only its key still held. */
  it('ends an abandoned sitting only once what its key holds has been flushed', async () => {
    const paper = await makePaper(prisma, { questions: ['Reasoning'] });
    const studentId = (await makeStudent(prisma)).id;
    const { id } = await sitPaper(prisma, {
      paper,
      studentId,
      chosen: [null],
      status: ATTEMPT_STATUS.IN_PROGRESS,
      startedAt: new Date(Date.now() - 2 * HOUR_MS),
      submittedAt: null,
    });
    const { sweeper, state, flusher } = build();
    const lastSeen = new Date(Date.now() - 49 * HOUR_MS);
    await state.open(
      await prisma.attempt.findUniqueOrThrow({ where: { id } }),
      undefined,
      lastSeen,
    );
    const answer = {
      questionId: paper.items[0]?.questionId ?? '',
      state: ANSWER_STATE.ANSWERED,
      selectedOptionId: RIGHT_OPTION,
      typedAnswer: null,
      timeSpentSec: 30,
    };
    await state.save(studentId, id, { revision: 1, answers: [answer] }, lastSeen);

    await sweeper.process();
    assert.equal(await ended(), 0, 'its answers are in the key alone, so it waits for the flush');

    await flusher.process();
    await sweeper.process();

    assert.equal(await ended(), 1);
    assert.equal((await servedAnswers(prisma, id))[0]?.selectedOptionId, RIGHT_OPTION);
    assert.equal(await state.read(id), null);
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

  /** The bug this prevents: one student's failed end taking every other lane down with it. */
  it('keeps ending the rest when one in the batch is refused', async () => {
    const count = SWEEP_LANES + 2;
    const [refused] = await stranded(count);
    const { asked, sweeper } = build({ refuse: (id) => id === refused });

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
  it('asks about each stranded sitting once when none of them can be ended', async () => {
    const ids = await stranded(SWEEP_BATCH + 5);
    const { asked, sweeper } = build({ refuse: () => true });

    await sweeper.process();

    assert.deepEqual([...asked].sort(), [...ids].sort(), 'a second read of a row is the loop');
    assert.equal(await ended(), 0);
  });

  /** The failure this prevents: a hall of paused sittings read first by every sweep, hiding the one behind them. */
  it('looks past a full batch of paused sittings to the stranded one behind them', async () => {
    const paused = await stranded(SWEEP_BATCH + 1);
    const [keyless = ''] = await stranded(1, HOUR_MS / 2);
    const { asked, sweeper, state } = build();
    for (const attempt of await prisma.attempt.findMany({ where: { id: { in: paused } } })) {
      await state.open(attempt, 'tab-1');
    }

    await sweeper.process();

    assert.deepEqual(asked, [keyless], 'none of the paused ones, and the one with no key');
    assert.equal(await ended(), 1);
  });
});

describe('AttemptSweeperProcessor — time given between the list and the end', () => {
  /** The failure this prevents: "Time added." on a sitting the sweep had already listed, and then ended. */
  it('leaves a sitting extended after it was listed, key and all, until that deadline passes too', async () => {
    const [attemptId = ''] = await stranded(1);
    const hooks: Hooks = {};
    const { sweeper, state, support, scoring } = build(hooks);
    const row = () => prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    // Last seen past the limit: abandoned, so the sweep lists it and goes on to end it.
    await state.open(await row(), undefined, new Date(Date.now() - 49 * HOUR_MS));
    hooks.beforeClaim = async () => {
      await support.extend(attemptId, { minutes: 10, reason: 'The hall lost power' });
    };

    await sweeper.process();

    assert.equal((await row()).status, ATTEMPT_STATUS.IN_PROGRESS);
    assert.ok(await state.read(attemptId), 'the key it is answered through is still there');
    assert.equal(scoring.jobs.length, 0, 'and nobody is asked to mark it');

    await prisma.attempt.update({
      where: { id: attemptId },
      data: { endsAt: new Date(Date.now() - HOUR_MS) },
    });
    await sweeper.process();

    assert.equal((await row()).status, ATTEMPT_STATUS.SUBMITTED);
    assert.equal(await state.read(attemptId), null);
    assert.deepEqual(
      scoring.jobs.map((job) => job.jobId),
      [scoringJobId(attemptId)],
    );
  });
});

describe('AttemptSweeperProcessor — asking again for the never-scored', () => {
  /** The gap this closes: a backlog of a handful sat invisible behind a queue depth of zero. */
  it('asks again for the whole backlog when it fits in one sweep, and reports it on the gauge', async () => {
    const ids = await unscored(3);
    const { sweeper, scoring, metrics } = build();

    await sweeper.process();

    assert.deepEqual(
      scoring.jobs.map((job) => (job.data as { attemptId: string }).attemptId).sort(),
      [...ids].sort(),
    );
    assert.deepEqual(metrics.scoringBacklog, [3]);
  });

  /** The failure this prevents: a fixed 100-a-sweep cap taking a 6,000-row backlog two hours to drain. */
  it('bounds one sweep to the ceiling, not the whole backlog, but reports the true size', async () => {
    const count = NEVER_SCORED_BATCH_CEILING + 5;
    await unscored(count);
    const { sweeper, scoring, metrics } = build();

    await sweeper.process();

    assert.equal(scoring.jobs.length, NEVER_SCORED_BATCH_CEILING);
    assert.deepEqual(metrics.scoringBacklog, [count]);
  });
});

/** `count` sittings marked against revision 0 of a test a drop has since moved to revision 1. */
async function markedBeforeADrop(count: number): Promise<string[]> {
  const test = await makeTest(prisma, await makeCatalog(prisma));
  await prisma.test.update({ where: { id: test.id }, data: { paperRevision: 1 } });
  const students = Array.from({ length: count }, () => uid());
  await prisma.student.createMany({
    data: students.map((id) => ({ id, mobile: uid(), studentType: STUDENT_TYPE.ONLINE })),
  });
  const submittedAt = new Date(Date.now() - HOUR_MS);
  const attempts = students.map((studentId) => ({
    id: uid(),
    testId: test.id,
    studentId,
    status: ATTEMPT_STATUS.EVALUATED,
    startedAt: new Date(submittedAt.getTime() - HOUR_MS),
    endsAt: submittedAt,
    submittedAt,
    evaluatedAt: submittedAt,
    score: 1,
    scoredRevision: 0,
    shuffleSeed: 1,
  }));
  await prisma.attempt.createMany({ data: attempts });
  return attempts.map((attempt) => attempt.id);
}

describe('AttemptSweeperProcessor — asking for the sittings a drop left behind', () => {
  /** The failure this prevents: one capped read a sweep, so a 6,000 hall took six sweeps to queue. */
  it('asks for every one in a single sweep, however many pages they fill', async () => {
    const ids = await markedBeforeADrop(RESCORE_PAGE + 5);
    const { sweeper, scoring } = build();

    await sweeper.process();

    assert.deepEqual(
      scoring.jobs.map((job) => job.jobId).sort(),
      ids.map((id) => rescoreJobId(id, 1)).sort(),
    );
  });
});

describe('AttemptSweeperProcessor — two clocks for an unscored sitting', () => {
  /** A minute unscored is queued again, since its own add may have been lost, but is no backlog yet. */
  it('queues one ended a minute ago again without calling it a backlog', async () => {
    const [id] = await unscored(1);
    await prisma.attempt.update({
      where: { id },
      data: { submittedAt: new Date(Date.now() - 60 * 1000) },
    });
    const { sweeper, scoring, metrics } = build();

    await sweeper.process();

    assert.equal(scoring.jobs.length, 1);
    assert.deepEqual(metrics.scoringBacklog, [0]);
  });
});

describe('AttemptSweeperProcessor — the clock the cohort counting runs on', () => {
  /** Nothing else asks any more: a first evaluation counts its own student and waits for this. */
  it('asks for a cohort counting pass on every sweep', async () => {
    const { sweeper, rollupQueue } = build();

    await sweeper.process();

    const job = rollupQueue.jobs.find((queued) => queued.name === ROLLUP_JOBS.SWEEP_COHORTS);
    assert.ok(job, 'the sweep asks for a cohort pass');
    assert.equal(job?.jobId, COHORT_SWEEP_JOB_ID);
  });
});
