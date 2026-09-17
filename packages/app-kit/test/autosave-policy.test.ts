import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes } from '@iace/contracts';
import {
  AUTOSAVE_AT_COUNT,
  AUTOSAVE_EVERY_MS,
  AUTOSAVE_JITTER_MS,
  autosaveDelayMs,
  seedRevision,
  shouldFlushNow,
  shouldRetrySubmit,
  submitRetryDelayMs,
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

describe('when a submit decides whether to try again', () => {
  /** The failure this prevents: an automatic hand-in at time-out that never lands is never retried. */
  it('retries a request that never landed, up to 3 times', () => {
    const offline = new AppException(ErrorCodes.INTERNAL, 'x', { httpStatus: 0 });
    assert.equal(shouldRetrySubmit(0, offline), true);
    assert.equal(shouldRetrySubmit(1, offline), true);
    assert.equal(shouldRetrySubmit(2, offline), true);
    assert.equal(shouldRetrySubmit(3, offline), false);
  });

  it('never retries a refusal the server actually answered', () => {
    const refused = new AppException(ErrorCodes.SITTING_TAKEN_OVER);
    assert.equal(shouldRetrySubmit(0, refused), false);
  });

  it('never retries a server error that did land', () => {
    const landed = new AppException(ErrorCodes.INTERNAL);
    assert.equal(landed.httpStatus === 0, false, 'INTERNAL default status is not 0');
    assert.equal(shouldRetrySubmit(0, landed), false);
  });

  it('delays 1s, 2s, 4s, never more than 8s', () => {
    assert.equal(submitRetryDelayMs(0), 1_000);
    assert.equal(submitRetryDelayMs(1), 2_000);
    assert.equal(submitRetryDelayMs(2), 4_000);
    assert.equal(submitRetryDelayMs(5), 8_000);
  });
});
