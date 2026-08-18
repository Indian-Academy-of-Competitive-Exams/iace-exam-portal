import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/** The plate carries the mark, so its size is the lockup's size. */
const plateVariants = cva(
  'inline-flex items-center rounded-lg bg-primary font-extrabold tracking-wide text-primary-foreground',
  {
    variants: {
      size: {
        default: 'px-3 py-2 text-lg',
        lg: 'px-5 py-3 text-3xl',
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

/**
 * The IACE lockup: the full name on a brand-red plate, with the portal beside it.
 * `lg` is for a screen the lockup owns — a login card, where it leads the page.
 */
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
