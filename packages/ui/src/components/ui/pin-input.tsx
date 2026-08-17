import * as React from 'react';
import { cn } from '../../lib/utils';
import { digitsOnly } from './numeric-input';

export interface PinInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'maxLength' | 'size'
> {
  /** How many digits — one box each. A PIN is 4; an OTP is whatever the server sent. */
  length: number;
  value: string;
  /** The whole value, not an event: the boxes are a rendering, not the state. */
  onChange: (value: string) => void;
  /** Fired the moment the last box fills — for auto-submit. */
  onComplete?: (value: string) => void;
  /** Show dots instead of digits. A PIN is a secret; an emailed OTP is not. */
  masked?: boolean;
  /** Marks the field invalid for both styling and assistive tech. */
  invalid?: boolean;
}

/**
 * Boxes share the width, but stop growing at `max-w-14`.
 *
 * `w-full` alone makes four boxes in a narrow form stretch into squat letterbox
 * shapes that stop reading as digit cells; a fixed width alone overflows a
 * phone once the code is eight digits. Sharing up to a cap does both.
 */
const BOX = [
  'flex h-12 w-full min-w-0 max-w-14 items-center justify-center rounded-md border bg-surface',
  'text-lg font-medium tabular-nums text-foreground',
  'border-input shadow-sm transition-[box-shadow,border-color]',
].join(' ');

/**
 * A code entered one digit per box — the shape every bank app and OTP screen
 * has already taught people to expect.
 *
 * **One real input, N drawn boxes**, rather than N inputs of `maxLength={1}`.
 * The boxes are `aria-hidden` decoration over a single focusable field that
 * holds the entire value, and that is what makes the rest work:
 *
 *   - **Autofill.** `autocomplete="one-time-code"` only fills a field that can
 *     hold the whole code. Split across four inputs, iOS and Android drop the
 *     code into the first box and leave the student to type the rest — which is
 *     the exact convenience the segmented look is promising.
 *   - **Paste.** A pasted code lands in one field and spreads across the boxes.
 *     Four inputs would take the first digit and silently discard the others.
 *   - **Screen readers.** One labelled field announces "One-time code, 4 8 1 3".
 *     Four unlabelled boxes announce "edit text, blank" four times, and a
 *     correction means hunting for which box holds the wrong digit.
 *
 * The caret is pinned to the end on every focus and click, so clicking box two
 * of four does not strand the next keystroke in the middle of the value. That
 * is a deliberate simplification: mid-value editing is not worth the ambiguity
 * when the whole value is four digits and retyping it costs nothing.
 */
const PinInput = React.forwardRef<HTMLInputElement, PinInputProps>(
  (
    {
      length,
      value,
      onChange,
      onComplete,
      masked = false,
      invalid,
      className,
      disabled,
      onFocus,
      onBlur,
      onClick,
      autoComplete = 'one-time-code',
      ...props
    },
    ref,
  ) => {
    const [focused, setFocused] = React.useState(false);

    // The box the next keystroke lands in. Clamped, so a full value highlights
    // the last box instead of nothing — otherwise the field looks unfocused at
    // exactly the moment the student is deciding whether to submit.
    const activeIndex = Math.min(value.length, length - 1);

    return (
      <div className={cn('relative', className)}>
        <div aria-hidden className="flex gap-2">
          {Array.from({ length }, (_, index) => {
            const filled = index < value.length;
            const isActive = focused && index === activeIndex;

            return (
              <div
                key={index}
                className={cn(
                  BOX,
                  isActive && 'border-ring shadow-focus',
                  invalid && 'border-destructive',
                  invalid && isActive && 'shadow-focus-invalid',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                {filled ? renderCell(value[index], masked) : null}
              </div>
            );
          })}
        </div>

        {/*
          Invisible, NOT hidden: `opacity-0` over the boxes keeps it focusable,
          tabbable, clickable and reachable by autofill. `display:none` or a
          `sr-only` clip would take all four of those away, and the boxes would
          become a picture of a field that cannot be typed into.
        */}
        <input
          {...props}
          ref={ref}
          value={value}
          disabled={disabled}
          // Concealment is drawn, not native — the input is invisible either
          // way. `password` is still right for a PIN: it is what stops a
          // password manager offering to save a one-time code, and what makes
          // one offer to fill a PIN.
          type={masked ? 'password' : 'text'}
          inputMode="numeric"
          autoComplete={autoComplete}
          maxLength={length}
          aria-invalid={invalid || undefined}
          className="absolute inset-0 h-full w-full cursor-default opacity-0 outline-none disabled:cursor-not-allowed"
          onChange={(event) => {
            const next = digitsOnly(event.currentTarget.value, length);
            onChange(next);
            if (next.length === length) onComplete?.(next);
          }}
          onFocus={(event) => {
            setFocused(true);
            caretToEnd(event.currentTarget);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          onClick={(event) => {
            caretToEnd(event.currentTarget);
            onClick?.(event);
          }}
        />
      </div>
    );
  },
);
PinInput.displayName = 'PinInput';

/** A filled box: the digit, or the dot standing in for it. */
function renderCell(digit: string | undefined, masked: boolean): React.ReactNode {
  return masked ? <span className="text-2xl leading-none">&bull;</span> : digit;
}

/**
 * Deferred to the next frame as well as run now: a click sets the caret AFTER
 * this handler, so setting it here alone is immediately undone.
 */
function caretToEnd(input: HTMLInputElement): void {
  const end = input.value.length;
  input.setSelectionRange(end, end);
  requestAnimationFrame(() => input.setSelectionRange(end, end));
}

export { PinInput };
