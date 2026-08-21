import assert from 'node:assert/strict';
import * as React from 'react';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '../src/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../src/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../src/components/ui/tabs';
import { ConfirmDialog } from '../src/components/ui/dialog';

afterEach(cleanup);

describe('Sheet', () => {
  const drawer = (props: { open: boolean; onOpenChange?: (o: boolean) => void }) => (
    <Sheet {...props}>
      <SheetContent side="left" showClose={false} aria-describedby={undefined}>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <a href="/students">All students</a>
        <SheetClose>Close</SheetClose>
      </SheetContent>
    </Sheet>
  );

  /** An sr-only title is still the name a screen reader announces on arrival. */
  it('is a named dialog even when its heading is hidden', () => {
    render(drawer({ open: true }));

    assert.ok(screen.getByRole('dialog', { name: 'Navigation' }));
  });

  it('moves focus into the panel', async () => {
    render(drawer({ open: true }));

    await waitFor(() =>
      assert.ok(screen.getByRole('dialog').contains(document.activeElement as Node)),
    );
  });

  it('asks the caller to close on Escape', async () => {
    const onOpenChange = mock.fn();
    render(drawer({ open: true, onOpenChange }));

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() => assert.deepEqual(onOpenChange.mock.calls[0]?.arguments, [false]));
  });

  it('renders nothing at all while closed', () => {
    render(drawer({ open: false }));

    assert.equal(screen.queryByRole('dialog'), null);
    assert.equal(screen.queryByRole('link', { name: 'All students' }), null);
  });
});

describe('DropdownMenu', () => {
  const menu = () => (
    <DropdownMenu>
      <DropdownMenuTrigger>Account</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>ravi@iace.co.in</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href="/profile">Profile</a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive>Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  /** A popover announces no count and no position; a menu does both. */
  it('announces itself as a menu with menu items', async () => {
    render(menu());

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Account' }), { button: 0 });

    assert.ok(await screen.findByRole('menu'));
    assert.equal(screen.getAllByRole('menuitem').length, 2);
  });

  /** An <a href> would reload the SPA and throw away the query cache. */
  it('lets a link be an item without losing its menu role', async () => {
    render(menu());

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Account' }), { button: 0 });

    const item = await screen.findByRole('menuitem', { name: 'Profile' });
    assert.equal(item.tagName, 'A');
    assert.equal(item.getAttribute('href'), '/profile');
  });

  it('is closed until it is opened', () => {
    render(menu());

    assert.equal(screen.queryByRole('menu'), null);
  });
});

describe('Tabs', () => {
  const report = () => (
    <Tabs defaultValue="score">
      <TabsList>
        <TabsTrigger value="score">Score card</TabsTrigger>
        <TabsTrigger value="solutions">Solutions</TabsTrigger>
      </TabsList>
      <TabsContent value="score">Rank 12</TabsContent>
      <TabsContent value="solutions">Question 1</TabsContent>
    </Tabs>
  );

  it('is a tablist of tabs, with one panel showing', () => {
    render(report());

    assert.equal(screen.getAllByRole('tab').length, 2);
    assert.ok(screen.getByRole('tabpanel', { name: 'Score card' }));
    assert.ok(screen.getByText('Rank 12'));
    assert.equal(screen.queryByText('Question 1'), null);
  });

  it('marks exactly one tab selected', () => {
    render(report());
    const [active, inactive] = screen.getAllByRole('tab');

    assert.equal(active?.getAttribute('aria-selected'), 'true');
    assert.equal(inactive?.getAttribute('aria-selected'), 'false');
  });

  it('switches the panel with the tab', () => {
    render(report());

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Solutions' }));

    assert.ok(screen.getByText('Question 1'));
    assert.equal(screen.queryByText('Rank 12'), null);
  });

  /**
   * Roving focus: one tab at a time is in the page's tab order, so Tab moves INTO
   * the panel rather than across the other tabs.
   */
  it('keeps only the current tab in the tab order', () => {
    render(report());

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Solutions' }));
    fireEvent.focus(screen.getByRole('tablist'));

    assert.deepEqual(
      screen.getAllByRole('tab').map((tab) => tab.getAttribute('tabindex')),
      ['-1', '0'],
    );
  });
});

/** With an entry animation and no exit, a sheet vanished on the frame the state flipped. */
describe('overlays animate out as well as in', () => {
  it('gives the sheet and its scrim a closed-state animation', () => {
    render(
      <Sheet open>
        <SheetContent side="left">
          <SheetTitle>Nav</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    const panel = screen.getByRole('dialog');
    assert.match(panel.className, /data-\[state=closed\]:animate-sheet-out-left/);
    assert.match(panel.className, /data-\[state=open\]:animate-sheet-in-left/);
  });
});

/** No DialogTrigger to return to, so a keyboard used to close onto the top of the document. */
describe('a dialog gives focus back to whatever opened it', () => {
  function Harness() {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Sure?"
          description="Yes?"
          confirmLabel="Do it"
          onConfirm={() => setOpen(false)}
        />
      </>
    );
  }

  it('returns focus to the opener, not the document', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    await waitFor(() => assert.equal(document.activeElement, opener));
  });
});
