import { useCallback, useState } from 'react';
import { PAGE_SIZE_DEFAULT, isPageSizeOption, type PageSizeOption } from '@iace/contracts';

/**
 * How many rows a list shows, remembered across sessions.
 *
 * It is a preference about the person, not the screen: someone on a large
 * monitor who wants 100 rows wants them on every table, and being asked again
 * on each one is the annoyance the control was added to remove. So it is stored
 * once and shared by every list.
 *
 * The stored value is VALIDATED, never trusted. A preference written by an
 * older build, or edited by hand, would otherwise be sent verbatim and make
 * every list fail until the reader thought to clear their browser storage.
 *
 * The storage key is a parameter for the same reason the token store's is: the
 * SPAs share one origin, and each keeps its own preferences.
 */
export function usePageSize(storageKey: string): [PageSizeOption, (size: number) => void] {
  const [pageSize, setStored] = useState<PageSizeOption>(() => readStoredPageSize(storageKey));

  // Takes a plain number because the control that calls it is a design-system
  // component that knows nothing about which sizes this platform allows. The
  // check below is the one place that knows, so an unsupported size is refused
  // here rather than travelling on to the API as a request it would reject.
  const setPageSize = useCallback(
    (size: number) => {
      if (!isPageSizeOption(size)) return;
      setStored(size);
      try {
        localStorage.setItem(storageKey, String(size));
      } catch {
        // Private browsing, a full quota — the choice still applies to this
        // session, it just will not outlive it. Not worth an error.
      }
    },
    [storageKey],
  );

  return [pageSize, setPageSize];
}

function readStoredPageSize(storageKey: string): PageSizeOption {
  try {
    const stored = Number(localStorage.getItem(storageKey));
    return isPageSizeOption(stored) ? stored : PAGE_SIZE_DEFAULT;
  } catch {
    return PAGE_SIZE_DEFAULT;
  }
}
