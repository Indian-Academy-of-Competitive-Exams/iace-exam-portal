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
  /** A value the form can work out for itself. Shown as the placeholder; Tab or the hint takes it. */
  suggestion?: string;
  onAcceptSuggestion?: (suggestion: string) => void;
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

const HINT = [
  'shrink-0 select-none rounded border border-border px-1.5 py-0.5 text-xs',
  'text-muted-foreground hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none',
].join(' ');

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      invalid,
      prefix,
      suffix,
      suggestion,
      onAcceptSuggestion,
      placeholder,
      onKeyDown,
      ...props
    },
    ref,
  ) => {
    // The caller drops the suggestion as soon as the field has text, so this is the whole test.
    const offering = suggestion !== undefined && suggestion !== '' && props.disabled !== true;
    const accept = () => {
      if (offering) onAcceptSuggestion?.(suggestion);
    };

    return (
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
          placeholder={offering ? suggestion : placeholder}
          onKeyDown={(event) => {
            // Only while one is on offer, so Tab is back to moving on the moment it is taken.
            if (offering && event.key === 'Tab' && !event.shiftKey) {
              event.preventDefault();
              accept();
            }
            onKeyDown?.(event);
          }}
          className={cn(
            'h-full w-full min-w-0 bg-transparent text-foreground outline-none',
            'placeholder:text-muted-foreground',
            'disabled:cursor-not-allowed disabled:text-disabled-foreground',
          )}
          {...props}
        />
        {offering ? (
          <button
            type="button"
            aria-label={`Use the suggested name ${suggestion}`}
            // Keeps the caret in the field, so accepting by mouse leaves you where typing would.
            onMouseDown={(event) => event.preventDefault()}
            onClick={accept}
            className={HINT}
          >
            Tab
          </button>
        ) : null}
        {suffix === undefined || offering ? null : (
          <span className="shrink-0 select-none">{suffix}</span>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';

export { Input };
