import { FileText, Printer } from 'lucide-react';
import {
  DIFFICULTY_LEVELS,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  QUESTION_STATUSES,
  QUESTION_TYPES,
  todayISO,
  type DifficultyLevel,
  type QuestionStatus,
  type QuestionType,
} from '@iace/contracts';
import { PageCrumbs, useFilters, useListScreen, usePrint } from '@iace/app-kit/browser';
import {
  Alert,
  Button,
  EmptyState,
  PageFrame,
  PageHeader,
  Pagination,
  SkeletonParagraph,
  plural,
  type ListFilterMultiControl,
} from '@iace/ui';
import { api } from '../lib/api';
import {
  NAV_ITEMS,
  QUERY_KEYS,
  QUESTION_STATUS_LABELS,
  QUESTION_TYPE_LABELS,
} from '../lib/constants';
import { useAuth } from '../providers/auth';
import { SubjectMultiPicker, TopicMultiPicker } from '../components/taxonomy-picker';
import { ProofreadQuestionBlock } from '../components/proofread-question';

type FilterKey =
  | 'q'
  | 'subjectId'
  | 'topicId'
  | 'type'
  | 'difficulty'
  | 'status'
  | 'tag'
  | 'author'
  | 'from'
  | 'to';

/** A filtered selection of the bank, read top to bottom as one document rather than a table. */
export function ProofreadingPage() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.QUESTION_PROOFREAD, PERMISSION_LEVELS.WRITE);
  const print = usePrint();

  // Held outside the spec: changing the subjects also has to drop the topics under them.
  const filters = useFilters<FilterKey>();
  const subjectIds = filters.get('subjectId').split(',').filter(Boolean);

  const filterSpec = [
    {
      key: 'q',
      kind: 'search',
      label: 'Search questions',
      placeholder: 'Search the text, a code or a tag',
      primary: true,
    },
    {
      key: 'subjectId',
      kind: 'customMulti',
      label: 'Subject',
      render: (control: ListFilterMultiControl) => (
        <SubjectMultiPicker
          {...control}
          // A topic under a subject no longer chosen would filter everything away.
          onChange={(value) => filters.set({ subjectId: value.join(','), topicId: '' })}
        />
      ),
    },
    {
      key: 'topicId',
      kind: 'customMulti',
      label: 'Topic',
      render: (control: ListFilterMultiControl) => (
        <TopicMultiPicker {...control} subjectIds={subjectIds} />
      ),
    },
    {
      key: 'status',
      kind: 'multi',
      label: 'Status',
      placeholder: 'Any status',
      items: QUESTION_STATUSES.map((value) => ({ value, label: QUESTION_STATUS_LABELS[value] })),
    },
    {
      key: 'difficulty',
      kind: 'multi',
      label: 'Difficulty',
      placeholder: 'Any difficulty',
      items: DIFFICULTY_LEVELS.map((level) => ({ value: level, label: level })),
    },
    {
      key: 'type',
      kind: 'multi',
      label: 'Type',
      placeholder: 'Any type',
      items: QUESTION_TYPES.map((value) => ({ value, label: QUESTION_TYPE_LABELS[value] })),
    },
    { key: 'tag', kind: 'search', label: 'Tag', placeholder: 'Exactly one tag' },
    { key: 'author', kind: 'search', label: 'Written by', placeholder: 'A name or an email' },
    { key: 'from', kind: 'date', label: 'Written from', max: todayISO() },
    { key: 'to', kind: 'date', label: 'Written to', max: todayISO() },
  ] as const;

  const questions = useListScreen({
    queryKey: QUERY_KEYS.PROOFREADING,
    filters: filterSpec,
    toQuery: (values) => ({
      q: values.q || undefined,
      subjectId: values.subjectId,
      topicId: values.topicId,
      type: values.type as QuestionType[],
      difficulty: values.difficulty as DifficultyLevel[],
      status: values.status as QuestionStatus[],
      tag: values.tag || undefined,
      author: values.author || undefined,
      from: values.from || undefined,
      to: values.to || undefined,
    }),
    fetchPage: (params) => api.admin.proofreading.document(params),
  });

  // The page on screen is the page that prints, so the reader can see the document before they take it.
  const first = (questions.pagination.page - 1) * questions.pagination.pageSize;

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          title="Proof-reading"
          meta={questions.hasLoaded ? plural(questions.total, 'question') : undefined}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={print}
              disabled={questions.rows.length === 0}
            >
              <Printer aria-hidden />
              Download PDF
            </Button>
          }
        />
      }
      filters={{ spec: filterSpec, state: questions }}
    >
      <div className="flex flex-col gap-6">
        <section data-print-document className="flex flex-col gap-8">
          {/* ui-copy-ok: consequence */}
          <Alert variant="warning">
            Internal — proof-reading copy, not for distribution. Every question below carries its
            answer key and solution.
          </Alert>

          {questions.isLoading ? <SkeletonParagraph lines={12} /> : null}

          {questions.hasLoaded && questions.rows.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nothing matches"
              action={
                <Button variant="outline" onClick={questions.clearFilters}>
                  Clear the filters
                </Button>
              }
            />
          ) : null}

          {questions.rows.map((question, index) => (
            <ProofreadQuestionBlock
              key={question.id}
              question={question}
              index={first + index + 1}
              canWrite={canWrite}
            />
          ))}
        </section>

        {questions.hasLoaded && questions.total > 0 ? (
          <Pagination {...questions.pagination} />
        ) : null}
      </div>
    </PageFrame>
  );
}
