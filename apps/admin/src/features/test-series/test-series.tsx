import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  TEST_SERIES_KIND,
  TEST_SERIES_KINDS,
  type TestSeriesKind,
  type TestSeriesSummary,
} from '@iace/contracts';
import { useFilters, useListScreen } from '@iace/app-kit/browser';
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
import { StageCell } from '../../components/stage-cell';
import { api } from '../../lib/api';
import {
  QUERY_KEYS,
  ROUTES,
  TEST_SERIES_KIND_LABELS,
  TEST_SERIES_KIND_HINTS,
  seriesQueryKey,
} from '../../lib/constants';
import { useAuth } from '../../providers/auth';
import { ExamMultiPicker, ExamStageMultiPicker } from '../../components/exam-picker';

type FilterKey = 'q' | 'examId' | 'examStageId' | 'kind';

/** Every kind, plus the row that means the reader has not chosen one. */
const KIND_FILTER_ITEMS = [
  { value: '', label: 'Any kind' },
  ...TEST_SERIES_KINDS.map((value) => ({
    value,
    label: TEST_SERIES_KIND_LABELS[value],
    hint: TEST_SERIES_KIND_HINTS[value],
  })),
];

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function seriesColumns(
  canWrite: boolean,
  refresh: () => void,
): DataTableColumn<TestSeriesSummary>[] {
  return [
    {
      key: 'name',
      header: 'Series',
      className: 'max-w-[20rem] font-medium',
      cell: (series) => (
        <Link to={ROUTES.TEST_SERIES_DETAIL(series.id)} className={linkVariants()}>
          <TruncatedText>{series.name}</TruncatedText>
        </Link>
      ),
    },
    { key: 'stage', header: 'Stage', cell: (series) => <StageCell stage={series.examStage} /> },
    {
      key: 'program',
      header: 'Program',
      cell: (series) =>
        series.programCode ? (
          <span className="font-mono text-sm">{series.programCode}</span>
        ) : (
          <span className="text-muted-foreground">Any</span>
        ),
    },
    {
      key: 'kind',
      header: 'Kind',
      cell: (series) => (
        <Badge variant={series.kind === TEST_SERIES_KIND.STANDARD ? 'neutral' : 'info'}>
          {TEST_SERIES_KIND_LABELS[series.kind]}
        </Badge>
      ),
    },
    { key: 'tests', header: 'Tests', numeric: true, cell: (series) => series.testCount },
    { key: 'branches', header: 'Branches', cell: (series) => <BranchReach series={series} /> },
    {
      key: 'actions',
      className: 'text-right',
      cell: (series) => (
        <SeriesRowActions series={series} canWrite={canWrite} onChanged={refresh} />
      ),
    },
  ];
}

// A test reaches a student only through an offering, and only where the series is switched on — so reach is a column, not a click.
export function SeriesList() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const queryClient = useQueryClient();
  // Held outside the spec: changing the exams also has to drop the stages under them.
  const filters = useFilters<FilterKey>();
  const examIds = filters.get('examId').split(',').filter(Boolean);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEST_SERIES });
  }, [queryClient]);

  const columns = useMemo(() => seriesColumns(canWrite, refresh), [canWrite, refresh]);

  const filterSpec = [
    {
      key: 'q',
      kind: 'search',
      label: 'Search test series',
      placeholder: 'Search series by name',
      primary: true,
    },
    {
      key: 'examId',
      kind: 'customMulti',
      label: 'Filter by exam',
      primary: true,
      // Narrows the stage list, not the table: "Tier 1" alone names half a dozen papers.
      render: (control: ListFilterMultiControl) => (
        <ExamMultiPicker
          {...control}
          onChange={(value) => filters.set({ examId: value.join(','), examStageId: '' })}
        />
      ),
    },
    {
      key: 'examStageId',
      kind: 'customMulti',
      label: 'Filter by stage',
      primary: true,
      render: (control: ListFilterMultiControl) => (
        <ExamStageMultiPicker {...control} examIds={examIds} />
      ),
    },
    { key: 'kind', kind: 'choice', label: 'Filter by kind', items: KIND_FILTER_ITEMS },
  ] as const;

  const series = useListScreen({
    queryKey: QUERY_KEYS.TEST_SERIES,
    filters: filterSpec,
    toQuery: (values) => ({
      q: values.q || undefined,
      examStageId: values.examStageId,
      kind: (values.kind || undefined) as TestSeriesKind | undefined,
    }),
    fetchPage: (params) => api.admin.testSeries.list(params),
  });

  return (
    <ListView
      list={series}
      filters={filterSpec}
      columns={columns}
      rowKey={(row) => row.id}
      empty={{
        title: 'No series yet',
        hint: 'Build the first one. A test reaches a student only through one.',
      }}
      emptyFiltered="No series match those filters"
    />
  );
}

function BranchReach({ series }: Readonly<{ series: TestSeriesSummary }>) {
  if (series.kind !== TEST_SERIES_KIND.STANDARD) {
    return <span className="text-muted-foreground">Every branch</span>;
  }

  if (series.enabledBranchCount === 0) {
    return <span className="text-muted-foreground">None of {series.branchCount}</span>;
  }

  return (
    <span>
      {series.enabledBranchCount}
      <span className="text-muted-foreground"> of {series.branchCount}</span>
    </span>
  );
}

/** Names what would refuse the delete, or what goes with it, so the dialog is not a guess the server then corrects. */
function deleteDescription({ name, testCount, grantCount }: TestSeriesSummary): string {
  if (testCount > 0) {
    const [are, them] = testCount === 1 ? ['is', 'it'] : ['are', 'them'];
    return `${plural(testCount, 'test')} ${are} offered through ${name}, and deleting it would take away the only route to ${them}, so the server will refuse. Move ${them} to another series first.`;
  }
  const grants =
    grantCount > 0
      ? ` ${plural(grantCount, 'student')} granted it directly ${grantCount === 1 ? 'loses' : 'lose'} that grant.`
      : '';
  return `No test is offered through ${name}.${grants} This cannot be undone.`;
}

function SeriesRowActions({
  series,
  canWrite,
  onChanged,
}: Readonly<{ series: TestSeriesSummary; canWrite: boolean; onChanged: () => void }>) {
  const [asking, setAsking] = useState(false);
  const close = () => setAsking(false);

  // Read again as the dialog opens: the row's own counts are as old as the list.
  const counted = useQuery({
    queryKey: seriesQueryKey(series.id),
    queryFn: () => api.admin.testSeries.detail(series.id),
    enabled: asking,
    staleTime: 0,
  });

  const remove = useMutation({
    meta: { success: `${series.name} deleted.` },
    mutationFn: () => api.admin.testSeries.remove(series.id),
    onSuccess: () => {
      close();
      onChanged();
    },
    // Drop out of the confirm on failure, or the row is left asking a question that's already been answered.
    onError: close,
  });

  if (!canWrite) return null;

  return (
    <>
      <RowActions label={`Actions for ${series.name}`}>
        <DropdownMenuItem asChild>
          <Link to={ROUTES.TEST_SERIES_DETAIL(series.id)}>
            <Pencil aria-hidden />
            Edit
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem destructive disabled={remove.isPending} onSelect={() => setAsking(true)}>
          <Trash2 aria-hidden />
          Delete
        </DropdownMenuItem>
      </RowActions>

      <ConfirmDialog
        open={asking}
        onOpenChange={(open) => !open && close()}
        destructive
        loading={remove.isPending || counted.isFetching}
        title={`Delete ${series.name}?`}
        description={deleteDescription(counted.data ?? series)}
        confirmLabel="Delete series"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
