import { useCallback, useState } from 'react';
import { PAGE_SIZE_DEFAULT, isPageSizeOption, type PageSizeOption } from '@iace/contracts';
import { STORAGE_KEYS } from './constants';

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
 */
export function usePageSize(): [PageSizeOption, (size: PageSizeOption) => void] {
  const [pageSize, setStored] = useState<PageSizeOption>(readStoredPageSize);

  const setPageSize = useCallback((size: PageSizeOption) => {
    setStored(size);
    try {
      localStorage.setItem(STORAGE_KEYS.PAGE_SIZE, String(size));
    } catch {
      // Private browsing, a full quota — the choice still applies to this
      // session, it just will not outlive it. Not worth an error.
    }
  }, []);

  return [pageSize, setPageSize];
}

function readStoredPageSize(): PageSizeOption {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEYS.PAGE_SIZE));
    return isPageSizeOption(stored) ? stored : PAGE_SIZE_DEFAULT;
  } catch {
    return PAGE_SIZE_DEFAULT;
  }
}
