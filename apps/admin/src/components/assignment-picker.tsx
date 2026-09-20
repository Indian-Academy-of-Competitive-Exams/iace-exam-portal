import { useInfinitePages } from '@iace/app-kit';
import { MultiCombobox } from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS, QUERY_SCOPES } from '../lib/constants';
import { type MultiPickerProps } from './picker-props';

/** A typist's own sections, loading on as they scroll — `mine` has no search for a box to drive. */
export function AssignmentMultiPicker(props: Readonly<MultiPickerProps>) {
  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, QUERY_SCOPES.PICKER],
    fetchPage: (page) => api.admin.assignments.mine({ page }),
  });

  return (
    <MultiCombobox
      {...props}
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      chips={false}
      placeholder={props.placeholder ?? 'Any section'}
      items={pages.items.map((assignment) => ({
        value: assignment.id,
        label: assignment.testTitle
          ? `${assignment.sectionName} · ${assignment.testTitle}`
          : assignment.sectionName,
      }))}
      emptyLabel="Nothing assigned to you yet"
    />
  );
}
