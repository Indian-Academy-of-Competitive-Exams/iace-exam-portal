import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Plus, Upload } from 'lucide-react';
import {
  DIFFICULTY_LEVELS,
  FEATURE_KEYS,
  LANGUAGE_LABELS,
  PERMISSION_LEVELS,
  QUESTION_STATUS,
  QUESTION_STATUSES,
  QUESTION_TYPES,
  type QuestionSummary,
} from '@iace/contracts';
import { useListQuery } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Badge,
  BadgeList,
  Button,
  Combobox,
  ConfirmDialog,
  DataTable,
  linkVariants,
  PageHeader,
  Pagination,
  SearchInput,
  TableFrame,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { useFilters } from '../lib/use-filters';
import { SubjectPicker, TopicPicker } from '../components/taxonomy-picker';

/** Every filter this screen owns. Named once so "clear all" cannot miss one. */
const ALL_FILTERS = ['q', 'subjectId', 'topicId', 'type', 'difficulty', 'status'] as const;
type FilterKey = (typeof ALL_FILTERS)[number];

/** ARCHIVED questions are out of circulation, so the list opens on the ones that are not. */
const DEFAULT_STATUS = QUESTION_STATUS.ACTIVE;

const DIFFICULTY_VARIANT = {
  LOW: 'success',
  MEDIUM: 'info',
  HIGH: 'warning',
} as const;

const STATUS_VARIANT = {
  [QUESTION_STATUS.DRAFT]: 'neutral',
  [QUESTION_STATUS.ACTIVE]: 'success',
  [QUESTION_STATUS.ARCHIVED]: 'warning',
} as const;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function questionColumns(): DataTableColumn<QuestionSummary>[] {
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
      cell: (question) => (
        <span className="text-muted-foreground">
          {[question.subject.name, question.topic?.name].filter(Boolean).join(' / ')}
        </span>
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
      key: 'status',
      header: 'Status',
      cell: (question) => (
        <Badge variant={STATUS_VARIANT[question.status]}>{question.status}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (question) => <QuestionActions question={question} />,
    },
  ];
}

export function QuestionsPage() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE);

  // Every filter lives in the URL, so a link into this screen and the controls
  // on it are the same state.
  const filters = useFilters<FilterKey>();
  const subjectId = filters.get('subjectId');
  const topicId = filters.get('topicId');
  const status = (filters.get('status') || DEFAULT_STATUS) as QuestionSummary['status'] | '';

  const questions = useListQuery({
    queryKey: ['admin', 'questions'],
    filters: {
      q: filters.get('q') || undefined,
      subjectId: subjectId || undefined,
      topicId: topicId || undefined,
      type: (filters.get('type') || undefined) as QuestionSummary['type'] | undefined,
      difficulty: (filters.get('difficulty') || undefined) as
        QuestionSummary['difficulty'] | undefined,
      status: status || undefined,
    },
    fetchPage: (params) => api.admin.questions.list(params),
  });

  const columns = useMemo(() => questionColumns(), []);

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Questions"
      action={
        canWrite ? (
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to={ROUTES.IMPORT_QUESTIONS}>
                <Upload aria-hidden />
                Import
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link to={ROUTES.QUESTION_NEW}>
                <Plus aria-hidden />
                New question
              </Link>
            </Button>
          </span>
        ) : undefined
      }
    />
  );

  const toolbar = (
    <div className="mb-4 flex flex-wrap gap-3">
      <div className="min-w-56 flex-1">
        <SearchInput
          aria-label="Search questions"
          placeholder="Search the question text or a code"
          value={filters.get('q')}
          onChange={(q) => filters.set({ q })}
        />
      </div>

      <div className="w-52">
        <SubjectPicker
          aria-label="Filter by subject"
          value={subjectId}
          clearable
          // A topic under the old subject would filter everything away.
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

      <div className="w-40">
        <Combobox
          aria-label="Filter by difficulty"
          clearable={false}
          value={filters.get('difficulty')}
          onChange={(next) => filters.set({ difficulty: next })}
          items={[
            { value: '', label: 'Any difficulty' },
            ...DIFFICULTY_LEVELS.map((level) => ({ value: level, label: level })),
          ]}
        />
      </div>

      <div className="w-40">
        <Combobox
          aria-label="Filter by type"
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
      </div>

      <div className="w-40">
        <Combobox
          aria-label="Filter by status"
          clearable={false}
          value={filters.get('status')}
          onChange={(next) => filters.set({ status: next })}
          items={[
            { value: '', label: 'Any status' },
            ...QUESTION_STATUSES.map((value) => ({ value, label: value })),
          ]}
        />
      </div>
    </div>
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
            ? 'No questions match those filters.'
            : 'No questions yet. Import a sheet, or add one.'
        }
        footer={questions.hasLoaded ? <Pagination {...questions.pagination} /> : null}
      />
    </TableFrame>
  );
}

function QuestionActions({ question }: Readonly<{ question: QuestionSummary }>) {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();

  const isArchived = question.status === QUESTION_STATUS.ARCHIVED;

  const setStatus = useMutation({
    meta: { success: isArchived ? 'Question back in circulation.' : 'Question retired.' },
    mutationFn: () =>
      api.admin.questions.setStatus(question.id, {
        status: isArchived ? QUESTION_STATUS.ACTIVE : QUESTION_STATUS.ARCHIVED,
      }),
    onSuccess: () => {
      setConfirming(false);
      return queryClient.invalidateQueries({ queryKey: ['admin', 'questions'] });
    },
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: () => setConfirming(false),
  });

  if (!canWrite) return null;

  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant="outline" asChild>
        <Link to={ROUTES.QUESTION(question.id)}>Edit</Link>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label={isArchived ? 'Return this question' : 'Retire this question'}
        onClick={() => {
          setStatus.reset();
          setConfirming(true);
        }}
      >
        <EyeOff aria-hidden />
      </Button>

      {/* Retiring changes what future papers can draw, and nothing on the row
          shows that having happened — so it is confirmed in both directions. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        loading={setStatus.isPending}
        title={isArchived ? 'Put this question back?' : 'Retire this question?'}
        description={
          isArchived
            ? 'It becomes available to new papers again.'
            : 'It stops being drawn into new papers and disappears from the bank. Papers that already pinned a version of it are untouched, and it can be brought back.'
        }
        confirmLabel={isArchived ? 'Put back' : 'Retire'}
        onConfirm={() => setStatus.mutate()}
      />
    </span>
  );
}
