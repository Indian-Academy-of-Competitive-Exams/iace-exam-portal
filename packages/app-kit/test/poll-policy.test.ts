import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  POLL_FIRST_MS,
  POLL_GIVES_UP_AFTER,
  POLL_MAX_MS,
  pollDelayMs,
  shouldKeepPolling,
} from '../src/poll-policy';

describe('waiting for a queued job to land', () => {
  /** Marking takes about a quarter second; a long first wait is almost all of the wait. */
  it('asks again quickly at first, then backs further off', () => {
    assert.ok(pollDelayMs(0) <= POLL_FIRST_MS, 'the first ask is prompt');
    assert.ok(
      pollDelayMs(3) > pollDelayMs(0),
      'a job that is taking a while is asked after less often',
    );
  });

  it('settles at the ceiling rather than growing without bound', () => {
    assert.ok(pollDelayMs(20) <= POLL_MAX_MS);
    assert.ok(pollDelayMs(POLL_GIVES_UP_AFTER) <= POLL_MAX_MS);
  });

  /** The bug this prevents: a whole hall polling in step, so the drain they wait on is starved. */
  it('spreads a hall that handed in together', () => {
    const hall = new Set(Array.from({ length: HALL }, () => pollDelayMs(20)));

    assert.ok(hall.size > HALL / 2, `a hall of ${HALL} asked at ${hall.size} different moments`);
    assert.ok(
      Math.min(...hall) >= POLL_MAX_MS / 2,
      'no ask lands near enough to now to be a retry storm',
    );
  });

  /** The bug this prevents: a dead job polled forever, so the error the screen can show never arrives. */
  it('gives up in a bounded number of tries', () => {
    let waited = 0;
    let asked = 0;
    while (asked < RUNAWAY && shouldKeepPolling(asked)) {
      waited += pollDelayMs(asked);
      asked += 1;
    }

    assert.ok(asked > 0, 'asks at least once');
    assert.equal(shouldKeepPolling(asked), false, 'stops asking rather than polling a dead job');
    assert.ok(waited >= 60_000, 'waits at least a minute before calling it failed');
    assert.ok(waited <= 300_000, 'does not leave the student for five minutes');
  });
});

/** Far past any real ceiling, so a predicate that never stops fails the test instead of hanging it. */
const RUNAWAY = 10_000;

/** Enough draws that a policy with no jitter in it collapses to one value and fails. */
const HALL = 200;
