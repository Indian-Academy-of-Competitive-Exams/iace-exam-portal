import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  /** Dashed where the rule divides two working areas rather than two parts of one thing. */
  dashed?: boolean;
}

/** A rule that stands on its own, between two things. Decorative, so assistive tech skips it. */
export function Separator({
  className,
  orientation = 'horizontal',
  dashed = false,
  ...props
}: Readonly<SeparatorProps>) {
  const horizontal = orientation === 'horizontal';
  return (
    // A bare <div> announces nothing already; role="presentation" would repeat it.
    <div
      className={cn(
        'shrink-0',
        // A dash needs a BORDER to break; a filled div has nothing to leave gaps in.
        dashed ? 'border-dashed border-border' : 'bg-border',
        horizontal && dashed && 'h-0 w-full border-t',
        horizontal && !dashed && 'h-px w-full',
        // `self-stretch`, never `h-full`: an explicit height beats stretch, and a flex row has none to take.
        !horizontal && dashed && 'w-0 self-stretch border-l',
        !horizontal && !dashed && 'w-px self-stretch',
        className,
      )}
      {...props}
    />
  );
}
