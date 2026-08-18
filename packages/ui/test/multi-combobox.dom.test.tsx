import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MultiCombobox } from '../src/components/ui/multi-combobox';

afterEach(cleanup);

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
    render(box());

    assert.ok(screen.getByRole('button', { name: 'Choose exams…' }));
  });

  it('summarises the selection on the trigger and lists it as chips', () => {
    render(box({ value: ['SSC CGL', 'RRB JE'] }));

    assert.ok(screen.getByRole('button', { name: '2 selected' }));
    assert.ok(screen.getByText('SSC CGL'));
    assert.ok(screen.getByRole('button', { name: 'Remove RRB JE' }));
  });

  /** A value chosen on an earlier page is still a chip, not a raw id. */
  it('names a value that sits outside the loaded pages', () => {
    render(box({ value: ['RRB NTPC'], items: [], selectedLabels: { 'RRB NTPC': 'RRB NTPC' } }));

    assert.ok(screen.getByRole('button', { name: 'Remove RRB NTPC' }));
  });

  it('announces the list as multi-select', async () => {
    render(box());

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
    render(box());

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
    render(box({ onChange }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose exams…' }));
    fireEvent.click(await screen.findByRole('option', { name: /SSC CGL/ }));

    assert.deepEqual(onChange.mock.calls[0]?.arguments, [['SSC CGL']]);
    assert.ok(screen.getByRole('listbox'), 'the list must not close on a pick');
  });

  it('toggles a chosen value back off from the list', async () => {
    const onChange = mock.fn();
    render(box({ value: ['SSC CGL', 'RRB JE'], onChange }));

    fireEvent.click(screen.getByRole('button', { name: '2 selected' }));
    fireEvent.click(await screen.findByRole('option', { name: /SSC CGL/ }));

    assert.deepEqual(onChange.mock.calls[0]?.arguments, [['RRB JE']]);
  });

  it('removes a value from its chip, without opening the list', () => {
    const onChange = mock.fn();
    render(box({ value: ['SSC CGL', 'RRB JE'], onChange }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove SSC CGL' }));

    assert.deepEqual(onChange.mock.calls[0]?.arguments, [['RRB JE']]);
    assert.equal(screen.queryByRole('listbox'), null);
  });
});
