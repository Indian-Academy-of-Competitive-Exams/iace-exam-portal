import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { ATTEMPT_STATUS, type AttemptStatus } from '@iace/contracts';
import { LiveOpsService } from '../src/attempts/live-ops.service';
import { makeBranch, makePaper, makeStudent, resetDatabase, testPrisma } from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** Redis holds a live sitting's answers; the board's own reads are what this suite is about. */
const noHeldState = () => ({ readMany: () => Promise.resolve(new Map()) }) as never;

const board = () => new LiveOpsService(prisma, noHeldState());

const NOW = new Date('2026-09-30T05:00:00.000Z');
const MINUTE_MS = 60 * 1000;

/** Unscored: what the live panels read off a sitting is its status and its deadline. */
const sitting = (input: {
  testId: string;
  studentId: string;
  status: AttemptStatus;
  endsAt: Date;
}) =>
  prisma.attempt.create({
    data: {
      id: randomUUID(),
      testId: input.testId,
      studentId: input.studentId,
      attemptNo: 1,
      isGraded: true,
      status: input.status,
      startedAt: new Date(input.endsAt.getTime() - 60 * MINUTE_MS),
      endsAt: input.endsAt,
      shuffleSeed: 1,
      ...(input.status === ATTEMPT_STATUS.SUBMITTED ? { submittedAt: input.endsAt } : {}),
    },
    select: { id: true },
  });

describe('LiveOpsService — the board', () => {
  it('splits the live sittings by their deadline, each with the student it belongs to', async () => {
    const paper = await makePaper(prisma, { questions: ['Reasoning', 'Maths'] });
    const branch = await makeBranch(prisma, 'HYDERABAD');
    const running = await makeStudent(prisma, {
      fullName: 'Still Sitting',
      currentBranchId: branch.id,
    });
    const overdue = await makeStudent(prisma, { fullName: 'Ran Over' });
    await sitting({
      testId: paper.testId,
      studentId: running.id,
      status: ATTEMPT_STATUS.IN_PROGRESS,
      endsAt: new Date(NOW.getTime() + 10 * MINUTE_MS),
    });
    await sitting({
      testId: paper.testId,
      studentId: overdue.id,
      status: ATTEMPT_STATUS.IN_PROGRESS,
      endsAt: new Date(NOW.getTime() - MINUTE_MS),
    });

    const shown = await board().board(paper.testId, NOW);

    assert.deepEqual([shown.counts.active, shown.counts.stuck], [1, 1]);
    assert.deepEqual(
      shown.active.map((row) => [row.studentName, row.branchName, row.questionCount]),
      [['Still Sitting', 'HYDERABAD', 2]],
    );
    assert.deepEqual(
      shown.stuck.map((row) => [row.studentName, row.branchName, row.hasLiveState]),
      [['Ran Over', null, false]],
    );
  });

  it('leaves a submitted sitting out of both live panels', async () => {
    const paper = await makePaper(prisma, { questions: ['Reasoning'] });
    const student = await makeStudent(prisma);
    await sitting({
      testId: paper.testId,
      studentId: student.id,
      status: ATTEMPT_STATUS.SUBMITTED,
      endsAt: new Date(NOW.getTime() - MINUTE_MS),
    });

    const shown = await board().board(paper.testId, NOW);

    assert.deepEqual([shown.counts.active, shown.counts.stuck], [0, 0]);
    assert.deepEqual([shown.active.length, shown.stuck.length], [0, 0]);
    assert.equal(shown.counts.awaitingScoring, 1);
  });
});
