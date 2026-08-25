import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RatioBar, type RatioPart } from '../src/components/ui/ratio-bar';

afterEach(cleanup);

const PARTS: [RatioPart, RatioPart, RatioPart] = [
  { key: 'LOW', label: 'Low', className: 'bg-success' },
  { key: 'MEDIUM', label: 'Medium', className: 'bg-warning' },
  { key: 'HIGH', label: 'High', className: 'bg-destructive' },
];

function mount(values: [number, number, number] = [7, 11, 7]) {
  const onChange = mock.fn();
  render(<RatioBar parts={PARTS} values={values} total={25} onChange={onChange} />);
  return onChange;
}

const handles = () => screen.getAllByRole('slider');

describe('RatioBar', () => {
  it('shows each part with the count it holds', () => {
    mount();

    assert.equal(screen.getAllByText('7').length, 2);
    assert.ok(screen.getByText('11'));
  });

  /** The failure this prevents: a control only a mouse can drive. */
  it('moves a handle with the arrow keys', () => {
    const onChange = mount();

    fireEvent.keyDown(handles()[0]!, { key: 'ArrowRight' });

    assert.deepEqual(onChange.mock.calls[0]?.arguments, [[8, 10, 7]]);
  });

  it('takes from one side and gives to the other, leaving the third alone', () => {
    const onChange = mount();

    fireEvent.keyDown(handles()[1]!, { key: 'ArrowLeft' });

    // The second handle governs medium and high; low is not its business.
    assert.deepEqual(onChange.mock.calls[0]?.arguments, [[7, 10, 8]]);
  });

  /** The total is what makes this a split rather than three numbers that might disagree. */
  it('never lets the three add up to anything but the total', () => {
    const onChange = mount();

    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      for (const handle of handles()) fireEvent.keyDown(handle, { key });
    }

    for (const call of onChange.mock.calls) {
      const next = call.arguments[0] as [number, number, number];
      assert.equal(next[0] + next[1] + next[2], 25, key(next));
    }
  });

  it('stops at nought rather than borrowing from the part beyond it', () => {
    const onChange = mount([0, 18, 7]);

    fireEvent.keyDown(handles()[0]!, { key: 'ArrowLeft' });

    assert.deepEqual(onChange.mock.calls[0]?.arguments, [[0, 18, 7]]);
  });

  it('takes a handle to its own end on Home and End', () => {
    const onChange = mount();

    fireEvent.keyDown(handles()[0]!, { key: 'Home' });
    fireEvent.keyDown(handles()[0]!, { key: 'End' });

    assert.deepEqual(onChange.mock.calls[0]?.arguments, [[0, 18, 7]]);
    assert.deepEqual(onChange.mock.calls[1]?.arguments, [[18, 0, 7]]);
  });

  /** A handle says nothing on its own, so it has to name the two parts it sits between. */
  it('tells a reader what each handle governs and what it now reads', () => {
    mount();

    const [first] = handles();
    assert.equal(first?.getAttribute('aria-label'), 'Low and Medium');
    assert.equal(first?.getAttribute('aria-valuenow'), '7');
    assert.equal(first?.getAttribute('aria-valuetext'), '7 Low, 11 Medium');
    assert.equal(first?.getAttribute('aria-valuemax'), '25');
  });

  /** jsdom measures nothing, so the track is given a width for the drag to resolve against. */
  function measured() {
    const handle = handles()[0]!;
    handle.parentElement!.getBoundingClientRect = () => ({ left: 0, width: 250 }) as DOMRect;
    return handle;
  }

  /** The failure this prevents: a drag ending the moment the pointer leaves the handle's pixels. */
  it('keeps following a pointer that has left the handle', () => {
    const onChange = mount();
    const handle = measured();

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 70 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 200 });

    // 100 of 250 is two fifths of 25 questions, so the boundary lands on 10.
    assert.deepEqual(onChange.mock.calls[0]?.arguments, [[10, 8, 7]]);
    // 200 asks for 20, and low plus medium is 18 — the third part is not this handle's to take.
    assert.deepEqual(onChange.mock.calls[1]?.arguments, [[18, 0, 7]]);
  });

  it('ignores a pointer that never pressed it', () => {
    const onChange = mount();
    measured();

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100 });

    assert.equal(onChange.mock.callCount(), 0);
  });

  it('stops following once the pointer is let go', () => {
    const onChange = mount();
    const handle = measured();

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 70 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 200 });

    assert.equal(onChange.mock.callCount(), 0);
  });

  it('is out of the tab order and deaf to keys when disabled', () => {
    const onChange = mock.fn();
    render(<RatioBar parts={PARTS} values={[7, 11, 7]} total={25} onChange={onChange} disabled />);

    const handle = screen.getAllByRole('slider')[0]!;
    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    assert.equal(handle.getAttribute('tabindex'), '-1');
    assert.equal(onChange.mock.callCount(), 0);
  });
});

const key = (values: readonly number[]) => values.join('/');
