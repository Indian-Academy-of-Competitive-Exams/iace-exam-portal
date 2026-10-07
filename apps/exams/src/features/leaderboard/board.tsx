import {
  Avatar,
  Card,
  DataTable,
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

export function Standings({ board, empty }: Readonly<{ board: Leaderboard; empty: EmptyMessage }>) {
  return (
    <DataTable
      columns={STANDING_COLUMNS}
      rows={board.neighbourhood}
      rowKey={(row) => String(row.rank)}
      rowClassName={(row) => (row.isYou ? '[&>td]:bg-primary-subtle' : undefined)}
      isLoading={false}
      empty={empty}
    />
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
