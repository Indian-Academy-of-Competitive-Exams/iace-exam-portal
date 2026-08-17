import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  /** Decorative (the default) hides it from assistive tech. */
  decorative?: boolean;
}

/** A rule that stands on its own, between two things. Spacing is the caller's. */
export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: Readonly<SeparatorProps>) {
  return (
    // A bare <div> announces nothing already; role="presentation" would repeat it.
    <div
      role={decorative ? undefined : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}
