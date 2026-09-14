import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  type AnswerChange,
  type AttemptStatus,
} from '@iace/contracts';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { AttemptSweeperProcessor } from '../src/attempts/attempt-sweeper.processor';
import { RollupOutbox } from '../src/attempts/rollup-outbox';
import { SCORING_REQUEST, ScoringOutbox } from '../src/attempts/scoring-outbox';
import { SubmitService } from '../src/attempts/submit.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { QUEUE_NAMES, scoringJobId } from '../src/queue/queues';
import { FakeMetrics, FakeQueue, FakeRedis, fakeQueueFailures } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makePaper,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
  uid,
} from './support/database';

const NOW = new Date('2026-09-01T05:00:00.000Z');
const ENDS_AT = new Date('2026-09-01T05:30:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const LATE = new Date(Date.now() - HOUR_MS);
const SETTLED = new Date(Date.now() - HOUR_MS);

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

interface Hooks {
  /** Runs before the batched flush lands; throwing refuses the write. */
  beforeFlush?: () => Promise<void>;
  /** Runs inside the claim's transaction, just before the UPDATE that ends the sitting. */
  beforeClaim?: () => Promise<void>;
}

/** The real client, with submit's batched flush and its claim each open to a hook. */
function hooked(hooks: Hooks): PrismaService {
  return new Proxy(prisma, {
    get(target, key: string | symbol) {
      if (key !== '$transaction') return Reflect.get(target, key) as unknown;
      return async (work: unknown) => {
        if (Array.isArray(work)) {
          await hooks.beforeFlush?.();
          return target.$transaction(work as Prisma.PrismaPromise<unknown>[]);
        }
        const inTx = work as (tx: Prisma.TransactionClient) => Promise<unknown>;
        return target.$transaction((tx) =>
          inTx(
            new Proxy(tx, {
              get(inner, model: string | symbol) {
                if (model !== 'attempt') return Reflect.get(inner, model) as unknown;
                return {
                  updateMany: async (args: Prisma.AttemptUpdateManyArgs) => {
                    await hooks.beforeClaim?.();
                    return inner.attempt.updateMany(args);
                  },
                };
              },
            }),
          ),
        );
      };
    },
  });
}

async function build(over: { endsAt?: Date; status?: AttemptStatus; submittedAt?: Date } = {}) {
  const paper = await makePaper(prisma, { questions: ['Reasoning', 'Reasoning'] });
  const student = (await makeStudent(prisma)).id;
  const endsAt = over.endsAt ?? ENDS_AT;
  const attempt = await sitPaper(prisma, {
    paper,
    studentId: student,
    chosen: [null, null],
    timeSpent: [0, 0],
    status: over.status ?? ATTEMPT_STATUS.IN_PROGRESS,
    startedAt: new Date(endsAt.getTime() - HOUR_MS),
    submittedAt: over.submittedAt ?? null,
  });
  const [q1 = '', q2 = ''] = paper.items.map((item) => item.questionId);
  const hooks: Hooks = {};
  const client = hooked(hooks);
  const redis = new FakeRedis();
  const state = new AttemptStateService(prisma, redis.asService());
  const queue = new FakeQueue();
  const busts: string[] = [];
  const access = {
    invalidateStudent: (studentId: string) => {
      busts.push(studentId);
      return Promise.resolve();
    },
  } as never;
  const outbox = new ScoringOutbox(prisma, queue.asQueue());
  const submit = new SubmitService(client, state, access, outbox, new FakeMetrics().asService());
  const change = (questionId = q1): AnswerChange => ({
    questionId,
    state: ANSWER_STATE.ANSWERED,
    selectedOptionId: RIGHT_OPTION,
    typedAnswer: null,
    timeSpentSec: 30,
  });
  return {
    attemptId: attempt.id,
    testId: paper.testId,
    student,
    q1,
    q2,
    hooks,
    state,
    queue,
    busts,
    outbox,
    submit,
    change,
    live: { id: attempt.id, studentId: student, endsAt },
    sweeper: new AttemptSweeperProcessor(
      prisma,
      submit,
      outbox,
      new RollupOutbox(new FakeQueue().asQueue()),
      fakeQueueFailures(),
    ),
  };
}

type Built = Awaited<ReturnType<typeof build>>;

const answered = async ({ state, live, student, attemptId, change }: Built) => {
  await state.open(live);
  await state.save(student, attemptId, { revision: 1, answers: [change()] }, NOW);
};

const attemptRow = (id: string) => prisma.attempt.findUniqueOrThrow({ where: { id } });

const chosenOn = async (attemptId: string, questionId: string) =>
  (
    await prisma.attemptQuestion.findUniqueOrThrow({
      where: { attemptId_questionId: { attemptId, questionId } },
    })
  ).selectedOptionId;

const requests = () => prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });

/** Ages every request past the relay's grace, as a sweep minutes later would find them. */
const settle = () => prisma.outboxEvent.updateMany({ data: { createdAt: SETTLED } });

describe('SubmitService', () => {
  it('writes what Redis held, ends the sitting, and enqueues one scoring job', async () => {
    const built = await build();
    await answered(built);

    const result = await built.submit.submit(built.student, built.attemptId);

    assert.equal(result.submittedByThisCall, true);
    assert.equal(result.status, ATTEMPT_STATUS.SUBMITTED);
    assert.equal(result.answeredCount, 1);
    assert.equal(await chosenOn(built.attemptId, built.q1), RIGHT_OPTION);
    assert.equal((await attemptRow(built.attemptId)).status, ATTEMPT_STATUS.SUBMITTED);
    const [request] = await requests();
    assert.deepEqual(built.queue.jobs, [
      {
        name: QUEUE_NAMES.SCORING,
        data: { attemptId: built.attemptId, testId: built.testId },
        jobId: scoringJobId(request?.id ?? ''),
        // The key only holds while nothing is kept under it: a retained failure swallows the retry.
        removeOnFail: true,
      },
    ]);
  });

  /** The catalog caches where the student got to, so a submitted test must leave the Open tab. */
  it('busts the student catalog exactly once', async () => {
    const built = await build();
    await answered(built);

    await built.submit.submit(built.student, built.attemptId);
    await built.submit.submit(built.student, built.attemptId);

    assert.deepEqual(built.busts, [built.student]);
  });

  /** The failure this prevents: a double-click scoring one sitting twice. */
  it('reports the first outcome on a second submit, and enqueues nothing more', async () => {
    const built = await build();
    await answered(built);

    const first = await built.submit.submit(built.student, built.attemptId);
    const second = await built.submit.submit(built.student, built.attemptId);

    assert.equal(second.submittedByThisCall, false);
    assert.equal(second.submittedAt, first.submittedAt);
    assert.equal(built.queue.jobs.length, 1);
  });

  /** Taking the state shuts the door: nothing can be saved into a sitting that has ended. */
  it('leaves no live state behind, so a later save is refused', async () => {
    const built = await build();
    await answered(built);

    await built.submit.submit(built.student, built.attemptId);

    assert.equal(await built.state.read(built.attemptId), null);
    await assert.rejects(
      () =>
        built.state.save(
          built.student,
          built.attemptId,
          { revision: 9, answers: [built.change()] },
          NOW,
        ),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT,
    );
  });

  it('submits an empty paper for a student who answered nothing', async () => {
    const built = await build();
    await built.state.open(built.live);

    const result = await built.submit.submit(built.student, built.attemptId);

    assert.equal(result.answeredCount, 0);
    assert.equal((await attemptRow(built.attemptId)).status, ATTEMPT_STATUS.SUBMITTED);
  });

  /** The failure this prevents: a database error losing the answers AND ending the sitting. */
  it('keeps the live state and the sitting open when the write fails', async () => {
    const built = await build();
    await answered(built);
    built.hooks.beforeFlush = () => Promise.reject(new Error('write refused'));

    await assert.rejects(() => built.submit.submit(built.student, built.attemptId));

    assert.ok(
      await built.state.read(built.attemptId),
      'the answers must survive to be written again',
    );
    assert.equal((await attemptRow(built.attemptId)).status, ATTEMPT_STATUS.IN_PROGRESS);
    assert.equal(await chosenOn(built.attemptId, built.q1), null);
    assert.equal(await prisma.outboxEvent.count(), 0);

    delete built.hooks.beforeFlush;
    const result = await built.submit.submit(built.student, built.attemptId);

    assert.equal(result.answeredCount, 1);
    assert.equal(await chosenOn(built.attemptId, built.q1), RIGHT_OPTION);
  });

  it('refuses another student with NOT_FOUND, not FORBIDDEN', async () => {
    const built = await build();
    await answered(built);

    await assert.rejects(
      () => built.submit.submit(uid('student'), built.attemptId),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

describe('AttemptSweeperProcessor', () => {
  it('ends a sitting whose clock ran out, and has nothing to do twice over', async () => {
    const built = await build({ endsAt: LATE });
    await built.state.open(built.live);

    await built.sweeper.process();
    await built.sweeper.process();

    assert.equal((await attemptRow(built.attemptId)).status, ATTEMPT_STATUS.SUBMITTED);
    assert.equal(built.queue.jobs.length, 1);
  });

  /** The grace a save gets is the grace the sweeper gives: it must not end one still reachable. */
  it('leaves a sitting still inside its clock alone', async () => {
    const built = await build({ endsAt: new Date(Date.now() + HOUR_MS) });

    await built.sweeper.process();

    assert.equal((await attemptRow(built.attemptId)).status, ATTEMPT_STATUS.IN_PROGRESS);
  });

  /** The failure this prevents: a sweep and a student's own submit both scoring the same sitting. */
  it('produces one submission when it races a manual submit', async () => {
    const built = await build({ endsAt: LATE });
    await built.state.open(built.live);

    await Promise.all([
      built.sweeper.process(),
      built.submit.submit(built.student, built.attemptId),
    ]);

    assert.equal((await attemptRow(built.attemptId)).status, ATTEMPT_STATUS.SUBMITTED);
    assert.equal(await prisma.outboxEvent.count(), 1);
    assert.equal(built.queue.jobs.length, 1);
  });
});

describe('the scoring outbox', () => {
  /** The failure this prevents: a crash between the commit and the queue, scored by nobody. */
  it('hands on a request the queue never took, exactly once', async () => {
    const built = await build();
    await answered(built);
    built.queue.failNext = true;

    const result = await built.submit.submit(built.student, built.attemptId);

    // The student's submit stands: the request is durable whether or not the queue was reachable.
    assert.equal(result.submittedByThisCall, true);
    assert.equal(built.queue.jobs.length, 0);
    assert.equal((await requests())[0]?.processedAt, null);

    await settle();
    await built.sweeper.process();
    await built.sweeper.process();

    const [request] = await requests();
    assert.equal(built.queue.jobs.length, 1);
    assert.equal(built.queue.jobs[0]?.jobId, scoringJobId(request?.id ?? ''));
    assert.ok(request?.processedAt);
  });

  it('does not ask again for a score it has already asked for', async () => {
    const built = await build();
    await answered(built);

    await built.submit.submit(built.student, built.attemptId);
    await settle();
    await built.sweeper.process();

    assert.equal(built.queue.jobs.length, 1);
  });

  /** The failure this prevents: 200 a sweep, so a queue outage takes 40 minutes to drain. */
  it('drains a backlog bigger than one batch in a single pass', async () => {
    const { queue, outbox } = await build();
    await prisma.outboxEvent.createMany({
      data: Array.from({ length: 250 }, (_, n) => ({
        aggregateType: SCORING_REQUEST.AGGREGATE_TYPE,
        aggregateId: `att_${n}`,
        eventType: SCORING_REQUEST.EVENT_TYPE,
        payload: { testId: 'tst_1' },
        createdAt: SETTLED,
      })),
    });

    assert.equal(await outbox.relay(), 250);
    assert.equal(queue.jobs.length, 250);
  });

  /** The job id is what lets BullMQ collapse two hand-offs; deriving it here is our half. */
  it('names every hand-off after the request it carries', async () => {
    const built = await build();
    await answered(built);
    await built.submit.submit(built.student, built.attemptId);
    built.queue.jobs.length = 0;
    // Back in flight, as a crash between the queue and the mark would leave it.
    await prisma.outboxEvent.updateMany({ data: { processedAt: null, createdAt: SETTLED } });

    await Promise.all([built.outbox.relay(), built.outbox.relay()]);

    const [request] = await requests();
    assert.deepEqual(
      new Set(built.queue.jobs.map((job) => job.jobId)),
      new Set([scoringJobId(request?.id ?? '')]),
    );
  });

  /** The failure this prevents: one unusable row at the head starving every request behind it. */
  it('gives up on a request nothing can act on rather than blocking the queue behind it', async () => {
    const { queue, outbox } = await build();
    await prisma.outboxEvent.create({
      data: {
        aggregateType: SCORING_REQUEST.AGGREGATE_TYPE,
        aggregateId: 'att_broken',
        eventType: SCORING_REQUEST.EVENT_TYPE,
        payload: {},
        createdAt: SETTLED,
      },
    });

    await outbox.relay();
    await outbox.relay();

    assert.equal(queue.jobs.length, 0);
    assert.ok((await requests())[0]?.processedAt, 'it must not come back every sweep forever');
  });
});

describe('a save that races the submit', () => {
  /** The failure this prevents: an autosave accepted with a 200 and then thrown away by the take. */
  it('writes an answer that landed while the claim was in flight', async () => {
    const built = await build();
    await answered(built);
    built.hooks.beforeClaim = async () => {
      delete built.hooks.beforeClaim;
      // The student's last answer lands between the read and the take, as an autosave would.
      await built.state.save(
        built.student,
        built.attemptId,
        { revision: 2, answers: [built.change(built.q2)] },
        NOW,
      );
    };

    const result = await built.submit.submit(built.student, built.attemptId);

    assert.equal(result.answeredCount, 2);
    assert.equal(await chosenOn(built.attemptId, built.q2), RIGHT_OPTION);
  });

  /** The failure this prevents: the one caller that can still write those answers dropping them. */
  it('writes the live state it finds behind an attempt that has already ended', async () => {
    const built = await build();
    await answered(built);
    await prisma.attempt.update({
      where: { id: built.attemptId },
      data: { status: ATTEMPT_STATUS.SUBMITTED, submittedAt: NOW },
    });

    const result = await built.submit.submit(built.student, built.attemptId);

    assert.equal(result.submittedByThisCall, false);
    assert.equal(result.answeredCount, 1);
    assert.equal(await chosenOn(built.attemptId, built.q1), RIGHT_OPTION);
    // A key outliving its sitting would go on accepting saves for the whole 12h TTL.
    assert.equal(await built.state.read(built.attemptId), null);
  });
});

describe('a sitting the scorer never scored', () => {
  const unscored = () => build({ status: ATTEMPT_STATUS.SUBMITTED, submittedAt: LATE });

  const asked = (attemptId: string, testId: string, processedAt: Date | null) =>
    prisma.outboxEvent.create({
      data: {
        aggregateType: SCORING_REQUEST.AGGREGATE_TYPE,
        aggregateId: attemptId,
        eventType: SCORING_REQUEST.EVENT_TYPE,
        payload: { testId },
        processedAt,
      },
    });

  /** The failure this prevents: a job that exhausted its retries leaving a result nobody owns. */
  it('asks for a score again once the request it made has been handed on and lost', async () => {
    const { attemptId, testId, sweeper } = await unscored();
    await asked(attemptId, testId, LATE);

    await sweeper.process();

    const rows = await requests();
    assert.equal(rows.length, 2);
    assert.equal(rows[1]?.aggregateId, attemptId);
  });

  it('does not stack a second ask on top of one still waiting to be handed on', async () => {
    const { attemptId, testId, sweeper } = await unscored();
    await asked(attemptId, testId, null);

    await sweeper.process();

    assert.equal(await prisma.outboxEvent.count(), 1);
  });

  it('leaves a scored sitting alone, and one that has only just ended', async () => {
    const { attemptId, sweeper } = await build({
      status: ATTEMPT_STATUS.SUBMITTED,
      submittedAt: new Date(),
    });

    await sweeper.process();
    await prisma.attempt.update({
      where: { id: attemptId },
      data: { submittedAt: LATE, score: 0 },
    });
    await sweeper.process();

    assert.equal(await prisma.outboxEvent.count(), 0);
  });
});
