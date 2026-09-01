import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_STATE,
  AppException,
  ATTEMPT_STATUS,
  ErrorCodes,
  type AnswerChange,
  type AttemptStatus,
} from '@iace/contracts';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { AttemptSweeperProcessor } from '../src/attempts/attempt-sweeper.processor';
import { ScoringOutbox, SCORING_REQUEST } from '../src/attempts/scoring-outbox';
import { SubmitService } from '../src/attempts/submit.service';
import { QUEUE_NAMES, scoringJobId } from '../src/queue/queues';
import {
  FakeQueue,
  fakeRollupOutbox,
  FakeRedis,
  FakeTestsPrisma,
  makeAttempt,
  makeBaseConfig,
  makeSection,
  makeTest,
} from './support/fakes';

const NOW = new Date('2026-09-01T05:00:00.000Z');
const ENDS_AT = new Date('2026-09-01T05:30:00.000Z');

const change = (over: Partial<AnswerChange> = {}): AnswerChange => ({
  questionId: 'q1',
  state: ANSWER_STATE.ANSWERED,
  selectedOptionId: 'opt_a',
  typedAnswer: null,
  timeSpentSec: 30,
  ...over,
});

function build(over: { endsAt?: Date; status?: AttemptStatus } = {}) {
  const prisma = new FakeTestsPrisma(
    [makeTest({ id: 'tst_1' })],
    [makeBaseConfig({ id: 'cfg_1' })],
    [makeSection({ id: 'sec_1', baseConfigId: 'cfg_1' })],
    [],
    [],
    [],
    [],
    [],
    [
      makeAttempt({
        id: 'att_1',
        studentId: 'stu_1',
        testId: 'tst_1',
        endsAt: over.endsAt ?? ENDS_AT,
        status: over.status ?? ATTEMPT_STATUS.IN_PROGRESS,
      }),
    ],
    ['q1', 'q2'].map((questionId, index) => ({
      attemptId: 'att_1',
      questionId,
      paperQuestionId: `pq_${index + 1}`,
      questionVersionId: `${questionId}_v1`,
      baseConfigSectionId: 'sec_1',
      order: index + 1,
      state: ANSWER_STATE.NOT_VISITED,
      selectedOptionId: null,
      typedAnswer: null,
      timeSpentSec: 0,
    })),
  );
  const redis = new FakeRedis();
  const state = new AttemptStateService(prisma.asService(), redis.asService());
  const queue = new FakeQueue();
  const busts: string[] = [];
  const access = {
    invalidateStudent: (studentId: string) => {
      busts.push(studentId);
      return Promise.resolve();
    },
  } as never;
  const outbox = new ScoringOutbox(prisma.asService(), queue.asQueue());
  const submit = new SubmitService(prisma.asService(), state, access, outbox);
  return {
    prisma,
    state,
    queue,
    busts,
    outbox,
    submit,
    sweeper: new AttemptSweeperProcessor(
      prisma.asService(),
      submit,
      outbox,
      fakeRollupOutbox(prisma, new FakeQueue()),
    ),
  };
}

/** The database refusing the very write submit is in the middle of. Returns the repair. */
function breakTheWrite(prisma: FakeTestsPrisma): () => void {
  const real = prisma.attemptQuestion.updateMany;
  prisma.attemptQuestion.updateMany = () => Promise.reject(new Error('write refused'));
  return () => {
    prisma.attemptQuestion.updateMany = real;
  };
}

const answered = async (state: AttemptStateService) => {
  await state.open({ id: 'att_1', studentId: 'stu_1', endsAt: ENDS_AT });
  await state.save('stu_1', 'att_1', { revision: 1, answers: [change()] }, NOW);
};

describe('SubmitService', () => {
  it('writes what Redis held, ends the sitting, and enqueues one scoring job', async () => {
    const { submit, state, prisma, queue } = build();
    await answered(state);

    const result = await submit.submit('stu_1', 'att_1');

    assert.equal(result.submittedByThisCall, true);
    assert.equal(result.status, ATTEMPT_STATUS.SUBMITTED);
    assert.equal(result.answeredCount, 1);
    assert.equal(prisma.attemptQuestions[0]?.selectedOptionId, 'opt_a');
    assert.equal(prisma.attemptRows[0]?.status, ATTEMPT_STATUS.SUBMITTED);
    assert.deepEqual(queue.jobs, [
      {
        name: QUEUE_NAMES.SCORING,
        data: { attemptId: 'att_1', testId: 'tst_1' },
        jobId: scoringJobId('obx_1'),
      },
    ]);
  });

  /** The catalog caches where the student got to, so a submitted test must leave the Open tab. */
  it('busts the student catalog exactly once', async () => {
    const { submit, state, busts } = build();
    await answered(state);

    await submit.submit('stu_1', 'att_1');
    await submit.submit('stu_1', 'att_1');

    assert.deepEqual(busts, ['stu_1']);
  });

  /** The failure this prevents: a double-click scoring one sitting twice. */
  it('reports the first outcome on a second submit, and enqueues nothing more', async () => {
    const { submit, state, queue } = build();
    await answered(state);

    const first = await submit.submit('stu_1', 'att_1');
    const second = await submit.submit('stu_1', 'att_1');

    assert.equal(second.submittedByThisCall, false);
    assert.equal(second.submittedAt, first.submittedAt);
    assert.equal(queue.jobs.length, 1);
  });

  /** Taking the state shuts the door: nothing can be saved into a sitting that has ended. */
  it('leaves no live state behind, so a later save is refused', async () => {
    const { submit, state } = build();
    await answered(state);

    await submit.submit('stu_1', 'att_1');

    assert.equal(await state.read('att_1'), null);
    const error = await state
      .save('stu_1', 'att_1', { revision: 9, answers: [change()] }, NOW)
      .catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
  });

  it('submits an empty paper for a student who answered nothing', async () => {
    const { submit, state, prisma } = build();
    await state.open({ id: 'att_1', studentId: 'stu_1', endsAt: ENDS_AT });

    const result = await submit.submit('stu_1', 'att_1');

    assert.equal(result.answeredCount, 0);
    assert.equal(prisma.attemptRows[0]?.status, ATTEMPT_STATUS.SUBMITTED);
  });

  /** The failure this prevents: a database error losing the answers AND ending the sitting. */
  it('keeps the live state and the sitting open when the write fails', async () => {
    const { submit, state, prisma } = build();
    await answered(state);
    const repair = breakTheWrite(prisma);

    await assert.rejects(() => submit.submit('stu_1', 'att_1'));

    assert.ok(await state.read('att_1'), 'the answers must survive to be written again');
    assert.equal(prisma.attemptRows[0]?.status, ATTEMPT_STATUS.IN_PROGRESS);
    assert.equal(prisma.attemptQuestions[0]?.selectedOptionId, null);
    assert.equal(prisma.outboxEvents.length, 0);

    repair();
    const result = await submit.submit('stu_1', 'att_1');

    assert.equal(result.answeredCount, 1);
    assert.equal(prisma.attemptQuestions[0]?.selectedOptionId, 'opt_a');
  });

  it('refuses another student with NOT_FOUND, not FORBIDDEN', async () => {
    const { submit, state } = build();
    await answered(state);

    const error = await submit.submit('stu_2', 'att_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });
});

describe('AttemptSweeperProcessor', () => {
  const LATE = new Date(Date.now() - 60 * 60 * 1000);

  it('ends a sitting whose clock ran out', async () => {
    const { sweeper, state, prisma, queue } = build({ endsAt: LATE });
    await state.open({ id: 'att_1', studentId: 'stu_1', endsAt: LATE });

    await sweeper.process();

    assert.equal(prisma.attemptRows[0]?.status, ATTEMPT_STATUS.SUBMITTED);
    assert.equal(queue.jobs.length, 1);
  });

  /** The grace a save gets is the grace the sweeper gives: it must not end one still reachable. */
  it('leaves a sitting still inside its clock alone', async () => {
    const { sweeper, prisma } = build({ endsAt: new Date(Date.now() + 60 * 60 * 1000) });

    await sweeper.process();

    assert.equal(prisma.attemptRows[0]?.status, ATTEMPT_STATUS.IN_PROGRESS);
  });

  /** The failure this prevents: a sweep and a student's own submit both scoring the same sitting. */
  it('produces one submission when it races a manual submit', async () => {
    const { sweeper, submit, state, queue, prisma } = build({ endsAt: LATE });
    await state.open({ id: 'att_1', studentId: 'stu_1', endsAt: LATE });

    await Promise.all([sweeper.process(), submit.submit('stu_1', 'att_1')]);

    assert.equal(prisma.attemptRows[0]?.status, ATTEMPT_STATUS.SUBMITTED);
    assert.equal(queue.jobs.length, 1);
  });

  it('has nothing to do twice over', async () => {
    const { sweeper, state, queue } = build({ endsAt: LATE });
    await state.open({ id: 'att_1', studentId: 'stu_1', endsAt: LATE });

    await sweeper.process();
    await sweeper.process();

    assert.equal(queue.jobs.length, 1);
  });
});

describe('the scoring outbox', () => {
  /** The failure this prevents: a crash between the commit and the queue, scored by nobody. */
  it('hands on a request the queue never took, exactly once', async () => {
    const { submit, state, prisma, queue, sweeper } = build();
    await answered(state);
    queue.failNext = true;

    const result = await submit.submit('stu_1', 'att_1');

    // The student's submit stands: the request is durable whether or not the queue was reachable.
    assert.equal(result.submittedByThisCall, true);
    assert.equal(queue.jobs.length, 0);
    assert.equal(prisma.outboxEvents[0]?.processedAt, null);

    await sweeper.process();
    await sweeper.process();

    assert.equal(queue.jobs.length, 1);
    assert.equal(queue.jobs[0]?.jobId, scoringJobId('obx_1'));
    assert.ok(prisma.outboxEvents[0]?.processedAt);
  });

  it('does not ask again for a score it has already asked for', async () => {
    const { submit, state, queue, sweeper } = build();
    await answered(state);

    await submit.submit('stu_1', 'att_1');
    await sweeper.process();

    assert.equal(queue.jobs.length, 1);
  });
});

describe('a save that races the submit', () => {
  /** The failure this prevents: an autosave accepted with a 200 and then thrown away by the take. */
  it('writes an answer that landed while the claim was in flight', async () => {
    const { submit, state, prisma } = build();
    await answered(state);
    const claim = prisma.attempt.updateMany;
    prisma.attempt.updateMany = async (args) => {
      // The student's last answer lands between the read and the take, as an autosave would.
      await state.save(
        'stu_1',
        'att_1',
        { revision: 2, answers: [change({ questionId: 'q2' })] },
        NOW,
      );
      return claim(args);
    };

    const result = await submit.submit('stu_1', 'att_1');

    assert.equal(result.answeredCount, 2);
    const q2 = prisma.attemptQuestions.find((row) => row.questionId === 'q2');
    assert.equal(q2?.selectedOptionId, 'opt_a');
  });

  /** The failure this prevents: the one caller that can still write those answers dropping them. */
  it('writes the live state it finds behind an attempt that has already ended', async () => {
    const { submit, state, prisma } = build();
    await answered(state);
    prisma.attemptRows[0]!.status = ATTEMPT_STATUS.SUBMITTED;
    prisma.attemptRows[0]!.submittedAt = NOW;

    const result = await submit.submit('stu_1', 'att_1');

    assert.equal(result.submittedByThisCall, false);
    assert.equal(result.answeredCount, 1);
    assert.equal(prisma.attemptQuestions[0]?.selectedOptionId, 'opt_a');
    // A key outliving its sitting would go on accepting saves for the whole 12h TTL.
    assert.equal(await state.read('att_1'), null);
  });
});

describe('the scoring relay', () => {
  /** The failure this prevents: 200 a sweep, so a queue outage takes 40 minutes to drain. */
  it('drains a backlog bigger than one batch in a single pass', async () => {
    const { prisma, queue, outbox } = build();
    for (let n = 0; n < 250; n += 1) {
      await prisma.outboxEvent.create({
        data: {
          aggregateType: SCORING_REQUEST.AGGREGATE_TYPE,
          aggregateId: `att_${n}`,
          eventType: SCORING_REQUEST.EVENT_TYPE,
          payload: { testId: 'tst_1' },
        },
      });
    }

    const handed = await outbox.relay();

    assert.equal(handed, 250);
    assert.equal(queue.jobs.length, 250);
  });

  /** The job id is what lets BullMQ collapse two hand-offs; deriving it here is our half. */
  it('names every hand-off after the request it carries', async () => {
    const { submit, state, queue, outbox } = build();
    await answered(state);
    await submit.submit('stu_1', 'att_1');
    queue.jobs.length = 0;
    prismaReopen(outbox);

    await Promise.all([outbox.relay(), outbox.relay()]);

    assert.deepEqual(new Set(queue.jobs.map((job) => job.jobId)), new Set([scoringJobId('obx_1')]));
  });
});

/** Puts the request back in flight, as a crash between the queue and the mark would leave it. */
function prismaReopen(outbox: ScoringOutbox): void {
  const rows = (outbox as unknown as { prisma: FakeTestsPrisma }).prisma.outboxEvents;
  for (const row of rows) row.processedAt = null;
}

describe('a request nothing can act on', () => {
  /** The failure this prevents: one unusable row at the head starving every request behind it. */
  it('gives up on it rather than blocking the queue behind it', async () => {
    const { prisma, queue, outbox } = build();
    await prisma.outboxEvent.create({
      data: {
        aggregateType: SCORING_REQUEST.AGGREGATE_TYPE,
        aggregateId: 'att_broken',
        eventType: SCORING_REQUEST.EVENT_TYPE,
        payload: {},
      },
    });

    await outbox.relay();
    await outbox.relay();

    assert.equal(queue.jobs.length, 0);
    assert.ok(prisma.outboxEvents[0]?.processedAt, 'it must not come back every sweep forever');
  });
});

describe('a sitting the scorer never scored', () => {
  const LONG_AGO = new Date(Date.now() - 60 * 60 * 1000);

  /** The failure this prevents: a job that exhausted its retries leaving a result nobody owns. */
  it('asks for a score again once the request it made has been handed on and lost', async () => {
    const { prisma, sweeper } = build({ status: ATTEMPT_STATUS.SUBMITTED });
    const attempt = prisma.attemptRows[0]!;
    attempt.submittedAt = LONG_AGO;
    await prisma.outboxEvent.create({
      data: {
        aggregateType: SCORING_REQUEST.AGGREGATE_TYPE,
        aggregateId: attempt.id,
        eventType: SCORING_REQUEST.EVENT_TYPE,
        payload: { testId: attempt.testId },
      },
    });
    await prisma.outboxEvent.update({ where: { id: 'obx_1' }, data: { processedAt: LONG_AGO } });

    await sweeper.process();

    assert.equal(prisma.outboxEvents.length, 2);
    assert.equal(prisma.outboxEvents[1]?.aggregateId, attempt.id);
  });

  it('does not stack a second ask on top of one still waiting to be handed on', async () => {
    const { prisma, sweeper } = build({ status: ATTEMPT_STATUS.SUBMITTED });
    const attempt = prisma.attemptRows[0]!;
    attempt.submittedAt = LONG_AGO;
    await prisma.outboxEvent.create({
      data: {
        aggregateType: SCORING_REQUEST.AGGREGATE_TYPE,
        aggregateId: attempt.id,
        eventType: SCORING_REQUEST.EVENT_TYPE,
        payload: { testId: attempt.testId },
      },
    });

    await sweeper.process();

    assert.equal(prisma.outboxEvents.length, 1);
  });

  it('leaves a scored sitting alone, and one that has only just ended', async () => {
    const { prisma, sweeper } = build({ status: ATTEMPT_STATUS.SUBMITTED });
    const attempt = prisma.attemptRows[0]!;
    attempt.submittedAt = new Date();

    await sweeper.process();
    attempt.submittedAt = LONG_AGO;
    attempt.score = 0;
    await sweeper.process();

    assert.equal(prisma.outboxEvents.length, 0);
  });
});
