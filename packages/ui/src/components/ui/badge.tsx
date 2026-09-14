import * as React from 'react';
import { cn } from '../../lib/utils';

/** Status pills. `danger` is crimson, `primary` is brand red — not interchangeable. */
const VARIANTS = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/[0.14] text-primary',
  success: 'bg-success-subtle text-success-ink',
  warning: 'bg-warning-subtle text-warning-ink',
  danger: 'bg-destructive/[0.14] text-destructive',
  info: 'bg-info-subtle text-info-ink',
} as const;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof VARIANTS;
}

function Badge({ className, variant = 'neutral', ...props }: Readonly<BadgeProps>) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-2xs font-semibold [&_svg]:size-3',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
