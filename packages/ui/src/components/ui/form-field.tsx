import * as React from 'react';
import {
  get,
  type FieldError,
  type FieldValues,
  type Path,
  type UseFormRegisterReturn,
  type UseFormReturn,
} from 'react-hook-form';
import { cn } from '../../lib/utils';
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

/** The inline layout the "new X" cards use: controls grow, wrap, align on their labels. */
export function FormRow({
  className,
  ...props
}: Readonly<React.FormHTMLAttributes<HTMLFormElement>>) {
  return (
    <form className={cn('flex flex-wrap items-start gap-4', className)} noValidate {...props} />
  );
}

/** Buttons at the end of a `FormRow`. The top padding lines them up with the inputs. */
export function FormActions({
  className,
  ...props
}: Readonly<React.HTMLAttributes<HTMLDivElement>>) {
  return <div className={cn('flex gap-2 pt-[1.625rem]', className)} {...props} />;
}
