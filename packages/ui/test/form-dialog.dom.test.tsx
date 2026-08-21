import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { useForm } from 'react-hook-form';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormDialog } from '../src/components/ui/form-dialog';

afterEach(cleanup);

interface Values {
  name: string;
}

/** A caller, as the route files write one: the form lives outside, the dialog drives it. */
function Harness({
  open = true,
  loading = false,
  onOpenChange = () => {},
  onSubmit = () => {},
}: Readonly<{
  open?: boolean;
  loading?: boolean;
  onOpenChange?: (next: boolean) => void;
  onSubmit?: (values: Values) => void;
}>) {
  const form = useForm<Values>({ defaultValues: { name: '' } });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      form={form}
      onSubmit={onSubmit}
      title="New branch"
      description="A centre, not a batch."
      submitLabel="Create"
      loading={loading}
    >
      <input aria-label="Branch name" {...form.register('name')} />
    </FormDialog>
  );
}

describe('FormDialog', () => {
  it('names the action on its button rather than saying "Submit"', () => {
    render(<Harness />);

    assert.ok(screen.getByRole('button', { name: 'Create' }));
    assert.equal(screen.queryByRole('button', { name: 'Submit' }), null);
  });

  it('is labelled and described by its own title and description', () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog');

    assert.equal(
      document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent,
      'New branch',
    );
    assert.equal(
      document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent,
      'A centre, not a batch.',
    );
  });

  it('hands the submit handler the form values', async () => {
    const onSubmit = mock.fn();
    render(<Harness onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Branch name'), { target: { value: 'AMEERPET' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => assert.equal(onSubmit.mock.callCount(), 1));
    assert.equal((onSubmit.mock.calls[0]?.arguments[0] as Values).name, 'AMEERPET');
  });

  /** A shut dialog stays mounted, so without a reset a half-typed name reopens with it. */
  it('clears what was typed when it closes, so it reopens empty', async () => {
    const onOpenChange = mock.fn();
    render(<Harness onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText('Branch name'), {
      target: { value: 'TYPED THEN ABANDONED' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => assert.equal(onOpenChange.mock.callCount(), 1));
    assert.equal(onOpenChange.mock.calls[0]?.arguments[0], false);
    assert.equal((screen.getByLabelText('Branch name') as HTMLInputElement).value, '');
  });

  it('does not submit when Cancel is what was pressed', async () => {
    const onSubmit = mock.fn();
    const onOpenChange = mock.fn();
    render(<Harness onSubmit={onSubmit} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => assert.equal(onOpenChange.mock.callCount(), 1));
    assert.equal(onSubmit.mock.callCount(), 0);
  });

  /** A second click while the first request is in flight creates the row twice. */
  it('makes both buttons inert while the request is in flight', () => {
    render(<Harness loading />);

    assert.equal(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled'), true);
    assert.equal(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled'), true);
  });
});
