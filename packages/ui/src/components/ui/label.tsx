import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * `htmlFor` is REQUIRED, not optional.
 *
 * A label with no control attached looks identical on screen and is useless to
 * anyone using a screen reader or clicking the text to focus the input. Making
 * it part of the type means that mistake cannot compile.
 */
export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  htmlFor: string;
}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, htmlFor, ...props }, ref) => (
    <label
      ref={ref}
      htmlFor={htmlFor}
      className={cn(
        'text-sm font-medium leading-none text-foreground',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = 'Label';

export { Label };
