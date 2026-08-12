import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';
import { Select } from './select';

/**
 * Shows the range rather than only the page number: "1–20 of 337" answers "how
 * much is there" and "am I nearly done", which a bare "page 1" does not.
 *
 * The rows-per-page control is optional so a short, never-paged list can leave
 * it off. The sizes are PASSED IN rather than known here: the API caps what it
 * will accept, the cap and the offered sizes are declared together in
 * @iace/contracts, and a design-system component has no business knowing either
 * — it would only be a second place for them to drift apart.
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
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="hidden sm:inline">Rows</span>
            <Select
              aria-label="Rows per page"
              className="h-8 w-[4.5rem] py-0 text-sm"
              value={String(pageSize)}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </label>
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
