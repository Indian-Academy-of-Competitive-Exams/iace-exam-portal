import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { useAnchoredCountdown, useCountdown } from '../src/exam/use-countdown';

/** A clock the test moves by hand; the hook re-reads it on each one-second tick. */
function handClock(start: number) {
  const clock = { seconds: start, read: () => clock.seconds };
  return clock;
}

/** Mounts the countdown on a mocked interval, so a failing assertion cannot leave a real one running. */
function sitting(start: number, run: (harness: ReturnType<typeof mountCountdown>) => void) {
  mock.timers.enable({ apis: ['setInterval'] });
  const harness = mountCountdown(start);
  try {
    run(harness);
  } finally {
    harness.unmount();
    mock.timers.reset();
  }
}

function mountCountdown(start: number) {
  const clock = handClock(start);
  const expiries = { count: 0 };
  // A fresh function on every render, exactly as useExamView rebuilds outOfTime and endSection.
  const freshCallback = () => () => {
    expiries.count += 1;
  };
  const hook = renderHook(({ onExpire }) => useCountdown(clock.read, onExpire), {
    initialProps: { onExpire: freshCallback() },
  });

  return {
    clock,
    expiries,
    result: hook.result,
    unmount: hook.unmount,
    rerender: () => hook.rerender({ onExpire: freshCallback() }),
    tick: () => act(() => mock.timers.tick(1000)),
  };
}

test('a clock held at zero expires once, however often the engine re-renders with a new callback', () => {
  sitting(0, ({ expiries, rerender }) => {
    for (let render = 0; render < 5; render += 1) rerender();

    assert.equal(expiries.count, 1, 'a failed submit must not be retried by every render at zero');
  });
});

test('a clock that rises above zero again re-arms, so the next section can expire too', () => {
  sitting(2, ({ clock, expiries, rerender, tick }) => {
    clock.seconds = 0;
    tick();
    rerender();
    assert.equal(expiries.count, 1, 'the first arrival at zero expires once');

    clock.seconds = 30;
    tick();
    clock.seconds = 0;
    tick();
    assert.equal(expiries.count, 2, 'the next arrival at zero expires again');
  });
});

test('a clock above zero never expires', () => {
  sitting(3, ({ clock, expiries, result, rerender, tick }) => {
    for (const seconds of [2, 1]) {
      clock.seconds = seconds;
      tick();
      rerender();
    }

    assert.equal(result.current, 1, 'the count follows the clock');
    assert.equal(expiries.count, 0);
  });
});

/** Mounts on a mocked `Date` too, so the seconds `useAnchoredCountdown` reads off it move by hand. */
function anchored(allowedSec: number, run: (harness: ReturnType<typeof mountAnchored>) => void) {
  // A real-looking epoch: a mocked clock starting at 0 would collide with any "not set yet" sentinel.
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_700_000_000_000 });
  const harness = mountAnchored(allowedSec);
  try {
    run(harness);
  } finally {
    harness.unmount();
    mock.timers.reset();
  }
}

function mountAnchored(allowedSec: number) {
  const hook = renderHook(({ allowedSec }) => useAnchoredCountdown(allowedSec, () => {}), {
    initialProps: { allowedSec },
  });

  return {
    result: hook.result,
    unmount: hook.unmount,
    setAllowedSec: (next: number) => hook.rerender({ allowedSec: next }),
    tick: (ms: number) => act(() => mock.timers.tick(ms)),
  };
}

test('an unchanged allowance just counts down with the clock', () => {
  anchored(1800, ({ result, tick }) => {
    tick(5_000);
    assert.equal(result.current, 1795, 'five real seconds cost five seconds of the allowance');
  });
});

/** The failure this prevents: a reloaded section's clock subtracting elapsed time twice and closing early. */
test('a corrected allowance does not have the same elapsed time taken off it twice', () => {
  anchored(1800, ({ result, setAllowedSec, tick }) => {
    tick(25_000);
    assert.equal(result.current, 1775, 'the first 25 real seconds land as usual');

    // A save ack recomputing "seconds left" from the server, exactly as a sectional clock does on reload.
    setAllowedSec(1775);
    tick(5_000);

    assert.equal(
      result.current,
      1770,
      'only the next five seconds come off, not the first 25 again',
    );
  });
});
