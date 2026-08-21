import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { FEATURE_KEYS, PERMISSION_LEVELS, type TestSeriesSummary } from '@iace/contracts';
import { useListQuery } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  DropdownMenuItem,
  linkVariants,
  PageHeader,
  Pagination,
  plural,
  RowActions,
  SearchInput,
  TableFrame,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, ROUTES, UNLOCK_MODE_LABELS } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { useFilters } from '../lib/use-filters';
import { ExamPicker, ExamStagePicker } from '../components/exam-picker';

/** Every filter this screen owns. Named once so "clear all" cannot miss one. */
const ALL_FILTERS = ['q', 'examId', 'examStageId'] as const;
type FilterKey = (typeof ALL_FILTERS)[number];

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
  const filters = useFilters<FilterKey>();
  const examId = filters.get('examId');
  const examStageId = filters.get('examStageId');

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SERIES_KEY });
  }, [queryClient]);

  const columns = useMemo(() => seriesColumns(canWrite, refresh), [canWrite, refresh]);

  const series = useListQuery({
    queryKey: SERIES_KEY,
    filters: { q: filters.get('q') || undefined, examStageId: examStageId || undefined },
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

  const toolbar = (
    <div className="mb-4 flex flex-wrap gap-3">
      <div className="min-w-56 flex-1">
        <SearchInput
          aria-label="Search test series"
          placeholder="Search series by name"
          value={filters.get('q')}
          onChange={(q) => filters.set({ q })}
        />
      </div>
      {/* The exam narrows the stage list rather than the table: a series hangs off
          a stage, and "Tier 1" alone names half a dozen different papers. */}
      <div className="w-48">
        <ExamPicker
          aria-label="Filter by exam"
          value={examId}
          clearable
          onChange={(value) => filters.set({ examId: value, examStageId: '' })}
        />
      </div>
      <div className="w-56">
        <ExamStagePicker
          aria-label="Filter by stage"
          examId={examId}
          value={examStageId}
          clearable
          onChange={(value) => filters.set({ examStageId: value })}
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
        rows={series.items}
        rowKey={(row) => row.id}
        isLoading={series.isLoading}
        empty={
          filters.activeCount(ALL_FILTERS) > 0
            ? 'No series match those filters.'
            : 'No series yet. Build the first one — a test reaches a student only through one.'
        }
        footer={series.hasLoaded ? <Pagination {...series.pagination} /> : null}
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
