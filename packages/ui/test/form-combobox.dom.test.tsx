import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { useEffect } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormCombobox } from '../src/components/ui/form-field';
import { TooltipProvider } from '../src/components/ui/tooltip';

afterEach(cleanup);

interface Values {
  mode: string;
}

const MODES = [
  { value: 'ONLINE', label: 'Online' },
  { value: 'OFFLINE', label: 'Offline' },
];

function Harness({
  onChange,
  error,
  expose,
}: Readonly<{
  onChange?: (value: string) => void;
  error?: string;
  expose?: (form: UseFormReturn<Values>) => void;
}>) {
  const form = useForm<Values>({ defaultValues: { mode: 'ONLINE' } });

  useEffect(() => {
    if (error) form.setError('mode', { message: error });
    expose?.(form);
  }, [error, expose, form]);

  // Every combobox trigger carries a Tooltip, so the tests mount the provider `mountApp` mounts.
  return (
    <TooltipProvider>
      <FormCombobox form={form} name="mode" label="Mode" items={MODES} onChange={onChange} />
    </TooltipProvider>
  );
}

describe('FormCombobox', () => {
  it('shows the value the form holds, named by its label', () => {
    render(<Harness />);

    assert.match(screen.getByRole('button', { name: 'Mode' }).textContent ?? '', /Online/);
  });

  /** The failure this prevents: a choice that never reaches the form, or reaches it clean, so a save skips it. */
  it('writes the choice into the form as a change, then tells the caller', async () => {
    const onChange = mock.fn();
    let form: UseFormReturn<Values> | undefined;
    render(<Harness onChange={onChange} expose={(held) => (form = held)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Mode' }));
    fireEvent.click(await screen.findByRole('option', { name: /Offline/ }));

    assert.equal(form?.getValues('mode'), 'OFFLINE');
    assert.equal(form?.getFieldState('mode').isDirty, true);
    assert.deepEqual(onChange.mock.calls[0]?.arguments, ['OFFLINE']);
    assert.match(screen.getByRole('button', { name: 'Mode' }).textContent ?? '', /Offline/);
  });

  it('shows the error the form holds for its field', async () => {
    render(<Harness error="Choose a mode" />);

    await waitFor(() => assert.ok(screen.getByText('Choose a mode')));
  });

  /** The failure this prevents: a refusal nothing re-validates, so every later submit was refused before it was sent. */
  it('drops a server refusal once another choice is made, so the next submit goes through', async () => {
    const onValid = mock.fn();
    let form: UseFormReturn<Values> | undefined;
    render(<Harness expose={(held) => (form = held)} />);

    act(() => form?.setError('mode', { type: 'server', message: 'Not offered here' }));
    assert.ok(screen.getByText('Not offered here'));

    fireEvent.click(screen.getByRole('button', { name: 'Mode' }));
    fireEvent.click(await screen.findByRole('option', { name: /Offline/ }));

    assert.equal(screen.queryAllByText('Not offered here').length, 0);
    await act(() => form?.handleSubmit(onValid)());
    assert.equal(onValid.mock.callCount(), 1);
  });
});
