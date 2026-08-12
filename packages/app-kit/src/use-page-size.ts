import { useCallback, useState } from 'react';
import { PAGE_SIZE_DEFAULT, isPageSizeOption, type PageSizeOption } from '@iace/contracts';

/**
 * How many rows ONE list shows.
 *
 * Deliberately local to the list that calls it, and deliberately not persisted.
 * Widening the students table to 50 rows is a statement about that table — the
 * reader is looking for someone — not a standing preference, and applying it to
 * every other screen surprises them somewhere they were not looking. Each list
 * starts at `PAGE_SIZE_DEFAULT` and answers only for itself.
 *
 * (An earlier version stored one shared preference. It meant setting 50 on any
 * screen silently set 50 on all of them, which is what this comment exists to
 * stop being re-invented.)
 */
export function usePageSize(): [PageSizeOption, (size: number) => void] {
  const [pageSize, setStored] = useState<PageSizeOption>(PAGE_SIZE_DEFAULT);

  // Takes a plain number because the control that calls it is a design-system
  // component that knows nothing about which sizes this platform allows. The
  // check below is the one place that knows, so an unsupported size is refused
  // here rather than travelling on to the API as a request it would reject.
  const setPageSize = useCallback((size: number) => {
    if (!isPageSizeOption(size)) return;
    setStored(size);
  }, []);

  return [pageSize, setPageSize];
}
