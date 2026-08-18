import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDebouncedSearch } from './search-input';
import { Spinner } from './spinner';
import { Skeleton } from './skeleton';

/** How close to the end counts as "nearly there", in pixels. */
const LOAD_MORE_THRESHOLD_PX = 160;

/** Stable no-op for the unsearchable case — a new arrow each render would make
 *  the hook look like it had a different consumer every time. */
const NO_SEARCH = () => {};

export interface ComboboxItem {
  value: string;
  label: string;
  /** A second line — a branch, a code, whatever tells two similar rows apart. */
  hint?: string;
}

/** Everything a combobox takes that is about the LIST rather than the selection. */
export interface ComboboxListProps {
  items: readonly ComboboxItem[];

  /** Shown when nothing is selected. */
  placeholder?: string;

  /** What `Field`'s render prop hands every control, so it can be spread. */
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;

  /** Server-side search. Leave both out for a plain, unsearchable list. */
  search?: string;
  onSearchChange?: (search: string) => void;
  searchPlaceholder?: string;

  /** Paging. `onLoadMore` fires when the bottom of the list comes into view. */
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoading?: boolean;
  isLoadingMore?: boolean;

  emptyLabel?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

export interface ComboboxShellProps extends ComboboxListProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerLabel: string;
  triggerMuted: boolean;
  /** Announces the list as multi-select, and is what a screen reader counts against. */
  multiple?: boolean;
  children: React.ReactNode;
}

/** The popover, the trigger, the debounced search box and the scrolling list — shared by both. */
export function ComboboxShell({
  open,
  onOpenChange,
  triggerLabel,
  triggerMuted,
  multiple = false,
  children,
  items,
  placeholder = 'Choose…',
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  hasMore = false,
  onLoadMore,
  isLoading = false,
  isLoadingMore = false,
  emptyLabel = 'Nothing matches that',
  disabled = false,
  id,
  'aria-label': ariaLabel,
  className,
}: Readonly<ComboboxShellProps>) {
  // Hooks cannot be conditional; unused, it never starts a timer.
  const { draft: searchDraft, type: typeSearch } = useDebouncedSearch(
    search ?? '',
    onSearchChange ?? NO_SEARCH,
  );

  /**
   * Fetch the next page near the bottom. A scroll handler, not an
   * IntersectionObserver: the list mounts in a portal and re-renders per page.
   */
  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (!onLoadMore || !hasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < LOAD_MORE_THRESHOLD_PX) onLoadMore();
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          disabled={disabled}
          // Same height as Select: the two sit side by side in a filter row.
          className={cn(
            'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-surface px-3 text-sm shadow-sm',
            'transition-[box-shadow,border-color] hover:border-ring',
            'focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span className={cn('truncate', triggerMuted && 'text-muted-foreground')}>
            {triggerLabel}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          // Matches the trigger width.
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-56 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          {onSearchChange ? (
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {/* Debounced for the same reason as SearchInput: this searches
                  the SERVER, so an unwaited keystroke is a request, and the
                  answers to the first seven letters of a group name are ones
                  nobody reads. The field itself stays instant. */}
              <input
                autoFocus
                value={searchDraft}
                onChange={(event) => typeSearch(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          ) : null}

          {/*
            role="listbox" is not decoration: the rows below carry
            role="option", and an option outside a listbox is invalid ARIA — a
            screen reader announces a pile of buttons rather than a list with a
            position and a count.
          */}
          <div // NOSONAR(typescript:S6819): a searchable, paged, popover combobox can't be a native <select>/<datalist>; role="listbox"/"option" is the ARIA APG pattern for it, unchanged from combobox.tsx.
            role="listbox"
            aria-multiselectable={multiple || undefined}
            aria-label={ariaLabel ?? placeholder}
            className="max-h-64 overflow-y-auto p-1"
            onScroll={onScroll}
          >
            {children}

            {/* Rows in the shape of the rows that are coming, so the list does
                not collapse to one line and then jump when they land. */}
            {isLoading ? <OptionSkeleton /> : null}
            {!isLoading && items.length === 0 ? <Status>{emptyLabel}</Status> : null}

            {/* Only while there is another page, so a finished list says so by
                showing nothing rather than a spinner that never resolves. */}
            {hasMore ? (
              <div className="flex items-center justify-center gap-2 py-2">
                <Spinner />
                <span className="text-xs text-muted-foreground">
                  {isLoadingMore ? 'Loading more…' : 'Scroll for more'}
                </span>
              </div>
            ) : null}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export function ComboboxOption({
  label,
  hint,
  selected,
  muted,
  onSelect,
}: Readonly<{
  label: string;
  hint?: string;
  selected: boolean;
  muted?: boolean;
  onSelect: () => void;
}>) {
  return (
    <button // NOSONAR(typescript:S6819): same combobox widget as above — the ARIA APG option role, not a native <option>.
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
        'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
        muted && 'text-muted-foreground',
      )}
    >
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        {hint ? <span className="block truncate text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      {selected ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
    </button>
  );
}

function Status({ children }: Readonly<{ children: React.ReactNode }>) {
  return <p className="px-2 py-3 text-sm text-muted-foreground">{children}</p>;
}

/** Placeholder rows have no identity of their own, so their keys are fixed. */
const PLACEHOLDER_KEYS = ['a', 'b', 'c', 'd'];

function OptionSkeleton() {
  return (
    <>
      {PLACEHOLDER_KEYS.map((key) => (
        <div key={key} className="px-2 py-2">
          <Skeleton variant="text" />
        </div>
      ))}
    </>
  );
}
