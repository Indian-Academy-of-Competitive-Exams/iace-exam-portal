import * as React from 'react';
import { cn } from '../../lib/utils';
import { Skeleton } from './skeleton';
import {
  EmptyState,
  emptyCopy,
  EMPTY_STATE_KINDS,
  type EmptyMessage,
  type EmptyStateKind,
} from './empty-state';
import { useOnCard } from './card';
import { useInTableFrame } from './table-frame';

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /** Given, the rows scroll under the pinned heading at a cap instead of growing the page. */
  scroll?: { onScroll?: React.UIEventHandler<HTMLDivElement> };
}

/** Tall enough to read a pool in, short enough that what sits below it stays reachable. */
export const CAPPED_VIEWPORT = 'max-h-[26rem] overflow-auto';

/** Uppercase headers, a rule between rows, tabular figures; owns its scrollbar. `border-separate` because a collapsed table drops a sticky heading's borders. */
const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, scroll, ...props }, ref) => {
    const fills = useInTableFrame();
    // Inside a frame the frame owns the height, so even a paging table fills instead of capping.
    const unframed = scroll ? CAPPED_VIEWPORT : 'overflow-x-auto';
    const viewport = fills ? 'min-h-0 flex-1 overflow-auto' : unframed;
    // A pinned column rules itself off only once something has slid under it.
    const [slid, setSlid] = React.useState(false);
    const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
      setSlid(event.currentTarget.scrollLeft > 0);
      scroll?.onScroll?.(event);
    };
    return (
      <div
        onScroll={onScroll}
        data-slid={slid || undefined}
        className={cn('group/table relative w-full', viewport)}
      >
        <table
          ref={ref}
          className={cn('w-full border-separate border-spacing-0 text-sm', className)}
          {...props}
        />
      </div>
    );
  },
);
Table.displayName = 'Table';

/** Owns the hover, scoped to `&>tr` so it cannot reach a `thead` however rows are composed; the last body row draws no rule — `Pagination` under it has its own `border-t`. */
const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn('[&>tr:hover>td]:before:bg-muted', '[&>tr:last-child>td]:border-b-0', className)}
    {...props}
  />
));
TableBody.displayName = 'TableBody';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr ref={ref} className={cn('transition-colors', className)} {...props} />
  ),
);
TableRow.displayName = 'TableRow';

/** On the cells: `border-separate` renders no `<tr>` border, and sticky keeps a cell's. */
const RULE = 'border-b border-border';

/** A pseudo-element, not the cell's background: a radius on the cell would round its `border-b` too; rounded at the row's ends only, or cells notch apart mid-row. */
const HOVER_BAND = [
  'relative isolate',
  "before:absolute before:inset-x-0 before:inset-y-[3px] before:-z-10 before:content-['']",
  'first:before:rounded-l-md last:before:rounded-r-md',
].join(' ');

export interface TableCellProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Right-aligned tabular figures, for counts and amounts. */
  numeric?: boolean;
  /** Held at the left edge once it reaches it, while the rest slide under. One column a table. */
  pinned?: boolean;
}

/** Opaque, or the columns sliding under it read through; ruled off only while they do. */
const PINNED = 'left-0 border-r border-r-transparent group-data-[slid]/table:border-r-border';

/** Inset from the cell, so air opens under it and the rule stays on the cell where nothing bends it. */
const FLOATING_HEAD = [
  // No `relative` here: `sticky` already positions the cell, and merge would drop it for this.
  'isolate bg-background',
  "before:absolute before:inset-x-0 before:inset-y-[3px] before:-z-10 before:content-['']",
  'before:bg-surface first:before:rounded-s-lg last:before:rounded-e-lg',
].join(' ');

/** A surface is not decoration: without one the rows scroll through the heading. */
const TableHead = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, numeric, pinned, ...props }, ref) => {
    const onCard = useOnCard();

    return (
      <th
        ref={ref}
        className={cn(
          'sticky top-0 z-[1]',
          onCard ? 'bg-card' : FLOATING_HEAD,
          RULE,
          'px-3 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide text-muted-foreground',
          numeric && 'text-right tabular-nums',
          // Above the pinned cells of the rows, which pass under it as the body scrolls.
          pinned && cn(PINNED, 'z-[2]'),
          className,
        )}
        {...props}
      />
    );
  },
);
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, numeric, pinned, ...props }, ref) => {
    const onCard = useOnCard();

    return (
      <td
        ref={ref}
        className={cn(
          'px-3 py-2.5 align-middle text-foreground',
          RULE,
          HOVER_BAND,
          numeric && 'text-right tabular-nums',
          pinned && cn(PINNED, 'sticky z-[1]', onCard ? 'bg-card' : 'bg-background'),
          className,
        )}
        {...props}
      />
    );
  },
);
TableCell.displayName = 'TableCell';

/** What a table shows instead of a bare header when there is nothing to list. */
function TableEmpty({
  colSpan,
  stacks,
  children,
}: Readonly<{ colSpan: number; stacks?: boolean; children: React.ReactNode }>) {
  return (
    <tr className={cn(stacks && STACKED_ROW)}>
      <td
        colSpan={colSpan}
        className={cn(
          'px-3 py-10 text-center text-sm text-muted-foreground',
          stacks && 'max-sm:block',
        )}
      >
        {children}
      </td>
    </tr>
  );
}

/** A stacked table's body is a column of blocks, where a bare row would shrink to its content. */
const STACKED_ROW = 'max-sm:block';

export { Table, TableBody, TableRow, TableHead, TableCell };

/** Placeholder rows have no identity of their own, so their keys are fixed. */
const PLACEHOLDER_KEYS = Array.from({ length: 12 }, (_, index) => `placeholder-${index}`);

/** Rows shaped like the rows coming, so the header and column widths hold still. */
function TableSkeleton({
  rows,
  columns,
  stacks,
}: Readonly<{ rows: number; columns: number; stacks?: boolean }>) {
  return (
    <>
      {PLACEHOLDER_KEYS.slice(0, rows).map((rowKey) => (
        <TableRow
          key={rowKey}
          className={cn(stacks && STACKED_ROW, stacks && 'max-sm:[&>td:nth-child(n+3)]:hidden')}
        >
          {PLACEHOLDER_KEYS.slice(0, columns).map((cellKey) => (
            <TableCell key={cellKey} className={cn(stacks && 'max-sm:block max-sm:border-b-0')}>
              <Skeleton variant="text" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

const DID_NOT_LOAD = 'Could not load this list.';

/** A dead end without the retry: the reader's only other move is reloading the page. */
function TableFailure({
  colSpan,
  error,
  onRetry,
  stacks,
}: Readonly<{ colSpan: number; error?: EmptyMessage; onRetry?: () => void; stacks?: boolean }>) {
  return (
    <TableEmpty colSpan={colSpan} stacks={stacks}>
      <EmptyState
        size="sm"
        kind={EMPTY_STATE_KINDS.FAILURE}
        onRetry={onRetry}
        {...emptyCopy(error ?? DID_NOT_LOAD)}
      />
    </TableEmpty>
  );
}

/** Loading, failed, empty, or rows — in that order, so a failure never reads as an absence. */
export function TableState({
  isLoading,
  isEmpty,
  isError = false,
  colSpan,
  empty,
  emptyKind = EMPTY_STATE_KINDS.EMPTY,
  error,
  onRetry,
  skeletonRows = 5,
  stacks,
  children,
}: Readonly<{
  isLoading: boolean;
  isEmpty: boolean;
  /** Only replaces the rows when there are none: a refetch that failed keeps the good ones. */
  isError?: boolean;
  colSpan: number;
  empty: EmptyMessage;
  emptyKind?: EmptyStateKind;
  error?: EmptyMessage;
  onRetry?: () => void;
  /** Roughly what the list usually holds — enough to fill the fold, not more. */
  skeletonRows?: number;
  /** The table is a column of blocks below `sm`, so these rows are drawn as blocks too. */
  stacks?: boolean;
  children: React.ReactNode;
}>) {
  if (isLoading) return <TableSkeleton rows={skeletonRows} columns={colSpan} stacks={stacks} />;

  if (isError && isEmpty) {
    return <TableFailure colSpan={colSpan} error={error} onRetry={onRetry} stacks={stacks} />;
  }
  if (isEmpty) {
    return (
      <TableEmpty colSpan={colSpan} stacks={stacks}>
        <EmptyState size="sm" kind={emptyKind} {...emptyCopy(empty)} />
      </TableEmpty>
    );
  }
  return <>{children}</>;
}
