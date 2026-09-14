import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { useEffect } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormCombobox } from '../src/components/ui/form-field';

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

  return <FormCombobox form={form} name="mode" label="Mode" items={MODES} onChange={onChange} />;
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
});
