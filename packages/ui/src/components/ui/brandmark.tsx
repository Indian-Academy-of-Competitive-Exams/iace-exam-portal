import * as React from 'react';
import { cn } from '../../lib/utils';

export interface BrandmarkProps extends React.HTMLAttributes<HTMLDivElement> {
  portal?: string;
}

/** The IACE lockup: the full name on a brand-red plate, with the portal beside it. */
const Brandmark = React.forwardRef<HTMLDivElement, BrandmarkProps>(
  ({ className, portal, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-2.5', className)} {...props}>
      <span className="rounded-md bg-primary px-2.5 py-1.5 text-sm font-extrabold tracking-wide text-primary-foreground">
        IACE
      </span>
      {portal ? (
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {portal}
        </span>
      ) : null}
    </div>
  ),
);
Brandmark.displayName = 'Brandmark';

export { Brandmark };
