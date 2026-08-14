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
  /**
   * Receives the accessibility wiring AND the register bindings, already
   * merged. Spread it onto the control and there is nothing left to forget.
   */
  children: (control: FieldControl & UseFormRegisterReturn<Path<TValues>>) => React.ReactNode;
}

/**
 * A `Field` bound to one react-hook-form field.
 *
 * `Field` alone still needed three things repeated at every call site — the
 * `htmlFor`, the `register(name)`, and the reach into
 * `formState.errors.<name>.message` — and the first two are the same string
 * written twice. When they drift, the label stops focusing its input and
 * nothing anywhere reports it: the form works, it is just no longer usable by
 * anyone navigating with a keyboard or a screen reader. Taking `name` once
 * makes that impossible to express.
 *
 * The error is read with react-hook-form's own `get`, so a nested name
 * (`profile.dob`) resolves the way the library resolves it rather than the way
 * a hand-written lookup happens to.
 *
 * Server-side messages arrive here too: `applyFieldErrors` from @iace/app-kit
 * writes the envelope's `fieldErrors` into the same `formState.errors` this
 * reads, so a rejection from the API lands on the input that caused it without
 * the screen doing anything.
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

/**
 * The inline form layout the "new X" cards all use: controls that grow, wrap
 * when there is no room, and align on their labels rather than their baselines.
 */
export function FormRow({
  className,
  ...props
}: Readonly<React.FormHTMLAttributes<HTMLFormElement>>) {
  return (
    <form className={cn('flex flex-wrap items-start gap-4', className)} noValidate {...props} />
  );
}

/**
 * The buttons at the end of a `FormRow`.
 *
 * The top padding is what lines them up with the INPUTS rather than with the
 * labels above them. It was a hand-written `pt-[26px]` on every such form — the
 * same magic number, copied, with nothing tying it to the label height it was
 * measured from. One place now, so a change to label spacing is one edit.
 */
export function FormActions({
  className,
  ...props
}: Readonly<React.HTMLAttributes<HTMLDivElement>>) {
  return <div className={cn('flex gap-2 pt-[1.625rem]', className)} {...props} />;
}
