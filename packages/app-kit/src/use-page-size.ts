import { useCallback, useState } from 'react';
import { PAGE_SIZE_DEFAULT, isPageSizeOption, type PageSizeOption } from '@iace/contracts';

/** How many rows ONE list shows. Local to that list and not persisted, deliberately. */
export function usePageSize(): [PageSizeOption, (size: number) => void] {
  const [pageSize, setPageSize] = useState<PageSizeOption>(PAGE_SIZE_DEFAULT);

  // A plain number: the calling control knows nothing about the allowed sizes.
  const choose = useCallback((size: number) => {
    if (isPageSizeOption(size)) setPageSize(size);
  }, []);

  return [pageSize, choose];
}
