import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LEADERBOARD_MAX_TIME_SEC, timeTakenSec } from '../src/attempts/leaderboard-score';

describe('timeTakenSec', () => {
  const startedAt = new Date('2026-09-01T05:00:00.000Z');

  it('measures the sitting from start to submit', () => {
    assert.equal(timeTakenSec(startedAt, new Date('2026-09-01T05:20:00.000Z')), 1200);
  });

  it('treats a sitting nobody submitted as having taken everything there was', () => {
    assert.equal(timeTakenSec(startedAt, null), LEADERBOARD_MAX_TIME_SEC);
  });

  it('never counts more than a day, however long the sitting was left open', () => {
    assert.equal(
      timeTakenSec(startedAt, new Date('2026-09-03T11:00:00.000Z')),
      LEADERBOARD_MAX_TIME_SEC,
    );
  });

  it('refuses to make a clock run backwards into a negative advantage', () => {
    assert.equal(timeTakenSec(startedAt, new Date('2026-09-01T04:59:00.000Z')), 0);
  });
});
