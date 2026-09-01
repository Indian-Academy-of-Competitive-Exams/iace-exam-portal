import { type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Avatar, Card, DataTable, TruncatedText, cn, type DataTableColumn } from '@iace/ui';
import {
  LEADERBOARD_MEASURES,
  type Leaderboard,
  type LeaderboardMeasure,
  type LeaderboardRow,
} from '@iace/contracts';
import { LEADERBOARD_MEASURE_LABELS, PODIUM_LABELS } from '../../lib/constants';

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
        'flex flex-col items-center gap-1 p-4 text-center',
        PODIUM_ORDER[row.rank],
        top && 'border-warning sm:p-5',
        row.isYou && 'border-primary bg-primary-subtle',
      )}
    >
      <Avatar
        name={row.name}
        size={top ? 'md' : 'sm'}
        className={cn('mb-1', top && 'bg-warning-subtle text-warning-ink')}
      />
      <span className="w-full text-sm font-semibold">
        <TruncatedText>{row.name}</TruncatedText>
      </span>
      <span className="w-full text-2xs text-muted-foreground">
        <TruncatedText>{row.branch}</TruncatedText>
      </span>
      <span
        className={cn(
          'text-2xl font-semibold tabular-nums tracking-tight',
          top ? 'text-warning-ink' : 'text-foreground',
        )}
      >
        {row.value}
      </span>
      <span
        className={cn(
          'text-2xs font-semibold uppercase tracking-wide',
          top ? 'text-warning-ink' : 'text-muted-foreground',
        )}
      >
        {PODIUM_LABELS[row.rank]}
      </span>
    </Card>
  );
}

export function Standings({ board, empty }: Readonly<{ board: Leaderboard; empty: ReactNode }>) {
  return (
    <DataTable
      columns={standingColumns(board.measure)}
      rows={board.neighbourhood}
      rowKey={(row) => String(row.rank)}
      rowClassName={(row) => (row.isYou ? '[&>td]:bg-primary-subtle' : undefined)}
      isLoading={false}
      empty={empty}
    />
  );
}

function standingColumns(measure: LeaderboardMeasure): DataTableColumn<LeaderboardRow>[] {
  const papers: DataTableColumn<LeaderboardRow>[] =
    measure === LEADERBOARD_MEASURES.PERCENTILE_POINTS
      ? [{ key: 'papers', header: 'Papers', numeric: true, cell: (row) => row.sittings }]
      : [];

  return [
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
      className: 'max-w-[18rem]',
      cell: (row) => <StudentCell row={row} />,
    },
    ...papers,
    {
      key: 'value',
      header: LEADERBOARD_MEASURE_LABELS[measure],
      numeric: true,
      cell: (row) => <span className="font-semibold">{row.value}</span>,
    },
    {
      key: 'delta',
      header: 'Change',
      numeric: true,
      className: 'w-24',
      cell: (row) => <Delta seats={row.deltaRank} />,
    },
  ];
}

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

/** Positive is up the board. Nothing moved and never having moved read the same to a student. */
function Delta({ seats }: Readonly<{ seats: number | null }>) {
  if (seats === null || seats === 0) return <span className="text-muted-foreground">—</span>;

  const up = seats > 0;
  const Arrow = up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        'inline-flex items-center justify-end gap-0.5 tabular-nums [&_svg]:size-3.5',
        up ? 'text-success' : 'text-destructive',
      )}
    >
      <Arrow aria-hidden />
      {Math.abs(seats)}
    </span>
  );
}
