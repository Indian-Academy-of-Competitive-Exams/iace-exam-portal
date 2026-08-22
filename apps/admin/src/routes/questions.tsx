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
import { PageCrumbs, useFilters, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  BadgeList,
  Button,
  ConfirmDialog,
  ListView,
  PageHeader,
  TableFrame,
  TruncatedText,
  linkVariants,
  type DataTableColumn,
  type ListFilterMultiControl,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { SubjectMultiPicker, TopicMultiPicker } from '../components/taxonomy-picker';

type FilterKey = 'q' | 'subjectId' | 'topicId' | 'type' | 'difficulty' | 'status';

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

  // Held outside the spec: changing the subjects also has to drop the topics under them.
  const filters = useFilters<FilterKey>();
  const subjectIds = filters.get('subjectId').split(',').filter(Boolean);

  const filterSpec = [
    {
      key: 'q',
      kind: 'search',
      label: 'Search questions',
      placeholder: 'Search the question text or a code',
      primary: true,
    },
    {
      key: 'status',
      kind: 'multi',
      label: 'Filter by status',
      primary: true,
      placeholder: 'Any status',
      items: QUESTION_STATUSES.map((value) => ({ value, label: value })),
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
      items: QUESTION_TYPES.map((type) => ({
        value: type,
        label: type === 'SINGLE_MCQ' ? 'Multiple choice' : 'Typed answer',
      })),
    },
  ] as const;

  const questions = useListScreen({
    queryKey: ['admin', 'questions'],
    filters: filterSpec,
    toQuery: (values) => ({
      q: values.q || undefined,
      subjectId: values.subjectId,
      topicId: values.topicId,
      type: values.type as QuestionSummary['type'][],
      difficulty: values.difficulty as QuestionSummary['difficulty'][],
      // ARCHIVED is out of circulation, so an untouched filter opens on the rest.
      status:
        values.status.length > 0
          ? (values.status as QuestionSummary['status'][])
          : [DEFAULT_STATUS],
    }),
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

  return (
    <TableFrame header={header}>
      <ListView
        list={questions}
        filters={filterSpec}
        columns={columns}
        rowKey={(question) => question.id}
        empty="No questions yet. Import a sheet, or add one."
        emptyFiltered="No questions match those filters."
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
