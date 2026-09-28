import test from 'node:test';
import assert from 'node:assert/strict';
import { LEADERBOARD_SCOPES } from '@iace/contracts';
import { isBoardAsked } from '../src/leaderboard';

/** The failure this prevents: a student who has sat nothing asking for the platform-wide board. */
test('no sitting asks for no board, all-time included', () => {
  assert.equal(isBoardAsked(LEADERBOARD_SCOPES.ALL_TIME, '', 0), false);
  assert.equal(isBoardAsked(LEADERBOARD_SCOPES.TEST, 'test-1', 0), false);
});

test('a board is asked for once there is a sitting and something to rank it by', () => {
  assert.equal(isBoardAsked(LEADERBOARD_SCOPES.ALL_TIME, '', 2), true);
  assert.equal(isBoardAsked(LEADERBOARD_SCOPES.TEST, 'test-1', 2), true);
  assert.equal(isBoardAsked(LEADERBOARD_SCOPES.SERIES, '', 2), false, 'no series picked yet');
});
