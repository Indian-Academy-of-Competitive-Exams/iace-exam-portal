import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUTOSAVE_AT_COUNT,
  AUTOSAVE_EVERY_MS,
  AUTOSAVE_JITTER_MS,
  autosaveDelayMs,
  seedRevision,
  shouldFlushNow,
} from '../src/autosave-policy';

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

describe('when a sitting picks its revision counter back up', () => {
  /** The failure this prevents: a reloaded counter replaying as stale for ~17 minutes of work. */
  it('takes the next batch past what the server is already holding', () => {
    const serverHolds = 40;

    for (const counter of [0, 1, 39, 40, 41]) {
      const next = seedRevision(counter, serverHolds) + 1;
      assert.ok(next > serverHolds, `a batch sent at ${next} would be dropped as stale`);
    }
  });

  /** Seeded from the reload AND from every save, and a flush can be in flight across either. */
  it('never moves the counter backwards', () => {
    const races: readonly (readonly [number, number])[] = [
      [41, 40],
      [40, 40],
      [7, 3],
      [0, 0],
    ];

    for (const [current, held] of races) {
      assert.ok(seedRevision(current, held) >= current, `fell below the client's ${current}`);
      assert.ok(seedRevision(current, held) >= held, `fell below the server's ${held}`);
    }
  });
});
