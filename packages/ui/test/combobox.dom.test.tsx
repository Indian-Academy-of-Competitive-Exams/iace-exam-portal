import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it, mock } from 'node:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Combobox } from '../src/components/ui/combobox';
import { TooltipProvider } from '../src/components/ui/tooltip';

afterEach(cleanup);

/** Every combobox trigger carries a Tooltip, so the tests mount the provider `mountApp` mounts. */
const show = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

const items = [
  { value: 'ext_1', label: 'SSC CGL' },
  { value: 'ext_2', label: 'RRB JE', hint: 'Junior Engineer' },
];

const box = (props: Partial<React.ComponentProps<typeof Combobox>> = {}) => (
  <Combobox value="" onChange={() => {}} items={items} placeholder="Choose…" {...props} />
);

/** The search box is the only text field in the app; it must focus like every other one. */
describe('Combobox search focus', () => {
  const searchable = { search: '', onSearchChange: () => {}, searchPlaceholder: 'Search groups' };

  it('gives the search row the wrapper ring, as input and select do', () => {
    show(box(searchable));
    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    const row = screen.getByLabelText('Search groups').parentElement;

    assert.equal(row?.getAttribute('data-focus-ring'), 'wrapper');
    assert.ok(row?.className.includes('shadow-focus'));
  });

  /** It autofocuses on every open, so focus-within would flash a ring nobody asked for. */
  it('rings on focus-visible, not on the autofocus that opening it causes', () => {
    show(box(searchable));
    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    const row = screen.getByLabelText('Search groups').parentElement;

    assert.ok(row?.className.includes('has-[:focus-visible]:shadow-focus'));
    assert.equal(row?.className.includes('focus-within:shadow-focus'), false);
  });
});

describe('Combobox', () => {
  it('reads as its placeholder while nothing is chosen', () => {
    show(box());

    assert.ok(screen.getByRole('button', { name: 'Choose…' }));
  });

  it('names the chosen item on the trigger', () => {
    show(box({ value: 'ext_2' }));

    assert.ok(screen.getByRole('button', { name: 'RRB JE' }));
  });

  /** An option outside a listbox is invalid ARIA — a pile of buttons with no count or position. */
  it('opens a listbox of options', async () => {
    show(box());

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    assert.ok(await screen.findByRole('listbox'));
    // The two items plus the clear row.
    assert.equal(screen.getAllByRole('option').length, 3);
  });

  it('reports the chosen value and closes', async () => {
    const onChange = mock.fn();
    show(box({ onChange }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    fireEvent.click(await screen.findByRole('option', { name: /SSC CGL/ }));

    assert.deepEqual(onChange.mock.calls[0]?.arguments, ['ext_1']);
    assert.equal(screen.queryByRole('listbox'), null);
  });

  it('offers no way back to nothing when it is not clearable', async () => {
    show(box({ clearable: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    await screen.findByRole('listbox');
    assert.equal(screen.getAllByRole('option').length, 2);
  });

  it('holds the shape of the rows that are coming rather than collapsing', async () => {
    show(box({ items: [], isLoading: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    const list = await screen.findByRole('listbox');
    // Skeleton carries no data-slot; it renders a <div aria-hidden>. The clearable row's Check icon is aria-hidden too, but it's an <svg>.
    assert.equal(list.querySelectorAll('div[aria-hidden="true"]').length, 4);
    assert.equal(screen.queryByText('Nothing matches that'), null);
  });

  it('says nothing matches when the list is genuinely empty', async () => {
    show(box({ items: [], isLoading: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    assert.ok(await screen.findByText('Nothing matches that'));
  });

  /** The failure this prevents: a list that did not load read as a search with no match. */
  it('says the list did not load, with a retry, rather than that nothing matches', async () => {
    const onRetry = mock.fn();
    show(box({ items: [], isError: true, onRetry }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    assert.equal(onRetry.mock.callCount(), 1);
    assert.ok(screen.getByText('Could not load this list.'));
    assert.equal(screen.queryAllByText('Nothing matches that').length, 0);
  });

  it('does not open when disabled', () => {
    show(box({ disabled: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    assert.equal(screen.queryByRole('listbox'), null);
  });

  it('closes on Escape, not just on picking an option', async () => {
    show(box());

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    const list = await screen.findByRole('listbox');

    fireEvent.keyDown(list, { key: 'Escape' });

    assert.equal(screen.queryByRole('listbox'), null);
  });

  /** Radix focuses the first tabbable descendant of the popover content on open; with no search box that's the clear row, which reads as the placeholder. Pinned as observed, not a deliberate design choice. */
  it('moves focus onto the first row when it opens', async () => {
    show(box());

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    await screen.findByRole('listbox');

    assert.equal(document.activeElement, screen.getByRole('option', { name: 'Choose…' }));
  });

  it('moves focus into the search box when the list is searchable', async () => {
    show(box({ search: '', onSearchChange: () => {}, searchPlaceholder: 'Search groups' }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    const searchBox = await screen.findByPlaceholderText('Search groups');
    assert.equal(document.activeElement, searchBox);
  });
});

const WIDTH_PER_CHARACTER = 10;
const TRIGGER_WIDTH = 100;

/** jsdom lays nothing out, so a label is told to measure ten pixels a character against a fixed box — which is what makes a long one genuinely cut. */
function measureByLength(): () => void {
  const element = window.HTMLElement.prototype;
  Object.defineProperty(element, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return (this.textContent ?? '').length * WIDTH_PER_CHARACTER;
    },
  });
  Object.defineProperty(element, 'clientWidth', { configurable: true, get: () => TRIGGER_WIDTH });

  return () => {
    Reflect.deleteProperty(element, 'scrollWidth');
    Reflect.deleteProperty(element, 'clientWidth');
  };
}

describe('the combobox trigger tooltip', () => {
  const LONG = 'Staff Selection Commission Combined Graduate Level Tier One';
  const named = [
    { value: 'ext_1', label: 'SSC' },
    { value: 'ext_2', label: LONG },
  ];

  let restoreMeasuring = () => {};
  before(() => {
    restoreMeasuring = measureByLength();
  });
  after(() => restoreMeasuring());

  /** The failure this prevents: truncation is MEASURED, so it flips after the first paint — and the trigger used to be swapped for a tooltip-wrapped copy at that moment, remounting the button, which lost its focus and left the measurement watching a detached span. */
  it('reveals a label it had to cut, on the button that was already there', async () => {
    const { rerender } = show(box({ items: named, value: 'ext_1' }));
    const trigger = screen.getByRole('button');

    rerender(<TooltipProvider>{box({ items: named, value: 'ext_2' })}</TooltipProvider>);

    assert.equal(screen.getByRole('button'), trigger, 'the trigger is the same button');

    act(() => trigger.focus());

    assert.equal((await screen.findByRole('tooltip')).textContent, LONG);
  });
});
