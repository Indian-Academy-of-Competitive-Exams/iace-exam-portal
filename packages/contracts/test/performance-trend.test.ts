import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bestSitting, sittingsOf, testsSat } from '../src/stats';
import { type PerformancePoint } from '../src/attempts';

/** The API hands the trend back oldest sitting first, so every fixture here is in that order. */
function sitting(overrides: Partial<PerformancePoint> & { attemptId: string }): PerformancePoint {
  return {
    testId: 'tst_1',
    testTitle: 'SSC CGL Mock 01',
    submittedAt: '2026-08-01T04:30:00.000Z',
    score: 100,
    maxMarks: 200,
    percentage: 50,
    accuracy: 60,
    rank: null,
    percentile: null,
    ...overrides,
  };
}

describe('testsSat', () => {
  it('lists each paper once, most recently sat first', () => {
    const tests = testsSat([
      sitting({ attemptId: 'att_1', testId: 'tst_a', testTitle: 'Mock 01' }),
      sitting({ attemptId: 'att_2', testId: 'tst_b', testTitle: 'Mock 02' }),
      sitting({ attemptId: 'att_3', testId: 'tst_a', testTitle: 'Mock 01' }),
    ]);

    assert.deepEqual(
      tests.map((test) => test.testId),
      ['tst_a', 'tst_b'],
    );
    assert.equal(tests[0]?.lastAttemptId, 'att_3');
  });

  /** The Performance screen opens on this row, so a retake must not push its own paper down. */
  it('dates a paper by its LATEST sitting, not its first', () => {
    const tests = testsSat([
      sitting({ attemptId: 'att_1', testId: 'tst_a', submittedAt: '2026-08-01T04:30:00.000Z' }),
      sitting({ attemptId: 'att_2', testId: 'tst_b', submittedAt: '2026-08-02T04:30:00.000Z' }),
      sitting({ attemptId: 'att_3', testId: 'tst_a', submittedAt: '2026-08-03T04:30:00.000Z' }),
    ]);

    assert.equal(tests[0]?.testId, 'tst_a');
    assert.equal(tests[0]?.lastSatAt, '2026-08-03T04:30:00.000Z');
  });

  it('has nothing to offer when no paper has been sat', () => {
    assert.deepEqual(testsSat([]), []);
  });
});

describe('sittingsOf', () => {
  it('keeps only one paper, in the order it was sat', () => {
    const points = [
      sitting({ attemptId: 'att_1', testId: 'tst_a', score: 34 }),
      sitting({ attemptId: 'att_2', testId: 'tst_b', score: 90 }),
      sitting({ attemptId: 'att_3', testId: 'tst_a', score: 44 }),
    ];

    assert.deepEqual(
      sittingsOf(points, 'tst_a').map((point) => point.score),
      [34, 44],
    );
  });
});

describe('bestSitting', () => {
  it('takes the highest score', () => {
    const best = bestSitting([
      sitting({ attemptId: 'att_1', score: 34 }),
      sitting({ attemptId: 'att_2', score: 44 }),
      sitting({ attemptId: 'att_3', score: 41 }),
    ]);

    assert.equal(best?.attemptId, 'att_2');
  });

  /** A tie is the sitting that first reached that score — a later retake did not better it. */
  it('gives a tie to the earliest sitting', () => {
    const best = bestSitting([
      sitting({ attemptId: 'att_1', score: 44 }),
      sitting({ attemptId: 'att_2', score: 44 }),
    ]);

    assert.equal(best?.attemptId, 'att_1');
  });

  it('is null when there is nothing to compare', () => {
    assert.equal(bestSitting([]), null);
  });
});
