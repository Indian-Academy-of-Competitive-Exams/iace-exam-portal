import {
  Avatar,
  Card,
  DataTable,
  Pagination,
  TruncatedText,
  cn,
  type DataTableColumn,
  type EmptyMessage,
} from '@iace/ui';
import { type Leaderboard, type LeaderboardRow } from '@iace/contracts';
import { PODIUM_LABELS } from '@iace/app-kit';

/** The topper takes the middle seat from `sm` up, so the shape reads as a podium. */
const PODIUM_ORDER: Readonly<Record<number, string>> = {
  1: 'sm:order-2',
  2: 'sm:order-1',
  3: 'sm:order-3',
};

export function Podium({ rows }: Readonly<{ rows: readonly LeaderboardRow[] }>) {
  return (
    <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
      {rows.map((row) => (
        <PodiumSeat key={row.rank} row={row} />
      ))}
    </div>
  );
}

function PodiumSeat({ row }: Readonly<{ row: LeaderboardRow }>) {
  const top = row.rank === 1;

  return (
    <Card
      className={cn(
        'flex items-center gap-3 p-3 sm:flex-col sm:gap-1 sm:p-4 sm:text-center',
        PODIUM_ORDER[row.rank],
        top && 'border-warning sm:p-5',
        row.isYou && 'border-primary bg-primary-subtle',
      )}
    >
      <Avatar
        name={row.name}
        size={top ? 'md' : 'sm'}
        className={cn(top && 'bg-warning-subtle text-warning-ink')}
      />
      <span className="flex min-w-0 flex-1 flex-col sm:w-full sm:flex-none sm:gap-1">
        <span className="text-sm font-semibold">
          <TruncatedText>{row.name}</TruncatedText>
        </span>
        <span className="text-2xs text-muted-foreground">
          <TruncatedText>{row.branch}</TruncatedText>
        </span>
      </span>
      <span className="flex flex-col items-end sm:items-center sm:gap-1">
        <span
          className={cn(
            'text-2xl font-semibold tabular-nums tracking-tight',
            top ? 'text-warning-ink' : 'text-foreground',
          )}
        >
          {row.score}
        </span>
        <span
          className={cn(
            'text-2xs font-semibold uppercase tracking-wide',
            top ? 'text-warning-ink' : 'text-muted-foreground',
          )}
        >
          {PODIUM_LABELS[row.rank]}
        </span>
      </span>
    </Card>
  );
}

/** One page of the ranking, the reader's own seat pinned under it when it is on another page, then the pager. */
export function Standings({
  board,
  empty,
  onPage,
}: Readonly<{ board: Leaderboard; empty: EmptyMessage; onPage: (page: number) => void }>) {
  const { you, yourPage } = board;
  const elsewhere = you !== null && yourPage !== null && yourPage !== board.page;

  return (
    <div className="flex flex-col">
      <DataTable
        columns={STANDING_COLUMNS}
        rows={board.rows}
        rowKey={(row) => String(row.rank)}
        rowClassName={(row) => (row.isYou ? '[&>td]:bg-primary-subtle' : undefined)}
        isLoading={false}
        empty={empty}
      />
      {elsewhere || board.total > board.pageSize ? (
        <div className="sticky bottom-0 flex flex-col border-t border-border bg-surface">
          {elsewhere ? (
            <button
              type="button"
              aria-label={`Go to your rank, ${you.rank}`}
              className="flex items-center gap-3 bg-primary-subtle px-4 py-2.5 text-left focus-visible:shadow-focus focus-visible:outline-none"
              onClick={() => onPage(yourPage)}
            >
              <span className="w-10 text-right text-sm font-medium tabular-nums text-primary-ink">
                {you.rank}
              </span>
              <span className="min-w-0 flex-1">
                <StudentCell row={you} />
              </span>
              <span className="text-sm font-semibold tabular-nums">{you.score}</span>
            </button>
          ) : null}
          {board.total > board.pageSize ? (
            <Pagination
              page={board.page}
              pageSize={board.pageSize}
              total={board.total}
              onPageChange={onPage}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const STANDING_COLUMNS: DataTableColumn<LeaderboardRow>[] = [
  {
    key: 'rank',
    header: 'Rank',
    numeric: true,
    className: 'w-16',
    cell: (row) => (
      <span className={row.isYou ? 'font-medium text-primary-ink' : ''}>{row.rank}</span>
    ),
  },
  {
    key: 'student',
    header: 'Student',
    className: 'max-w-[18rem] max-sm:w-full max-sm:max-w-0',
    cell: (row) => <StudentCell row={row} />,
  },
  {
    key: 'score',
    header: 'Marks',
    numeric: true,
    cell: (row) => <span className="font-semibold">{row.score}</span>,
  },
];

function StudentCell({ row }: Readonly<{ row: LeaderboardRow }>) {
  const under =
    row.percentile === null
      ? row.branch
      : `${row.branch ?? '—'} · ${Math.round(row.percentile)}%ile`;

  return (
    <div className="flex items-center gap-2.5">
      <Avatar name={row.name} size="sm" />
      <div className="min-w-0">
        <div className={cn('text-sm font-medium', row.isYou && 'text-primary-ink')}>
          <TruncatedText>{row.isYou ? `${row.name} · you` : row.name}</TruncatedText>
        </div>
        <div className={cn('text-2xs text-muted-foreground', row.isYou && 'text-primary-ink/75')}>
          <TruncatedText>{under}</TruncatedText>
        </div>
      </div>
    </div>
  );
}
