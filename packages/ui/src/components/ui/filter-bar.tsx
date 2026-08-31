import * as React from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Badge } from './badge';
import { Button } from './button';
import { RadioGroup, RadioGroupItem } from './radio-group';

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
  /** A mandatory scope the list is READ THROUGH, not narrowed by — it never counts toward Clear. */
  leading?: React.ReactNode;
  /** True widens instead of narrowing. Omit the pair for a bar with nothing to combine. */
  matchAny?: boolean;
  onMatchAnyChange?: (matchAny: boolean) => void;
  className?: string;
}

const MATCH_ALL_VALUE = 'all';
const MATCH_ANY_VALUE = 'any';

/** The row above a table: rows are what the reader came for, so anything past a search box folds. */
export function FilterBar({
  activeCount,
  onClear,
  advanced,
  advancedCount = 0,
  children,
  leading,
  matchAny,
  onMatchAnyChange,
  className,
}: Readonly<FilterBarProps>) {
  const [showAll, setShowAll] = React.useState(false);
  // A set filter is never hidden: the fold opens itself rather than lying about the rows.
  const open = showAll || advancedCount > 0;

  return (
    <div className={className}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {leading}
        {children}

        {advanced ? (
          <Button variant="outline" onClick={() => setShowAll((was) => !was)}>
            <SlidersHorizontal aria-hidden />
            Filters
            {advancedCount > 0 ? <Badge variant="primary">{advancedCount}</Badge> : null}
            <ChevronDown aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
        ) : null}

        {/* Plain words: the people reading this ran exam centres, not query planners. */}
        {onMatchAnyChange ? (
          <RadioGroup
            inline
            name="filter-match"
            legend="Match filters"
            value={matchAny ? MATCH_ANY_VALUE : MATCH_ALL_VALUE}
            onValueChange={(next) => onMatchAnyChange(next === MATCH_ANY_VALUE)}
          >
            <RadioGroupItem value={MATCH_ALL_VALUE} label="All" />
            <RadioGroupItem value={MATCH_ANY_VALUE} label="Any" />
          </RadioGroup>
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
