import { type ComboboxProps, type MultiComboboxProps } from '@iace/ui';

/** What a paged picker supplies itself: the list it loads and the way that list is searched. */
type Supplied =
  | 'items'
  | 'search'
  | 'onSearchChange'
  | 'searchPlaceholder'
  | 'hasMore'
  | 'onLoadMore'
  | 'isLoading'
  | 'isLoadingMore'
  | 'emptyLabel';

export type PickerProps = Omit<ComboboxProps, Supplied>;
export type MultiPickerProps = Omit<MultiComboboxProps, Supplied | 'chips'>;
