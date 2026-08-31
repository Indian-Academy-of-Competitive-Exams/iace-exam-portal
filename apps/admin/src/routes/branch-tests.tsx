import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  TEST_SERIES_KIND,
  type Branch,
  type BranchSeriesRow,
} from '@iace/contracts';
import { PageCrumbs, useFilters, useListScreen } from '@iace/app-kit/browser';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  ListView,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
  TableFrame,
  TruncatedText,
  plural,
  type DataTableColumn,
  type ListFilterMultiControl,
} from '@iace/ui';
import { api } from '../lib/api';
import { ExamStageMultiPicker } from '../components/exam-picker';
import { StageCell } from '../components/stage-cell';
import { NAV_ITEMS, QUERY_KEYS, TEST_SERIES_KIND_LABELS } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { useBranch } from '../lib/use-branches';

/** What one branch runs, from the branch's side. The series form writes the same rows. */

const TABS = {
  SERIES: 'series',
} as const;

const branchSeriesKey = (branchId: string) =>
  [...QUERY_KEYS.BRANCH_CONFIG, branchId, 'test-series'] as const;

export function BranchTestsPage() {
  const { branchId = '' } = useParams();
  const { branch, isLoading } = useBranch(branchId);

  // The screen has a known shape, so it is drawn and held rather than spun at.
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton variant="title" />
        <Card className="p-6">
          <SkeletonParagraph lines={8} />
        </Card>
      </div>
    );
  }

  if (!branch) {
    return (
      <Alert variant="warning">
        This branch is not one of yours, so there is nothing here to configure. A super admin can
        add it to your branches.
      </Alert>
    );
  }

  return <BranchConfiguration branch={branch} />;
}

function BranchConfiguration({ branch }: Readonly<{ branch: Branch }>) {
  const filters = useFilters<'tab'>();
  const tab = filters.get('tab') || TABS.SERIES;

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={[{ label: branch.name }]} />}
      title={branch.name}
    />
  );

  return (
    <TableFrame
      header={header}
      tabs={{
        value: tab,
        onValueChange: (value) => filters.set({ tab: value }),
        items: [
          { value: TABS.SERIES, label: 'Test series', content: <SeriesTab branch={branch} /> },
        ],
      }}
    />
  );
}

// ============================================================================
// Test series — what this branch offers. A row always exists, so this is a boolean.
// ============================================================================

/** Only what DIFFERS from the server. The name rides along, so a change off-page is still nameable. */
type SeriesDraft = Readonly<Record<string, { name: string; enabled: boolean }>>;

function seriesColumns(
  draft: SeriesDraft,
  canWrite: boolean,
  onToggle: (row: BranchSeriesRow, enabled: boolean) => void,
): DataTableColumn<BranchSeriesRow>[] {
  return [
    {
      key: 'name',
      header: 'Series',
      className: 'max-w-[22rem] font-medium',
      cell: (row) => <TruncatedText>{row.name}</TruncatedText>,
    },
    { key: 'stage', header: 'Stage', cell: (row) => <StageCell stage={row.examStage} /> },
    {
      key: 'kind',
      header: 'Kind',
      cell: (row) => (
        <Badge variant={row.kind === TEST_SERIES_KIND.STANDARD ? 'neutral' : 'success'}>
          {TEST_SERIES_KIND_LABELS[row.kind]}
        </Badge>
      ),
    },
    { key: 'tests', header: 'Tests', numeric: true, cell: (row) => row.testCount },
    {
      key: 'runs',
      header: 'Runs here',
      cell: (row) => (
        <Checkbox
          aria-label={`${branchRunsLabel(row)} ${row.name}`}
          checked={draft[row.testSeriesId]?.enabled ?? row.enabled}
          disabled={!canWrite}
          onChange={(event) => onToggle(row, event.target.checked)}
        />
      ),
    },
  ];
}

const branchRunsLabel = (row: BranchSeriesRow): string => (row.enabled ? 'Stop offering' : 'Offer');

function SeriesTab({ branch }: Readonly<{ branch: Branch }>) {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<SeriesDraft>({});
  const [asking, setAsking] = useState(false);

  const filterSpec = [
    {
      key: 'q',
      kind: 'search',
      label: 'Search test series',
      placeholder: 'Search series by name',
      primary: true,
    },
    {
      key: 'enabled',
      kind: 'choice',
      label: 'Filter by whether this branch runs it',
      primary: true,
      items: [
        { value: '', label: 'Any series' },
        { value: 'true', label: 'Runs here' },
        { value: 'false', label: 'Not offered here' },
      ],
    },
    {
      key: 'examStageId',
      kind: 'customMulti',
      label: 'Filter by stage',
      primary: true,
      render: (control: ListFilterMultiControl) => (
        <ExamStageMultiPicker {...control} examIds={[]} />
      ),
    },
  ] as const;

  const series = useListScreen({
    queryKey: branchSeriesKey(branch.id),
    filters: filterSpec,
    toQuery: (values) => ({
      q: values.q || undefined,
      enabled: (values.enabled || undefined) as 'true' | 'false' | undefined,
      examStageId: values.examStageId,
    }),
    fetchPage: (params) => api.admin.branches.testSeries(branch.id, params),
  });

  const toggle = useCallback(
    (row: BranchSeriesRow, enabled: boolean) =>
      setDraft((held) => {
        const next = { ...held };
        // Toggling a row back to where the server has it is not a change, so it leaves the draft.
        if (enabled === row.enabled) delete next[row.testSeriesId];
        else next[row.testSeriesId] = { name: row.name, enabled };
        return next;
      }),
    [],
  );

  const changes = Object.entries(draft);

  const save = useMutation({
    meta: { success: 'Saved.' },
    mutationFn: () =>
      api.admin.branches.setTestSeries(branch.id, {
        changes: changes.map(([testSeriesId, held]) => ({ testSeriesId, enabled: held.enabled })),
      }),
    onSuccess: async () => {
      setAsking(false);
      setDraft({});
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRANCH_CONFIG });
      // The series form reads the same rows from the other side, and would go stale behind this.
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEST_SERIES });
    },
    // The draft stays: a save that failed changed nothing, and retyping forty toggles is not a fix.
    onError: () => setAsking(false),
  });

  const columns = useMemo(() => seriesColumns(draft, canWrite, toggle), [draft, canWrite, toggle]);

  return (
    <>
      <ListView
        list={series}
        filters={filterSpec}
        columns={columns}
        rowKey={(row) => row.testSeriesId}
        banner={
          changes.length > 0 ? (
            <Alert variant="warning" className="mb-4 items-center justify-between">
              <span>
                {`${plural(changes.length, 'change')} not saved yet. Leaving this screen loses them.`}
              </span>
              <Button type="button" size="sm" onClick={() => setAsking(true)}>
                Save changes
              </Button>
            </Alert>
          ) : null
        }
        empty="No test series yet. Every series reaches this branch through a switch here."
        emptyFiltered="No series match those filters."
      />

      {/* One confirm for the whole draft: forty of these one at a time is what the conventions
          call absurd, and the count here is the request's own. */}
      <ConfirmDialog
        open={asking}
        onOpenChange={(open) => !open && setAsking(false)}
        loading={save.isPending}
        title={`Change what ${branch.name} runs?`}
        description={`${plural(changes.length, 'series', 'series')} change for every student whose current branch is ${branch.name}. Switching one on lets them start its tests; switching one off takes the route away straight away, keeping every attempt already made.`}
        confirmLabel="Save changes"
        onConfirm={() => save.mutate()}
      >
        <ul className="flex flex-col gap-1 text-sm">
          {changes.map(([testSeriesId, held]) => (
            <li key={testSeriesId} className="flex items-center justify-between gap-3">
              <TruncatedText className="max-w-[20rem]">{held.name}</TruncatedText>
              <Badge variant={held.enabled ? 'success' : 'neutral'}>
                {held.enabled ? 'Runs here' : 'Not offered'}
              </Badge>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  );
}
