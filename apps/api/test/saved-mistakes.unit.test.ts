import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ATTEMPT_STATUS, SAVED_QUESTION_KIND } from '@iace/contracts';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { RollupService } from '../src/attempts/rollup.service';
import { ROLLUP_JOBS } from '../src/queue/queues';
import {
  FakeEventBus,
  FakeQueue,
  FakeRollupPrisma,
  fakeNotificationOutbox,
  fakeRollupOutbox,
  makeAttempt,
  makeRollupTest,
  makeServedAnswer,
  mcqOptions,
  type FakeServedAnswerRow,
} from './support/fakes';

const RIGHT = 'o1';
const WRONG = 'o2';

/** Four questions on one paper, so one answer of each kind can be chosen per case. */
function paper(attemptId: string, chosen: readonly (string | null)[]): FakeServedAnswerRow[] {
  return chosen.map((selectedOptionId, index) =>
    makeServedAnswer({
      attemptId,
      questionId: `q${index + 1}`,
      paperQuestionId: `pq${index + 1}`,
      subjectId: 'sub_reasoning',
      subjectName: 'Reasoning',
      order: index + 1,
      options: mcqOptions(1),
      selectedOptionId,
      timeSpentSec: 30,
    }),
  );
}

function world(chosen: readonly (string | null)[]) {
  const attempt = makeAttempt({
    id: 'att_1',
    status: ATTEMPT_STATUS.SUBMITTED,
    submittedAt: new Date('2026-09-09T05:00:00.000Z'),
  });
  const prisma = new FakeRollupPrisma([attempt], paper('att_1', chosen), [makeRollupTest()]);
  const queue = new FakeQueue();
  const outbox = fakeRollupOutbox(prisma, queue);
  const scoring = new ScoringProcessor(
    prisma.asService(),
    outbox,
    new FakeEventBus().asService(),
    fakeNotificationOutbox(),
  );

  return { prisma, queue, scoring, rollup: new RollupService(prisma.asService()) };
}

type World = ReturnType<typeof world>;

/** Everything one submitted sitting goes through: scored, handed on, and folded by the worker. */
async function counted(built: World): Promise<void> {
  await built.scoring.score('att_1');
  for (const job of built.queue.jobs.splice(0)) {
    const data = job.data as { attemptId?: string };
    if (job.name === ROLLUP_JOBS.FOLD && data.attemptId !== undefined) {
      await built.rollup.fold(data.attemptId);
    }
  }
}

const mistakes = (built: World) =>
  built.prisma.savedQuestions.filter((row) => row.kind === SAVED_QUESTION_KIND.MISTAKE);

describe('the fold collects a sitting’s mistakes', () => {
  it('saves a question they chose the wrong answer to', async () => {
    const built = world([RIGHT, WRONG, WRONG, RIGHT]);

    await counted(built);

    assert.deepEqual(
      mistakes(built).map((row) => row.questionId),
      ['q2', 'q3'],
    );
    assert.equal(mistakes(built)[0]?.attemptId, 'att_1');
    assert.equal(mistakes(built)[0]?.paperQuestionId, 'pq2');
  });

  /** A mistake is a chosen wrong answer. One left blank is a finishing problem, not a knowledge gap. */
  it('leaves a skipped question off the list', async () => {
    const built = world([RIGHT, null, WRONG, null]);

    await counted(built);

    assert.deepEqual(
      mistakes(built).map((row) => row.questionId),
      ['q3'],
    );
  });

  it('writes nothing when every answer was right', async () => {
    const built = world([RIGHT, RIGHT, RIGHT, RIGHT]);

    await counted(built);

    assert.equal(mistakes(built).length, 0);
  });

  /** A re-score of a dropped question replays the fold; the unique guard is what stops a second row. */
  it('counts a question once however many times the fold runs', async () => {
    const built = world([RIGHT, WRONG, WRONG, RIGHT]);

    await counted(built);
    await built.rollup.fold('att_1');
    await built.rollup.rebuildStudent('stu_1');

    assert.equal(mistakes(built).length, 2);
  });
});
