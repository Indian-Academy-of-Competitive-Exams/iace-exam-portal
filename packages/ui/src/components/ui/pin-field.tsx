import * as React from 'react';
import {
  Controller,
  get,
  type FieldError,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from 'react-hook-form';
import { Field } from './field';
import { PinInput } from './pin-input';

export interface PinFieldProps<TValues extends FieldValues> {
  form: UseFormReturn<TValues>;
  name: Path<TValues>;
  label: React.ReactNode;
  /** A PIN is 4. An OTP is whatever the server said — never assume six. */
  length: number;
  /** Dots instead of digits. A PIN is a secret; an emailed code is not. */
  masked?: boolean;
  autoFocus?: boolean;
  /** `one-time-code` lets a phone offer the SMS; the PIN screens use password. */
  autoComplete?: string;
  hint?: React.ReactNode;
  className?: string;
}

/**
 * `FormField`'s sibling for the boxed inputs — a PIN, an OTP.
 *
 * It exists because `FormField` cannot serve them. That one hands the control
 * `register(name)`, and `register` leaves the value in the DOM; `PinInput`
 * RENDERS the value into its boxes, so it has to be controlled through
 * `Controller` or the digits are typed into a field nothing draws. Every screen
 * with a code on it had therefore written out the same Field + Controller +
 * PinInput sandwich — the admin's sign-in code, the student's PIN, the
 * student's OTP, and the change-PIN form.
 *
 * The error is read from the form the way `FormField` reads it, so a rejection
 * from the API — written into `formState.errors` by `applyFieldErrors` — lands
 * on the boxes without the screen doing anything.
 */
export function PinField<TValues extends FieldValues>({
  form,
  name,
  label,
  length,
  masked,
  autoFocus,
  autoComplete,
  hint,
  className,
}: Readonly<PinFieldProps<TValues>>) {
  const error = get(form.formState.errors, name) as FieldError | undefined;

  return (
    <Field htmlFor={name} label={label} hint={hint} error={error?.message} className={className}>
      {(wiring) => (
        <Controller
          name={name}
          control={form.control}
          render={({ field: { value, ...field } }) => (
            <PinInput
              {...wiring}
              {...field}
              // The field may hold undefined before anything is typed, and an
              // input flipping from uncontrolled to controlled warns and loses
              // its first keystroke.
              value={String(value ?? '')}
              length={length}
              masked={masked}
              autoFocus={autoFocus}
              autoComplete={autoComplete}
              invalid={Boolean(error)}
            />
          )}
        />
      )}
    </Field>
  );
}
