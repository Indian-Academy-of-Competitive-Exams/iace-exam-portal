import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_STATE } from '@iace/contracts';
import { answersFromRows, rowsToFlush } from '../src/attempts/attempt-flush';

const ENDS_AT = new Date('2026-09-01T05:30:00.000Z');

describe('rowsToFlush', () => {
  const held = {
    attemptId: 'att_1',
    studentId: 'stu_1',
    testId: 'test_1',
    startedAt: '2026-09-01T05:00:00.000Z',
    endsAt: ENDS_AT.toISOString(),
    revision: 2,
    sections: {},
    answers: {
      q1: {
        state: ANSWER_STATE.ANSWERED,
        selectedOptionId: 'opt_a',
        typedAnswer: null,
        timeSpentSec: 40,
        answeredAt: '2026-09-01T05:01:00.000Z',
        firstActionAt: '2026-09-01T05:00:20.000Z',
      },
      q2: {
        state: ANSWER_STATE.NOT_ANSWERED,
        selectedOptionId: null,
        typedAnswer: null,
        timeSpentSec: 8,
        answeredAt: null,
        firstActionAt: '2026-09-01T05:02:00.000Z',
      },
    },
  };

  it('writes a row per question the sitting has touched', () => {
    const rows = rowsToFlush(held);

    assert.deepEqual(rows.map((row) => row.questionId).sort(), ['q1', 'q2']);
  });

  /** The failure this prevents: a repeatable job rewriting answeredAt every minute it runs. */
  it('takes every value off the state and none off the clock', () => {
    const first = rowsToFlush(held);
    const second = rowsToFlush(held);

    assert.deepEqual(first, second);
    assert.deepEqual(first[0]?.data.answeredAt, new Date('2026-09-01T05:01:00.000Z'));
  });

  it('leaves an unanswered question with no answered time', () => {
    const rows = rowsToFlush(held);
    const unanswered = rows.find((row) => row.questionId === 'q2');

    assert.equal(unanswered?.data.answeredAt, null);
    assert.equal(unanswered?.data.state, ANSWER_STATE.NOT_ANSWERED);
  });

  /** The whole point of the pass: the eighty answers that did not move are not rewritten. */
  it('writes only the questions it is given', () => {
    const rows = rowsToFlush(held, ['q2']);

    assert.deepEqual(
      rows.map((row) => row.questionId),
      ['q2'],
    );
  });

  /** Submit passes no list on purpose: the final write is the whole paper, changed or not. */
  it('writes every touched question when it is given no list', () => {
    assert.equal(rowsToFlush(held).length, 2);
  });

  it('writes nothing when nothing changed', () => {
    assert.deepEqual(rowsToFlush(held, []), []);
  });

  /** The failure this prevents: a rebuilt live key handing the student back an empty paper. */
  it('reads back into the same answers a lost key is put together from', () => {
    const durable = rowsToFlush(held).map((row) => ({ questionId: row.questionId, ...row.data }));

    assert.deepEqual(answersFromRows(durable), held.answers);
  });
});
