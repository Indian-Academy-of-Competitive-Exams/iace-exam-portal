import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { useAnchoredCountdown, useClockCountdown, useCountdown } from '../src/exam/use-countdown';

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
  // A fresh function on every render, exactly as useExamView rebuilds timer.onExpire.
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
  const expiries = { count: 0 };
  const hook = renderHook(
    ({ allowedSec }) =>
      useAnchoredCountdown(allowedSec, () => {
        expiries.count += 1;
      }),
    { initialProps: { allowedSec } },
  );

  return {
    expiries,
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

/** The failure this prevents: a reload into a section whose time is spent leaving it open until the paper ends. */
test('an allowance the server corrects to zero closes the section once', () => {
  anchored(1800, ({ expiries, setAllowedSec, tick }) => {
    // Before the seed lands the section reads as unopened; its stamp then says the time is gone.
    setAllowedSec(0);
    tick(1_000);
    tick(1_000);

    assert.equal(expiries.count, 1, 'a spent section expires on the next tick, and only once');
  });
});

/** The failure this prevents: a candidate tapping faster than once a second freezing the paper's clock. */
test('a clock rebuilt on every render keeps ticking', () => {
  const start = Date.parse('2026-09-01T05:00:00.000Z');
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: start });
  const clockAt = () => ({
    endsAt: '2026-09-01T06:00:00.000Z',
    serverNow: '2026-09-01T05:00:00.000Z',
    arrivedAt: start,
  });
  const hook = renderHook(({ clock }) => useClockCountdown(clock, () => {}), {
    initialProps: { clock: clockAt() },
  });
  try {
    for (let tap = 0; tap < 6; tap += 1) {
      act(() => mock.timers.tick(500));
      hook.rerender({ clock: clockAt() });
    }
    assert.equal(hook.result.current, 3597, 'three seconds of taps cost three seconds, not none');
  } finally {
    hook.unmount();
    mock.timers.reset();
  }
});

/** The failure this prevents: every save's reply restarting the tick, so the clock holds one second and skips the next. */
test("a clock re-anchored by a save's reply keeps the tick it was already on", () => {
  const start = Date.parse('2026-09-01T05:00:00.000Z');
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: start });
  const endsAt = '2026-09-01T06:00:00.000Z';
  const hook = renderHook(({ clock }) => useClockCountdown(clock, () => {}), {
    initialProps: { clock: { endsAt, serverNow: '2026-09-01T05:00:00.000Z', arrivedAt: start } },
  });
  try {
    act(() => mock.timers.tick(600));
    // The same deadline, anchored on a reply that landed 600ms into the second.
    hook.rerender({
      clock: { endsAt, serverNow: '2026-09-01T05:00:00.600Z', arrivedAt: start + 600 },
    });
    act(() => mock.timers.tick(400));

    assert.equal(hook.result.current, 3599, 'the tick due a second after mount still fires');
  } finally {
    hook.unmount();
    mock.timers.reset();
  }
});
