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

  /** Round, because the trigger is a bare glyph — the same rule every icon control follows. */
  it('uses the round icon button', () => {
    render(
      <RowActions>
        <DropdownMenuItem>Retire</DropdownMenuItem>
      </RowActions>,
    );

    assert.match(screen.getByRole('button').className, /rounded-full/);
  });
});

describe('the row menu and focus', () => {
  /** lucide defaults to 24px, which is half again the row's text. The menu sizes it, not the caller. */
  it('sizes an item icon like the trigger sizes its own', async () => {
    render(
      <RowActions>
        <DropdownMenuItem>
          <svg data-testid="glyph" />
          Retire
        </DropdownMenuItem>
      </RowActions>,
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Row actions' }), { button: 0 });
    const item = (await screen.findByTestId('glyph')).parentElement;

    assert.match(item?.className ?? '', /\[&_svg\]:size-4/);
  });

  /** The one focus treatment the rest of the system uses; Button had hand-rolled its own. */
  it('focuses the way every other control does', () => {
    render(
      <RowActions>
        <DropdownMenuItem>Retire</DropdownMenuItem>
      </RowActions>,
    );

    const trigger = screen.getByRole('button');
    assert.match(trigger.className, /focus-visible:shadow-focus/);
    assert.equal(trigger.className.includes('focus-visible:ring-2'), false);
  });
});
