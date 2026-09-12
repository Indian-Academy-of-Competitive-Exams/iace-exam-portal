import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bandsAfterBatch } from '../src/attempts/rollup-fold';

const BANDS = [
  { from: 0, to: 10, count: 1 },
  { from: 10, to: 20, count: 0 },
];

describe('bandsAfterBatch', () => {
  it('bumps a band per score while every score is inside the range', () => {
    const moved = bandsAfterBatch(BANDS, 0, 20, [5, 5, 15]);

    assert.deepEqual(moved, [
      { from: 0, to: 10, count: 3 },
      { from: 10, to: 20, count: 1 },
    ]);
  });

  /** The signal the caller needs: one score past the edge means the whole curve is re-cut. */
  it('gives up as soon as one score falls outside the range', () => {
    assert.equal(bandsAfterBatch(BANDS, 0, 20, [5, 99]), null);
  });
});
