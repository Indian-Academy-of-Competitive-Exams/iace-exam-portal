import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RowActions } from '../src/components/ui/row-actions';
import { DropdownMenuItem } from '../src/components/ui/dropdown-menu';

afterEach(cleanup);

describe('RowActions', () => {
  /** One trigger, whatever the row can do — a button per action is width off every row. */
  it('shows one control until it is opened', () => {
    render(
      <RowActions label="Actions for AMEERPET">
        <DropdownMenuItem>Retire</DropdownMenuItem>
        <DropdownMenuItem destructive>Delete</DropdownMenuItem>
      </RowActions>,
    );

    assert.equal(screen.getAllByRole('button').length, 1);
    assert.equal(screen.queryByText('Delete'), null);
  });

  /** The failure this prevents: a trigger on every row that opens on an empty list. */
  it('draws nothing at all when the row can do nothing', () => {
    render(<RowActions label="Actions for AMEERPET">{null}</RowActions>);

    assert.equal(screen.queryByRole('button'), null);
  });

  /** Call sites filter items inline, so every one of them can come back false. */
  it('draws nothing when every item was filtered out', () => {
    const canWrite = false;
    render(
      <RowActions label="Actions for AMEERPET">
        {canWrite ? <DropdownMenuItem>Retire</DropdownMenuItem> : null}
        {canWrite ? <DropdownMenuItem destructive>Delete</DropdownMenuItem> : null}
      </RowActions>,
    );

    assert.equal(screen.queryByRole('button'), null);
  });

  it('still draws where one item survives the filter', () => {
    render(
      <RowActions label="Actions for AMEERPET">
        {null}
        <DropdownMenuItem>Retire</DropdownMenuItem>
      </RowActions>,
    );

    assert.equal(screen.getAllByRole('button').length, 1);
  });

  /** The glyph says nothing, so the row it belongs to has to be in the name. */
  it('names the row it acts on', () => {
    render(
      <RowActions label="Actions for AMEERPET">
        <DropdownMenuItem>Retire</DropdownMenuItem>
      </RowActions>,
    );

    assert.ok(screen.getByRole('button', { name: 'Actions for AMEERPET' }));
  });

  it('opens its items and runs the one chosen', async () => {
    const onSelect = mock.fn();
    render(
      <RowActions>
        <DropdownMenuItem onSelect={onSelect}>Retire</DropdownMenuItem>
      </RowActions>,
    );

    // Radix opens a menu on pointerDown, not click.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Row actions' }), { button: 0 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Retire' }));

    await waitFor(() => assert.equal(onSelect.mock.callCount(), 1));
  });
});
