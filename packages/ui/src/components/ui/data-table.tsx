import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn, FILLS } from '../../lib/utils';
import { nearTheEnd } from '../../lib/scroll';
import { Checkbox } from './checkbox';
import { useInTableFrame } from './table-frame';
import { Spinner } from './spinner';
import { EMPTY_STATE_KINDS, type EmptyMessage, type EmptyStateKind } from './empty-state';
import { Table, TableBody, TableCell, TableHead, TableRow, TableState } from './table';

export interface DataTableColumn<TRow> {
  /** Stable identity for the column. Also the React key for its cells. */
  key: string;
  /** Omit for an actions column — a header with no label still reserves space. */
  header?: React.ReactNode;
  /** Right-aligned tabular figures, for counts and amounts. */
  numeric?: boolean;
  /** Held at the left edge of a table wider than its frame. One column a table. */
  pinned?: boolean;
  cell: (row: TRow) => React.ReactNode;
  className?: string;
}

export interface DataTableProps<TRow> {
  columns: readonly DataTableColumn<TRow>[];
  rows: readonly TRow[];
  rowKey: (row: TRow) => string;
  isLoading: boolean;
  /** Shown when there are no rows. A bare string is its title; `EmptyState` draws it. */
  empty: EmptyMessage;
  /** Which absence `empty` is. `ListView` sets it; a bare table only ever has the one. */
  emptyKind?: EmptyStateKind;
  /** The rows did not load. Without this a failed fetch renders as an empty list. */
  isError?: boolean;
  error?: EmptyMessage;
  onRetry?: () => void;
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
  /** Names the row a tick belongs to. Without it a reader hears the row's id read out. */
  rowLabel?: (key: string) => string;
  /** Which rows a tick may be ADDED to. A ticked row can always be unticked. */
  selectable?: (key: string) => boolean;
}

/** `selectable` is asked once per row per render: a caller's check may itself be a scan. */
function rowSelection(keys: readonly string[], selection: DataTableSelection | undefined) {
  const selected = selection?.selected;
  const selectable = selection?.selectable;
  // Only what is on screen and within reach: a box that silently took the rest would be a lie.
  const reachable = new Set(
    keys.filter((key) => Boolean(selected?.has(key)) || (selectable?.(key) ?? true)),
  );
  const allShown = reachable.size > 0 && [...reachable].every((key) => selected?.has(key));

  return { reachable, allShown };
}

/** Outside the component, so a row's own tick handler is stable while the selection is. */
function toggleSelection(
  selection: DataTableSelection | undefined,
  touched: Iterable<string>,
  on: boolean,
) {
  const next = new Set(selection?.selected);
  for (const key of touched) {
    if (on) next.add(key);
    else next.delete(key);
  }
  selection?.onChange(next);
}

/** The tick arrives as three values rather than an object: memo compares props, and a literal is never equal. */
interface DataTableRowProps<TRow> {
  row: TRow;
  id: string;
  columns: readonly DataTableColumn<TRow>[];
  span: number;
  className?: string;
  expand?: DataTableExpand<TRow>;
  isOpen: boolean;
  onToggleOpen: (id: string) => void;
  /** Undefined where the table has no selection column at all. */
  ticked?: boolean;
  tickDisabled?: boolean;
  tickLabel?: string;
  onTick: (id: string, on: boolean) => void;
}

function Row<TRow>({
  row,
  id,
  columns,
  span,
  className,
  expand,
  isOpen,
  onToggleOpen,
  ticked,
  tickDisabled,
  tickLabel,
  onTick,
}: Readonly<DataTableRowProps<TRow>>) {
  return (
    <>
      <TableRow className={className}>
        {expand ? (
          <TableCell>
            <button
              type="button"
              aria-label={expand.label(row)}
              aria-expanded={isOpen}
              onClick={() => onToggleOpen(id)}
              className={cn(
                'flex size-7 items-center justify-center rounded-full text-muted-foreground',
                'transition-colors hover:bg-muted hover:text-foreground',
                'focus-visible:shadow-focus focus-visible:outline-none [&_svg]:size-4',
              )}
            >
              <ChevronRight
                className={cn('transition-transform', isOpen && 'rotate-90')}
                aria-hidden
              />
            </button>
          </TableCell>
        ) : null}
        {ticked === undefined ? null : (
          <TableCell>
            <Checkbox
              aria-label={tickLabel}
              checked={ticked}
              disabled={tickDisabled}
              onChange={(event) => onTick(id, event.target.checked)}
            />
          </TableCell>
        )}
        {columns.map((column) => (
          <TableCell
            key={column.key}
            numeric={column.numeric}
            pinned={column.pinned}
            className={column.className}
          >
            {column.cell(row)}
          </TableCell>
        ))}
      </TableRow>

      {expand && isOpen ? (
        <TableRow>
          {/* Capped and scrolling: a long child list must not push the parent rows off screen. */}
          <TableCell colSpan={span} className="bg-surface-2 p-0">
            <div className="relative max-h-[26rem] overflow-y-auto px-4 py-3">
              {expand.render(row)}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

/** Memoized, so a table that re-renders redraws only the rows whose own values moved — which needs a stable `columns` from the caller. */
const DataTableRow = React.memo(Row) as typeof Row;

/** Header, three-state body and pagination in one; `colSpan` follows `columns.length`. The `empty` message stays the caller's — only they know whether a filter is set. */
export function DataTable<TRow>({
  columns,
  rows,
  rowKey,
  isLoading,
  empty,
  emptyKind = EMPTY_STATE_KINDS.EMPTY,
  isError,
  error,
  onRetry,
  skeletonRows,
  footer,
  selection,
  expand,
  scroll,
  rowClassName,
}: Readonly<DataTableProps<TRow>>) {
  const [open, setOpen] = React.useState<ReadonlySet<string>>(new Set());

  // Stable, both of them: a row is memoized, and a fresh handler each render would defeat it.
  const toggleOpen = React.useCallback((key: string) => {
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  const toggleOne = React.useCallback(
    (key: string, on: boolean) => toggleSelection(selection, [key], on),
    [selection],
  );

  const keyed = rows.map((row) => ({ row, id: rowKey(row) }));
  const { reachable, allShown } = rowSelection(
    keyed.map(({ id }) => id),
    selection,
  );

  const span = columns.length + (selection ? 1 : 0) + (expand ? 1 : 0);
  const fills = useInTableFrame();

  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (scroll?.hasMore && nearTheEnd(event.currentTarget)) scroll.onLoadMore?.();
    scroll?.onScroll?.(event.currentTarget);
  };

  const body = (
    <>
      <Table scroll={scroll ? { onScroll } : undefined}>
        <thead>
          <TableRow>
            {selection ? (
              <TableHead className="w-10">
                <Checkbox
                  aria-label={selection.label ?? 'Select every row shown'}
                  checked={allShown}
                  disabled={reachable.size === 0}
                  onChange={(event) => toggleSelection(selection, reachable, event.target.checked)}
                />
              </TableHead>
            ) : null}
            {expand ? <TableHead className="w-10" /> : null}
            {columns.map((column) => (
              <TableHead key={column.key} numeric={column.numeric} pinned={column.pinned}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </thead>
        <TableBody>
          <TableState
            isLoading={isLoading}
            isEmpty={rows.length === 0}
            isError={isError}
            colSpan={span}
            empty={empty}
            emptyKind={emptyKind}
            error={error}
            onRetry={onRetry}
            skeletonRows={skeletonRows}
          >
            {keyed.map(({ row, id }) => (
              <DataTableRow
                key={id}
                row={row}
                id={id}
                columns={columns}
                span={span}
                className={rowClassName?.(row)}
                expand={expand}
                isOpen={open.has(id)}
                onToggleOpen={toggleOpen}
                ticked={selection ? selection.selected.has(id) : undefined}
                tickDisabled={selection ? !reachable.has(id) : undefined}
                tickLabel={selection ? (selection.rowLabel?.(id) ?? `Select row ${id}`) : undefined}
                onTick={toggleOne}
              />
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
  return fills ? <div className={FILLS}>{body}</div> : body;
}
