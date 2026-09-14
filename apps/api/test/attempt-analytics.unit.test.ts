import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_STATE, DIFFICULTY_LEVEL } from '@iace/contracts';
import {
  bucketOf,
  bucketsBy,
  strategyOf,
  timeUseOf,
  type AnalysedQuestion,
} from '../src/attempts/attempt-analytics';

function asked(overrides: Partial<AnalysedQuestion> = {}): AnalysedQuestion {
  return {
    baseConfigSectionId: 'sec_a',
    subjectId: 'sub_r',
    subjectName: 'Reasoning',
    difficulty: DIFFICULTY_LEVEL.MEDIUM,
    state: ANSWER_STATE.ANSWERED,
    answered: true,
    isCorrect: true,
    marksAwarded: 2,
    timeSpentSec: 30,
    ...overrides,
  };
}

const right = asked();
const wrong = asked({ isCorrect: false, marksAwarded: -0.5, timeSpentSec: 60 });
const untouched = asked({
  answered: false,
  isCorrect: null,
  marksAwarded: 0,
  timeSpentSec: 0,
  state: ANSWER_STATE.NOT_VISITED,
});

describe('bucketOf', () => {
  /** The failure this prevents: a strong student who skipped half the paper reading as weak. */
  it('measures accuracy over what was attempted, not over the whole paper', () => {
    const bucket = bucketOf('all', 'Overall', [right, wrong, untouched, untouched]);

    assert.equal(bucket.total, 4);
    assert.equal(bucket.attempted, 2);
    assert.equal(bucket.unattempted, 2);
    assert.equal(bucket.accuracy, 50);
  });

  it('reads a paper nobody touched as no accuracy rather than as a division by zero', () => {
    const bucket = bucketOf('all', 'Overall', [untouched, untouched]);

    assert.equal(bucket.accuracy, 0);
    assert.equal(Number.isFinite(bucket.accuracy), true);
  });

  it('adds the marks the paper actually awarded, negatives and all', () => {
    assert.equal(bucketOf('all', 'Overall', [right, right, wrong]).marks, 3.5);
  });

  /** The failure this prevents: a broken answer key reading as a question they never opened. */
  it('counts an answer nothing could judge as attempted, and as neither right nor wrong', () => {
    const unjudgeable = asked({ answered: true, isCorrect: null, marksAwarded: 0 });
    const bucket = bucketOf('all', 'Overall', [right, unjudgeable]);

    assert.equal(bucket.attempted, 2);
    assert.equal(bucket.unattempted, 0);
    assert.equal(bucket.correct, 1);
    assert.equal(bucket.wrong, 0);
  });
});

describe('bucketsBy', () => {
  it('splits a paper by whatever key it is given, keeping the order it met them in', () => {
    const buckets = bucketsBy(
      [
        asked({ subjectId: 'sub_q', subjectName: 'Quant' }),
        right,
        asked({ subjectId: 'sub_q', subjectName: 'Quant', isCorrect: false }),
      ],
      (row) => row.subjectId,
      (row) => row.subjectName,
    );

    assert.deepEqual(
      buckets.map((bucket) => [bucket.name, bucket.total, bucket.accuracy]),
      [
        ['Quant', 2, 50],
        ['Reasoning', 1, 100],
      ],
    );
  });
});

describe('timeUseOf', () => {
  it('separates the time that earned marks from the time that lost them', () => {
    const time = timeUseOf([right, wrong, asked({ ...untouched, timeSpentSec: 12 })]);

    assert.equal(time.totalSec, 102);
    assert.equal(time.avgOnCorrectSec, 30);
    assert.equal(time.avgOnWrongSec, 60);
    assert.equal(time.spentOnUnattemptedSec, 12);
    assert.equal(time.avgPerQuestionSec, 34);
  });

  it('reports zero rather than NaN where there is nothing of that kind to average', () => {
    const time = timeUseOf([right]);

    assert.equal(time.avgOnWrongSec, 0);
  });
});

describe('strategyOf', () => {
  /** The failure this prevents: a stacked bar of these double-counting an answered-and-marked one. */
  it('partitions the paper, so the five counts sum to it exactly', () => {
    const rows = [
      asked({ state: ANSWER_STATE.ANSWERED_MARKED }),
      asked({ state: ANSWER_STATE.MARKED_REVIEW }),
      asked({ state: ANSWER_STATE.NOT_ANSWERED }),
      asked({ state: ANSWER_STATE.NOT_VISITED }),
      right,
    ];

    const strategy = strategyOf(rows);

    assert.deepEqual(strategy, {
      answered: 1,
      answeredAndMarked: 1,
      markedOnly: 1,
      seenAndLeft: 1,
      neverOpened: 1,
    });
    assert.equal(
      Object.values(strategy).reduce((sum, count) => sum + count, 0),
      rows.length,
    );
  });
});
