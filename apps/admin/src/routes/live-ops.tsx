import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ATTEMPT_STATUS,
  FEATURE_KEYS,
  INSTITUTE_TIME_ZONE,
  LIVE_OPS_POLL_MS,
  PERMISSION_LEVELS,
  type LiveOpsBoard,
  type LiveSitting,
  type RecentSubmission,
} from '@iace/contracts';
import { PageCrumbs, useFilters } from '@iace/app-kit/browser';
import {
  Alert,
  Badge,
  DataTable,
  PageHeader,
  TableFrame,
  TruncatedText,
  plural,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { ATTEMPT_STATUS_LABELS, NAV_ITEMS, QUERY_KEYS } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { LiveTestPicker } from '../components/live-test-picker';
import { SittingActions } from '../components/sitting-actions';

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  timeZone: INSTITUTE_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
});

/** Which panel is open. In the URL, so a link to a hall opens on what the sender was reading. */
const PANELS = {
  ACTIVE: 'active',
  STUCK: 'stuck',
  RECENT: 'recent',
} as const;

type Panel = (typeof PANELS)[keyof typeof PANELS];

const NO_TEST = 'Choose a test to watch';

const STATUS_VARIANT = {
  IN_PROGRESS: 'info',
  SUBMITTED: 'warning',
  EVALUATED: 'success',
  EXPIRED: 'neutral',
  VOIDED: 'danger',
} as const;

export function LiveOpsPage() {
  const { can } = useAuth();
  const filters = useFilters<'testId' | 'panel'>();
  const testId = filters.get('testId');
  const panel = (filters.get('panel') || PANELS.ACTIVE) as Panel;
  const canResolve = can(FEATURE_KEYS.TEST_OPERATIONS, PERMISSION_LEVELS.WRITE);

  const board = useQuery({
    queryKey: [...QUERY_KEYS.LIVE_OPS, testId],
    queryFn: () => api.admin.liveOps.board(testId),
    enabled: testId !== '',
    refetchInterval: LIVE_OPS_POLL_MS,
  });

  const sittingColumns = useMemo(() => liveColumns(canResolve), [canResolve]);
  const recentColumns = useMemo(() => submissionColumns(canResolve), [canResolve]);
  const counts = board.data?.counts;

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Sittings"
      meta={counts ? `${plural(counts.active, 'sitting')} in progress` : undefined}
    />
  );

  return (
    <TableFrame
      header={header}
      toolbar={
        <div className="mb-4 flex flex-col gap-3">
          <LiveTestPicker
            value={testId}
            onChange={(value) => filters.set({ testId: value, panel: undefined })}
          />
          <ScoringBacklog board={board.data} />
        </div>
      }
      tabs={{
        value: panel,
        onValueChange: (value) => filters.set({ panel: value }),
        items: [
          {
            value: PANELS.ACTIVE,
            label: tabLabel('Active now', counts?.active),
            content: (
              <SittingPanel
                testId={testId}
                rows={board.data?.active ?? []}
                total={counts?.active}
                columns={sittingColumns}
                isLoading={board.isLoading}
                empty="Nobody is sitting this test right now"
              />
            ),
          },
          {
            value: PANELS.STUCK,
            label: tabLabel('Past deadline', counts?.stuck),
            content: (
              <SittingPanel
                testId={testId}
                rows={board.data?.stuck ?? []}
                total={counts?.stuck}
                columns={sittingColumns}
                isLoading={board.isLoading}
                empty="Nothing is waiting to be swept"
              />
            ),
          },
          {
            value: PANELS.RECENT,
            label: tabLabel('Landed', counts?.submittedRecently),
            content: (
              <DataTable
                columns={recentColumns}
                rows={board.data?.recent ?? []}
                rowKey={(row) => row.attemptId}
                isLoading={board.isLoading}
                empty={testId === '' ? NO_TEST : 'No sitting has landed in the last half hour'}
                footer={
                  <ShowingSome
                    shown={board.data?.recent.length ?? 0}
                    total={counts?.submittedRecently}
                  />
                }
              />
            ),
          },
        ],
      }}
    />
  );
}

function tabLabel(name: string, count: number | undefined) {
  return (
    <span className="flex items-center gap-2">
      {name}
      {count === undefined ? null : <Badge variant="neutral">{count}</Badge>}
    </span>
  );
}

/** The sweeper heals a backlog on its own, so this is a fact to know rather than a fault. */
function ScoringBacklog({ board }: Readonly<{ board?: LiveOpsBoard }>) {
  if (!board || board.counts.awaitingScoring === 0) return null;

  return (
    <Alert variant="info">
      {plural(board.counts.awaitingScoring, 'sitting')} ended without a score yet. The sweeper asks
      again every few minutes.
    </Alert>
  );
}

function SittingPanel({
  testId,
  rows,
  total,
  columns,
  isLoading,
  empty,
}: Readonly<{
  testId: string;
  rows: readonly LiveSitting[];
  total?: number;
  columns: DataTableColumn<LiveSitting>[];
  isLoading: boolean;
  empty: string;
}>) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.attemptId}
      isLoading={isLoading}
      empty={testId === '' ? NO_TEST : empty}
      footer={<ShowingSome shown={rows.length} total={total} />}
    />
  );
}

/** A panel is a sample of a hall, so it says how much of one it is rather than ending silently. */
function ShowingSome({ shown, total }: Readonly<{ shown: number; total?: number }>) {
  if (total === undefined || total <= shown) return null;

  return (
    <span className="block border-t border-border pt-3 text-sm text-muted-foreground">
      Showing {shown} of {plural(total, 'sitting')}
    </span>
  );
}

function studentColumn<
  TRow extends { studentName: string | null; mobile: string },
>(): DataTableColumn<TRow> {
  return {
    key: 'student',
    header: 'Student',
    className: 'max-w-56',
    cell: (row) => (
      <div className="flex flex-col">
        <TruncatedText>{row.studentName}</TruncatedText>
        <span className="text-xs text-muted-foreground">{row.mobile}</span>
      </div>
    ),
  };
}

function liveColumns(canResolve: boolean): DataTableColumn<LiveSitting>[] {
  const columns: DataTableColumn<LiveSitting>[] = [
    studentColumn<LiveSitting>(),
    {
      key: 'branch',
      header: 'Branch',
      className: 'max-w-40',
      cell: (row) => (
        <TruncatedText className="text-muted-foreground">{row.branchName}</TruncatedText>
      ),
    },
    {
      key: 'sitting',
      header: 'Sitting',
      cell: (row) => (
        <Badge variant={row.isGraded ? 'info' : 'neutral'}>
          {row.isGraded ? 'Ranked' : `Practice · ${row.attemptNo}`}
        </Badge>
      ),
    },
    {
      key: 'answered',
      header: 'Answered',
      cell: (row) => (
        <span className="whitespace-nowrap">
          {row.answeredCount === null ? (
            <span className="text-muted-foreground">Live state lost</span>
          ) : (
            `${row.answeredCount} / ${row.questionCount}`
          )}
        </span>
      ),
    },
    {
      key: 'started',
      header: 'Started',
      cell: (row) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {TIME_FORMATTER.format(new Date(row.startedAt))}
        </span>
      ),
    },
    {
      key: 'ends',
      header: 'Ends',
      cell: (row) => (
        <span className="whitespace-nowrap">{TIME_FORMATTER.format(new Date(row.endsAt))}</span>
      ),
    },
  ];

  if (!canResolve) return columns;
  return [
    ...columns,
    {
      key: 'actions',
      header: '',
      cell: (row) => (
        <SittingActions
          sitting={{
            attemptId: row.attemptId,
            studentName: row.studentName,
            isGraded: row.isGraded,
            isLive: true,
          }}
        />
      ),
    },
  ];
}

function submissionColumns(canResolve: boolean): DataTableColumn<RecentSubmission>[] {
  const columns: DataTableColumn<RecentSubmission>[] = [
    studentColumn<RecentSubmission>(),
    {
      key: 'sitting',
      header: 'Sitting',
      cell: (row) => (
        <Badge variant={row.isGraded ? 'info' : 'neutral'}>
          {row.isGraded ? 'Ranked' : `Practice · ${row.attemptNo}`}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge variant={STATUS_VARIANT[row.status]}>{ATTEMPT_STATUS_LABELS[row.status]}</Badge>
      ),
    },
    {
      key: 'submitted',
      header: 'Landed',
      cell: (row) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {row.submittedAt === null ? '—' : TIME_FORMATTER.format(new Date(row.submittedAt))}
        </span>
      ),
    },
    {
      key: 'score',
      header: 'Score',
      cell: (row) => row.score ?? <span className="text-muted-foreground">—</span>,
    },
  ];

  if (!canResolve) return columns;
  return [
    ...columns,
    {
      key: 'actions',
      header: '',
      // A sitting already stood down has nothing left to do to it, so it carries no menu.
      cell: (row) =>
        row.status === ATTEMPT_STATUS.VOIDED ? null : (
          <SittingActions
            sitting={{
              attemptId: row.attemptId,
              studentName: row.studentName,
              isGraded: row.isGraded,
              isLive: false,
            }}
          />
        ),
    },
  ];
}
