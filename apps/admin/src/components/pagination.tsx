import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@iace/ui';

/**
 * Shows the range rather than only the page number: "1–20 of 337" answers "how
 * much is there" and "am I nearly done", which a bare "page 1" does not.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-1 pt-3">
      <p className="text-sm text-muted-foreground tabular-nums">
        {total === 0 ? 'Nothing to show' : `${first}–${last} of ${total}`}
      </p>

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
        <span className="text-sm text-muted-foreground tabular-nums">
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
