import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/** Danger is crimson, never brand red. */
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

/** `danger` renders `role="alert"` (assertive); everything else an `<output>` (polite). */
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
