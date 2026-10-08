import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ListTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { type ZodType } from 'zod';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  createSubjectSchema,
  createTopicSchema,
  updateSubjectSchema,
  updateTopicSchema,
  type CreateSubjectInput,
  type CreateTopicInput,
  type Subject,
  type Topic,
  type UpdateSubjectBody,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import { PageCrumbs, useFilters, useListScreen, usePageTour } from '@iace/app-kit/browser';
import {
  Button,
  ConfirmDialog,
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
import { api } from '../../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../../lib/constants';
import { TAXONOMY_TOUR, TOUR_IDS, TOUR_TARGETS } from '../../lib/tours';
import { useAuth } from '../../providers/auth';
import { SubjectMultiPicker, SubjectPicker } from '../../components/taxonomy-picker';

// Subject -> topic: the two levels a question is filed under, and what the import template's dropdowns are generated from; names are canonical, never refused.

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

function subjectColumns(
  canWrite: boolean,
  onRename: (subject: Subject) => void,
  onChanged: () => void,
): DataTableColumn<Subject>[] {
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
        <TaxonomyActions
          noun="subject"
          name={row.name}
          canWrite={canWrite}
          // The row counts two of its holders; the server names the rest if it is refused.
          held={row.topicCount > 0 || row.questionCount > 0}
          consequence="It has no topics and no questions, so nothing is lost. It leaves every picker and cannot be brought back."
          onRename={() => onRename(row)}
          remove={() => api.admin.taxonomy.removeSubject(row.id)}
          onChanged={onChanged}
        >
          <DropdownMenuItem asChild>
            <Link to={topicsOf(row.id)}>
              <ListTree aria-hidden />
              Topics
            </Link>
          </DropdownMenuItem>
        </TaxonomyActions>
      ),
    },
  ];
}

/** A name or a count changed: the lists, every picker's cached query and the question rows that print them. */
const TAXONOMY_QUERIES = [QUERY_KEYS.SUBJECTS, QUERY_KEYS.TOPICS, QUERY_KEYS.QUESTIONS] as const;

function useRefreshTaxonomy() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    for (const queryKey of TAXONOMY_QUERIES) void queryClient.invalidateQueries({ queryKey });
  }, [queryClient]);
}

const RENAME_FIELDS = ['name'] as const;

type RenameValues = Pick<UpdateSubjectBody, 'name'>;

/** A subject and a topic are renamed the same way; only the schema and the route differ. */
function RenameDialog({
  noun,
  current,
  schema,
  save,
  onDone,
  onClose,
}: Readonly<{
  noun: 'subject' | 'topic';
  current: string;
  schema: ZodType<RenameValues, RenameValues>;
  save: (name: string) => Promise<unknown>;
  onDone: () => void;
  onClose: () => void;
}>) {
  const form = useForm<RenameValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: current },
  });

  const rename = useMutation({
    meta: {
      success: `${noun === 'subject' ? 'Subject' : 'Topic'} renamed.`,
      fields: RENAME_FIELDS,
    },
    mutationFn: (input: RenameValues) => save(input.name ?? current),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, RENAME_FIELDS),
  });

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      form={form}
      onSubmit={(values) => rename.mutate(values)}
      title={`Rename ${noun}`}
      submitLabel={`Rename ${noun}`}
      loading={rename.isPending}
    >
      <FormField form={form} name="name" label="Name">
        {(field) => <Input {...field} autoFocus />}
      </FormField>
    </FormDialog>
  );
}

/** Rename and Delete behind the one menu; a writer's, since reading the taxonomy needs neither. */
function TaxonomyActions({
  noun,
  name,
  canWrite,
  held,
  consequence,
  onRename,
  remove,
  onChanged,
  children,
}: Readonly<{
  noun: 'subject' | 'topic';
  name: string;
  canWrite: boolean;
  /** Known from the row to be carried already, so Delete is left out rather than offered to be refused. */
  held: boolean;
  consequence: string;
  onRename: () => void;
  remove: () => Promise<unknown>;
  onChanged: () => void;
  children?: ReactNode;
}>) {
  const [asking, setAsking] = useState(false);

  const drop = useMutation({
    meta: { success: `${name} deleted.` },
    mutationFn: remove,
    onSuccess: () => {
      setAsking(false);
      onChanged();
    },
    // Closing on failure too, or the row is left asking a question already answered.
    onError: () => setAsking(false),
  });

  return (
    <>
      <RowActions label={`Actions for ${name}`}>
        {children}
        {canWrite ? (
          <DropdownMenuItem onSelect={onRename}>
            <Pencil aria-hidden />
            Rename
          </DropdownMenuItem>
        ) : null}
        {canWrite && !held ? (
          <DropdownMenuItem destructive onSelect={() => setAsking(true)}>
            <Trash2 aria-hidden />
            Delete
          </DropdownMenuItem>
        ) : null}
      </RowActions>

      <ConfirmDialog
        open={asking}
        onOpenChange={(open) => !open && setAsking(false)}
        destructive
        loading={drop.isPending}
        title={`Delete ${name}?`}
        description={consequence}
        confirmLabel={`Delete ${noun}`}
        onConfirm={() => drop.mutate()}
      />
    </>
  );
}

/** Two levels of one taxonomy, so one nav row and a tab each rather than two menu entries. */
const LEVELS = {
  SUBJECTS: 'subjects',
  TOPICS: 'topics',
} as const;

export function TaxonomyPage() {
  const { can } = useAuth();
  usePageTour({ id: TOUR_IDS.TAXONOMY, steps: TAXONOMY_TOUR, ready: true });
  const canWrite = can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const filters = useFilters<'level' | 'q' | 'subjectId'>();
  const onSubjects = filters.get('level') !== LEVELS.TOPICS;
  const level = onSubjects ? LEVELS.SUBJECTS : LEVELS.TOPICS;

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Subjects and topics"
      action={
        canWrite ? (
          <Button data-tour={TOUR_TARGETS.TAXONOMY_NEW} size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {onSubjects ? 'New subject' : 'New topic'}
          </Button>
        ) : undefined
      }
    />
  );

  const done =
    (...queryKeys: readonly (readonly string[])[]) =>
    () => {
      setCreating(false);
      for (const queryKey of queryKeys) void queryClient.invalidateQueries({ queryKey });
    };
  const subjectId = onlySubjectFiltered(filters.get('subjectId'));

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
          // Its form resets to the values it was mounted with, so a new filter is a new dialog.
          key={subjectId}
          subjectId={subjectId}
          open={creating}
          onOpenChange={setCreating}
          // A subject's row counts its topics.
          onDone={done(QUERY_KEYS.TOPICS, QUERY_KEYS.SUBJECTS)}
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
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [renaming, setRenaming] = useState<Subject | null>(null);
  const refresh = useRefreshTaxonomy();
  const columns = useMemo(
    () => subjectColumns(canWrite, setRenaming, refresh),
    [canWrite, refresh],
  );

  const subjects = useListScreen({
    queryKey: QUERY_KEYS.SUBJECTS,
    filters: SUBJECT_FILTERS,
    toQuery: (values) => ({ q: values.q || undefined }),
    fetchPage: (params) => api.admin.taxonomy.listSubjects(params),
  });

  return (
    <>
      {/* Mounted only while a row is being renamed and keyed by it, or it opens on the last row's name. */}
      {renaming ? (
        <RenameDialog
          key={renaming.id}
          noun="subject"
          current={renaming.name}
          schema={updateSubjectSchema}
          save={(name) => api.admin.taxonomy.updateSubject(renaming.id, { name })}
          onDone={() => {
            setRenaming(null);
            refresh();
          }}
          onClose={() => setRenaming(null)}
        />
      ) : null}
      <ListView
        list={subjects}
        filters={SUBJECT_FILTERS}
        columns={columns}
        rowKey={(row) => row.id}
        empty={{
          title: 'No subjects yet',
          hint: 'Add the first one. Questions are filed under it.',
        }}
        emptyFiltered="No subjects match that search"
      />
    </>
  );
}

const SUBJECT_FIELDS = ['name', 'code'] as const;
const TOPIC_FIELDS = ['name', 'subjectId'] as const;

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
    meta: { success: 'Subject added.', fields: SUBJECT_FIELDS },
    mutationFn: (input: CreateSubjectInput) =>
      api.admin.taxonomy.createSubject({ name: input.name, code: input.code || undefined }),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, SUBJECT_FIELDS),
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
      <FormField form={form} name="code" label="Code" /* ui-copy-ok: rule */ hint="Optional">
        {(field) => <Input {...field} placeholder="QA" />}
      </FormField>
    </FormDialog>
  );
}

// ============================================================================
// Topics
// ============================================================================

function topicColumns(
  canWrite: boolean,
  onRename: (topic: Topic) => void,
  onChanged: () => void,
): DataTableColumn<Topic>[] {
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
    ...(canWrite
      ? [
          {
            key: 'actions',
            className: 'text-right',
            cell: (row: Topic) => (
              <TaxonomyActions
                noun="topic"
                name={row.name}
                canWrite
                // The row counts its questions; the server names a draw setting if one still uses it.
                held={row.questionCount > 0}
                consequence="It has no questions, so nothing is lost. It leaves every picker and cannot be brought back."
                onRename={() => onRename(row)}
                remove={() => api.admin.taxonomy.removeTopic(row.id)}
                onChanged={onChanged}
              />
            ),
          },
        ]
      : []),
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
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [renaming, setRenaming] = useState<Topic | null>(null);
  const refresh = useRefreshTaxonomy();
  const columns = useMemo(() => topicColumns(canWrite, setRenaming, refresh), [canWrite, refresh]);

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
    <>
      {renaming ? (
        <RenameDialog
          key={renaming.id}
          noun="topic"
          current={renaming.name}
          schema={updateTopicSchema}
          save={(name) => api.admin.taxonomy.updateTopic(renaming.id, { name })}
          onDone={() => {
            setRenaming(null);
            refresh();
          }}
          onClose={() => setRenaming(null)}
        />
      ) : null}
      <ListView
        list={topics}
        filters={TOPIC_FILTERS}
        columns={columns}
        rowKey={(row) => row.id}
        empty="No topics here yet"
        emptyFiltered="No topics match those filters"
      />
    </>
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
    meta: { success: 'Topic added.', fields: TOPIC_FIELDS },
    mutationFn: (input: CreateTopicInput) => api.admin.taxonomy.createTopic(input),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, TOPIC_FIELDS),
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
