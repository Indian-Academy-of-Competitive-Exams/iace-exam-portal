import { Printer } from 'lucide-react';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  todayISO,
  type DifficultyLevel,
  type QuestionType,
} from '@iace/contracts';
import { PageCrumbs, useFilters, useListScreen, usePrint } from '@iace/app-kit/browser';
import {
  Button,
  EmptyState,
  EMPTY_STATE_KINDS,
  PageFrame,
  PageHeader,
  Pagination,
  SkeletonParagraph,
  plural,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { ProofreadQuestionBlock } from '../components/proofread-question';
import {
  QUESTION_AUTHOR_FILTER,
  QUESTION_TAG_FILTER,
  questionFacetFilters,
} from '../lib/question-filters';

type FilterKey =
  'q' | 'subjectId' | 'topicId' | 'type' | 'difficulty' | 'tag' | 'author' | 'from' | 'to';

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
    ...questionFacetFilters(filters, subjectIds),
    QUESTION_TAG_FILTER,
    QUESTION_AUTHOR_FILTER,
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
      footer={
        questions.hasLoaded && questions.total > 0 ? <Pagination {...questions.pagination} /> : null
      }
    >
      <section data-print-document className="flex flex-col gap-8">
        {questions.isLoading ? <SkeletonParagraph lines={12} /> : null}

        {questions.hasLoaded && questions.rows.length === 0 ? (
          <EmptyState
            kind={EMPTY_STATE_KINDS.FILTERED}
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
    </PageFrame>
  );
}
