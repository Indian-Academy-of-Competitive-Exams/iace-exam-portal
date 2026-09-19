import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, History, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import {
  FEATURE_KEYS,
  LANGUAGE_LABELS,
  PERMISSION_LEVELS,
  QUESTION_STATUS,
  QUESTION_STATUSES,
  type QuestionSummary,
} from '@iace/contracts';
import { PageCrumbs, useFilters, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  BadgeList,
  Button,
  ConfirmDialog,
  DropdownMenuItem,
  ListView,
  RowActions,
  PageHeader,
  TableFrame,
  TruncatedText,
  linkVariants,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { DIFFICULTY_VARIANT, NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { questionFacetFilters } from '../lib/question-filters';
import { QuestionHistorySheet } from '../components/question-history';

type FilterKey = 'q' | 'subjectId' | 'topicId' | 'type' | 'difficulty' | 'status';

const STATUS_VARIANT = {
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
      placeholder: 'Search the text, a code or a tag',
      primary: true,
    },
    {
      key: 'status',
      kind: 'multi',
      label: 'Filter by status',
      primary: true,
      placeholder: 'In circulation',
      items: QUESTION_STATUSES.map((value) => ({ value, label: value })),
    },
    ...questionFacetFilters(filters, subjectIds),
  ] as const;

  const questions = useListScreen({
    queryKey: QUERY_KEYS.QUESTIONS,
    filters: filterSpec,
    toQuery: (values) => ({
      q: values.q || undefined,
      subjectId: values.subjectId,
      topicId: values.topicId,
      type: values.type as QuestionSummary['type'][],
      difficulty: values.difficulty as QuestionSummary['difficulty'][],
      // Naming no status is how you ask for the bank; the server leaves the retired out of it.
      status: values.status as QuestionSummary['status'][],
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
        empty={{ title: 'No questions yet', hint: 'Import a sheet, or add one.' }}
        emptyFiltered="No questions match those filters"
      />
    </TableFrame>
  );
}

/** What a row can do to a question, and what each one is called when it is confirmed. */
const PROMPTS = {
  ARCHIVE: {
    title: 'Archive this question?',
    description:
      'It stops being drawn into new papers and disappears from the bank. Papers that already pinned a version of it are untouched, and it can be brought back.',
    confirmLabel: 'Archive',
    destructive: true,
  },
  UNARCHIVE: {
    title: 'Put this question back?',
    description: 'It becomes available to new papers again.',
    confirmLabel: 'Unarchive',
    destructive: false,
  },
  DELETE: {
    title: 'Delete this question?',
    description:
      'It is removed from the bank for good, along with every version of it. This cannot be undone.',
    confirmLabel: 'Delete',
    destructive: true,
  },
} as const;

type Move = keyof typeof PROMPTS;

const RUN: Record<Move, (id: string) => Promise<unknown>> = {
  ARCHIVE: (id) => api.admin.questions.archive(id),
  UNARCHIVE: (id) => api.admin.questions.unarchive(id),
  DELETE: (id) => api.admin.questions.remove(id),
};

function QuestionActions({ question }: Readonly<{ question: QuestionSummary }>) {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [asking, setAsking] = useState<Move | null>(null);
  const [showingHistory, setShowingHistory] = useState(false);
  const queryClient = useQueryClient();

  const isArchived = question.status === QUESTION_STATUS.ARCHIVED;

  const settle = () => {
    setAsking(null);
    return queryClient.invalidateQueries({ queryKey: QUERY_KEYS.QUESTIONS });
  };

  const act = useMutation({
    meta: { success: 'Question updated.' },
    mutationFn: (move: Move) => RUN[move](question.id),
    onSuccess: settle,
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: () => setAsking(null),
  });

  const ask = (move: Move) => {
    act.reset();
    setAsking(move);
  };

  const prompt = asking ? PROMPTS[asking] : null;

  return (
    <>
      <RowActions label={`Actions for question ${question.questionCode ?? question.id}`}>
        {/* Outside the write guard: reading the trail is what a READ grant already allows. */}
        <DropdownMenuItem onSelect={() => setShowingHistory(true)}>
          <History aria-hidden />
          History
        </DropdownMenuItem>

        {canWrite ? (
          <>
            <DropdownMenuItem asChild>
              <Link to={ROUTES.QUESTION(question.id)}>
                <Pencil aria-hidden />
                Edit
              </Link>
            </DropdownMenuItem>

            <DropdownMenuItem
              destructive={!isArchived}
              disabled={act.isPending}
              onSelect={() => ask(isArchived ? 'UNARCHIVE' : 'ARCHIVE')}
            >
              {isArchived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
              {isArchived ? 'Unarchive' : 'Archive'}
            </DropdownMenuItem>

            {question.inUse ? null : (
              <DropdownMenuItem destructive disabled={act.isPending} onSelect={() => ask('DELETE')}>
                <Trash2 aria-hidden />
                Delete
              </DropdownMenuItem>
            )}
          </>
        ) : null}
      </RowActions>

      <QuestionHistorySheet
        question={question}
        open={showingHistory}
        onOpenChange={setShowingHistory}
      />

      {/* Each of these changes what future papers can draw, and nothing on the row shows it. */}
      {prompt ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setAsking(null)}
          loading={act.isPending}
          title={prompt.title}
          description={prompt.description}
          confirmLabel={prompt.confirmLabel}
          destructive={prompt.destructive}
          onConfirm={() => asking && act.mutate(asking)}
        />
      ) : null}
    </>
  );
}
