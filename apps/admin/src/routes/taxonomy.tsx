import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ListTree, Plus } from 'lucide-react';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  createSubjectSchema,
  createTopicSchema,
  type CreateSubjectInput,
  type CreateTopicInput,
  type Subject,
  type Topic,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import { PageCrumbs, useFilters, useListScreen } from '@iace/app-kit/browser';
import {
  Button,
  DropdownMenuItem,
  FormDialog,
  FormField,
  Input,
  linkVariants,
  ListView,
  PageHeader,
  RowActions,
  TableFrame,
  TruncatedText,
  type DataTableColumn,
  type ListFilterMultiControl,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { SubjectMultiPicker, SubjectPicker } from '../components/taxonomy-picker';

/**
 * Subject -> topic, the two levels a question is filed under and
 * the lists the import template's dropdowns are generated from. Names are
 * canonical: what is typed is normalised, never refused.
 */

// ============================================================================
// Subjects
// ============================================================================

/** A new topic starts in the subject being looked at, and only when exactly one is. */
function onlySubjectFiltered(filtered: string): string {
  const chosen = filtered.split(',').filter(Boolean);
  return chosen.length === 1 ? (chosen[0] as string) : '';
}

/** The topics tab, already filtered to one subject — the child list reached from its parent. */
function topicsOf(subjectId: string): string {
  return `${ROUTES.TAXONOMY}?level=${LEVELS.TOPICS}&subjectId=${subjectId}`;
}

function subjectColumns(): DataTableColumn<Subject>[] {
  return [
    {
      key: 'name',
      header: 'Subject',
      className: 'max-w-[16rem] font-medium',
      cell: (row) => <TruncatedText>{row.name}</TruncatedText>,
    },
    {
      key: 'code',
      header: 'Code',
      cell: (row) => <TruncatedText>{row.code}</TruncatedText>,
    },
    {
      key: 'topics',
      header: 'Topics',
      numeric: true,
      cell: (row) =>
        row.topicCount > 0 ? (
          <Link to={topicsOf(row.id)} className={linkVariants()}>
            {row.topicCount}
          </Link>
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
    },
    { key: 'questions', header: 'Questions', numeric: true, cell: (row) => row.questionCount },
    {
      key: 'actions',
      className: 'text-right',
      // The topics list, filtered — a subject has no topic list of its own.
      cell: (row) => (
        <RowActions label={`Actions for ${row.name}`}>
          <DropdownMenuItem asChild>
            <Link to={topicsOf(row.id)}>
              <ListTree aria-hidden />
              Topics
            </Link>
          </DropdownMenuItem>
        </RowActions>
      ),
    },
  ];
}

/** Two levels of one taxonomy, so one nav row and a tab each rather than two menu entries. */
const LEVELS = {
  SUBJECTS: 'subjects',
  TOPICS: 'topics',
} as const;

export function TaxonomyPage() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const filters = useFilters<'level' | 'q' | 'subjectId'>();
  const level = filters.get('level') || LEVELS.SUBJECTS;
  const onSubjects = level === LEVELS.SUBJECTS;

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Subjects and topics"
      action={
        canWrite ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {onSubjects ? 'New subject' : 'New topic'}
          </Button>
        ) : undefined
      }
    />
  );

  const done = (queryKey: readonly string[]) => () => {
    setCreating(false);
    void queryClient.invalidateQueries({ queryKey });
  };

  return (
    <>
      <TableFrame
        header={header}
        tabs={{
          value: level,
          onValueChange: (value) => filters.set({ level: value, q: '', subjectId: '' }),
          items: [
            { value: LEVELS.SUBJECTS, label: 'Subjects', content: <SubjectsList /> },
            { value: LEVELS.TOPICS, label: 'Topics', content: <TopicsList /> },
          ],
        }}
      />

      {onSubjects ? (
        <NewSubjectDialog
          open={creating}
          onOpenChange={setCreating}
          onDone={done(QUERY_KEYS.SUBJECTS)}
        />
      ) : (
        <NewTopicDialog
          subjectId={onlySubjectFiltered(filters.get('subjectId'))}
          open={creating}
          onOpenChange={setCreating}
          onDone={done(QUERY_KEYS.TOPICS)}
        />
      )}
    </>
  );
}

const SUBJECT_FILTERS = [
  {
    key: 'q',
    kind: 'search',
    label: 'Search subjects',
    placeholder: 'Search subjects',
    primary: true,
  },
] as const;

function SubjectsList() {
  const columns = useMemo(() => subjectColumns(), []);

  const subjects = useListScreen({
    queryKey: QUERY_KEYS.SUBJECTS,
    filters: SUBJECT_FILTERS,
    toQuery: (values) => ({ q: values.q || undefined }),
    fetchPage: (params) => api.admin.taxonomy.listSubjects(params),
  });

  return (
    <ListView
      list={subjects}
      filters={SUBJECT_FILTERS}
      columns={columns}
      rowKey={(row) => row.id}
      empty="No subjects yet. Add the first one — questions are filed under it."
      emptyFiltered="No subjects match that search."
    />
  );
}

function NewSubjectDialog({
  open,
  onOpenChange,
  onDone,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }>) {
  const form = useForm<CreateSubjectInput>({
    resolver: zodResolver(createSubjectSchema),
    defaultValues: { name: '', code: '' },
  });

  const create = useMutation({
    meta: { success: 'Subject added.' },
    mutationFn: (input: CreateSubjectInput) =>
      api.admin.taxonomy.createSubject({ name: input.name, code: input.code || undefined }),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, ['name', 'code']),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      form={form}
      onSubmit={(values) => create.mutate(values)}
      title="New subject"
      submitLabel="Add subject"
      loading={create.isPending}
    >
      <FormField form={form} name="name" label="Name">
        {(field) => <Input {...field} placeholder="QUANTITATIVE APTITUDE" autoFocus />}
      </FormField>
      <FormField form={form} name="code" label="Code" hint="Optional">
        {(field) => <Input {...field} placeholder="QA" />}
      </FormField>
    </FormDialog>
  );
}

// ============================================================================
// Topics
// ============================================================================

function topicColumns(): DataTableColumn<Topic>[] {
  return [
    {
      key: 'name',
      header: 'Topic',
      className: 'max-w-[16rem] font-medium',
      cell: (row) => <TruncatedText>{row.name}</TruncatedText>,
    },
    {
      key: 'subject',
      header: 'Subject',
      className: 'max-w-[14rem]',
      cell: (row) => <TruncatedText>{row.subject.name}</TruncatedText>,
    },
    { key: 'questions', header: 'Questions', numeric: true, cell: (row) => row.questionCount },
  ];
}

const TOPIC_FILTERS = [
  { key: 'q', kind: 'search', label: 'Search topics', placeholder: 'Search topics', primary: true },
  {
    key: 'subjectId',
    kind: 'customMulti',
    label: 'Subject',
    primary: true,
    render: (control: ListFilterMultiControl) => <SubjectMultiPicker {...control} />,
  },
] as const;

function TopicsList() {
  const columns = useMemo(() => topicColumns(), []);

  const topics = useListScreen({
    queryKey: QUERY_KEYS.TOPICS,
    filters: TOPIC_FILTERS,
    toQuery: (values) => ({
      q: values.q || undefined,
      subjectId: values.subjectId,
    }),
    fetchPage: (params) => api.admin.taxonomy.listTopics(params),
  });

  return (
    <ListView
      list={topics}
      filters={TOPIC_FILTERS}
      columns={columns}
      rowKey={(row) => row.id}
      empty="No topics here yet."
      emptyFiltered="No topics match those filters."
    />
  );
}

function NewTopicDialog({
  subjectId,
  open,
  onOpenChange,
  onDone,
}: Readonly<{
  subjectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}>) {
  const form = useForm<CreateTopicInput>({
    resolver: zodResolver(createTopicSchema),
    defaultValues: { name: '', subjectId },
  });
  // useWatch, not form.watch: a fresh function each render re-renders the picker on every keystroke.
  const chosenSubject = useWatch({ control: form.control, name: 'subjectId' }) ?? '';

  const create = useMutation({
    meta: { success: 'Topic added.' },
    mutationFn: (input: CreateTopicInput) => api.admin.taxonomy.createTopic(input),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, ['name', 'subjectId']),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      form={form}
      onSubmit={(values) => create.mutate(values)}
      title="New topic"
      submitLabel="Add topic"
      loading={create.isPending}
    >
      <FormField form={form} name="subjectId" label="Subject">
        {(control) => (
          <SubjectPicker
            id={control.id}
            value={chosenSubject}
            onChange={(value) => form.setValue('subjectId', value, { shouldValidate: true })}
            placeholder="Choose a subject"
          />
        )}
      </FormField>
      <FormField form={form} name="name" label="Name">
        {(field) => <Input {...field} placeholder="ARITHMETIC" />}
      </FormField>
    </FormDialog>
  );
}
