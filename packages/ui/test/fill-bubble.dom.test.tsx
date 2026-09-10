import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  FillBubble,
  FILL_BUBBLE_HOLD_MS,
  FILL_BUBBLE_MIN_HOLD_MS,
} from '../src/components/ui/fill-bubble';

/** Frames are driven by hand: real rAF timing would make "released at half" a number that flakes. */

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  mock.method(globalThis, 'requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  mock.method(globalThis, 'cancelAnimationFrame', () => undefined);
  mock.method(performance, 'now', () => 0);
});

afterEach(() => {
  mock.restoreAll();
  cleanup();
});

/** Advance the held fill to `elapsed` ms into the hold. */
const holdFor = (elapsed: number) => {
  const next = frames.at(-1);
  assert.ok(next, 'nothing asked for a frame — the hold never started');
  act(() => next(elapsed));
};

const bubble = (props: Partial<React.ComponentProps<typeof FillBubble>> = {}) => (
  <FillBubble fill={0} onFillChange={() => {}} label="A" {...props} />
);

describe('FillBubble — holding fills it', () => {
  it('reports where the fill stopped when released early', () => {
    const onFillChange = mock.fn();
    render(bubble({ onFillChange }));

    fireEvent.pointerDown(screen.getByRole('radio'));
    holdFor(FILL_BUBBLE_HOLD_MS / 2);
    fireEvent.pointerUp(screen.getByRole('radio'));

    assert.equal(onFillChange.mock.callCount(), 1);
    assert.equal(onFillChange.mock.calls[0]?.arguments[0], 0.5);
  });

  /** The commit is the point of the gesture, so it lands as the ink lands — not on release. */
  it('reports full the instant it fills, without waiting for release', () => {
    const onFillChange = mock.fn();
    render(bubble({ onFillChange }));

    fireEvent.pointerDown(screen.getByRole('radio'));
    holdFor(FILL_BUBBLE_HOLD_MS);

    assert.equal(onFillChange.mock.callCount(), 1);
    assert.equal(onFillChange.mock.calls[0]?.arguments[0], 1);
  });

  /** The failure this prevents: a CLICK leaving half an answer nobody meant to give. */
  it('reports nothing at all on a press too short to be a hold', () => {
    const onFillChange = mock.fn();
    render(bubble({ onFillChange }));

    fireEvent.pointerDown(screen.getByRole('radio'));
    holdFor(FILL_BUBBLE_MIN_HOLD_MS - 1);
    fireEvent.pointerUp(screen.getByRole('radio'));

    assert.equal(onFillChange.mock.callCount(), 0);
  });

  it('reports a press held just past the threshold', () => {
    const onFillChange = mock.fn();
    render(bubble({ onFillChange }));

    fireEvent.pointerDown(screen.getByRole('radio'));
    holdFor(FILL_BUBBLE_MIN_HOLD_MS);
    fireEvent.pointerUp(screen.getByRole('radio'));

    assert.equal(onFillChange.mock.callCount(), 1);
  });

  /** The same rule when there is ink already: a click must not nudge a partial bubble either. */
  it('reports nothing when a short press only tops up a partly filled bubble', () => {
    const onFillChange = mock.fn();
    render(bubble({ fill: 0.5, onFillChange }));

    fireEvent.pointerDown(screen.getByRole('radio'));
    holdFor(FILL_BUBBLE_MIN_HOLD_MS - 1);
    fireEvent.pointerUp(screen.getByRole('radio'));

    assert.equal(onFillChange.mock.callCount(), 0);
  });

  it('accrues from where a partly filled bubble stopped', () => {
    const onFillChange = mock.fn();
    render(bubble({ fill: 0.5, onFillChange }));

    fireEvent.pointerDown(screen.getByRole('radio'));
    holdFor(FILL_BUBBLE_HOLD_MS / 4);
    fireEvent.pointerUp(screen.getByRole('radio'));

    assert.equal(onFillChange.mock.calls[0]?.arguments[0], 0.75);
  });

  /** Scribbling a 28px circle wanders off it; the pointer is captured so that keeps filling. */
  it('keeps filling when a scribble wanders off the control', () => {
    const onFillChange = mock.fn();
    render(bubble({ onFillChange }));

    fireEvent.pointerDown(screen.getByRole('radio'));
    holdFor(FILL_BUBBLE_HOLD_MS / 2);
    fireEvent.pointerLeave(screen.getByRole('radio'));

    assert.equal(onFillChange.mock.callCount(), 0);
  });

  /** The gesture taken away — the OS claiming it, say — still has to end the hold. */
  it('reports where it stopped when the gesture is cancelled', () => {
    const onFillChange = mock.fn();
    render(bubble({ onFillChange }));

    fireEvent.pointerDown(screen.getByRole('radio'));
    holdFor(FILL_BUBBLE_HOLD_MS / 2);
    fireEvent.pointerCancel(screen.getByRole('radio'));

    assert.equal(onFillChange.mock.callCount(), 1);
    assert.equal(onFillChange.mock.calls[0]?.arguments[0], 0.5);
  });
});

describe('FillBubble — what it refuses', () => {
  it('ignores a hold once it is already full', () => {
    const onFillChange = mock.fn();
    render(bubble({ fill: 1, onFillChange }));

    fireEvent.pointerDown(screen.getByRole('radio'));

    assert.equal(frames.length, 0);
    assert.equal(onFillChange.mock.callCount(), 0);
  });

  it('ignores pointer and keyboard while disabled', () => {
    const onFillChange = mock.fn();
    render(bubble({ disabled: true, onFillChange }));
    const control = screen.getByRole('radio');

    fireEvent.pointerDown(control);
    fireEvent.keyDown(control, { key: ' ' });

    assert.equal(frames.length, 0);
    assert.equal(onFillChange.mock.callCount(), 0);
  });
});

describe('FillBubble — without a mouse', () => {
  it('fills while Space is held and reports on release', () => {
    const onFillChange = mock.fn();
    render(bubble({ onFillChange }));
    const control = screen.getByRole('radio');

    fireEvent.keyDown(control, { key: ' ' });
    holdFor(FILL_BUBBLE_HOLD_MS / 2);
    fireEvent.keyUp(control, { key: ' ' });

    assert.equal(onFillChange.mock.calls[0]?.arguments[0], 0.5);
  });

  /** `aria-checked` has no half, so the accessible name is the only place partial can be read. */
  it('says how full it is, since checked cannot', () => {
    const { rerender } = render(bubble({ fill: 0 }));
    assert.ok(screen.getByRole('radio', { name: 'A, not filled' }));

    rerender(bubble({ fill: 0.5 }));
    assert.ok(screen.getByRole('radio', { name: 'A, partly filled' }));

    rerender(bubble({ fill: 1 }));
    assert.ok(screen.getByRole('radio', { name: 'A, filled', checked: true }));
  });
});
