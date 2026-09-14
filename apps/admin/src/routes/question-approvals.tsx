import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Trash2 } from 'lucide-react';
import {
  FEATURE_KEYS,
  LANGUAGE_LABELS,
  PERMISSION_LEVELS,
  QUESTION_STATUS,
  todayISO,
  type QuestionSummary,
} from '@iace/contracts';
import { PageCrumbs, useFilters, useListScreen } from '@iace/app-kit/browser';
import { WHEN_FORMATTER } from '../lib/audit-vocabulary';
import {
  Alert,
  Badge,
  BadgeList,
  Button,
  ConfirmDialog,
  DropdownMenuItem,
  DropdownMenuSeparator,
  linkVariants,
  ListView,
  PageHeader,
  plural,
  RowActions,
  TableFrame,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { DIFFICULTY_VARIANT, NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';
import {
  QUESTION_AUTHOR_FILTER,
  QUESTION_TAG_FILTER,
  questionFacetFilters,
} from '../lib/question-filters';

type FilterKey =
  'q' | 'subjectId' | 'topicId' | 'type' | 'difficulty' | 'tag' | 'author' | 'from' | 'to';

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
      key: 'tags',
      header: 'Tags',
      className: 'max-w-48',
      cell: (question) => (
        <BadgeList
          items={question.tags}
          label={(tag) => tag}
          max={2}
          empty={<span className="text-muted-foreground">—</span>}
        />
      ),
    },
    {
      key: 'author',
      header: 'Written by',
      className: 'max-w-40',
      cell: (question) => (
        <TruncatedText className="text-muted-foreground">{question.author?.name}</TruncatedText>
      ),
    },
    {
      key: 'written',
      header: 'Written',
      cell: (question) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {WHEN_FORMATTER.format(new Date(question.createdAt))}
        </span>
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
      key: 'flags',
      header: 'Open flags',
      numeric: true,
      cell: (question) =>
        question.openFlags > 0 ? (
          <Badge variant="warning">{question.openFlags}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
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
  // Held outside the spec: changing the subjects also has to drop the topics under them.
  const filters = useFilters<FilterKey>();
  const subjectIds = filters.get('subjectId').split(',').filter(Boolean);

  // Everything but the search folds: a queue is read top to bottom before it is narrowed.
  const filterSpec = [
    {
      key: 'q',
      kind: 'search',
      label: 'Search draft questions',
      placeholder: 'Search the text, a code or a tag',
      primary: true,
    },
    ...questionFacetFilters(filters, subjectIds),
    QUESTION_TAG_FILTER,
    QUESTION_AUTHOR_FILTER,
    { key: 'from', kind: 'date', label: 'Written from', max: todayISO() },
    { key: 'to', kind: 'date', label: 'Written to', max: todayISO() },
  ] as const;

  // Status is not a filter here: a screen for approving drafts shows drafts.
  const questions = useListScreen({
    queryKey: [...QUERY_KEYS.QUESTIONS, 'drafts'],
    filters: filterSpec,
    toQuery: (values) => ({
      q: values.q || undefined,
      subjectId: values.subjectId,
      topicId: values.topicId,
      type: values.type as QuestionSummary['type'][],
      difficulty: values.difficulty as QuestionSummary['difficulty'][],
      tag: values.tag || undefined,
      author: values.author || undefined,
      from: values.from || undefined,
      to: values.to || undefined,
      status: [QUESTION_STATUS.DRAFT],
    }),
    fetchPage: (params) => api.admin.questions.list(params),
  });

  const columns = useMemo(() => approvalColumns(), []);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Draft questions"
      meta={questions.hasLoaded ? `${questions.total} waiting` : undefined}
    />
  );

  // Narrowed to what is on screen: a row the reader cannot see must never be in the batch.
  const shown = new Set(questions.rows.map((question) => question.id));
  const chosen = new Set([...selected].filter((id) => shown.has(id)));

  return (
    <TableFrame header={header}>
      <BulkApproval
        selected={chosen}
        flagged={questions.rows.filter((row) => chosen.has(row.id) && row.openFlags > 0).length}
        onDone={() => setSelected(new Set())}
      />

      <ListView
        list={questions}
        filters={filterSpec}
        columns={columns}
        rowKey={(question) => question.id}
        selection={{ selected: chosen, onChange: setSelected, label: 'Select every draft shown' }}
        empty="Nothing waiting for review"
        emptyFiltered="No drafts match those filters"
      />
    </TableFrame>
  );
}

/** What the count of flagged rows adds to the bar, and nothing at all when none of them are. */
function blockedBy(flagged: number): string {
  if (flagged === 0) return '';
  const carry = flagged === 1 ? 'has' : 'have';
  return ` ${plural(flagged, 'question')} still ${carry} open proof-reading flags, so none of them can be approved until those are settled.`;
}

/** Only when something is chosen: a bar that is always there is a bar nobody reads. */
function BulkApproval({
  selected,
  flagged,
  onDone,
}: Readonly<{ selected: ReadonlySet<string>; flagged: number; onDone: () => void }>) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const count = selected.size;

  const approve = useMutation({
    meta: { success: `${plural(count, 'question')} approved.` },
    mutationFn: () =>
      api.admin.questions.bulkSetStatus({
        ids: [...selected],
        status: QUESTION_STATUS.ACTIVE,
      }),
    onSuccess: async () => {
      setAsking(false);
      onDone();
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.QUESTIONS });
    },
    onError: () => setAsking(false),
  });

  if (count === 0 || !can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE)) return null;

  // A batch is one decision, so one flagged row refuses all of it — say so before they press it.
  return (
    <Alert variant={flagged > 0 ? 'warning' : 'info'} className="mb-4">
      <span className="flex flex-wrap items-center justify-between gap-3">
        <span>{`${plural(count, 'question')} selected.${blockedBy(flagged)}`}</span>
        <Button size="sm" disabled={flagged > 0} onClick={() => setAsking(true)}>
          <Check aria-hidden />
          Approve selected
        </Button>
      </span>

      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        loading={approve.isPending}
        title={`Approve ${plural(count, 'question')}?`}
        description={`They go into the bank as ACTIVE and can be drawn into any paper built from now on. Approving does not put them into a paper that already exists.`}
        confirmLabel="Approve them"
        onConfirm={() => approve.mutate()}
      />
    </Alert>
  );
}

/** The two answers a review has. Delete is the reject: a draft nobody drew leaves nothing behind. */
const PROMPTS = {
  APPROVE: {
    title: 'Approve this question?',
    description: 'It joins the bank and can be drawn into any paper built from now on.',
    confirmLabel: 'Approve',
    destructive: false,
  },
  DELETE: {
    title: 'Delete this draft?',
    description:
      'It is removed from the bank for good, along with everything written on it. This cannot be undone, and only a draft nothing has drawn can be deleted.',
    confirmLabel: 'Delete',
    destructive: true,
  },
} as const;

type Decision = keyof typeof PROMPTS;

function ApprovalActions({ question }: Readonly<{ question: QuestionSummary }>) {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [asking, setAsking] = useState<Decision | null>(null);
  const queryClient = useQueryClient();

  const settle = () => {
    setAsking(null);
    return queryClient.invalidateQueries({ queryKey: QUERY_KEYS.QUESTIONS });
  };

  const approve = useMutation({
    meta: { success: 'Question approved.' },
    mutationFn: () =>
      api.admin.questions.setStatus(question.id, { status: QUESTION_STATUS.ACTIVE }),
    onSuccess: settle,
    // On failure, drop the confirm — the row must not keep asking an answered question.
    onError: () => setAsking(null),
  });

  const remove = useMutation({
    meta: { success: 'Draft deleted.' },
    mutationFn: () => api.admin.questions.remove(question.id),
    onSuccess: settle,
    onError: () => setAsking(null),
  });

  if (!canWrite) return null;

  const busy = approve.isPending || remove.isPending;
  const ask = (decision: Decision) => {
    approve.reset();
    remove.reset();
    setAsking(decision);
  };
  const prompt = asking ? PROMPTS[asking] : null;

  return (
    <>
      <RowActions label={`Review ${question.questionCode ?? question.stemPreview}`}>
        <DropdownMenuItem asChild>
          <Link to={ROUTES.QUESTION(question.id)}>Open</Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem disabled={busy} onSelect={() => ask('APPROVE')}>
          <Check aria-hidden />
          Approve
        </DropdownMenuItem>
        <DropdownMenuItem destructive disabled={busy} onSelect={() => ask('DELETE')}>
          <Trash2 aria-hidden />
          Delete
        </DropdownMenuItem>
      </RowActions>

      {/* Approving puts it in front of students, and deleting takes it away for good. */}
      {prompt ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setAsking(null)}
          loading={busy}
          title={prompt.title}
          description={prompt.description}
          confirmLabel={prompt.confirmLabel}
          destructive={prompt.destructive}
          onConfirm={() => (asking === 'APPROVE' ? approve.mutate() : remove.mutate())}
        />
      ) : null}
    </>
  );
}
