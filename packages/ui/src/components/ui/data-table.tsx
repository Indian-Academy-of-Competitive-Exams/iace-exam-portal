import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { nearTheEnd } from '../../lib/scroll';
import { Checkbox } from './checkbox';
import { useInTableFrame } from './table-frame';
import { Spinner } from './spinner';
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
  /** Given this, the rows scroll in a capped panel that pages as the reader nears its end. */
  scroll?: DataTableScroll;
  /** Marks a row apart from its neighbours — the reader's own line, a row a filter landed on. */
  rowClassName?: (row: TRow) => string | undefined;
}

/** A capped, scrolling panel. Omit the paging pair for a list already holding everything. */
export interface DataTableScroll {
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  /** The scroller itself, for a caller that needs to read how far it has gone or move it back. */
  onScroll?: (viewport: HTMLDivElement) => void;
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
  /** Which rows a tick may be ADDED to. A ticked row can always be unticked. */
  selectable?: (key: string) => boolean;
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
  scroll,
  rowClassName,
}: Readonly<DataTableProps<TRow>>) {
  const [open, setOpen] = React.useState<ReadonlySet<string>>(new Set());

  const toggleOpen = (key: string) => {
    const next = new Set(open);
    if (!next.delete(key)) next.add(key);
    setOpen(next);
  };
  const keys = rows.map(rowKey);
  const reaches = (key: string) =>
    Boolean(selection?.selected.has(key)) || (selection?.selectable?.(key) ?? true);
  // Only what is on screen and within reach: a box that silently took the rest would be a lie.
  const reachable = keys.filter(reaches);
  const allShown = reachable.length > 0 && reachable.every((key) => selection?.selected.has(key));

  const toggleAll = (on: boolean) => {
    const next = new Set(selection?.selected);
    for (const key of reachable) {
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

  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (scroll?.hasMore && nearTheEnd(event.currentTarget)) scroll.onLoadMore?.();
    scroll?.onScroll?.(event.currentTarget);
  };

  const body = (
    <>
      <Table scroll={scroll ? { onScroll } : undefined}>
        <TableHeader>
          <TableRow>
            {selection ? (
              <TableHead className="w-10">
                <Checkbox
                  aria-label={selection.label ?? 'Select every row shown'}
                  checked={allShown}
                  disabled={reachable.length === 0}
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
                <TableRow className={rowClassName?.(row)}>
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
                        disabled={!reaches(rowKey(row))}
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

      {scroll?.isLoadingMore ? (
        <div className="flex justify-center border-t border-border py-2">
          <Spinner label="Loading more" />
        </div>
      ) : null}
      {footer}
    </>
  );

  // Owning the column rather than borrowing the parent's: the footer pins wherever this is dropped.
  return fills ? <div className="flex min-h-0 flex-1 flex-col">{body}</div> : body;
}
