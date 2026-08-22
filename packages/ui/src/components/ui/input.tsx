import * as React from 'react';
import { cn } from '../../lib/utils';

// `prefix` is a global RDFa HTML attribute typed as string; ours is a node.
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  /** Marks the field invalid for both styling and assistive tech. */
  invalid?: boolean;
  /** Inside the control, before the text — a country code, a currency, a search icon. */
  prefix?: React.ReactNode;
  /** Rendered inside the control, after the text — a unit, a reveal toggle. */
  suffix?: React.ReactNode;
}

/** Focus is a soft glow; invalid is the same glow in crimson. */
const CONTROL = [
  'flex h-10 w-full items-center gap-2 rounded-md border bg-surface px-3 text-sm',
  'border-input text-foreground shadow-sm transition-[box-shadow,border-color]',
  'focus-within:border-ring focus-within:shadow-focus',
  'has-[input:disabled]:cursor-not-allowed has-[input:disabled]:border-disabled-border',
  'has-[input:disabled]:bg-disabled has-[input:disabled]:text-disabled-foreground',
  'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-within:shadow-focus-invalid',
].join(' ');

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, invalid, prefix, suffix, ...props }, ref) => (
    // This div paints the ring, so the inner input must not (see tokens.css).
    <div
      className={cn(CONTROL, className)}
      data-focus-ring="wrapper"
      aria-invalid={invalid || undefined}
    >
      {prefix === undefined ? null : (
        <span className="shrink-0 select-none text-sm text-muted-foreground">{prefix}</span>
      )}
      <input
        type={type}
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-full w-full min-w-0 bg-transparent text-foreground outline-none',
          'placeholder:text-muted-foreground',
          'disabled:cursor-not-allowed disabled:text-disabled-foreground',
        )}
        {...props}
      />
      {suffix === undefined ? null : <span className="shrink-0 select-none">{suffix}</span>}
    </div>
  ),
);
Input.displayName = 'Input';

export { Input };
