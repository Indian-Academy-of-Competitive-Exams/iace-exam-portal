import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { AUDIT_ACTION, fieldDiff } from '@iace/contracts';
import { TOGGLE_ACTIONS } from '../src/audit/audit.decorator';
import { AUDITED_QUESTION_FIELDS } from '../src/questions/questions.service';

describe('the question audit diff', () => {
  it('covers the columns a question edit can change', () => {
    for (const field of [
      'type',
      'subjectId',
      'topicId',
      'subTopicId',
      'difficulty',
      'questionCode',
      'status',
      'isActive',
      'defaultMarks',
      'defaultNegativeMarks',
      'correctOptionPositions',
      'answerKey',
    ]) {
      assert.ok((AUDITED_QUESTION_FIELDS as readonly string[]).includes(field));
    }
  });

  /** Retiring a question changes which papers can draw it, so it is worth finding later. */
  it('reports a retire', () => {
    const before = {
      subjectId: 's1',
      topicId: null,
      subTopicId: null,
      isActive: true,
      status: 'PUBLISHED',
    };

    assert.deepEqual(
      fieldDiff(before, { ...before, isActive: false }, AUDITED_QUESTION_FIELDS as never)?.isActive,
      { from: true, to: false },
    );
  });

  /**
   * The failure this prevents: changing which option is correct after a paper has been attempted
   * changes who passed, and nothing else in the system records that it happened.
   */
  it('reports a change to the correct answer', () => {
    const before = { correctOptionPositions: [1] };

    assert.deepEqual(
      fieldDiff(before, { correctOptionPositions: [2] }, AUDITED_QUESTION_FIELDS as never)
        ?.correctOptionPositions,
      { from: [1], to: [2] },
    );
  });

  /**
   * `QuestionOption.id` is a fresh cuid on every save — `update()` deletes and recreates every
   * option — so keying this projection on `id` would report a change on every no-op resubmit.
   * `position` is the stable identity: two option sets with different ids but the same correct
   * position(s) must diff to null, the shape `update()` actually produces for an unchanged save.
   */
  it('reports no diff when a save regenerates option ids but keeps the correct position', () => {
    const positionsOf = (options: { position: number; isCorrect: boolean }[]) =>
      options
        .filter((option) => option.isCorrect)
        .map((option) => option.position)
        .sort((a, b) => a - b);

    const before = {
      correctOptionPositions: positionsOf([
        { position: 1, isCorrect: false },
        { position: 2, isCorrect: true },
      ]),
    };
    // Different option ids underneath — deleteMany + create minted new ones — same positions.
    const after = {
      correctOptionPositions: positionsOf([
        { position: 1, isCorrect: false },
        { position: 2, isCorrect: true },
      ]),
    };

    assert.equal(fieldDiff(before, after, AUDITED_QUESTION_FIELDS as never), null);
  });

  /** Marks are Decimal(6,2) from Prisma and plain numbers from the body; equal must read equal. */
  it('does not report a marks change when only the representation differs', () => {
    const before = { defaultMarks: new Prisma.Decimal('2.00') };

    assert.equal(
      fieldDiff(before, { defaultMarks: 2 } as never, AUDITED_QUESTION_FIELDS as never),
      null,
    );
    assert.deepEqual(
      fieldDiff(before, { defaultMarks: 1.5 } as never, AUDITED_QUESTION_FIELDS as never)
        ?.defaultMarks,
      { from: before.defaultMarks, to: 1.5 },
    );
  });

  /**
   * A question's active flag is a retire, not a sign-in state, so it uses ACTIVATE/DEACTIVATE
   * and never BLOCK/UNBLOCK — those belong to students.
   */
  it('uses the sign-in style toggle vocabulary for a question retire', () => {
    assert.equal(TOGGLE_ACTIONS.signIn({ isActive: false }), AUDIT_ACTION.DEACTIVATE);
  });
});
