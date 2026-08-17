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

/** Boxes share the width up to a cap, so four in a narrow form stay square. */
const BOX = [
  'flex h-12 w-full min-w-0 max-w-14 items-center justify-center rounded-md border bg-surface',
  'text-lg font-medium tabular-nums text-foreground',
  'border-input shadow-sm transition-[box-shadow,border-color]',
].join(' ');

/**
 * One real input under N aria-hidden boxes, which is what makes autofill,
 * paste and screen readers work. The caret is pinned to the end — no mid-value editing.
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

    // The box the next keystroke lands in. Clamped, so a full value highlights the last.
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
          // Concealment is drawn, not native. `password` still drives password-manager behaviour.
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

/** Deferred a frame as well as run now: a click sets the caret after this handler. */
function caretToEnd(input: HTMLInputElement): void {
  const end = input.value.length;
  input.setSelectionRange(end, end);
  requestAnimationFrame(() => input.setSelectionRange(end, end));
}

export { PinInput };
