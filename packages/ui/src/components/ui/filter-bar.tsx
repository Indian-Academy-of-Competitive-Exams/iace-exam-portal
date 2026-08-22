import * as React from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Badge } from './badge';
import { Button } from './button';

export interface FilterBarProps {
  /** Every filter that is set, folded or not. Clear is absent when there is nothing to clear. */
  activeCount: number;
  onClear: () => void;
  /** The controls behind the fold. Omit it and the bar is one row with no toggle. */
  advanced?: React.ReactNode;
  /** How many of the FOLDED ones are set — the badge, so a hidden filter is never a silent one. */
  advancedCount?: number;
  /** The controls that stay on screen: the search box, and at most one choice beside it. */
  children: React.ReactNode;
  className?: string;
}

/** The row above a table: rows are what the reader came for, so anything past a search box folds. */
export function FilterBar({
  activeCount,
  onClear,
  advanced,
  advancedCount = 0,
  children,
  className,
}: Readonly<FilterBarProps>) {
  const [showAll, setShowAll] = React.useState(false);
  // A set filter is never hidden: the fold opens itself rather than lying about the rows.
  const open = showAll || advancedCount > 0;

  return (
    <div className={className}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {children}

        {advanced ? (
          <Button variant="outline" onClick={() => setShowAll((was) => !was)}>
            <SlidersHorizontal aria-hidden />
            Filters
            {advancedCount > 0 ? <Badge variant="primary">{advancedCount}</Badge> : null}
            <ChevronDown aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
        ) : null}

        {/* Shown only when it would do something — a permanently greyed Clear teaches nobody. */}
        {activeCount > 0 ? (
          <Button variant="ghost" onClick={onClear}>
            <X aria-hidden />
            Clear filters
            <Badge variant="neutral">{activeCount}</Badge>
          </Button>
        ) : null}
      </div>

      {advanced && open ? (
        <div className="mb-4 grid gap-3 rounded-lg border border-border bg-muted/40 p-3 sm:grid-cols-2 lg:grid-cols-4">
          {advanced}
        </div>
      ) : null}
    </div>
  );
}
