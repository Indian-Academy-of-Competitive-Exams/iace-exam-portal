import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * Variants match the style guide's .alert-* set. Danger is crimson, never brand
 * red: brand red means "this is IACE", crimson means "this went wrong", and an
 * alert that borrowed the brand colour would blur the only signal that matters.
 */
const alertVariants = cva(
  'flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        danger: 'border-destructive/35 bg-destructive/10 text-destructive',
        info: 'border-info/30 bg-info-subtle text-info-ink',
        warning: 'border-warning/40 bg-warning-subtle text-warning-ink',
        success: 'border-success/30 bg-success-subtle text-success-ink',
      },
    },
    defaultVariants: { variant: 'danger' },
  },
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

/**
 * Two elements, because they announce differently and that difference matters.
 *
 * `danger` is a <div role="alert"> — assertive, interrupting whatever a screen
 * reader was saying, which is right for "this did not save". Everything else is
 * an <output>: a polite live region whose native meaning is "the result of a
 * user action", which is exactly what a success or info banner is. <output> is
 * inline by default, hence the explicit block.
 */
const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, ...props }, ref) => {
    const classes = cn(alertVariants({ variant }), className);

    if (variant === 'danger' || variant === undefined) {
      return <div ref={ref} role="alert" className={classes} {...props} />;
    }

    return (
      <output
        ref={ref as React.Ref<HTMLOutputElement>}
        className={cn('block', classes)}
        {...(props as React.OutputHTMLAttributes<HTMLOutputElement>)}
      />
    );
  },
);
Alert.displayName = 'Alert';

export { Alert, alertVariants };
