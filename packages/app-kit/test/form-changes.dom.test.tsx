import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { changedValues } from '../src/form-changes';

afterEach(cleanup);

const OPENED = { course: 'SSC', name: 'SSC CGL', code: 'SSC CGL' };

const openedForm = () => renderHook(() => useForm({ defaultValues: OPENED })).result;

/** The failure this prevents: a dialog opened before another admin's rename sending the old name back. */
describe('changedValues', () => {
  it('carries the field that was changed, and not one typed in and put back', () => {
    const form = openedForm();

    act(() => {
      form.current.setValue('course', 'RRB', { shouldDirty: true });
      form.current.setValue('name', 'Renamed', { shouldDirty: true });
      form.current.setValue('name', OPENED.name, { shouldDirty: true });
    });

    assert.deepEqual(changedValues(form.current), { course: 'RRB' });
  });

  it('carries nothing from a form left as it opened', () => {
    assert.deepEqual(changedValues(openedForm().current), {});
  });
});
