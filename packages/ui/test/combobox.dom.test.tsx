import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Combobox } from '../src/components/ui/combobox';

afterEach(cleanup);

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
    render(box(searchable));
    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    const row = screen.getByLabelText('Search groups').parentElement;

    assert.equal(row?.getAttribute('data-focus-ring'), 'wrapper');
    assert.ok(row?.className.includes('shadow-focus'));
  });

  /** It autofocuses on every open, so focus-within would flash a ring nobody asked for. */
  it('rings on focus-visible, not on the autofocus that opening it causes', () => {
    render(box(searchable));
    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    const row = screen.getByLabelText('Search groups').parentElement;

    assert.ok(row?.className.includes('has-[:focus-visible]:shadow-focus'));
    assert.equal(row?.className.includes('focus-within:shadow-focus'), false);
  });
});

describe('Combobox', () => {
  it('reads as its placeholder while nothing is chosen', () => {
    render(box());

    assert.ok(screen.getByRole('button', { name: 'Choose…' }));
  });

  it('names the chosen item on the trigger', () => {
    render(box({ value: 'ext_2' }));

    assert.ok(screen.getByRole('button', { name: 'RRB JE' }));
  });

  /** An option outside a listbox is invalid ARIA — a pile of buttons with no count or position. */
  it('opens a listbox of options', async () => {
    render(box());

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    assert.ok(await screen.findByRole('listbox'));
    // The two items plus the clear row.
    assert.equal(screen.getAllByRole('option').length, 3);
  });

  it('reports the chosen value and closes', async () => {
    const onChange = mock.fn();
    render(box({ onChange }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    fireEvent.click(await screen.findByRole('option', { name: /SSC CGL/ }));

    assert.deepEqual(onChange.mock.calls[0]?.arguments, ['ext_1']);
    assert.equal(screen.queryByRole('listbox'), null);
  });

  it('offers no way back to nothing when it is not clearable', async () => {
    render(box({ clearable: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    await screen.findByRole('listbox');
    assert.equal(screen.getAllByRole('option').length, 2);
  });

  it('holds the shape of the rows that are coming rather than collapsing', async () => {
    render(box({ items: [], isLoading: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    const list = await screen.findByRole('listbox');
    // Skeleton carries no data-slot; it renders a <div aria-hidden>. The
    // clearable row's Check icon is aria-hidden too, but it is an <svg>.
    assert.equal(list.querySelectorAll('div[aria-hidden="true"]').length, 4);
    assert.equal(screen.queryByText('Nothing matches that'), null);
  });

  it('says nothing matches when the list is genuinely empty', async () => {
    render(box({ items: [], isLoading: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    assert.ok(await screen.findByText('Nothing matches that'));
  });

  it('does not open when disabled', () => {
    render(box({ disabled: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    assert.equal(screen.queryByRole('listbox'), null);
  });

  it('closes on Escape, not just on picking an option', async () => {
    render(box());

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    const list = await screen.findByRole('listbox');

    fireEvent.keyDown(list, { key: 'Escape' });

    assert.equal(screen.queryByRole('listbox'), null);
  });

  /**
   * Radix focuses the first tabbable descendant of the popover content on
   * open; with no search box that is the clear row, which reads as the
   * placeholder. Pinned as observed, not as a deliberate design choice.
   */
  it('moves focus onto the first row when it opens', async () => {
    render(box());

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    await screen.findByRole('listbox');

    assert.equal(document.activeElement, screen.getByRole('option', { name: 'Choose…' }));
  });

  it('moves focus into the search box when the list is searchable', async () => {
    render(box({ search: '', onSearchChange: () => {}, searchPlaceholder: 'Search groups' }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));

    const searchBox = await screen.findByPlaceholderText('Search groups');
    assert.equal(document.activeElement, searchBox);
  });
});
