import * as React from 'react';
import { cn } from '../../lib/utils';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Omit in a grid where the column header labels it; pass `aria-label` instead. */
  label?: React.ReactNode;
  hint?: React.ReactNode;
}

/** Native checkbox with a label, styled through `accent-color`. */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, hint, id, ...props }, ref) => (
    <label
      className={cn(
        'flex cursor-pointer items-start rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60',
        // The gap belongs to the label; with no label it would push the box off-centre.
        label ? 'gap-2.5' : '',
        'has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50',
        className,
      )}
      htmlFor={id}
    >
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:shadow-focus"
        {...props}
      />
      {label ? (
        <span className="text-sm leading-tight text-foreground">
          {label}
          {hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}
        </span>
      ) : null}
    </label>
  ),
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };
