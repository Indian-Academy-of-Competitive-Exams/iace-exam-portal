import { usePagedPicker } from '@iace/app-kit';
import { Combobox, MultiCombobox } from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS, QUERY_SCOPES } from '../lib/constants';
import { type MultiPickerProps, type PickerProps } from './picker-props';

/**
 * Subject -> topic, each searched on the server a page at a time. A bank has more topics than
 * one request returns, and filtering what happened to load is not filtering.
 *
 * The two cascade: a topic only means something under its subject. Nothing is disabled for the
 * sake of it — without a subject there is no list of topics to offer.
 */

export function SubjectPicker(props: Readonly<PickerProps>) {
  const subjects = usePagedPicker({
    queryKey: [...QUERY_KEYS.SUBJECTS, QUERY_SCOPES.PICKER],
    fetchPage: (params) => api.admin.taxonomy.listSubjects(params),
  });

  return (
    <Combobox
      {...props}
      {...subjects.paging}
      placeholder={props.placeholder ?? 'All subjects'}
      items={subjects.items.map((subject) => ({ value: subject.id, label: subject.name }))}
      searchPlaceholder="Search subjects"
      emptyLabel="No subjects yet"
    />
  );
}

export function TopicPicker({
  subjectId,
  ...props
}: Readonly<PickerProps & { subjectId: string }>) {
  const topics = usePagedPicker({
    queryKey: [...QUERY_KEYS.TOPICS, QUERY_SCOPES.PICKER, subjectId],
    fetchPage: (params) => api.admin.taxonomy.listTopics({ ...params, subjectId }),
    enabled: subjectId !== '',
  });

  return (
    <Combobox
      {...props}
      {...topics.paging}
      disabled={props.disabled === true || subjectId === ''}
      placeholder={
        subjectId === '' ? 'Choose a subject first' : (props.placeholder ?? 'All topics')
      }
      items={topics.items.map((topic) => ({ value: topic.id, label: topic.name }))}
      searchPlaceholder="Search topics"
      emptyLabel="No topics in that subject"
    />
  );
}

export function SubjectMultiPicker(props: Readonly<MultiPickerProps>) {
  const subjects = usePagedPicker({
    queryKey: [...QUERY_KEYS.SUBJECTS, QUERY_SCOPES.PICKER],
    fetchPage: (params) => api.admin.taxonomy.listSubjects(params),
  });

  return (
    <MultiCombobox
      {...props}
      {...subjects.paging}
      chips={false}
      placeholder={props.placeholder ?? 'All subjects'}
      items={subjects.items.map((subject) => ({ value: subject.id, label: subject.name }))}
      searchPlaceholder="Search subjects"
      emptyLabel="No subjects yet"
    />
  );
}

export function TopicMultiPicker({
  subjectIds,
  ...props
}: Readonly<MultiPickerProps & { subjectIds: readonly string[] }>) {
  const topics = usePagedPicker({
    queryKey: [...QUERY_KEYS.TOPICS, QUERY_SCOPES.PICKER, [...subjectIds].join(',')],
    fetchPage: (params) => api.admin.taxonomy.listTopics({ ...params, subjectId: [...subjectIds] }),
    enabled: subjectIds.length > 0,
  });

  return (
    <MultiCombobox
      {...props}
      {...topics.paging}
      chips={false}
      disabled={subjectIds.length === 0}
      placeholder={
        subjectIds.length === 0 ? 'Choose a subject first' : (props.placeholder ?? 'All topics')
      }
      items={topics.items.map((topic) => ({ value: topic.id, label: topic.name }))}
      searchPlaceholder="Search topics"
      emptyLabel="No topics in those subjects"
    />
  );
}
