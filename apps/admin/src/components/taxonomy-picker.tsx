import { usePagedPicker } from '@iace/app-kit';
import { Combobox, MultiCombobox } from '@iace/ui';
import { api } from '../lib/api';
import { subjectPickerQueryKey, topicPickerQueryKey } from '../lib/constants';
import { itemsOf, namesOf, type MultiPickerProps, type PickerProps } from './picker-props';

// Subject -> topic cascade: a topic only means something under its subject, so there's no list to offer without one.

export function SubjectPicker(props: Readonly<PickerProps>) {
  const subjects = usePagedPicker({
    queryKey: subjectPickerQueryKey(),
    fetchPage: (params) => api.admin.taxonomy.listSubjects(params),
    chosen: [props.value],
  });

  const { items, chosen } = itemsOf(subjects, (subject) => ({
    value: subject.id,
    label: subject.name,
  }));

  return (
    <Combobox
      {...props}
      selectedLabel={props.selectedLabel ?? namesOf(chosen)[props.value]}
      {...subjects.paging}
      placeholder={props.placeholder ?? 'All subjects'}
      items={items}
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
    queryKey: topicPickerQueryKey(subjectId),
    fetchPage: (params) => api.admin.taxonomy.listTopics({ ...params, subjectId }),
    enabled: subjectId !== '',
    chosen: [props.value],
  });

  const { items, chosen } = itemsOf(topics, (topic) => ({ value: topic.id, label: topic.name }));

  return (
    <Combobox
      {...props}
      selectedLabel={props.selectedLabel ?? namesOf(chosen)[props.value]}
      {...topics.paging}
      disabled={props.disabled === true || subjectId === ''}
      placeholder={
        subjectId === '' ? 'Choose a subject first' : (props.placeholder ?? 'All topics')
      }
      items={items}
      searchPlaceholder="Search topics"
      emptyLabel="No topics in that subject"
    />
  );
}

export function SubjectMultiPicker(props: Readonly<MultiPickerProps>) {
  const subjects = usePagedPicker({
    queryKey: subjectPickerQueryKey(),
    fetchPage: (params) => api.admin.taxonomy.listSubjects(params),
    chosen: props.value,
  });

  const { items, chosen } = itemsOf(subjects, (subject) => ({
    value: subject.id,
    label: subject.name,
  }));

  return (
    <MultiCombobox
      {...props}
      selectedLabels={{ ...namesOf(chosen), ...props.selectedLabels }}
      {...subjects.paging}
      chips={false}
      placeholder={props.placeholder ?? 'All subjects'}
      items={items}
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
    queryKey: topicPickerQueryKey([...subjectIds].join(',')),
    fetchPage: (params) => api.admin.taxonomy.listTopics({ ...params, subjectId: [...subjectIds] }),
    enabled: subjectIds.length > 0,
    chosen: props.value,
  });

  const { items, chosen } = itemsOf(topics, (topic) => ({ value: topic.id, label: topic.name }));

  return (
    <MultiCombobox
      {...props}
      selectedLabels={{ ...namesOf(chosen), ...props.selectedLabels }}
      {...topics.paging}
      chips={false}
      disabled={subjectIds.length === 0}
      placeholder={
        subjectIds.length === 0 ? 'Choose a subject first' : (props.placeholder ?? 'All topics')
      }
      items={items}
      searchPlaceholder="Search topics"
      emptyLabel="No topics in those subjects"
    />
  );
}
