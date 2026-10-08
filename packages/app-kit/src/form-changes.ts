import { type FieldValues, type UseFormReturn } from 'react-hook-form';

/** What an edit sends: a field left as it opened must not put back a value somebody saved since. */
export function changedValues<T extends FieldValues>(
  form: Pick<UseFormReturn<T>, 'getValues'>,
): Partial<T> {
  return form.getValues(undefined, { dirtyFields: true });
}
