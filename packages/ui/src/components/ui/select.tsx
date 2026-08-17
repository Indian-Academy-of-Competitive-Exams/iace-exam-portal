import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/** Native select: keyboard-accessible, and the platform picker on a phone. */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, children, ...props }, ref) => (
    <div
      className={cn(
        'relative flex h-10 w-full items-center rounded-md border border-input bg-surface shadow-sm transition-[box-shadow,border-color]',
        'focus-within:border-ring focus-within:shadow-focus',
        'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-within:shadow-focus-invalid',
        className,
      )}
      // See input.tsx — the wrapper owns the ring, the inner control stands down.
      data-focus-ring="wrapper"
      aria-invalid={invalid || undefined}
    >
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className="h-full w-full appearance-none bg-transparent px-3 pr-9 text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 size-4 text-muted-foreground"
      />
    </div>
  ),
);
Select.displayName = 'Select';

export { Select };
