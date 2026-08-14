import * as React from 'react';
import { cn } from '../../lib/utils';
import { Badge } from './badge';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

export interface BadgeListProps<T> {
  items: readonly T[];
  /**
   * Plain text for one item — used for the overflow tooltip, one line each.
   * Text rather than a node on purpose: the tooltip has to be readable as a
   * list, and a node would invite putting controls in a thing that does not
   * exist on touch.
   */
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
 * Chips in a table row, with the overflow behind a tooltip.
 *
 * A row cannot grow to fit its contents. Rendering every chip either wraps the
 * row to three lines — at which point the columns no longer line up and the
 * table stops being scannable, which is the only reason it is a table — or
 * clips them at the column edge, which hides values with nothing to say they
 * are hidden. Both lose the same information; only one of them admits it.
 *
 * So: the first `max`, then a `+N` chip whose tooltip lists the rest. The count
 * is the honest part — it says how much is missing — and the tooltip is the
 * recovery. `+N` is focusable, so the overflow is reachable by keyboard and not
 * only by hover.
 *
 * The tooltip is RECOVERY, never the only home for something. If a value
 * matters enough that a decision depends on it, it belongs on a detail screen
 * or behind a filter, because a tooltip does not survive touch, print, or a
 * reader that never hovers.
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
