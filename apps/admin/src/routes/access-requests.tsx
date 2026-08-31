import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import {
  UNLOCK_REQUEST_STATUS,
  type SeriesUnlockRequestRow,
  type UnlockDecision,
} from '@iace/contracts';
import {
  Badge,
  ConfirmDialog,
  ListView,
  DropdownMenuItem,
  PageHeader,
  RowActions,
  TableFrame,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import { api } from '../lib/api';
import { WHEN_FORMATTER } from '../lib/audit-format';
import { NAV_ITEMS, QUERY_KEYS, UNLOCK_REQUEST_STATUS_LABELS } from '../lib/constants';

const REQUEST_FILTERS = [
  {
    key: 'status',
    kind: 'choice',
    label: 'Filter by status',
    primary: true,
    items: [
      { value: '', label: 'Any status' },
      { value: UNLOCK_REQUEST_STATUS.PENDING, label: 'Waiting' },
      { value: UNLOCK_REQUEST_STATUS.APPROVED, label: 'Approved' },
      { value: UNLOCK_REQUEST_STATUS.REJECTED, label: 'Declined' },
    ],
  },
] as const;

const STATUS_VARIANTS: Readonly<Record<string, 'warning' | 'success' | 'neutral'>> = {
  [UNLOCK_REQUEST_STATUS.PENDING]: 'warning',
  [UNLOCK_REQUEST_STATUS.APPROVED]: 'success',
  [UNLOCK_REQUEST_STATUS.REJECTED]: 'neutral',
};

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function requestColumns(
  canWrite: boolean,
  busy: boolean,
  onDecide: (row: SeriesUnlockRequestRow, status: UnlockDecision) => void,
): DataTableColumn<SeriesUnlockRequestRow>[] {
  return [
    {
      key: 'student',
      header: 'Student',
      className: 'max-w-56',
      cell: (row) => <TruncatedText>{row.student.fullName ?? row.student.mobile}</TruncatedText>,
    },
    {
      key: 'series',
      header: 'Series',
      className: 'max-w-72',
      cell: (row) => <TruncatedText>{row.testSeries.name}</TruncatedText>,
    },
    {
      key: 'asked',
      header: 'Asked',
      className: 'max-w-48',
      cell: (row) => (
        <TruncatedText>{WHEN_FORMATTER.format(new Date(row.requestedAt))}</TruncatedText>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge variant={STATUS_VARIANTS[row.status] ?? 'neutral'}>
          {UNLOCK_REQUEST_STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
    {
      key: 'actions',
      // Left out rather than disabled: an answered request has nothing left to answer.
      cell: (row) =>
        canWrite && row.status === UNLOCK_REQUEST_STATUS.PENDING ? (
          <RowActions label={`Answer ${row.student.mobile}`}>
            <DropdownMenuItem
              disabled={busy}
              onSelect={() => onDecide(row, UNLOCK_REQUEST_STATUS.APPROVED)}
            >
              <Check aria-hidden />
              Approve
            </DropdownMenuItem>
            <DropdownMenuItem
              destructive
              disabled={busy}
              onSelect={() => onDecide(row, UNLOCK_REQUEST_STATUS.REJECTED)}
            >
              <X aria-hidden />
              Decline
            </DropdownMenuItem>
          </RowActions>
        ) : null,
    },
  ];
}

export function AccessRequestsPage() {
  return (
    <TableFrame
      header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Access requests" />}
    >
      <AccessRequestList />
    </TableFrame>
  );
}

/** The queue itself, so the branch configuration screen shows it rather than rebuilding it. */
export function AccessRequestList({ branchId }: Readonly<{ branchId?: string }>) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<{
    row: SeriesUnlockRequestRow;
    status: UnlockDecision;
  } | null>(null);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.UNLOCK_REQUESTS });
  }, [queryClient]);

  const decide = useMutation({
    meta: { success: 'Answered.' },
    mutationFn: ({ row, status }: { row: SeriesUnlockRequestRow; status: UnlockDecision }) =>
      api.admin.unlockRequests.decide(row.id, { status }),
    onSuccess: () => {
      setAsking(null);
      refresh();
    },
    onError: () => setAsking(null),
  });

  const onDecide = useCallback(
    (row: SeriesUnlockRequestRow, status: UnlockDecision) => setAsking({ row, status }),
    [],
  );

  const columns = useMemo(
    () => requestColumns(true, decide.isPending, onDecide),
    [decide.isPending, onDecide],
  );

  const requests = useListScreen({
    queryKey: [...QUERY_KEYS.UNLOCK_REQUESTS, branchId ?? ''],
    filters: REQUEST_FILTERS,
    toQuery: (values) => ({
      status: (values.status || undefined) as UnlockDecision | undefined,
      branchId,
    }),
    fetchPage: (params) => api.admin.unlockRequests.list(params),
  });

  const approving = asking?.status === UNLOCK_REQUEST_STATUS.APPROVED;

  return (
    <>
      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        destructive={!approving}
        loading={decide.isPending}
        title={
          approving
            ? `Open ${asking?.row.testSeries.name ?? ''} to this student?`
            : `Turn down ${asking?.row.student.mobile ?? ''}?`
        }
        description={
          approving
            ? `${asking?.row.student.fullName ?? asking?.row.student.mobile} reaches every test in ${asking?.row.testSeries.name} from now on, whatever still stands in front of it.`
            : 'They keep everything else they reach, and can ask again.'
        }
        confirmLabel={approving ? 'Approve' : 'Decline'}
        onConfirm={() => asking && decide.mutate(asking)}
      />

      <ListView
        list={requests}
        filters={REQUEST_FILTERS}
        columns={columns}
        rowKey={(row) => row.id}
        empty="Nobody has asked for a series yet."
        emptyFiltered="No request matches those filters."
      />
    </>
  );
}
