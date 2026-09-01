import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
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
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  /** Lets the reader put it away once read. A `danger` one stays: it is not theirs to dismiss. */
  dismissible?: boolean;
  onDismiss?: () => void;
}

/** `danger` renders `role="alert"` (assertive); everything else an `<output>` (polite). */
const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, dismissible, onDismiss, children, ...props }, ref) => {
    const [shown, setShown] = React.useState(true);
    const assertive = variant === 'danger' || variant === undefined;
    // Nothing about a failure is the reader's to wave away, so danger never takes the control.
    const closes = dismissible === true && !assertive;

    if (!shown) return null;

    const classes = cn(alertVariants({ variant }), closes && 'pr-2', className);
    const body = (
      <>
        <span className="flex min-w-0 flex-1 items-start gap-2.5">{children}</span>
        {closes ? (
          <button
            type="button"
            className="-my-1 shrink-0 rounded-md p-1 opacity-70 hover:opacity-100 focus-visible:shadow-focus"
            onClick={() => {
              setShown(false);
              onDismiss?.();
            }}
          >
            <X aria-hidden />
            <span className="sr-only">Dismiss</span>
          </button>
        ) : null}
      </>
    );

    if (assertive) {
      return (
        <div ref={ref} role="alert" className={classes} {...props}>
          {body}
        </div>
      );
    }

    return (
      <output
        ref={ref as React.Ref<HTMLOutputElement>}
        className={cn('block', classes)}
        {...(props as React.OutputHTMLAttributes<HTMLOutputElement>)}
      >
        {body}
      </output>
    );
  },
);
Alert.displayName = 'Alert';

export { Alert, alertVariants };
