import * as React from 'react';
import { Input, type InputProps } from './input';

/**
 * Keeps only digits, up to `maxLength`.
 *
 * Pure and exported so it can be tested directly — the browser behaviour on
 * top of it is just plumbing, and this is the part that must never let a letter
 * through.
 */
export function digitsOnly(value: string, maxLength?: number): string {
  const digits = value.replace(/\D/g, '');
  return maxLength === undefined ? digits : digits.slice(0, maxLength);
}

export interface NumericInputProps extends Omit<InputProps, 'type'> {
  /** Hard cap on the number of digits, enforced on typing AND on paste. */
  maxLength?: number;
  /**
   * Conceal the value (a PIN). Still digits-only and still the numeric keypad —
   * `type="password"` handles the masking, `inputMode` handles the keyboard.
   */
  masked?: boolean;
  /**
   * Replaces the default digits-only rule. A mobile number needs it: pasting
   * "+91 98765 43210" must drop the country code, not keep it and lose the last
   * two digits to the length cap. Set `maxLength` above the final length when
   * using this, or the browser truncates the paste before it is ever seen.
   */
  sanitize?: (raw: string) => string;
}

/**
 * A field that accepts digits and nothing else.
 *
 * `type="tel"` and `inputMode="numeric"` only ask politely: they pick the phone
 * keypad on a mobile, and are ignored entirely by a physical keyboard. Typing
 * letters into a mobile-number field stayed possible, and the student found out
 * it was wrong only after submitting.
 *
 * Two layers, because either alone leaves a hole:
 *   - `beforeinput` rejects a non-digit before it is inserted, which keeps the
 *     caret where the student left it;
 *   - `change` re-filters regardless, covering paste, drag-and-drop, autofill
 *     and any browser that does not fire `beforeinput`.
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
        // Rewrite before the handler sees it, so react-hook-form and any zod
        // resolver downstream only ever receive digits.
        if (event.currentTarget.value !== cleaned) event.currentTarget.value = cleaned;
        onChange?.(event);
      }}
    />
  ),
);
NumericInput.displayName = 'NumericInput';

export { NumericInput };
