import * as React from 'react';
import { cn } from '../../lib/utils';
import { Skeleton } from './skeleton';
import { useInTableFrame } from './table-frame';

/**
 * Uppercase headers, a rule between rows, tabular figures. Owns its scrollbar.
 * `border-separate`: a collapsed table drops a sticky heading's borders.
 */
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => {
    const fills = useInTableFrame();
    return (
      <div
        className={cn(
          'relative w-full',
          fills ? 'min-h-0 flex-1 overflow-auto' : 'overflow-x-auto',
        )}
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

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => <thead ref={ref} className={cn(className)} {...props} />);
TableHeader.displayName = 'TableHeader';

/**
 * Owns the hover, scoped to `&>tr` so it cannot reach a `thead` however rows are composed.
 * The last body row draws no rule — `Pagination` under it has its own `border-t`.
 */
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

/**
 * A pseudo-element, not the cell's background: a radius on the cell would round its
 * `border-b` too. Rounded at the row's ends only, or cells notch apart mid-row.
 */
const HOVER_BAND = [
  'relative isolate',
  "before:absolute before:inset-x-0 before:inset-y-[3px] before:-z-10 before:content-['']",
  'first:before:rounded-l-md last:before:rounded-r-md',
].join(' ');

export interface TableCellProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Right-aligned tabular figures, for counts and amounts. */
  numeric?: boolean;
}

/** `bg-card` is not decoration: without it the rows scroll through the heading. */
const TableHead = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, numeric, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'sticky top-0 z-[1] bg-card',
        'px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
        RULE,
        numeric && 'text-right tabular-nums',
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, numeric, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        'px-3 py-2.5 align-middle text-foreground',
        RULE,
        HOVER_BAND,
        numeric && 'text-right tabular-nums',
        className,
      )}
      {...props}
    />
  ),
);
TableCell.displayName = 'TableCell';

/** What a table shows instead of a bare header when there is nothing to list. */
function TableEmpty({
  colSpan,
  children,
}: Readonly<{ colSpan: number; children: React.ReactNode }>) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty };

/** Placeholder rows have no identity of their own, so their keys are fixed. */
const PLACEHOLDER_KEYS = Array.from({ length: 12 }, (_, index) => `placeholder-${index}`);

/** Rows shaped like the rows coming, so the header and column widths hold still. */
function TableSkeleton({ rows, columns }: Readonly<{ rows: number; columns: number }>) {
  return (
    <>
      {PLACEHOLDER_KEYS.slice(0, rows).map((rowKey) => (
        <TableRow key={rowKey}>
          {PLACEHOLDER_KEYS.slice(0, columns).map((cellKey) => (
            <TableCell key={cellKey}>
              <Skeleton variant="text" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/**
 * Loading, empty, or rows. `empty` is the caller's — only they know if a filter is set.
 * Loading draws skeleton rows; pass `loading` to show a message instead.
 */
export function TableState({
  isLoading,
  isEmpty,
  colSpan,
  empty,
  loading,
  skeletonRows = 5,
  children,
}: Readonly<{
  isLoading: boolean;
  isEmpty: boolean;
  colSpan: number;
  empty: React.ReactNode;
  loading?: React.ReactNode;
  /** Roughly what the list usually holds — enough to fill the fold, not more. */
  skeletonRows?: number;
  children: React.ReactNode;
}>) {
  if (isLoading) {
    return loading === undefined ? (
      <TableSkeleton rows={skeletonRows} columns={colSpan} />
    ) : (
      <TableEmpty colSpan={colSpan}>{loading}</TableEmpty>
    );
  }
  if (isEmpty) return <TableEmpty colSpan={colSpan}>{empty}</TableEmpty>;
  return <>{children}</>;
}
