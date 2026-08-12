import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';
import { cn } from '../../lib/utils';

/** How close to the end counts as "nearly there", in pixels. */
const LOAD_MORE_THRESHOLD_PX = 160;

export interface ComboboxItem {
  value: string;
  label: string;
  /** A second line — a branch, a code, whatever tells two similar rows apart. */
  hint?: string;
}

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  items: readonly ComboboxItem[];

  /**
   * What to show for the current value when it is not in `items`.
   *
   * It usually will not be: with pages loaded on demand, a value chosen
   * earlier — or arriving in a link — is very often outside the page that
   * happens to be loaded. Without this the trigger renders blank and the
   * control looks like it lost the selection.
   */
  selectedLabel?: string;

  /** Shown when nothing is selected. Also the "clear" option's label. */
  placeholder?: string;
  /** Omit to make the control mandatory — no way back to "no choice". */
  clearable?: boolean;

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

/**
 * A select for a list too long to render at once.
 *
 * The list is loaded a page at a time and the next page is fetched when the
 * reader scrolls to the bottom — which is the point: a plain `<select>` over a
 * capped query silently ends at the first hundred and looks complete. Anything
 * missing from it is invisible, and the reader has no way to know.
 *
 * It knows nothing about where items come from. The paging lives in
 * `useInfinitePages` (@iace/app-kit); this only says "I have reached the end of
 * what you gave me" and renders what comes back.
 */
export function Combobox({
  value,
  onChange,
  items,
  selectedLabel,
  placeholder = 'Choose…',
  clearable = true,
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
}: Readonly<ComboboxProps>) {
  const [open, setOpen] = React.useState(false);

  const selected = items.find((item) => item.value === value);
  const triggerLabel = selected?.label ?? selectedLabel ?? value ?? placeholder;

  /**
   * Ask for the next page as the reader nears the bottom.
   *
   * A scroll handler rather than an IntersectionObserver. The observer is the
   * fashionable answer and it was the first thing here, but it has to be
   * attached to an element inside a portal that mounts a tick after the popover
   * opens, re-armed every time a page is appended, and rooted on the scroller
   * rather than the viewport — three chances to attach to nothing and silently
   * never fire, which is exactly what it did. Scroll position is a fact this
   * element already has.
   *
   * The threshold starts the fetch before the end is reached, so the next page
   * is usually there by the time the reader gets to it.
   */
  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (!onLoadMore || !hasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < LOAD_MORE_THRESHOLD_PX) onLoadMore();
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          disabled={disabled}
          // Deliberately the same shape as Select: the two sit side by side in
          // a filter row, and a 36px control beside a 40px one reads as broken.
          className={cn(
            'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-surface px-3 text-sm shadow-sm',
            'transition-[box-shadow,border-color] hover:border-ring',
            'focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span className={cn('truncate', !selected && !selectedLabel && 'text-muted-foreground')}>
            {triggerLabel}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          // Matches the trigger, so the list never appears narrower than the
          // thing it belongs to.
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-56 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          {onSearchChange ? (
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                autoFocus
                value={search ?? ''}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          ) : null}

          <div className="max-h-64 overflow-y-auto p-1" onScroll={onScroll}>
            {clearable ? (
              <Option
                label={placeholder}
                muted
                selected={value === ''}
                onSelect={() => {
                  onChange('');
                  setOpen(false);
                }}
              />
            ) : null}

            {items.map((item) => (
              <Option
                key={item.value}
                label={item.label}
                hint={item.hint}
                selected={item.value === value}
                onSelect={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
              />
            ))}

            {isLoading ? <Status>Loading…</Status> : null}
            {!isLoading && items.length === 0 ? <Status>{emptyLabel}</Status> : null}

            {/* Only while there is another page, so a finished list says so by
                showing nothing rather than a spinner that never resolves. */}
            {hasMore ? (
              <div className="flex items-center justify-center gap-2 py-2">
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
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

function Option({
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
    <button
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
