import * as React from 'react';
import { Input, type InputProps } from './input';

/** Keeps only digits, up to `maxLength`. Exported so it can be tested directly. */
export function digitsOnly(value: string, maxLength?: number): string {
  const digits = value.replace(/\D/g, '');
  return maxLength === undefined ? digits : digits.slice(0, maxLength);
}

export interface NumericInputProps extends Omit<InputProps, 'type'> {
  /** Hard cap on the number of digits, enforced on typing AND on paste. */
  maxLength?: number;
  /** Conceal the value (a PIN). Still digits-only, still the numeric keypad. */
  masked?: boolean;
  /**
   * Replaces the digits-only rule — pasting "+91 98765 43210" must drop the prefix.
   * Set `maxLength` above the final length, or the browser truncates the paste first.
   */
  sanitize?: (raw: string) => string;
}

/**
 * Digits only. `type="tel"` and `inputMode` only ask; a physical keyboard ignores both.
 * `beforeinput` rejects a keystroke; `change` re-filters paste, autofill and drag.
 */
const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  ({ maxLength, masked = false, sanitize, onChange, onBeforeInput, ...props }, ref) => (
    <Input
      {...props}
      ref={ref}
      type={masked ? 'password' : 'tel'}
      inputMode="numeric"
      autoComplete={props.autoComplete ?? 'off'}
      maxLength={maxLength}
      onBeforeInput={(event) => {
        // `data` is null for deletions, which must always be allowed through.
        const inserted = (event.nativeEvent as InputEvent).data;
        if (inserted !== null && /\D/.test(inserted)) event.preventDefault();
        onBeforeInput?.(event);
      }}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        const cleaned = sanitize ? sanitize(raw) : digitsOnly(raw, maxLength);
        // Rewrite before the handler sees it, so downstream only receives digits.
        if (event.currentTarget.value !== cleaned) event.currentTarget.value = cleaned;
        onChange?.(event);
      }}
    />
  ),
);
NumericInput.displayName = 'NumericInput';

export { NumericInput };
