import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
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
import {
  Button,
  DataTable,
  FormDialog,
  FormField,
  Input,
  PageHeader,
  Pagination,
  SearchInput,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { useAuth } from '../providers/auth';
import { useFilters } from '../lib/use-filters';
import { SubjectPicker } from '../components/taxonomy-picker';

/**
 * Subject -> topic, the two levels a question is filed under and
 * the lists the import template's dropdowns are generated from. Names are
 * canonical: what is typed is normalised, never refused.
 */

const LEVELS = {
  SUBJECTS: 'subjects',
  TOPICS: 'topics',
} as const;

export function TaxonomyPage() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const filters = useFilters<'level' | 'q' | 'subjectId'>();
  const level = filters.get('level') || LEVELS.SUBJECTS;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Subjects and topics"
        description="Where a question is filed, and what the import template offers. Anything finer than a topic is a tag on the question."
      />

      <Tabs value={level} onValueChange={(value) => filters.set({ level: value, q: '' })}>
        <TabsList>
          <TabsTrigger value={LEVELS.SUBJECTS}>Subjects</TabsTrigger>
          <TabsTrigger value={LEVELS.TOPICS}>Topics</TabsTrigger>
        </TabsList>

        <TabsContent value={LEVELS.SUBJECTS}>
          <SubjectsTab canWrite={canWrite} />
        </TabsContent>
        <TabsContent value={LEVELS.TOPICS}>
          <TopicsTab canWrite={canWrite} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================================
// Subjects
// ============================================================================

function subjectColumns(): DataTableColumn<Subject>[] {
  return [
    { key: 'name', header: 'Subject', className: 'font-medium', cell: (row) => row.name },
    {
      key: 'code',
      header: 'Code',
      cell: (row) => row.code ?? <span className="text-muted-foreground">—</span>,
    },
    { key: 'topics', header: 'Topics', numeric: true, cell: (row) => row.topicCount },
    { key: 'questions', header: 'Questions', numeric: true, cell: (row) => row.questionCount },
  ];
}

function SubjectsTab({ canWrite }: Readonly<{ canWrite: boolean }>) {
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const filters = useFilters<'q'>();
  const columns = useMemo(() => subjectColumns(), []);

  const subjects = useListQuery({
    queryKey: ['admin', 'subjects'],
    filters: { q: filters.get('q') || undefined },
    fetchPage: (params) => api.admin.taxonomy.listSubjects(params),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-56 flex-1">
          <SearchInput
            aria-label="Search subjects"
            placeholder="Search subjects"
            value={filters.get('q')}
            onChange={(q) => filters.set({ q })}
          />
        </div>
        {canWrite ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            New subject
          </Button>
        ) : null}
      </div>

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
    </div>
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
      description="Capital letters, numbers and single spaces — what you type is tidied to that."
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
    { key: 'name', header: 'Topic', className: 'font-medium', cell: (row) => row.name },
    { key: 'subject', header: 'Subject', cell: (row) => row.subject.name },
    { key: 'questions', header: 'Questions', numeric: true, cell: (row) => row.questionCount },
  ];
}

function TopicsTab({ canWrite }: Readonly<{ canWrite: boolean }>) {
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
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
        {canWrite ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            New topic
          </Button>
        ) : null}
      </div>

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
    </div>
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
      description="A topic belongs to one subject and never moves — every question under it would change meaning."
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
