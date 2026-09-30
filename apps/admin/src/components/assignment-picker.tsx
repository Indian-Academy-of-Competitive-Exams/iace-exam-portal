import { type AssignmentRole } from '@iace/contracts';
import { useInfinitePages } from '@iace/app-kit';
import { MultiCombobox } from '@iace/ui';
import { api } from '../lib/api';
import { assignmentPickerQueryKey } from '../lib/constants';
import { type MultiPickerProps } from './picker-props';

/** One role's own sections, loading on as they scroll — `mine` has no search for a box to drive. */
export function AssignmentMultiPicker({
  role,
  testId = '',
  ...props
}: Readonly<MultiPickerProps & { role: AssignmentRole; testId?: string }>) {
  const pages = useInfinitePages({
    queryKey: assignmentPickerQueryKey(role, testId),
    fetchPage: (page) => api.admin.assignments.mine({ page, role, testId: testId || undefined }),
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
