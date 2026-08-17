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
 * Header, three-state body and pagination in one; `colSpan` follows `columns.length`.
 * The `empty` message stays the caller's — only they know whether a filter is set.
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
