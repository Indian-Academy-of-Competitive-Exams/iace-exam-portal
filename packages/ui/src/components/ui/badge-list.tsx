import * as React from 'react';
import { cn } from '../../lib/utils';
import { Badge } from './badge';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

export interface BadgeListProps<T> {
  items: readonly T[];
  /** Plain text per item for the overflow tooltip, one line each. */
  label: (item: T) => string;
  /** The visible chip. Defaults to a neutral badge showing `label`. */
  children?: (item: T) => React.ReactNode;
  /** How many to show before the rest collapse into a count. */
  max?: number;
  /** Rendered when there is nothing at all. */
  empty?: React.ReactNode;
  className?: string;
}

/**
 * The first `max` chips, then a focusable `+N` whose tooltip lists the rest.
 * Never a value's only home — a tooltip does not survive touch or print.
 */
export function BadgeList<T>({
  items,
  label,
  children,
  max = 1,
  empty = null,
  className,
}: Readonly<BadgeListProps<T>>) {
  if (items.length === 0) return <>{empty}</>;

  const shown = items.slice(0, max);
  const hidden = items.slice(max);
  const renderChip = children ?? ((item: T) => <Badge variant="neutral">{label(item)}</Badge>);

  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      {shown.map((item) => (
        <React.Fragment key={label(item)}>{renderChip(item)}</React.Fragment>
      ))}

      {hidden.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* tabIndex so the overflow is reachable without a pointer. Unlike a
                truncation, these are hidden however wide the column gets, so
                this always has something to say. */}
            <Badge variant="neutral" tabIndex={0} className="focus-visible:shadow-focus">
              +{hidden.length}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{hidden.map(label).join('\n')}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
