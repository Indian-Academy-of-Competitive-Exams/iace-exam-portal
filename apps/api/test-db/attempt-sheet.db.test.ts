import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { ANSWER_STATE, ATTEMPT_STATUS, type LiveAnswer } from '@iace/contracts';
import { AttemptSheetService } from '../src/attempts/attempt-sheet.service';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { type HeldState } from '../src/attempts/attempt-state';
import {
  makePaper,
  makeStudent,
  resetDatabase,
  servedAnswers,
  sitPaper,
  testPrisma,
} from './support/database';

const prisma = testPrisma();
beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const STARTED = new Date('2026-09-01T05:00:00.000Z');

async function sitting() {
  const paper = await makePaper(prisma, { questions: ['Reasoning', 'Reasoning'] });
  const studentId = (await makeStudent(prisma)).id;
  const attempt = await sitPaper(prisma, {
    paper,
    studentId,
    chosen: [null, null],
    timeSpent: [0, 0],
    status: ATTEMPT_STATUS.IN_PROGRESS,
    startedAt: STARTED,
    submittedAt: null,
  });
  const optionIds = (
    await prisma.paperQuestion.findMany({
      where: { testId: paper.testId },
      orderBy: { order: 'asc' },
    })
  ).map((row) => row.optionIds);
  const [q1 = '', q2 = ''] = paper.items.map((item) => item.questionId);
  const answer = (selectedOptionId: string): LiveAnswer => ({
    state: ANSWER_STATE.ANSWERED,
    selectedOptionId,
    typedAnswer: null,
    timeSpentSec: 25,
    answeredAt: '2026-09-01T05:02:00.000Z',
    firstActionAt: '2026-09-01T05:01:00.000Z',
  });
  const held = (answers: Record<string, LiveAnswer>): HeldState => ({
    attemptId: attempt.id,
    studentId,
    testId: paper.testId,
    startedAt: STARTED.toISOString(),
    endsAt: '2026-09-01T06:00:00.000Z',
    revision: 1,
    answers,
    sections: {},
  });
  const sheets = new AttemptSheetService(prisma, new PaperSheetService(prisma));
  const chosen = async (questionId: string) =>
    (await servedAnswers(prisma, attempt.id)).find((row) => row.questionId === questionId)
      ?.selectedOptionId;
  return { paper, attemptId: attempt.id, q1, q2, optionIds, answer, held, sheets, chosen };
}

describe('AttemptSheetService', () => {
  it('seeds one untouched slot per paper row inside the start’s transaction', async () => {
    const { paper, attemptId, sheets } = await sitting();
    await prisma.attemptSheet.delete({ where: { attemptId } });

    await prisma.$transaction((tx) => sheets.create(tx, attemptId, paper.testId));

    assert.deepEqual(
      (await prisma.attemptSheet.findUniqueOrThrow({ where: { attemptId } })).answers,
      [null, null],
    );
  });

  it('patches only the named slots, and nothing once the sitting has ended', async () => {
    const { attemptId, q1, q2, optionIds, answer, held, sheets, chosen } = await sitting();
    const [, second = []] = optionIds;

    await sheets.patch(held({ [q1]: answer('forged'), [q2]: answer(second[1] ?? '') }), [q2]);
    assert.equal(await chosen(q2), second[1]);
    assert.equal(await chosen(q1), null);

    await prisma.attempt.update({
      where: { id: attemptId },
      data: { status: ATTEMPT_STATUS.SUBMITTED },
    });
    await sheets.patch(held({ [q2]: answer(second[2] ?? '') }), [q2]);
    assert.equal(await chosen(q2), second[1]);
  });

  it('writes the whole sheet, live-gated before the claim and not after it', async () => {
    const { attemptId, q1, q2, optionIds, answer, held, sheets, chosen } = await sitting();
    const [first = [], second = []] = optionIds;
    const both = held({ [q1]: answer(first[0] ?? ''), [q2]: answer(second[3] ?? '') });

    const written = await sheets.write(both, true);
    assert.equal(written.filter((slot) => slot !== null).length, 2);
    assert.deepEqual([await chosen(q1), await chosen(q2)], [first[0], second[3]]);

    await prisma.attempt.update({
      where: { id: attemptId },
      data: { status: ATTEMPT_STATUS.SUBMITTED },
    });
    await sheets.write(held({ [q1]: answer(first[2] ?? '') }), true);
    assert.equal(await chosen(q1), first[0]);
    await sheets.write(held({ [q1]: answer(first[2] ?? '') }), false);
    assert.equal(await chosen(q1), first[2]);
  });
});
