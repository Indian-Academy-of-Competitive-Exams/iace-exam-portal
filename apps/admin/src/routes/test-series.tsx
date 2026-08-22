import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { FEATURE_KEYS, PERMISSION_LEVELS, type TestSeriesSummary } from '@iace/contracts';
import { PageCrumbs, useFilters, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenuItem,
  ListView,
  PageHeader,
  RowActions,
  TableFrame,
  TruncatedText,
  linkVariants,
  plural,
  type DataTableColumn,
  type ListFilterMultiControl,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, ROUTES, UNLOCK_MODE_LABELS } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { ExamMultiPicker, ExamStageMultiPicker } from '../components/exam-picker';

type FilterKey = 'q' | 'examId' | 'examStageId';

const SERIES_KEY = ['admin', 'test-series'] as const;

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
    { key: 'stage', header: 'Stage', cell: (series) => <SeriesStage series={series} /> },
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
      key: 'pricing',
      header: 'Pricing',
      cell: (series) => (
        <Badge variant={series.isFree ? 'success' : 'neutral'}>
          {series.isFree ? 'Free' : 'Paid'}
        </Badge>
      ),
    },
    {
      key: 'unlock',
      header: 'Unlocks',
      cell: (series) => (
        <span className="text-muted-foreground">{UNLOCK_MODE_LABELS[series.unlockMode]}</span>
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

/**
 * The offerings. A test reaches a student only through one of these, and only at a branch the
 * series is switched on for — which is why the reach of each one is a column rather than a click.
 */
export function TestSeriesPage() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const queryClient = useQueryClient();
  // Held outside the spec: changing the exams also has to drop the stages under them.
  const filters = useFilters<FilterKey>();
  const examIds = filters.get('examId').split(',').filter(Boolean);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SERIES_KEY });
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
  ] as const;

  const series = useListScreen({
    queryKey: SERIES_KEY,
    filters: filterSpec,
    toQuery: (values) => ({
      q: values.q || undefined,
      examStageId: values.examStageId,
    }),
    fetchPage: (params) => api.admin.testSeries.list(params),
  });

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Test series"
      action={
        canWrite ? (
          <Button size="sm" asChild>
            <Link to={ROUTES.TEST_SERIES_NEW}>
              <Plus aria-hidden />
              New series
            </Link>
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <TableFrame header={header}>
      <ListView
        list={series}
        filters={filterSpec}
        columns={columns}
        rowKey={(row) => row.id}
        empty="No series yet. Build the first one — a test reaches a student only through one."
        emptyFiltered="No series match those filters."
      />
    </TableFrame>
  );
}

/** A series with no stage spans a family rather than one paper, which is a fact, not a gap. */
function SeriesStage({ series }: Readonly<{ series: TestSeriesSummary }>) {
  if (!series.examStage) return <span className="text-muted-foreground">Any stage</span>;

  return (
    <span className="flex flex-col">
      <span className="font-mono text-sm">{series.examStage.examCode}</span>
      <span className="text-xs text-muted-foreground">{series.examStage.name}</span>
    </span>
  );
}

/**
 * How far the series actually reaches. Every branch has a row from the moment the series was
 * created, so the denominator is every centre and "0 of 12" means nobody can sit it yet.
 */
function BranchReach({ series }: Readonly<{ series: TestSeriesSummary }>) {
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

/** Names what would refuse the delete, so the dialog is not a guess the server then corrects. */
function deleteDescription(series: TestSeriesSummary): string {
  if (series.testCount > 0) {
    return `${plural(series.testCount, 'test')} are offered through ${series.name}, and deleting it would take away the only route to them — the server will refuse. Take the tests out of the series first.`;
  }
  return `No test is offered through ${series.name}. It is still refused if another series waits on this one before it opens. Every branch's row for it goes with it, and this cannot be undone.`;
}

function SeriesRowActions({
  series,
  canWrite,
  onChanged,
}: Readonly<{ series: TestSeriesSummary; canWrite: boolean; onChanged: () => void }>) {
  const [asking, setAsking] = useState(false);
  const close = () => setAsking(false);

  const remove = useMutation({
    meta: { success: `${series.name} deleted.` },
    mutationFn: () => api.admin.testSeries.remove(series.id),
    onSuccess: () => {
      close();
      onChanged();
    },
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
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
        loading={remove.isPending}
        title={`Delete ${series.name}?`}
        description={deleteDescription(series)}
        confirmLabel="Delete series"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
