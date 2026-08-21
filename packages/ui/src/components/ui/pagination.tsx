import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';
import { Combobox } from './combobox';

/**
 * Shows the range ("1–20 of 337"), not just the page number.
 * Page sizes are passed in: the cap is declared in @iace/contracts, not here.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions,
}: Readonly<{
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Omit to hide the rows-per-page control entirely. */
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
}>) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-1 pt-3">
      <div className="flex items-center gap-3">
        <p className="text-sm tabular-nums text-muted-foreground">
          {total === 0 ? 'Nothing to show' : `${first}–${last} of ${total}`}
        </p>

        {onPageSizeChange && pageSizeOptions?.length ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="hidden sm:inline">Rows</span>
            <Combobox
              aria-label="Rows per page"
              className="h-8 w-[5rem] text-sm"
              clearable={false}
              value={String(pageSize)}
              onChange={(next) => onPageSizeChange(Number(next))}
              items={pageSizeOptions.map((size) => ({ value: String(size), label: String(size) }))}
            />
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft aria-hidden />
          Previous
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground">
          {page} / {lastPage}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= lastPage}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}
