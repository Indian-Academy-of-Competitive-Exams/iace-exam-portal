import { useState } from 'react';
import { PAGE_SIZE_MAX, QUESTION_STATUS } from '@iace/contracts';
import { useInfinitePages } from '@iace/app-kit';
import { MultiCombobox } from '@iace/ui';
import { api } from '../lib/api';

/** Questions an admin picks by hand for one section — its own subject, and only the live ones. */
export function QuestionMultiPicker({
  subjectId,
  value,
  onChange,
  disabled,
  ...control
}: Readonly<{
  subjectId: string | null;
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: ['admin', 'questions', 'picker', subjectId ?? '', search],
    fetchPage: (page) =>
      api.admin.questions.list({
        page,
        pageSize: PAGE_SIZE_MAX,
        q: search,
        status: QUESTION_STATUS.ACTIVE,
        ...(subjectId ? { subjectId } : {}),
      }),
  });

  return (
    <MultiCombobox
      {...control}
      chips={false}
      disabled={disabled}
      value={value}
      onChange={onChange}
      placeholder="Draw them all"
      items={pages.items.map((question) => ({
        value: question.id,
        label: question.questionCode ?? question.stemPreview,
        hint: question.questionCode ? question.stemPreview : undefined,
      }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search by stem or code"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No question matches that"
    />
  );
}
