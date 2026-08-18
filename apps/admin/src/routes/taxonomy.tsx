import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  createSubTopicSchema,
  createSubjectSchema,
  createTopicSchema,
  type CreateSubTopicInput,
  type CreateSubjectInput,
  type CreateTopicInput,
  type SubTopic,
  type Subject,
  type Topic,
} from '@iace/contracts';
import { applyFieldErrors, useListQuery } from '@iace/app-kit';
import {
  Badge,
  BadgeList,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  FormActions,
  FormField,
  FormRow,
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
import { SubjectPicker, TopicPicker } from '../components/taxonomy-picker';

/**
 * Subject -> topic -> sub-topic, the three levels a question is filed under and
 * the lists the import template's dropdowns are generated from. Names are
 * canonical: what is typed is normalised, never refused.
 */

const LEVELS = {
  SUBJECTS: 'subjects',
  TOPICS: 'topics',
  SUB_TOPICS: 'sub-topics',
} as const;

export function TaxonomyPage() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const filters = useFilters<'level' | 'q' | 'subjectId' | 'topicId'>();
  const level = filters.get('level') || LEVELS.SUBJECTS;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Subjects and topics"
        description="Where a question is filed, and what the import template offers. A sub-topic is shared: one row, linked to every topic that drills it."
      />

      <Tabs value={level} onValueChange={(value) => filters.set({ level: value, q: '' })}>
        <TabsList>
          <TabsTrigger value={LEVELS.SUBJECTS}>Subjects</TabsTrigger>
          <TabsTrigger value={LEVELS.TOPICS}>Topics</TabsTrigger>
          <TabsTrigger value={LEVELS.SUB_TOPICS}>Sub-topics</TabsTrigger>
        </TabsList>

        <TabsContent value={LEVELS.SUBJECTS}>
          <SubjectsTab canWrite={canWrite} />
        </TabsContent>
        <TabsContent value={LEVELS.TOPICS}>
          <TopicsTab canWrite={canWrite} />
        </TabsContent>
        <TabsContent value={LEVELS.SUB_TOPICS}>
          <SubTopicsTab canWrite={canWrite} />
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
          <Button size="sm" onClick={() => setCreating((open) => !open)}>
            <Plus aria-hidden />
            New subject
          </Button>
        ) : null}
      </div>

      {creating ? (
        <NewSubjectCard
          onDone={() => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['admin', 'subjects'] });
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

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

function NewSubjectCard({
  onDone,
  onCancel,
}: Readonly<{ onDone: () => void; onCancel: () => void }>) {
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
    <Card>
      <CardHeader>
        <CardTitle>New subject</CardTitle>
        <CardDescription>
          Capital letters, numbers and single spaces — what you type is tidied to that.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormRow onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <FormField form={form} name="name" label="Name">
            {(field) => <Input {...field} placeholder="QUANTITATIVE APTITUDE" autoFocus />}
          </FormField>
          <FormField form={form} name="code" label="Code" hint="Optional">
            {(field) => <Input {...field} placeholder="QA" />}
          </FormField>
          <FormActions>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Add subject
            </Button>
          </FormActions>
        </FormRow>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Topics
// ============================================================================

function topicColumns(): DataTableColumn<Topic>[] {
  return [
    { key: 'name', header: 'Topic', className: 'font-medium', cell: (row) => row.name },
    { key: 'subject', header: 'Subject', cell: (row) => row.subject.name },
    { key: 'subTopics', header: 'Sub-topics', numeric: true, cell: (row) => row.subTopicCount },
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
          <Button size="sm" onClick={() => setCreating((open) => !open)}>
            <Plus aria-hidden />
            New topic
          </Button>
        ) : null}
      </div>

      {creating ? (
        <NewTopicCard
          subjectId={subjectId}
          onDone={() => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['admin', 'topics'] });
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

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

function NewTopicCard({
  subjectId,
  onDone,
  onCancel,
}: Readonly<{ subjectId: string; onDone: () => void; onCancel: () => void }>) {
  const form = useForm<CreateTopicInput>({
    resolver: zodResolver(createTopicSchema),
    defaultValues: { name: '', subjectId },
  });
  const chosenSubject = form.watch('subjectId');

  const create = useMutation({
    meta: { success: 'Topic added.' },
    mutationFn: (input: CreateTopicInput) => api.admin.taxonomy.createTopic(input),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, ['name', 'subjectId']),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>New topic</CardTitle>
        <CardDescription>
          A topic belongs to one subject and never moves — every question under it would change
          meaning.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormRow onSubmit={form.handleSubmit((values) => create.mutate(values))}>
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
          <FormActions>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Add topic
            </Button>
          </FormActions>
        </FormRow>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Sub-topics — the shared level
// ============================================================================

function subTopicColumns(): DataTableColumn<SubTopic>[] {
  return [
    { key: 'name', header: 'Sub-topic', className: 'font-medium', cell: (row) => row.name },
    {
      key: 'topics',
      header: 'Linked to',
      cell: (row) => (
        <BadgeList
          items={row.topics}
          label={(topic) => `${topic.subject.name} / ${topic.name}`}
          empty={<Badge variant="warning">No topic</Badge>}
        />
      ),
    },
    { key: 'questions', header: 'Questions', numeric: true, cell: (row) => row.questionCount },
  ];
}

function SubTopicsTab({ canWrite }: Readonly<{ canWrite: boolean }>) {
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const filters = useFilters<'q' | 'subjectId' | 'topicId'>();
  const subjectId = filters.get('subjectId');
  const topicId = filters.get('topicId');
  const columns = useMemo(() => subTopicColumns(), []);

  const subTopics = useListQuery({
    queryKey: ['admin', 'sub-topics'],
    filters: {
      q: filters.get('q') || undefined,
      subjectId: subjectId || undefined,
      topicId: topicId || undefined,
    },
    fetchPage: (params) => api.admin.taxonomy.listSubTopics(params),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-56 flex-1">
          <SearchInput
            aria-label="Search sub-topics"
            placeholder="Search sub-topics"
            value={filters.get('q')}
            onChange={(q) => filters.set({ q })}
          />
        </div>
        <div className="w-52">
          <SubjectPicker
            aria-label="Filter by subject"
            value={subjectId}
            clearable
            onChange={(value) => filters.set({ subjectId: value, topicId: '' })}
          />
        </div>
        <div className="w-52">
          <TopicPicker
            aria-label="Filter by topic"
            subjectId={subjectId}
            value={topicId}
            clearable
            onChange={(value) => filters.set({ topicId: value })}
          />
        </div>
        {canWrite ? (
          <Button size="sm" onClick={() => setCreating((open) => !open)}>
            <Plus aria-hidden />
            New sub-topic
          </Button>
        ) : null}
      </div>

      {creating ? (
        <NewSubTopicCard
          onDone={() => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['admin', 'sub-topics'] });
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      <DataTable
        columns={columns}
        rows={subTopics.items}
        rowKey={(row) => row.id}
        isLoading={subTopics.isLoading}
        empty="No sub-topics yet."
        footer={subTopics.hasLoaded ? <Pagination {...subTopics.pagination} /> : null}
      />
    </div>
  );
}

function NewSubTopicCard({
  onDone,
  onCancel,
}: Readonly<{ onDone: () => void; onCancel: () => void }>) {
  const [subjectId, setSubjectId] = useState('');

  const form = useForm<CreateSubTopicInput>({
    resolver: zodResolver(createSubTopicSchema),
    defaultValues: { name: '', topicIds: [] },
  });

  const chosenTopics = form.watch('topicIds');

  const create = useMutation({
    meta: { success: 'Sub-topic linked.' },
    mutationFn: (input: CreateSubTopicInput) => api.admin.taxonomy.createSubTopic(input),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, ['name', 'topicIds']),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>New sub-topic</CardTitle>
        <CardDescription>
          A name already in use is LINKED to this topic rather than created again — that is what
          makes PERCENTAGES one thing under Arithmetic and under Data Interpretation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormRow onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <FormField form={form} name="name" label="Name">
            {(field) => <Input {...field} placeholder="PERCENTAGES" autoFocus />}
          </FormField>
          <FormField form={form} name="topicIds" label="Topic">
            {(control) => (
              <div className="flex flex-col gap-2">
                <SubjectPicker
                  id={control.id}
                  aria-label="Subject"
                  value={subjectId}
                  onChange={(value) => {
                    setSubjectId(value);
                    // The topic under the old subject would be linked to the wrong tree.
                    form.setValue('topicIds', []);
                  }}
                  placeholder="Choose a subject"
                />
                <TopicPicker
                  aria-label="Topic"
                  subjectId={subjectId}
                  value={chosenTopics[0] ?? ''}
                  onChange={(value) =>
                    form.setValue('topicIds', value ? [value] : [], { shouldValidate: true })
                  }
                  placeholder="Choose a topic"
                />
              </div>
            )}
          </FormField>
          <FormActions>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Add sub-topic
            </Button>
          </FormActions>
        </FormRow>
      </CardContent>
    </Card>
  );
}
