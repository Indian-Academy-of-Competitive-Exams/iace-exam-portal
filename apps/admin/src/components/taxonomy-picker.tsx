import { useState } from 'react';
import { PAGE_SIZE_MAX } from '@iace/contracts';
import { useInfinitePages } from '@iace/app-kit';
import { Combobox, MultiCombobox } from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS, QUERY_SCOPES } from '../lib/constants';

/**
 * Subject -> topic, each searched on the server a page at a time. A bank has more topics than
 * one request returns, and filtering what happened to load is not filtering.
 *
 * The two cascade: a topic only means something under its subject. Nothing is disabled for the
 * sake of it — without a subject there is no list of topics to offer.
 */

interface PickerProps {
  value: string;
  onChange: (value: string) => void;
  /** The name of the current value, for when it sits outside the loaded pages. */
  selectedLabel?: string;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

export function SubjectPicker(props: Readonly<PickerProps>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.SUBJECTS, QUERY_SCOPES.PICKER, search],
    fetchPage: (page) =>
      api.admin.taxonomy.listSubjects({ page, pageSize: PAGE_SIZE_MAX, q: search }),
  });

  return (
    <Combobox
      {...props}
      placeholder={props.placeholder ?? 'All subjects'}
      items={pages.items.map((subject) => ({ value: subject.id, label: subject.name }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search subjects"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No subjects yet"
    />
  );
}

export function TopicPicker({
  subjectId,
  ...props
}: Readonly<PickerProps & { subjectId: string }>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.TOPICS, QUERY_SCOPES.PICKER, subjectId, search],
    fetchPage: (page) =>
      api.admin.taxonomy.listTopics({ page, pageSize: PAGE_SIZE_MAX, q: search, subjectId }),
    enabled: subjectId !== '',
  });

  return (
    <Combobox
      {...props}
      disabled={props.disabled === true || subjectId === ''}
      placeholder={
        subjectId === '' ? 'Choose a subject first' : (props.placeholder ?? 'All topics')
      }
      items={pages.items.map((topic) => ({ value: topic.id, label: topic.name }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search topics"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No topics in that subject"
    />
  );
}

/** The same two lists, choosing several. A filter narrows to a set; a form still picks one. */
interface MultiPickerProps {
  value: readonly string[];
  onChange: (next: string[]) => void;
  selectedLabels?: Readonly<Record<string, string>>;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
}

export function SubjectMultiPicker(props: Readonly<MultiPickerProps>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.SUBJECTS, QUERY_SCOPES.PICKER, search],
    fetchPage: (page) =>
      api.admin.taxonomy.listSubjects({ page, pageSize: PAGE_SIZE_MAX, q: search }),
  });

  return (
    <MultiCombobox
      {...props}
      chips={false}
      placeholder={props.placeholder ?? 'All subjects'}
      items={pages.items.map((subject) => ({ value: subject.id, label: subject.name }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search subjects"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No subjects yet"
    />
  );
}

export function TopicMultiPicker({
  subjectIds,
  ...props
}: Readonly<MultiPickerProps & { subjectIds: readonly string[] }>) {
  const [search, setSearch] = useState('');
  const scope = [...subjectIds].join(',');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.TOPICS, QUERY_SCOPES.PICKER, scope, search],
    fetchPage: (page) =>
      api.admin.taxonomy.listTopics({
        page,
        pageSize: PAGE_SIZE_MAX,
        q: search,
        subjectId: [...subjectIds],
      }),
    enabled: subjectIds.length > 0,
  });

  return (
    <MultiCombobox
      {...props}
      chips={false}
      disabled={subjectIds.length === 0}
      placeholder={
        subjectIds.length === 0 ? 'Choose a subject first' : (props.placeholder ?? 'All topics')
      }
      items={pages.items.map((topic) => ({ value: topic.id, label: topic.name }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search topics"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No topics in those subjects"
    />
  );
}
