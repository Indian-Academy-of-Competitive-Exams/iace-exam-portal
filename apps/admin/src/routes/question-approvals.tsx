import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, EyeOff } from 'lucide-react';
import {
  DIFFICULTY_LEVELS,
  FEATURE_KEYS,
  LANGUAGE_LABELS,
  PERMISSION_LEVELS,
  QUESTION_STATUS,
  QUESTION_TYPES,
  type QuestionSummary,
} from '@iace/contracts';
import { useListQuery } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Badge,
  BadgeList,
  Combobox,
  ConfirmDialog,
  DataTable,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Field,
  FilterBar,
  PageHeader,
  Pagination,
  RowActions,
  SearchInput,
  TableFrame,
  TruncatedText,
  linkVariants,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { useFilters } from '../lib/use-filters';
import { SubjectPicker, TopicPicker } from '../components/taxonomy-picker';

/** Every filter this screen owns. Named once so "clear all" cannot miss one. */
const ALL_FILTERS = ['q', 'subjectId', 'topicId', 'type', 'difficulty'] as const;
/** Everything but the search: a queue is read top to bottom before it is narrowed. */
const FOLDED_FILTERS = ['subjectId', 'topicId', 'type', 'difficulty'] as const;
type FilterKey = (typeof ALL_FILTERS)[number];

const QUESTIONS_KEY = ['admin', 'questions'] as const;

const DIFFICULTY_VARIANT = {
  LOW: 'success',
  MEDIUM: 'info',
  HIGH: 'warning',
} as const;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function approvalColumns(): DataTableColumn<QuestionSummary>[] {
  return [
    {
      key: 'stem',
      header: 'Question',
      className: 'max-w-md',
      cell: (question) => (
        <Link to={ROUTES.QUESTION(question.id)} className={linkVariants()}>
          <TruncatedText>{question.stemPreview}</TruncatedText>
        </Link>
      ),
    },
    {
      key: 'taxonomy',
      header: 'Filed under',
      className: 'max-w-56',
      cell: (question) => (
        <TruncatedText className="text-muted-foreground">
          {[question.subject.name, question.topic?.name].filter(Boolean).join(' / ')}
        </TruncatedText>
      ),
    },
    {
      key: 'languages',
      header: 'Languages',
      cell: (question) => (
        <BadgeList
          items={question.languages}
          label={(language) => LANGUAGE_LABELS[language]}
          empty={<span className="text-muted-foreground">—</span>}
        />
      ),
    },
    {
      key: 'difficulty',
      header: 'Difficulty',
      cell: (question) => (
        <Badge variant={DIFFICULTY_VARIANT[question.difficulty]}>{question.difficulty}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (question) => <ApprovalActions question={question} />,
    },
  ];
}

export function QuestionApprovalsPage() {
  const filters = useFilters<FilterKey>();
  const subjectId = filters.get('subjectId');
  const topicId = filters.get('topicId');

  // Status is not a filter here: a screen for approving drafts shows drafts.
  const questions = useListQuery({
    queryKey: [...QUESTIONS_KEY, 'drafts'],
    filters: {
      q: filters.get('q') || undefined,
      subjectId: subjectId || undefined,
      topicId: topicId || undefined,
      type: (filters.get('type') || undefined) as QuestionSummary['type'] | undefined,
      difficulty: (filters.get('difficulty') || undefined) as
        QuestionSummary['difficulty'] | undefined,
      status: QUESTION_STATUS.DRAFT,
    },
    fetchPage: (params) => api.admin.questions.list(params),
  });

  const columns = useMemo(() => approvalColumns(), []);

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Draft questions"
      meta={questions.hasLoaded ? `${questions.pagination.total} waiting` : undefined}
    />
  );

  const advancedFilters = (
    <>
      <Field htmlFor="filter-subject" label="Subject">
        {(control) => (
          <SubjectPicker
            {...control}
            value={subjectId}
            clearable
            // A topic under the old subject would filter everything away.
            onChange={(value) => filters.set({ subjectId: value, topicId: '' })}
          />
        )}
      </Field>

      <Field htmlFor="filter-topic" label="Topic">
        {(control) => (
          <TopicPicker
            {...control}
            subjectId={subjectId}
            value={topicId}
            clearable
            onChange={(value) => filters.set({ topicId: value })}
          />
        )}
      </Field>

      <Field htmlFor="filter-difficulty" label="Difficulty">
        {(control) => (
          <Combobox
            {...control}
            clearable={false}
            value={filters.get('difficulty')}
            onChange={(next) => filters.set({ difficulty: next })}
            items={[
              { value: '', label: 'Any difficulty' },
              ...DIFFICULTY_LEVELS.map((level) => ({ value: level, label: level })),
            ]}
          />
        )}
      </Field>

      <Field htmlFor="filter-type" label="Type">
        {(control) => (
          <Combobox
            {...control}
            clearable={false}
            value={filters.get('type')}
            onChange={(next) => filters.set({ type: next })}
            items={[
              { value: '', label: 'Any type' },
              ...QUESTION_TYPES.map((type) => ({
                value: type,
                label: type === 'SINGLE_MCQ' ? 'Multiple choice' : 'Typed answer',
              })),
            ]}
          />
        )}
      </Field>
    </>
  );

  const toolbar = (
    <FilterBar
      activeCount={filters.activeCount(ALL_FILTERS)}
      advancedCount={filters.activeCount(FOLDED_FILTERS)}
      onClear={() => filters.clear()}
      advanced={advancedFilters}
    >
      <div className="min-w-56 flex-1">
        <SearchInput
          aria-label="Search draft questions"
          placeholder="Search the question text or a code"
          value={filters.get('q')}
          onChange={(q) => filters.set({ q })}
        />
      </div>
    </FilterBar>
  );

  return (
    <TableFrame header={header} toolbar={toolbar}>
      {/* "None match" and "there are none" are different facts, and telling an
          admin the wrong one sends them looking in the wrong place. */}
      <DataTable
        columns={columns}
        rows={questions.items}
        rowKey={(question) => question.id}
        isLoading={questions.isLoading}
        empty={
          filters.activeCount(ALL_FILTERS) > 0
            ? 'No drafts match those filters.'
            : 'Nothing waiting for review.'
        }
        footer={questions.hasLoaded ? <Pagination {...questions.pagination} /> : null}
      />
    </TableFrame>
  );
}

const DECISIONS = {
  APPROVE: 'APPROVE',
  ARCHIVE: 'ARCHIVE',
} as const;
type Decision = (typeof DECISIONS)[keyof typeof DECISIONS];

function ApprovalActions({ question }: Readonly<{ question: QuestionSummary }>) {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [asking, setAsking] = useState<Decision | null>(null);
  const queryClient = useQueryClient();

  const approving = asking === DECISIONS.APPROVE;

  const decide = useMutation({
    meta: { success: approving ? 'Question approved.' : 'Draft retired.' },
    mutationFn: (decision: Decision) =>
      api.admin.questions.setStatus(question.id, {
        status: decision === DECISIONS.APPROVE ? QUESTION_STATUS.ACTIVE : QUESTION_STATUS.ARCHIVED,
      }),
    onSuccess: () => {
      setAsking(null);
      return queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY });
    },
    // On failure, drop the confirm — the row must not keep asking an answered question.
    onError: () => setAsking(null),
  });

  if (!canWrite) return null;

  const ask = (decision: Decision) => {
    decide.reset();
    setAsking(decision);
  };

  return (
    <>
      <RowActions label={`Review ${question.questionCode ?? question.stemPreview}`}>
        <DropdownMenuItem asChild>
          <Link to={ROUTES.QUESTION(question.id)}>Open</Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem disabled={decide.isPending} onSelect={() => ask(DECISIONS.APPROVE)}>
          <Check aria-hidden />
          Approve
        </DropdownMenuItem>
        <DropdownMenuItem
          destructive
          disabled={decide.isPending}
          onSelect={() => ask(DECISIONS.ARCHIVE)}
        >
          <EyeOff aria-hidden />
          Retire
        </DropdownMenuItem>
      </RowActions>

      {/* Approving puts it in front of students, and nothing on the row shows
          that having happened — so both directions are confirmed. */}
      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        loading={decide.isPending}
        title={approving ? 'Approve this question?' : 'Retire this draft?'}
        description={
          approving
            ? 'It joins the bank and can be drawn into any paper built from now on.'
            : 'It leaves the review list and is drawn into no paper. It can be brought back from the questions screen.'
        }
        confirmLabel={approving ? 'Approve' : 'Retire'}
        onConfirm={() => asking && decide.mutate(asking)}
      />
    </>
  );
}
