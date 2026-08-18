import { useState } from 'react';
import { PAGE_SIZE_MAX } from '@iace/contracts';
import { useInfinitePages } from '@iace/app-kit';
import { Combobox } from '@iace/ui';
import { api } from '../lib/api';

/**
 * Subject -> topic -> sub-topic, each searched on the server a page at a time.
 * A bank has more topics than one request returns, and filtering what happened
 * to load is not filtering.
 *
 * The three cascade: a topic only means something under its subject, and a
 * sub-topic only under its topic. Nothing is disabled for the sake of it —
 * without a subject there is no list of topics to offer.
 */

interface PickerProps {
  value: string;
  onChange: (value: string) => void;
  /** The name of the current value, for when it sits outside the loaded pages. */
  selectedLabel?: string;
  placeholder?: string;
  clearable?: boolean;
  id?: string;
  'aria-label'?: string;
}

export function SubjectPicker(props: Readonly<PickerProps>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: ['admin', 'subjects', 'picker', search],
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
    queryKey: ['admin', 'topics', 'picker', subjectId, search],
    fetchPage: (page) =>
      api.admin.taxonomy.listTopics({ page, pageSize: PAGE_SIZE_MAX, q: search, subjectId }),
    enabled: subjectId !== '',
  });

  return (
    <Combobox
      {...props}
      disabled={subjectId === ''}
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

export function SubTopicPicker({ topicId, ...props }: Readonly<PickerProps & { topicId: string }>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: ['admin', 'sub-topics', 'picker', topicId, search],
    fetchPage: (page) =>
      api.admin.taxonomy.listSubTopics({ page, pageSize: PAGE_SIZE_MAX, q: search, topicId }),
    enabled: topicId !== '',
  });

  return (
    <Combobox
      {...props}
      disabled={topicId === ''}
      placeholder={
        topicId === '' ? 'Choose a topic first' : (props.placeholder ?? 'All sub-topics')
      }
      items={pages.items.map((subTopic) => ({ value: subTopic.id, label: subTopic.name }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search sub-topics"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No sub-topics under that topic"
    />
  );
}
