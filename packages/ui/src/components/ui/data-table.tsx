import * as React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableState } from './table';

export interface DataTableColumn<TRow> {
  /** Stable identity for the column. Also the React key for its cells. */
  key: string;
  /** Omit for an actions column — a header with no label still reserves space. */
  header?: React.ReactNode;
  /** Right-aligned tabular figures, for counts and amounts. */
  numeric?: boolean;
  cell: (row: TRow) => React.ReactNode;
  className?: string;
}

export interface DataTableProps<TRow> {
  columns: readonly DataTableColumn<TRow>[];
  rows: readonly TRow[];
  rowKey: (row: TRow) => string;
  isLoading: boolean;
  /** Shown when there are no rows. The caller writes it — see below. */
  empty: React.ReactNode;
  /** Overrides the loading skeleton with a message. Rarely what you want. */
  loading?: React.ReactNode;
  /** Roughly how many rows this list usually shows. */
  skeletonRows?: number;
  /** Usually a `<Pagination />`. Rendered only when given. */
  footer?: React.ReactNode;
}

/**
 * The paginated list, assembled once.
 *
 * Every list screen was writing the same header row, the same three-state body,
 * and the same pagination block underneath — and getting them subtly different.
 * `colSpan` on the empty state is the clearest example: it is the column count,
 * it was written by hand on each screen, and when a column was added nothing
 * failed. The empty row just stopped spanning the table and sat squashed under
 * the first heading, which reads as a broken table rather than an empty one.
 * Here it cannot be wrong, because it is `columns.length`.
 *
 * The `empty` MESSAGE stays the caller's, because only the caller knows whether
 * a filter is set: "No group matches that search" and "No groups yet — create
 * one before adding students" are different facts, and showing the second when
 * the first is true sends an admin off to create something they already have.
 */
export function DataTable<TRow>({
  columns,
  rows,
  rowKey,
  isLoading,
  empty,
  loading,
  skeletonRows,
  footer,
}: Readonly<DataTableProps<TRow>>) {
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} numeric={column.numeric}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableState
            isLoading={isLoading}
            isEmpty={rows.length === 0}
            colSpan={columns.length}
            empty={empty}
            loading={loading}
            skeletonRows={skeletonRows}
          >
            {rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((column) => (
                  <TableCell key={column.key} numeric={column.numeric} className={column.className}>
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableState>
        </TableBody>
      </Table>

      {footer}
    </>
  );
}
