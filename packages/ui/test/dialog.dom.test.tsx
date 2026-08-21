import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ConfirmDialog } from '../src/components/ui/dialog';

afterEach(cleanup);

const props = {
  open: true,
  onOpenChange: () => {},
  title: 'Delete AMEERPET?',
  description: 'This cannot be undone.',
  confirmLabel: 'Delete branch',
  onConfirm: () => {},
};

/** One scroller per dialog: a scrollbar inside a scrollbar strands content between the two. */
describe('dialog scrollports', () => {
  it('gives a dialog exactly one vertical scroller, and it is the body', () => {
    render(<ConfirmDialog {...props}>a long body</ConfirmDialog>);

    const scrollers = document.querySelectorAll('[class*="overflow-y-auto"]');

    assert.equal(scrollers.length, 1);
    assert.ok(scrollers[0]?.className.includes('--modal-pad'));
  });

  it('lets that body shrink, so it scrolls instead of pushing the dialog off-screen', () => {
    render(<ConfirmDialog {...props}>a long body</ConfirmDialog>);

    const body = document.querySelector('[class*="overflow-y-auto"]');

    assert.ok(body?.className.includes('min-h-0'));
  });
});

describe('ConfirmDialog', () => {
  /** Enter on a dialog that appeared under someone's fingers must not delete. */
  it('opens with the focus on Cancel, not on the destructive action', async () => {
    render(<ConfirmDialog {...props} destructive />);

    await waitFor(() =>
      assert.equal(document.activeElement, screen.getByRole('button', { name: 'Cancel' })),
    );
  });

  it('names the action on its button rather than saying "Confirm"', () => {
    render(<ConfirmDialog {...props} />);

    assert.ok(screen.getByRole('button', { name: 'Delete branch' }));
    assert.equal(screen.queryByRole('button', { name: 'Confirm' }), null);
  });

  it('is labelled and described by its own title and body', () => {
    render(<ConfirmDialog {...props} />);
    const dialog = screen.getByRole('dialog');

    assert.match(dialog.getAttribute('aria-labelledby') ?? '', /.+/);
    assert.equal(
      document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent,
      'Delete AMEERPET?',
    );
    assert.equal(
      document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent,
      'This cannot be undone.',
    );
  });

  /** The caller closes it when the work finishes, so a failure stays on screen. */
  it('calls onConfirm and does not close itself', async () => {
    const onConfirm = mock.fn();
    const onOpenChange = mock.fn();
    render(<ConfirmDialog {...props} onConfirm={onConfirm} onOpenChange={onOpenChange} />);

    screen.getByRole('button', { name: 'Delete branch' }).click();

    await waitFor(() => assert.equal(onConfirm.mock.callCount(), 1));
    assert.equal(onOpenChange.mock.callCount(), 0);
    assert.ok(screen.getByRole('dialog'));
  });

  it('Cancel asks the caller to close', () => {
    const onOpenChange = mock.fn();
    render(<ConfirmDialog {...props} onOpenChange={onOpenChange} />);

    screen.getByRole('button', { name: 'Cancel' }).click();

    assert.deepEqual(onOpenChange.mock.calls[0]?.arguments, [false]);
  });

  /** Dismissing mid-request leaves the reader guessing whether it happened. */
  it('refuses Escape while the action is in flight', async () => {
    const onOpenChange = mock.fn();
    render(<ConfirmDialog {...props} loading onOpenChange={onOpenChange} />);

    const dialog = screen.getByRole('dialog');
    dialog.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    await waitFor(() => assert.ok(screen.getByRole('dialog')));
    assert.equal(onOpenChange.mock.callCount(), 0);
  });

  it('closes on Escape when nothing is in flight', async () => {
    const onOpenChange = mock.fn();
    render(<ConfirmDialog {...props} onOpenChange={onOpenChange} />);

    screen
      .getByRole('dialog')
      .dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );

    await waitFor(() => assert.deepEqual(onOpenChange.mock.calls[0]?.arguments, [false]));
  });

  it('disables both buttons while the action is in flight', () => {
    render(<ConfirmDialog {...props} loading />);

    for (const name of ['Cancel', 'Delete branch']) {
      assert.equal((screen.getByRole('button', { name }) as HTMLButtonElement).disabled, true);
    }
  });
});
