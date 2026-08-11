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

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      role={variant === 'danger' || variant === undefined ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  ),
);
Alert.displayName = 'Alert';

export { Alert, alertVariants };
