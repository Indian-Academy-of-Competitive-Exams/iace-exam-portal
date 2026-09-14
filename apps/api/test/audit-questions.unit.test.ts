import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QUESTION_STATUS, fieldDiff, type QuestionStatus } from '@iace/contracts';
import { AUDITED_QUESTION_FIELDS } from '../src/questions/questions.service';

describe('the question audit diff', () => {
  it('covers the columns a question edit can change', () => {
    for (const field of [
      'type',
      'subjectId',
      'topicId',
      'difficulty',
      'questionCode',
      'status',
      'version',
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
      status: QUESTION_STATUS.ACTIVE as QuestionStatus,
    };

    assert.deepEqual(
      fieldDiff(
        before,
        { ...before, status: QUESTION_STATUS.ARCHIVED },
        AUDITED_QUESTION_FIELDS as never,
      )?.status,
      { from: QUESTION_STATUS.ACTIVE, to: QUESTION_STATUS.ARCHIVED },
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
   * `position` is what survives a version: an option carries its id over only while its slot is
   * unchanged, so two sets with different ids and the same correct position(s) must diff to null.
   */
  it('reports no diff when the option ids differ but the correct position does not', () => {
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
    const after = {
      correctOptionPositions: positionsOf([
        { position: 1, isCorrect: false },
        { position: 2, isCorrect: true },
      ]),
    };

    assert.equal(fieldDiff(before, after, AUDITED_QUESTION_FIELDS as never), null);
  });
});
