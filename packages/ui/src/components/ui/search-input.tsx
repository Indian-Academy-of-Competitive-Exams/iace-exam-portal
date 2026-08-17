import * as React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from './input';

/** How long the typing has to stop before the search runs. */
export const SEARCH_DEBOUNCE_MS = 300;

export interface Debouncer {
  /** Replaces any pending call and starts the clock again. */
  schedule: (run: () => void) => void;
  /** Runs the pending call now — for Enter, or for losing focus. */
  flush: () => void;
  /** Drops the pending call. Nothing runs. */
  cancel: () => void;
}

/**
 * The waiting, separated from the input so it can be tested without a DOM.
 *
 * Kept deliberately small: it holds ONE pending call, because a search box only
 * ever has one outstanding question — "what did they finally type".
 */
export function createDebouncer(delay: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: (() => void) | undefined;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };

  return {
    schedule(run) {
      cancel();
      pending = run;
      timer = setTimeout(() => {
        timer = undefined;
        pending = undefined;
        run();
      }, delay);
    },
    flush() {
      const run = pending;
      cancel();
      run?.();
    },
    cancel,
  };
}

export interface DebouncedSearch {
  /** What is in the box right now — updated on every keystroke. */
  draft: string;
  /** Record a keystroke and restart the clock. */
  type: (next: string) => void;
  /** Hand the current text up now: Enter, or focus leaving the field. */
  flush: () => void;
  /** Empty the box and search for nothing, with no wait. */
  clear: () => void;
}

/**
 * A search box that stays instant while the search itself waits.
 *
 * `value` is still the truth. When it changes from somewhere else — a "clear
 * all filters" button, a link that arrives with a term in the URL — the box
 * follows it; our own commits are ignored, or the caret would jump back on
 * every keystroke.
 */
export function useDebouncedSearch(
  value: string,
  onChange: (next: string) => void,
  delay: number = SEARCH_DEBOUNCE_MS,
): DebouncedSearch {
  const [draft, setDraft] = React.useState(value);
  const committed = React.useRef(value);
  const debouncer = React.useRef<Debouncer>(undefined);
  debouncer.current ??= createDebouncer(delay);

  React.useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    setDraft(value);
  }, [value]);

  // A pending search after the box has gone would run a query for a screen the
  // reader has already left.
  React.useEffect(() => {
    const pending = debouncer.current;
    return () => pending?.cancel();
  }, []);

  const commit = (next: string) => {
    committed.current = next;
    onChange(next);
  };

  return {
    draft,
    type(next) {
      setDraft(next);
      debouncer.current?.schedule(() => commit(next));
    },
    flush() {
      debouncer.current?.flush();
    },
    clear() {
      debouncer.current?.cancel();
      setDraft('');
      commit('');
    },
  };
}

export interface SearchInputProps {
  /** The committed term — the one the query actually ran with. */
  value: string;
  /** Called once the typing settles, not on every keystroke. */
  onChange: (next: string) => void;
  /** Names the field. The magnifier is decoration; it announces nothing. */
  'aria-label': string;
  placeholder?: string;
  /** Milliseconds of quiet before the search runs. */
  delay?: number;
  className?: string;
}

/**
 * The search box, with the wait built in.
 *
 * Three screens had `<Input prefix={<Search/>}>` with `onChange` wired straight
 * to the query state, so every keystroke was a request: "AMEERPET" is eight of
 * them, seven of which are answers nobody reads. Two of the three also write
 * that state into the URL, so the same eight keystrokes were eight entries in
 * the browser's history — Back walked out of the search one letter at a time.
 *
 * The box stays instant while the search waits: what the reader types lands in
 * local state immediately and is only handed upward once the typing settles.
 * Enter and losing focus skip the wait, because both mean "I have finished".
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  delay = SEARCH_DEBOUNCE_MS,
  className,
  'aria-label': ariaLabel,
}: Readonly<SearchInputProps>) {
  const { draft, type, flush, clear } = useDebouncedSearch(value, onChange, delay);

  return (
    <Input
      type="search"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={draft}
      className={className}
      prefix={<Search className="size-4" aria-hidden />}
      suffix={
        draft === '' ? null : (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
          >
            <X className="size-4" aria-hidden />
          </button>
        )
      }
      onChange={(event) => type(event.target.value)}
      onBlur={flush}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          // Submitting nothing — the search is live. Without this, Enter in a
          // search box that sits inside a form posts the form.
          event.preventDefault();
          flush();
        }
      }}
    />
  );
}
