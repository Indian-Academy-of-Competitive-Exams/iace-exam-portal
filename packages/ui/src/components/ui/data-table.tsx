import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Checkbox } from './checkbox';
import { useInTableFrame } from './table-frame';
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
  /** Given this, the table grows a checkbox column. The caller owns what "selected" means. */
  selection?: DataTableSelection;
  /** Given this, every row grows a chevron and opens a panel beneath itself. */
  expand?: DataTableExpand<TRow>;
}

export interface DataTableExpand<TRow> {
  /** What the open row shows. Anything — a sub-table, a summary, a form. */
  render: (row: TRow) => React.ReactNode;
  /** Names the toggle, since a chevron on its own says nothing to a screen reader. */
  label: (row: TRow) => string;
}

export interface DataTableSelection {
  selected: ReadonlySet<string>;
  onChange: (selected: ReadonlySet<string>) => void;
  /** The label the header checkbox announces, since a table has no heading of its own. */
  label?: string;
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
  selection,
  expand,
}: Readonly<DataTableProps<TRow>>) {
  const [open, setOpen] = React.useState<ReadonlySet<string>>(new Set());

  const toggleOpen = (key: string) => {
    const next = new Set(open);
    if (!next.delete(key)) next.add(key);
    setOpen(next);
  };
  const keys = rows.map(rowKey);
  // Only what is on screen: a header box that silently took the other nine pages would be a lie.
  const allShown = keys.length > 0 && keys.every((key) => selection?.selected.has(key));

  const toggleAll = (on: boolean) => {
    const next = new Set(selection?.selected);
    for (const key of keys) {
      if (on) next.add(key);
      else next.delete(key);
    }
    selection?.onChange(next);
  };

  const toggleOne = (key: string, on: boolean) => {
    const next = new Set(selection?.selected);
    if (on) next.add(key);
    else next.delete(key);
    selection?.onChange(next);
  };

  const span = columns.length + (selection ? 1 : 0) + (expand ? 1 : 0);
  const fills = useInTableFrame();

  const body = (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {selection ? (
              <TableHead className="w-10">
                <Checkbox
                  aria-label={selection.label ?? 'Select every row shown'}
                  checked={allShown}
                  onChange={(event) => toggleAll(event.target.checked)}
                />
              </TableHead>
            ) : null}
            {expand ? <TableHead className="w-10" /> : null}
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
            colSpan={span}
            empty={empty}
            loading={loading}
            skeletonRows={skeletonRows}
          >
            {rows.map((row) => (
              <React.Fragment key={rowKey(row)}>
                <TableRow>
                  {expand ? (
                    <TableCell>
                      <button
                        type="button"
                        aria-label={expand.label(row)}
                        aria-expanded={open.has(rowKey(row))}
                        onClick={() => toggleOpen(rowKey(row))}
                        className={cn(
                          'flex size-7 items-center justify-center rounded-full text-muted-foreground',
                          'transition-colors hover:bg-muted hover:text-foreground',
                          'focus-visible:shadow-focus focus-visible:outline-none [&_svg]:size-4',
                        )}
                      >
                        <ChevronRight
                          className={cn(
                            'transition-transform',
                            open.has(rowKey(row)) && 'rotate-90',
                          )}
                          aria-hidden
                        />
                      </button>
                    </TableCell>
                  ) : null}
                  {selection ? (
                    <TableCell>
                      <Checkbox
                        aria-label={`Select row ${rowKey(row)}`}
                        checked={selection.selected.has(rowKey(row))}
                        onChange={(event) => toggleOne(rowKey(row), event.target.checked)}
                      />
                    </TableCell>
                  ) : null}
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      numeric={column.numeric}
                      className={column.className}
                    >
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>

                {expand && open.has(rowKey(row)) ? (
                  <TableRow>
                    {/* Its own scrollport, capped: a long child list must not push the parent
                        rows off the screen the reader is using to navigate them. */}
                    <TableCell colSpan={span} className="bg-surface-2 p-0">
                      <div className="relative max-h-[26rem] overflow-y-auto px-4 py-3">
                        {expand.render(row)}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </React.Fragment>
            ))}
          </TableState>
        </TableBody>
      </Table>

      {footer}
    </>
  );

  // Owning the column rather than borrowing the parent's: the footer pins wherever this is dropped.
  return fills ? <div className="flex min-h-0 flex-1 flex-col">{body}</div> : body;
}
