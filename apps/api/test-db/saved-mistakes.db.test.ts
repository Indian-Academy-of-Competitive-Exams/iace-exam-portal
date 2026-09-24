import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { SAVED_QUESTION_KIND } from '@iace/contracts';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { RollupService } from '../src/attempts/rollup.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { ROLLUP_JOBS } from '../src/queue/queues';
import { FakeQueue, fakeQueueFailures } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makePaper,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
} from './support/database';

const RIGHT = RIGHT_OPTION;
const WRONG = 'o2';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** Four Reasoning questions on one paper, sat once with the answers chosen. */
async function world(chosen: readonly (string | null)[]) {
  const paper = await makePaper(prisma, {
    questions: ['Reasoning', 'Reasoning', 'Reasoning', 'Reasoning'],
  });
  const student = await makeStudent(prisma);
  const attempt = await sitPaper(prisma, { paper, studentId: student.id, chosen });
  const queue = new FakeQueue();
  const scoring = new ScoringProcessor(
    prisma,
    new RollupQueue(queue.asQueue()),
    new NotificationOutbox(new FakeQueue().asQueue()),
    fakeQueueFailures(),
    new PaperSheetService(prisma),
    new RollupService(prisma),
  );
  return {
    paper,
    studentId: student.id,
    attemptId: attempt.id,
    queue,
    scoring,
    rollup: new RollupService(prisma),
  };
}

type World = Awaited<ReturnType<typeof world>>;

/** Everything one submitted sitting goes through: scored, handed on, and folded by the worker. */
async function counted(built: World): Promise<void> {
  await built.scoring.score(built.attemptId);
  for (const job of built.queue.jobs.splice(0)) {
    if (job.name === ROLLUP_JOBS.SWEEP_COHORTS) await built.rollup.sweepCohorts();
  }
}

/** The mistakes held, as the paper positions they came from. */
async function mistakes(built: World) {
  const rows = await prisma.savedQuestion.findMany({
    where: { studentId: built.studentId, kind: SAVED_QUESTION_KIND.MISTAKE },
  });
  const positionOf = (questionId: string) =>
    built.paper.items.findIndex((item) => item.questionId === questionId) + 1;
  return rows
    .map((row) => ({ ...row, position: positionOf(row.questionId) }))
    .sort((a, b) => a.position - b.position);
}

describe('the fold collects a sitting’s mistakes', () => {
  it('saves a question they chose the wrong answer to', async () => {
    const built = await world([RIGHT, WRONG, WRONG, RIGHT]);

    await counted(built);

    const held = await mistakes(built);
    assert.deepEqual(
      held.map((row) => row.position),
      [2, 3],
    );
    assert.equal(held[0]?.attemptId, built.attemptId);
    assert.equal(held[0]?.paperQuestionId, built.paper.items[1]?.paperQuestionId);
  });

  /** A mistake is a chosen wrong answer. One left blank is a finishing problem, not a knowledge gap. */
  it('leaves a skipped question off the list', async () => {
    const built = await world([RIGHT, null, WRONG, null]);

    await counted(built);

    assert.deepEqual(
      (await mistakes(built)).map((row) => row.position),
      [3],
    );
  });

  it('writes nothing when every answer was right', async () => {
    const built = await world([RIGHT, RIGHT, RIGHT, RIGHT]);

    await counted(built);

    assert.equal((await mistakes(built)).length, 0);
  });

  /** A re-score writes the mistakes again; the unique guard is what stops a second row. */
  it('counts a question once however many times the sitting is scored', async () => {
    const built = await world([RIGHT, WRONG, WRONG, RIGHT]);

    await counted(built);
    await built.scoring.score(built.attemptId);
    await built.rollup.rebuildStudent(built.studentId);

    assert.equal((await mistakes(built)).length, 2);
  });
});
