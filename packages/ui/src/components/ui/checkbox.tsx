import * as React from 'react';
import { cn } from '../../lib/utils';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /**
   * Omit it for a box in a grid, where the column header is the label and
   * repeating it on every row would be noise — give it an `aria-label` instead,
   * so it still announces as something.
   */
  label?: React.ReactNode;
  hint?: React.ReactNode;
}

/**
 * A native checkbox with a label, styled through the accent colour rather than
 * replaced by a div. The browser's own control is already keyboard-operable and
 * announced correctly; a custom one has to re-earn both.
 */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, hint, id, ...props }, ref) => (
    <label
      className={cn(
        'flex cursor-pointer items-start rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60',
        // The gap belongs to the label, not the box: without one there is
        // nothing to sit beside, and a stray 10px would push the control
        // off-centre in a column that is trying to centre it.
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
