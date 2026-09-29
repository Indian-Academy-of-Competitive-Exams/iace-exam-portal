import test from 'node:test';
import assert from 'node:assert/strict';
import { type PerformancePoint } from '@iace/contracts';
import { trendOf } from '../src/trend';

const sitting = (
  attemptId: string,
  score: number,
  percentile: number | null,
): PerformancePoint => ({
  attemptId,
  attemptNo: 1,
  isGraded: true,
  testId: `t-${attemptId}`,
  testTitle: 'A paper',
  submittedAt: '2026-09-01T10:00:00.000Z',
  score,
  maxMarks: 100,
  percentage: score,
  accuracy: 80,
  rank: percentile === null ? null : 4,
  percentile,
});

test('one marked sitting anywhere puts the line on percentiles', () => {
  const line = trendOf([sitting('a', 50, null), sitting('b', 60, 82)]);

  assert.equal(line?.title, 'Percentile');
  assert.equal(line?.suffix, '');
  assert.deepEqual(
    line?.points.map((point) => point.value),
    [null, 82],
  );
  assert.equal(line?.band?.from, 75);
});

test('nothing ranked yet reads the marks instead, and says so with a unit', () => {
  const line = trendOf([sitting('a', 50, null), sitting('b', 70, null)]);

  assert.equal(line?.title, 'Score');
  assert.equal(line?.suffix, '%');
  assert.deepEqual(
    line?.points.map((point) => point.value),
    [50, 70],
  );
  assert.equal(line?.band, undefined);
  assert.equal(line?.reference?.value, 60);
});

test('a single sitting is not a trend', () => {
  assert.equal(trendOf([sitting('a', 50, 60)]), null);
});

test('the average is taken over what was measured, never over a null as zero', () => {
  const line = trendOf([sitting('a', 50, null), sitting('b', 60, 80), sitting('c', 70, 90)]);

  assert.equal(line?.reference?.value, 85);
});
