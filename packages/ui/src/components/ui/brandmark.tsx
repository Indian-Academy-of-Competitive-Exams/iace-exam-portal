import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/** The plate carries the mark, so its size is the lockup's size. */
const plateVariants = cva(
  'inline-flex items-center rounded-md bg-primary font-brand text-primary-foreground font-extrabold tracking-brand',
  {
    variants: {
      size: {
        default: 'px-4 py-1.5 text-brand',
        lg: 'px-6 py-2.5 text-3xl',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

const PORTAL_CLASS = {
  default: 'text-xs',
  lg: 'text-sm',
} as const;

const GAP_CLASS = {
  default: 'gap-2.5',
  lg: 'gap-3',
} as const;

export interface BrandmarkProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof plateVariants> {
  portal?: string;
}

/** The IACE lockup: the name on a brand-red plate; `lg` is for a screen it leads. */
const Brandmark = React.forwardRef<HTMLDivElement, BrandmarkProps>(
  ({ className, portal, size, ...props }, ref) => {
    const scale = size ?? 'default';

    return (
      <div ref={ref} className={cn('flex items-center', GAP_CLASS[scale], className)} {...props}>
        <span className={plateVariants({ size })}>IACE</span>
        {portal ? (
          <span
            className={cn(
              'font-semibold uppercase tracking-wide text-muted-foreground',
              PORTAL_CLASS[scale],
            )}
          >
            {portal}
          </span>
        ) : null}
      </div>
    );
  },
);
Brandmark.displayName = 'Brandmark';

export { Brandmark };
