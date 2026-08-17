import * as React from 'react';
import { cn } from '../../lib/utils';

export interface BrandmarkProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Show the wordmark beside the tile. */
  withWordmark?: boolean;
}

/** The IACE mark: a brand-red tile with the initial, optionally with the wordmark. */
const Brandmark = React.forwardRef<HTMLDivElement, BrandmarkProps>(
  ({ className, withWordmark = false, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-2.5', className)} {...props}>
      <span
        aria-hidden
        className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-extrabold tracking-tighter text-primary-foreground"
      >
        IA
      </span>
      {withWordmark ? (
        <span className="text-lg font-semibold tracking-tight text-foreground">IACE</span>
      ) : null}
      <span className="sr-only">IACE</span>
    </div>
  ),
);
Brandmark.displayName = 'Brandmark';

export { Brandmark };
