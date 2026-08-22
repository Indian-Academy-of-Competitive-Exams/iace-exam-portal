import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MultiCombobox } from '../src/components/ui/multi-combobox';
import { TooltipProvider } from '../src/components/ui/tooltip';

afterEach(cleanup);

/** Several chosen puts a Tooltip on the trigger, and AppProviders is what supplies its provider. */
const show = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

const items = [
  { value: 'SSC CGL', label: 'SSC CGL' },
  { value: 'RRB JE', label: 'RRB JE', hint: 'Junior Engineer' },
  { value: 'SSC CHSL', label: 'SSC CHSL' },
];

const box = (props: Partial<React.ComponentProps<typeof MultiCombobox>> = {}) => (
  <MultiCombobox
    value={[]}
    onChange={() => {}}
    items={items}
    placeholder="Choose exams…"
    {...props}
  />
);

describe('MultiCombobox', () => {
  it('reads as its placeholder while nothing is chosen', () => {
    show(box());

    assert.ok(screen.getByRole('button', { name: 'Choose exams…' }));
  });

  /** Named rather than counted: "2 selected" makes the reader open the list to learn what they chose. */
  it('names the selection on the trigger, and lists it as chips', () => {
    show(box({ value: ['SSC CGL', 'RRB JE'] }));

    assert.ok(screen.getByRole('button', { name: 'SSC CGL, RRB JE' }));
    assert.ok(screen.getByRole('button', { name: 'Remove RRB JE' }));
  });

  /** A filter bar has a table under it, so the selection stays in the trigger it was chosen from. */
  it('keeps the selection in the trigger alone when chips are off', () => {
    show(box({ value: ['SSC CGL', 'RRB JE'], chips: false }));

    assert.ok(screen.getByRole('button', { name: 'SSC CGL, RRB JE' }));
    assert.equal(screen.queryByRole('button', { name: 'Remove RRB JE' }), null);
  });

  /** A value chosen on an earlier page is still a chip, not a raw id. */
  it('names a value that sits outside the loaded pages', () => {
    show(box({ value: ['RRB NTPC'], items: [], selectedLabels: { 'RRB NTPC': 'RRB NTPC' } }));

    assert.ok(screen.getByRole('button', { name: 'Remove RRB NTPC' }));
  });

  it('announces the list as multi-select', async () => {
    show(box());

    fireEvent.click(screen.getByRole('button', { name: 'Choose exams…' }));

    const list = await screen.findByRole('listbox');
    assert.equal(list.getAttribute('aria-multiselectable'), 'true');
    assert.equal(screen.getAllByRole('option').length, 3);
  });

  /**
   * A multi-select carries no clear row, so the first tabbable descendant of the popover is a real
   * option, not a decoy — unlike `Combobox`, which lands here only by accident.
   */
  it('moves focus onto the first real option when it opens', async () => {
    show(box());

    fireEvent.click(screen.getByRole('button', { name: 'Choose exams…' }));
    await screen.findByRole('listbox');

    assert.equal(document.activeElement, screen.getByRole('option', { name: /SSC CGL/ }));
  });

  /**
   * The failure this exists to prevent: closing on the first pick makes choosing three exam types
   * three round trips through the trigger, and the search term is lost every time.
   */
  it('adds a value and stays open for the next one', async () => {
    const onChange = mock.fn();
    show(box({ onChange }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose exams…' }));
    fireEvent.click(await screen.findByRole('option', { name: /SSC CGL/ }));

    assert.deepEqual(onChange.mock.calls[0]?.arguments, [['SSC CGL']]);
    assert.ok(screen.getByRole('listbox'), 'the list must not close on a pick');
  });

  it('toggles a chosen value back off from the list', async () => {
    const onChange = mock.fn();
    show(box({ value: ['SSC CGL', 'RRB JE'], onChange }));

    fireEvent.click(screen.getByRole('button', { name: 'SSC CGL, RRB JE' }));
    fireEvent.click(await screen.findByRole('option', { name: /SSC CGL/ }));

    assert.deepEqual(onChange.mock.calls[0]?.arguments, [['RRB JE']]);
  });

  it('removes a value from its chip, without opening the list', () => {
    const onChange = mock.fn();
    show(box({ value: ['SSC CGL', 'RRB JE'], onChange }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove SSC CGL' }));

    assert.deepEqual(onChange.mock.calls[0]?.arguments, [['RRB JE']]);
    assert.equal(screen.queryByRole('listbox'), null);
  });
});
