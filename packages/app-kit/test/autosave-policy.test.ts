import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUTOSAVE_AT_COUNT,
  AUTOSAVE_EVERY_MS,
  AUTOSAVE_JITTER_MS,
  autosaveDelayMs,
  shouldFlushNow,
} from '../browser/autosave-policy';

describe('when a sitting saves what it has', () => {
  /** 5,000 sittings that began together must not come back to the server together. */
  it('spreads the timer across clients', () => {
    assert.equal(
      autosaveDelayMs(() => 0),
      AUTOSAVE_EVERY_MS - AUTOSAVE_JITTER_MS,
    );
    assert.equal(
      autosaveDelayMs(() => 1),
      AUTOSAVE_EVERY_MS + AUTOSAVE_JITTER_MS,
    );
    assert.equal(
      autosaveDelayMs(() => 0.5),
      AUTOSAVE_EVERY_MS,
    );
  });

  /** A delay that could reach zero would hammer the server instead of spreading it. */
  it('never leaves the window, whatever the source of randomness says', () => {
    for (let step = 0; step <= 100; step += 1) {
      const delay = autosaveDelayMs(() => step / 100);
      assert.ok(delay >= AUTOSAVE_EVERY_MS - AUTOSAVE_JITTER_MS, `low at ${step}`);
      assert.ok(delay <= AUTOSAVE_EVERY_MS + AUTOSAVE_JITTER_MS, `high at ${step}`);
    }
  });

  it('goes early once enough answers are waiting', () => {
    assert.equal(shouldFlushNow(AUTOSAVE_AT_COUNT - 1), false);
    assert.equal(shouldFlushNow(AUTOSAVE_AT_COUNT), true);
    assert.equal(shouldFlushNow(0), false);
  });
});
