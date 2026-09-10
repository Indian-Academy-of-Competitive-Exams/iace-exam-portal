import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Pencil, Trash2 } from 'lucide-react';
import {
  EVALUATION_MODE,
  EVALUATION_MODE_LABELS,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  TEST_SCOPE_LABELS,
  TEST_STATUS,
  TEST_STATUSES,
  type Test,
} from '@iace/contracts';
import { useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  ConfirmDialog,
  DropdownMenuItem,
  ListView,
  RowActions,
  TruncatedText,
  linkVariants,
  plural,
  type DataTableColumn,
  type ListFilterMultiControl,
} from '@iace/ui';
import { StageCell } from '../components/stage-cell';
import { api } from '../lib/api';
import { QUERY_KEYS, ROUTES, TEST_STATUS_LABELS } from '../lib/constants';
import { durationLabel } from '../lib/duration';
import { useAuth } from '../providers/auth';
import { ExamMultiPicker } from '../components/exam-picker';

const TEST_FILTERS = [
  {
    key: 'q',
    kind: 'search',
    label: 'Search tests',
    placeholder: 'Search tests by name',
    primary: true,
  },
  {
    key: 'examId',
    kind: 'customMulti',
    label: 'Filter by exam',
    primary: true,
    render: (control: ListFilterMultiControl) => <ExamMultiPicker {...control} />,
  },
  {
    key: 'status',
    kind: 'choice',
    label: 'Filter by status',
    primary: true,
    items: [
      { value: '', label: 'Any status' },
      ...TEST_STATUSES.map((status) => ({ value: status, label: TEST_STATUS_LABELS[status] })),
    ],
  },
] as const;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function testColumns(canWrite: boolean, refresh: () => void): DataTableColumn<Test>[] {
  return [
    {
      key: 'title',
      header: 'Test',
      className: 'max-w-[18rem] font-medium',
      cell: (test) => (
        <Link to={ROUTES.TEST(test.id)} className={linkVariants()}>
          <TruncatedText>{test.title ?? 'Untitled test'}</TruncatedText>
        </Link>
      ),
    },
    {
      key: 'stage',
      header: 'Stage',
      cell: (test) => (
        <StageCell stage={{ examCode: test.examStage.exam.code, name: test.examStage.name }} />
      ),
    },
    {
      key: 'config',
      header: 'Base configuration',
      className: 'max-w-[16rem] text-muted-foreground',
      cell: (test) => <TruncatedText>{test.baseConfigName}</TruncatedText>,
    },
    {
      key: 'coverage',
      header: 'Coverage',
      cell: (test) => (
        <span className="flex flex-col">
          <span className="text-sm">{TEST_SCOPE_LABELS[test.scope]}</span>
          <span className="text-xs text-muted-foreground">
            {EVALUATION_MODE_LABELS[test.evaluationMode]}
          </span>
        </span>
      ),
    },
    { key: 'questions', header: 'Questions', numeric: true, cell: (test) => test.totalQuestions },
    {
      key: 'duration',
      header: 'Duration',
      numeric: true,
      cell: (test) => durationLabel(test.durationSec),
    },
    { key: 'status', header: 'Status', cell: (test) => <TestStatusBadges test={test} /> },
    {
      key: 'actions',
      className: 'text-right',
      cell: (test) => <TestRowActions test={test} canWrite={canWrite} onChanged={refresh} />,
    },
  ];
}

/** Every test built from a stage's blueprints, whatever step of the build it has reached. */
export function TestsList() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const queryClient = useQueryClient();
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TESTS });
  }, [queryClient]);

  const columns = useMemo(() => testColumns(canWrite, refresh), [canWrite, refresh]);

  const tests = useListScreen({
    queryKey: QUERY_KEYS.TESTS,
    filters: TEST_FILTERS,
    toQuery: (values) => ({
      q: values.q || undefined,
      examId: values.examId,
      status: values.status || undefined,
    }),
    fetchPage: (params) => api.admin.tests.list(params),
  });

  return (
    <ListView
      list={tests}
      filters={TEST_FILTERS}
      columns={columns}
      rowKey={(test) => test.id}
      empty={{ title: 'No tests yet', hint: 'Open a series and build the first one inside it.' }}
      emptyFiltered="No tests match those filters"
    />
  );
}

function TestStatusBadges({ test }: Readonly<{ test: Test }>) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {test.isLocked ? <Badge variant="warning">Finalized</Badge> : null}
      <Badge variant={test.status === TEST_STATUS.ACTIVE ? 'success' : 'neutral'}>
        {TEST_STATUS_LABELS[test.status]}
      </Badge>
    </span>
  );
}

const UNTITLED = 'this test';

/** Names what deleting costs. Only an unsat test is ever offered it, so nothing here refuses. */
function deleteDescription(test: Test): string {
  const name = test.title ?? UNTITLED;

  const costs = [
    test.paperQuestionCount > 0
      ? `the ${plural(test.paperQuestionCount, 'question')} drawn for it are discarded`
      : null,
    'it leaves its series',
    test.status === TEST_STATUS.ACTIVE ? 'students stop being offered it' : null,
  ].filter((cost): cost is string => cost !== null);

  const consequence = costs.length > 0 ? `${sentenceOf(costs)}. ` : '';
  return `No student has sat ${name}. ${consequence}This cannot be undone.`;
}

/** `a, b and c` — a list read as a sentence, because that is what the dialog is. */
function sentenceOf(parts: readonly string[]): string {
  const lead = parts.slice(0, -1).join(', ');
  const last = parts.at(-1) ?? '';
  const joined = lead === '' ? last : `${lead} and ${last}`;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

function TestRowActions({
  test,
  canWrite,
  onChanged,
}: Readonly<{ test: Test; canWrite: boolean; onChanged: () => void }>) {
  const [asking, setAsking] = useState(false);
  const close = () => setAsking(false);

  const remove = useMutation({
    meta: { success: 'Test deleted.' },
    mutationFn: () => api.admin.tests.remove(test.id),
    onSuccess: () => {
      close();
      onChanged();
    },
    onError: close,
  });

  // Only a ranked test folds a cohort, so on any other one the report would have nothing to read.
  const ranked = test.evaluationMode === EVALUATION_MODE.RANKED;
  if (!canWrite && !ranked) return null;

  return (
    <>
      <RowActions label={`Actions for ${test.title ?? UNTITLED}`}>
        {ranked ? (
          <DropdownMenuItem asChild>
            <Link to={ROUTES.TEST_ANALYTICS(test.id)}>
              <BarChart3 aria-hidden />
              Analytics
            </Link>
          </DropdownMenuItem>
        ) : null}
        {canWrite ? (
          <DropdownMenuItem asChild>
            <Link to={ROUTES.TEST(test.id)}>
              <Pencil aria-hidden />
              Edit
            </Link>
          </DropdownMenuItem>
        ) : null}
        {/* A sat test is never deleted, so Delete is left out rather than offered and refused. */}
        {canWrite && test.attemptCount === 0 ? (
          <DropdownMenuItem
            destructive
            disabled={remove.isPending}
            onSelect={() => setAsking(true)}
          >
            <Trash2 aria-hidden />
            Delete
          </DropdownMenuItem>
        ) : null}
      </RowActions>

      <ConfirmDialog
        open={asking}
        onOpenChange={(open) => !open && close()}
        destructive
        title={`Delete ${test.title ?? UNTITLED}?`}
        description={deleteDescription(test)}
        confirmLabel="Delete test"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
