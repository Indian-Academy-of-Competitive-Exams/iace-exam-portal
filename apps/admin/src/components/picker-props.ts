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

/** Names for chosen values no loaded page holds, keyed by value — what `selectedLabels` takes. */
export const namesOf = (
  items: readonly { value: string; label: string }[],
): Record<string, string> => Object.fromEntries(items.map((item) => [item.value, item.label]));

/** A picker's loaded rows and its chosen-but-unloaded rows, both as the items a combobox takes. */
export const itemsOf = <T, I>(
  picker: { items: readonly T[]; chosen: readonly T[] },
  toItem: (row: T) => I,
): { items: I[]; chosen: I[] } => ({
  items: picker.items.map(toItem),
  chosen: picker.chosen.map(toItem),
});
