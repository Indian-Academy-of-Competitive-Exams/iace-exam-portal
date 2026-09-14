import * as React from 'react';
import { cn } from '../../lib/utils';

/** The plate carries the mark, so its size is the lockup's size. */
const PLATE_CLASS = {
  default: 'px-4 py-1.5 text-brand',
  lg: 'px-6 py-2.5 text-3xl',
} as const;

const PORTAL_CLASS = {
  default: 'text-xs',
  lg: 'text-sm',
} as const;

const GAP_CLASS = {
  default: 'gap-2.5',
  lg: 'gap-3',
} as const;

export interface BrandmarkProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: keyof typeof PLATE_CLASS;
  portal?: string;
}

/** The IACE lockup: the name on a brand-red plate; `lg` is for a screen it leads. */
const Brandmark = React.forwardRef<HTMLDivElement, BrandmarkProps>(
  ({ className, portal, size: scale = 'default', ...props }, ref) => {
    return (
      <div ref={ref} className={cn('flex items-center', GAP_CLASS[scale], className)} {...props}>
        <span
          className={`inline-flex items-center rounded-md bg-primary font-brand text-primary-foreground font-extrabold tracking-brand ${PLATE_CLASS[scale]}`}
        >
          IACE
        </span>
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
