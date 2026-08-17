import * as React from 'react';
import { cn } from '../../lib/utils';
import { Skeleton } from './skeleton';

/**
 * Data-forward table, per the style guide: quiet uppercase headers, a rule
 * under each row, and numbers in tabular figures so columns of digits line up
 * rather than wobble.
 *
 * Wrapped in an overflow container because a table is the one thing that
 * reliably breaks a responsive layout — it scrolls itself instead of pushing
 * the page sideways.
 */
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="w-full overflow-x-auto">
      <table ref={ref} className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  ),
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => <thead ref={ref} className={cn(className)} {...props} />);
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => <tbody ref={ref} className={cn(className)} {...props} />);
TableBody.displayName = 'TableBody';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr ref={ref} className={cn('transition-colors hover:bg-muted/50', className)} {...props} />
  ),
);
TableRow.displayName = 'TableRow';

export interface TableCellProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Right-aligned tabular figures, for counts and amounts. */
  numeric?: boolean;
}

const TableHead = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, numeric, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'border-b border-border px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
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
        'border-b border-border px-3 py-2.5 align-middle text-foreground',
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

/**
 * The rows a table shows while its rows are on their way.
 *
 * A table is the case skeletons exist for: the shape is already known — this
 * many columns, roughly this many rows — so the header stays put, the columns
 * keep their widths, and nothing jumps when the data lands. The centred
 * "Loading…" it replaced collapsed the table to one line and then threw the
 * page around as the real rows arrived.
 */
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
 * A table body's three states: loading, empty, or rows.
 *
 * Every list screen wrote this as a nested ternary — `isPending ? … : rows.length
 * ? … : …` — which is both hard to read and easy to get subtly different from
 * the screen next door. One of them said "No rows" while another said nothing at
 * all, and neither was a decision anybody made.
 *
 * `empty` is the message for "nothing matches", which is a different fact from
 * "there is nothing yet" — the caller decides which it is, because only the
 * caller knows whether a filter is set.
 *
 * Loading is skeleton rows, not a word. A table knows its own shape before the
 * data arrives, so it can hold it: the word "Loading…" collapsed the whole
 * table to a single centred line and then threw the page around when the rows
 * landed. `loading` is still there for the rare wait that has something to say
 * ("Reading the file…"), and passing it opts back out of the skeleton.
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
