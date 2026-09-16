import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { useCountdown } from '../src/exam/use-countdown';

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
