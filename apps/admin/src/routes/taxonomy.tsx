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
import { applyFieldErrors, useListQuery } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Button,
  DataTable,
  DropdownMenuItem,
  FilterBar,
  FormDialog,
  FormField,
  Input,
  linkVariants,
  PageHeader,
  Pagination,
  RowActions,
  SearchInput,
  TableFrame,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { useFilters } from '../lib/use-filters';
import { SubjectPicker } from '../components/taxonomy-picker';

/**
 * Subject -> topic, the two levels a question is filed under and
 * the lists the import template's dropdowns are generated from. Names are
 * canonical: what is typed is normalised, never refused.
 */

// ============================================================================
// Subjects
// ============================================================================

/** The topics list, already filtered to one subject — the child list reached from its parent. */
function topicsOf(subjectId: string): string {
  return `${ROUTES.TOPICS}?subjectId=${subjectId}`;
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

export function SubjectsPage() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const filters = useFilters<'q'>();
  const columns = useMemo(() => subjectColumns(), []);

  const subjects = useListQuery({
    queryKey: ['admin', 'subjects'],
    filters: { q: filters.get('q') || undefined },
    fetchPage: (params) => api.admin.taxonomy.listSubjects(params),
  });

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Subjects"
      action={
        canWrite ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            New subject
          </Button>
        ) : undefined
      }
    />
  );

  const toolbar = (
    <FilterBar activeCount={filters.activeCount(['q'])} onClear={() => filters.clear()}>
      <div className="min-w-56 flex-1">
        <SearchInput
          aria-label="Search subjects"
          placeholder="Search subjects"
          value={filters.get('q')}
          onChange={(q) => filters.set({ q })}
        />
      </div>
    </FilterBar>
  );

  return (
    <TableFrame header={header} toolbar={toolbar}>
      <NewSubjectDialog
        open={creating}
        onOpenChange={setCreating}
        onDone={() => {
          setCreating(false);
          void queryClient.invalidateQueries({ queryKey: ['admin', 'subjects'] });
        }}
      />

      <DataTable
        columns={columns}
        rows={subjects.items}
        rowKey={(row) => row.id}
        isLoading={subjects.isLoading}
        empty="No subjects yet. Add the first one — questions are filed under it."
        footer={subjects.hasLoaded ? <Pagination {...subjects.pagination} /> : null}
      />
    </TableFrame>
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

/** Named so the bar knows what Clear drops — and so search and subject stay in step. */
const TOPIC_FILTERS = ['q', 'subjectId'] as const;

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

export function TopicsPage() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const filters = useFilters<'q' | 'subjectId'>();
  const subjectId = filters.get('subjectId');
  const columns = useMemo(() => topicColumns(), []);

  const topics = useListQuery({
    queryKey: ['admin', 'topics'],
    filters: { q: filters.get('q') || undefined, subjectId: subjectId || undefined },
    fetchPage: (params) => api.admin.taxonomy.listTopics(params),
  });

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Topics"
      action={
        canWrite ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            New topic
          </Button>
        ) : undefined
      }
    />
  );

  const toolbar = (
    <FilterBar activeCount={filters.activeCount(TOPIC_FILTERS)} onClear={() => filters.clear()}>
      <div className="min-w-56 flex-1">
        <SearchInput
          aria-label="Search topics"
          placeholder="Search topics"
          value={filters.get('q')}
          onChange={(q) => filters.set({ q })}
        />
      </div>

      <div className="w-56">
        <SubjectPicker
          aria-label="Filter by subject"
          value={subjectId}
          clearable
          onChange={(value) => filters.set({ subjectId: value })}
        />
      </div>
    </FilterBar>
  );

  return (
    <TableFrame header={header} toolbar={toolbar}>
      <NewTopicDialog
        subjectId={subjectId}
        open={creating}
        onOpenChange={setCreating}
        onDone={() => {
          setCreating(false);
          void queryClient.invalidateQueries({ queryKey: ['admin', 'topics'] });
        }}
      />

      <DataTable
        columns={columns}
        rows={topics.items}
        rowKey={(row) => row.id}
        isLoading={topics.isLoading}
        empty="No topics here yet."
        footer={topics.hasLoaded ? <Pagination {...topics.pagination} /> : null}
      />
    </TableFrame>
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
