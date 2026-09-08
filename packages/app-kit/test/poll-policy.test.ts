import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  POLL_FIRST_MS,
  POLL_GIVES_UP_AFTER,
  POLL_MAX_MS,
  pollDelayMs,
} from '../browser/poll-policy';

describe('waiting for a queued job to land', () => {
  /** Marking takes about a quarter second; a fixed three-second poll is almost all of the wait. */
  it('asks again quickly at first', () => {
    assert.equal(pollDelayMs(0), POLL_FIRST_MS);
    assert.equal(pollDelayMs(1), POLL_FIRST_MS * 2);
    assert.equal(pollDelayMs(2), POLL_FIRST_MS * 4);
  });

  it('settles at the ceiling rather than growing without bound', () => {
    assert.equal(pollDelayMs(20), POLL_MAX_MS);
    assert.equal(pollDelayMs(POLL_GIVES_UP_AFTER), POLL_MAX_MS);
  });

  /** The bug this prevents: a dead job polled forever, so the error the screen can show never arrives. */
  it('gives up in a bounded number of tries', () => {
    assert.ok(POLL_GIVES_UP_AFTER > 0);
    let waited = 0;
    for (let at = 0; at < POLL_GIVES_UP_AFTER; at += 1) waited += pollDelayMs(at);
    assert.ok(waited >= 60_000, 'waits at least a minute before calling it failed');
    assert.ok(waited <= 300_000, 'does not leave the student for five minutes');
  });
});
