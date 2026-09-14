import * as React from 'react';
import {
  get,
  useWatch,
  type FieldError,
  type FieldValues,
  type Path,
  type PathValue,
  type UseFormRegisterReturn,
  type UseFormReturn,
} from 'react-hook-form';
import { Combobox, type ComboboxProps } from './combobox';
import { Field } from './field';

/** Everything a control needs to be labelled, described and marked invalid. */
export type FieldControl = {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
};

export interface FormFieldProps<TValues extends FieldValues> {
  form: UseFormReturn<TValues>;
  name: Path<TValues>;
  label: React.ReactNode;
  /** Standing guidance — shown until an error replaces it. */
  hint?: React.ReactNode;
  className?: string;
  /** Accessibility wiring merged with the register bindings — spread onto the control. */
  children: (control: FieldControl & UseFormRegisterReturn<Path<TValues>>) => React.ReactNode;
}

/**
 * A `Field` bound to one react-hook-form field: `htmlFor`, `register(name)` and the error.
 * Reads the error with the library's `get`, so nested names (`profile.dob`) resolve.
 */
export function FormField<TValues extends FieldValues>({
  form,
  name,
  label,
  hint,
  className,
  children,
}: Readonly<FormFieldProps<TValues>>) {
  const error = get(form.formState.errors, name) as FieldError | undefined;

  return (
    <Field htmlFor={name} label={label} hint={hint} error={error?.message} className={className}>
      {(control) => children({ ...control, ...form.register(name) })}
    </Field>
  );
}

export interface FormComboboxProps<TValues extends FieldValues>
  extends
    Omit<FormFieldProps<TValues>, 'children'>,
    Omit<ComboboxProps, 'value' | 'onChange' | 'id' | 'className'> {
  /** Runs after the choice is written, for a field whose choice clears another. */
  onChange?: (value: string) => void;
}

/** A `Combobox` bound to one string field: it reads the value, writes the choice dirty, shows the error. */
export function FormCombobox<TValues extends FieldValues>({
  form,
  name,
  label,
  hint,
  className,
  onChange,
  clearable = false,
  ...combobox
}: Readonly<FormComboboxProps<TValues>>) {
  const value = useWatch({ control: form.control, name }) as string | null | undefined;
  const error = get(form.formState.errors, name) as FieldError | undefined;

  return (
    <Field htmlFor={name} label={label} hint={hint} error={error?.message} className={className}>
      {(control) => (
        <Combobox
          {...control}
          {...combobox}
          clearable={clearable}
          value={value ?? ''}
          onChange={(next) => {
            form.setValue(name, next as PathValue<TValues, Path<TValues>>, { shouldDirty: true });
            onChange?.(next);
          }}
        />
      )}
    </Field>
  );
}
