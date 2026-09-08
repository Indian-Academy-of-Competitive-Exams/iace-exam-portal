import * as React from 'react';
import { cn } from '../../lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'min-h-24 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground shadow-sm',
        'transition-[box-shadow,border-color] placeholder:text-placeholder',
        'focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none',
        'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:shadow-focus-invalid',
        'disabled:cursor-not-allowed disabled:border-disabled-border disabled:bg-disabled',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
