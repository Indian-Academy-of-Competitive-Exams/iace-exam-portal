import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  type SeriesBranch,
  type TestSeriesSummary,
} from '@iace/contracts';
import { Power } from 'lucide-react';
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  FormSection,
  Skeleton,
  StatRow,
  plural,
} from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { branchesKey } from './test-series-detail';

/** Stable keys for placeholder rows, which have no identity of their own. */
const SKELETON_ROWS = ['branch-1', 'branch-2', 'branch-3'] as const;

export function BranchSchedule({ series }: Readonly<{ series: TestSeriesSummary }>) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canRead = can(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT);
  const canWrite = can(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [askingAll, setAskingAll] = useState(false);

  const branches = useQuery({
    queryKey: branchesKey(series.id),
    queryFn: () => api.admin.testSeries.branches(series.id),
    enabled: canRead,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: branchesKey(series.id) });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEST_SERIES });
  };

  const enableEverywhere = useMutation({
    meta: { success: 'Switched on at every branch.' },
    mutationFn: () =>
      api.admin.testSeries.setBranches(series.id, {
        branchIds: (branches.data ?? []).map((row) => row.id),
      }),
    onSuccess: () => {
      setAskingAll(false);
      refresh();
    },
    onError: () => setAskingAll(false),
  });

  const off = series.branchCount - series.enabledBranchCount;

  return (
    <FormSection title="Branches">
      {series.isEnabled ? null : (
        <Alert variant="warning">
          <span>
            {series.name} is switched off, so a branch switched on here opens nothing. Enabled,
            under Access, is what lets anybody sit it.
          </span>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatRow
          label="Switched on at"
          value={`${series.enabledBranchCount} of ${plural(series.branchCount, 'branch', 'branches')}`}
        />
        {canWrite && off > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={enableEverywhere.isPending}
            onClick={() => setAskingAll(true)}
          >
            <Power aria-hidden />
            Switch on everywhere
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={askingAll}
        onOpenChange={(open) => !open && setAskingAll(false)}
        loading={enableEverywhere.isPending}
        title={`Switch ${series.name} on at every branch?`}
        description={`All ${plural(series.branchCount, 'branch', 'branches')} run it from now on, including the ${off} switched off today. A branch that was left off on purpose is switched on too.`}
        confirmLabel="Switch on everywhere"
        onConfirm={() => enableEverywhere.mutate()}
      />

      <BranchScheduleList
        series={series}
        rows={branches.data ?? []}
        isLoading={canRead && branches.isLoading}
        canRead={canRead}
        canWrite={canWrite}
        onSaved={refresh}
      />
    </FormSection>
  );
}

/** The three states of the list, so the card above stays one shape. */
function BranchScheduleList({
  series,
  rows,
  isLoading,
  canRead,
  canWrite,
  onSaved,
}: Readonly<{
  series: TestSeriesSummary;
  rows: readonly SeriesBranch[];
  isLoading: boolean;
  canRead: boolean;
  canWrite: boolean;
  onSaved: () => void;
}>) {
  if (!canRead) {
    return (
      <Alert variant="info">
        <span>
          Branch scheduling is a permission of its own. You can see how far this series reaches, but
          not change it.
        </span>
      </Alert>
    );
  }

  // The list has a known shape, so it is drawn and held rather than spun at.
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {SKELETON_ROWS.map((key) => (
          <Skeleton key={key} variant="row" className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <Alert variant="warning">There are no branches yet, so nothing runs this series.</Alert>;
  }

  return (
    <>
      {rows.map((row) => (
        <BranchScheduleRow
          key={row.id}
          series={series}
          row={row}
          rows={rows}
          canWrite={canWrite}
          onSaved={onSaved}
        />
      ))}
    </>
  );
}

/** Turning it on and turning it off are not the same question, so they are not the same words. */
function offerQuestion(
  series: TestSeriesSummary,
  row: SeriesBranch,
  next: boolean,
): { title: string; description: string; confirmLabel: string; destructive: boolean } {
  const tests = plural(series.testCount, 'test');

  if (next) {
    return {
      title: `Offer ${series.name} at ${row.name}?`,
      description: `Every student whose current branch is ${row.name} and who reaches this series by their enrolment can start its ${tests} from then on, for as long as the series itself is switched on. When each test opens is the test's own, not this switch.`,
      confirmLabel: 'Offer it here',
      destructive: false,
    };
  }

  return {
    title: `Stop offering ${series.name} at ${row.name}?`,
    description: `Students at ${row.name} lose the route to its ${tests} straight away. Attempts already made and their results are kept, and a test somebody is sitting right now is not stopped. Switching it back on restores everything.`,
    confirmLabel: 'Stop offering it here',
    destructive: true,
  };
}

function BranchScheduleRow({
  series,
  row,
  rows,
  canWrite,
  onSaved,
}: Readonly<{
  series: TestSeriesSummary;
  row: SeriesBranch;
  rows: readonly SeriesBranch[];
  canWrite: boolean;
  onSaved: () => void;
}>) {
  const [asking, setAsking] = useState<boolean | null>(null);

  const save = useMutation({
    meta: { success: `${row.name} saved.` },
    mutationFn: (enabled: boolean) =>
      api.admin.testSeries.setBranches(series.id, {
        branchIds: rows
          .filter((candidate) => (candidate.id === row.id ? enabled : candidate.enabled))
          .map((candidate) => candidate.id),
      }),
    onSuccess: () => {
      setAsking(null);
      onSaved();
    },
    // Drop out of the confirm on failure, or the row keeps asking a question already answered.
    onError: () => setAsking(null),
  });

  const question = offerQuestion(series, row, asking ?? !row.enabled);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
      <Checkbox
        checked={row.enabled}
        disabled={!canWrite || save.isPending}
        onChange={(event) => setAsking(event.target.checked)}
        label={row.name}
      />

      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        destructive={question.destructive}
        loading={save.isPending}
        title={question.title}
        description={question.description}
        confirmLabel={question.confirmLabel}
        onConfirm={() => asking !== null && save.mutate(asking)}
      />
    </div>
  );
}
