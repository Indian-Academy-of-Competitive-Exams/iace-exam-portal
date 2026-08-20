import { useState } from 'react';
import { PAGE_SIZE_MAX } from '@iace/contracts';
import { useInfinitePages } from '@iace/app-kit';
import { Combobox } from '@iace/ui';
import { api } from '../lib/api';

/**
 * The exam catalog, searched on the server a page at a time. The code is the label: it is what an
 * enrolment stores, so it is what an admin recognises a row by. A stage is qualified by its
 * exam's code, because "Tier 1" alone names half a dozen different papers.
 */

interface PickerProps {
  value: string;
  onChange: (value: string) => void;
  /** The label of the current value, for when it sits outside the loaded pages. */
  selectedLabel?: string;
  placeholder?: string;
  clearable?: boolean;
  id?: string;
  'aria-label'?: string;
}

export function ExamPicker(props: Readonly<PickerProps>) {
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

/** Only active stages: a retired one takes no new config, and the save would be refused. */
export function ExamStagePicker({ examId, ...props }: Readonly<PickerProps & { examId?: string }>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: ['admin', 'exam-stages', 'picker', examId ?? '', search],
    fetchPage: (page) =>
      api.admin.examStages.list({
        page,
        pageSize: PAGE_SIZE_MAX,
        q: search,
        examId: examId || undefined,
        activeOnly: 'true',
      }),
  });

  return (
    <Combobox
      {...props}
      placeholder={props.placeholder ?? 'All stages'}
      items={pages.items.map((stage) => ({
        value: stage.id,
        label: `${stage.exam.code} / ${stage.name}`,
        hint: stage.stageKey,
      }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search stages"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No stage matches that"
    />
  );
}
