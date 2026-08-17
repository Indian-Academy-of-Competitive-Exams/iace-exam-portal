import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  /**
   * A rule that only groups things visually — most of them.
   *
   * `decorative` (the default) hides it from assistive tech, because a screen
   * reader announcing "separator" between every row of a list is noise the
   * sighted reader never gets. Set it false when the line is the only thing
   * saying two blocks are unrelated.
   */
  decorative?: boolean;
}

/**
 * The line between things.
 *
 * Only for a rule that stands on its own. A border on an element that has
 * content of its own — a sticky header's underline, a table cell's rule — is
 * that element's edge and stays where it is; this is for the line BETWEEN two
 * things, which was previously a bare `<div className="border-t border-border">`
 * whose padding it also had to carry (`my-1` in one place, `mt-2 pt-2` in
 * another). Spacing stays the caller's: a rule inside a menu and one under a
 * page header are not the same gap.
 */
export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: Readonly<SeparatorProps>) {
  return (
    // No role at all when decorative: a bare <div> already announces nothing,
    // and role="presentation" would only be saying so twice.
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
