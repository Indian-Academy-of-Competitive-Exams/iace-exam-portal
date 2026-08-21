import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/** Status pills. `danger` is crimson, `primary` is brand red — not interchangeable. */
const badgeVariants = cva(
  'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-2xs font-semibold [&_svg]:size-3',
  {
    variants: {
      variant: {
        neutral: 'bg-muted text-muted-foreground',
        primary: 'bg-primary/[0.14] text-primary',
        success: 'bg-success-subtle text-success-ink',
        warning: 'bg-warning-subtle text-warning-ink',
        danger: 'bg-destructive/[0.14] text-destructive',
        info: 'bg-info-subtle text-info-ink',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: Readonly<BadgeProps>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
