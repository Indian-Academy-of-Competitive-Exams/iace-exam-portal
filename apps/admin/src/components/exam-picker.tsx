import { useState } from 'react';
import { PAGE_SIZE_MAX } from '@iace/contracts';
import { useInfinitePages } from '@iace/app-kit';
import { Combobox } from '@iace/ui';
import { api } from '../lib/api';

/**
 * One exam out of the catalog, searched on the server a page at a time. The code is the label:
 * it is what an enrolment stores, so it is what an admin recognises a row by.
 */
export function ExamPicker(
  props: Readonly<{
    value: string;
    onChange: (value: string) => void;
    /** The code of the current value, for when it sits outside the loaded pages. */
    selectedLabel?: string;
    placeholder?: string;
    clearable?: boolean;
    id?: string;
    'aria-label'?: string;
  }>,
) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: ['admin', 'exams', 'picker', search],
    fetchPage: (page) => api.admin.exams.list({ page, pageSize: PAGE_SIZE_MAX, q: search }),
  });

  return (
    <Combobox
      {...props}
      placeholder={props.placeholder ?? 'All exams'}
      items={pages.items.map((exam) => ({
        value: exam.id,
        label: exam.code,
        hint: exam.name,
      }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search exams"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No exam matches that"
    />
  );
}
