import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type PerformancePoint } from '@iace/contracts';
import { ordinal, ordinalSuffix, resultLine } from '../src/student-figures';

describe('ordinal — a rank or a percentile as it is read', () => {
  it('ends in st, nd or rd where the number does', () => {
    assert.deepEqual([1, 22, 62, 83, 91, 101].map(ordinal), [
      '1st',
      '22nd',
      '62nd',
      '83rd',
      '91st',
      '101st',
    ]);
  });

  /** The exception every naive rule gets wrong: eleventh, twelfth, thirteenth. */
  it('keeps th through the teens of every hundred', () => {
    assert.deepEqual([11, 12, 13, 111, 113].map(ordinalSuffix), ['th', 'th', 'th', 'th', 'th']);
  });

  it('keeps th on a fraction and on a round number', () => {
    assert.deepEqual([82.5, 91.25, 0, 100].map(ordinal), ['82.5th', '91.25th', '0th', '100th']);
  });
});

describe('resultLine', () => {
  const point = (percentile: number | null): PerformancePoint => ({
    attemptId: 'a',
    attemptNo: 1,
    isGraded: true,
    testId: 't',
    testTitle: 'A paper',
    submittedAt: null,
    score: 60,
    maxMarks: 100,
    percentage: 60,
    accuracy: 80,
    rank: percentile === null ? null : 4,
    percentile,
  });

  /** "th" was written into the line, so the 91st percentile read "91th". */
  it('reads the percentile as the ordinal it is, and leaves an unranked sitting without one', () => {
    assert.equal(resultLine(point(91)), '60 of 100 marks · 91st percentile · rank 4');
    assert.equal(resultLine(point(null)), '60 of 100 marks');
  });
});
