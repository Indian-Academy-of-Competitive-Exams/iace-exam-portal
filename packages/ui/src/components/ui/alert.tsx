import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

/** Danger is crimson, never brand red. */
const VARIANTS = {
  danger: 'border-destructive/35 bg-destructive/10 text-destructive',
  info: 'border-info/30 bg-info-subtle text-info-ink',
  warning: 'border-warning/40 bg-warning-subtle text-warning-ink',
  success: 'border-success/30 bg-success-subtle text-success-ink',
} as const;

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof VARIANTS;
}

/** `danger` renders `role="alert"` (assertive); everything else an `<output>` (polite). A read message is clutter, so every one closes. */
const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = 'danger', children, ...props }, ref) => {
    const [shown, setShown] = React.useState(true);

    if (!shown) return null;

    const classes = cn(
      'flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0',
      VARIANTS[variant],
      'pr-2',
      className,
    );
    const body = (
      <>
        <span className="flex min-w-0 flex-1 items-start gap-2.5">{children}</span>
        <button
          type="button"
          className="-my-1 shrink-0 rounded-md p-1 opacity-70 hover:opacity-100 focus-visible:shadow-focus"
          onClick={() => setShown(false)}
        >
          <X aria-hidden />
          <span className="sr-only">Dismiss</span>
        </button>
      </>
    );

    if (variant === 'danger') {
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

export { Alert };
