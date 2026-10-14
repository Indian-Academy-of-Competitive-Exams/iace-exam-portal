/// <reference types="nativewind/types" />
import { Pressable, View } from 'react-native';
import { PODIUM_LABELS } from '@iace/app-kit';
import { type Leaderboard, type LeaderboardRow } from '@iace/contracts';
import { Text } from '../ui/text';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { EmptyState } from '../ui/empty-state';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';

export function Podium({ rows }: Readonly<{ rows: readonly LeaderboardRow[] }>) {
  if (rows.length === 0) return null;

  return (
    <View className="gap-3">
      {rows.map((row) => (
        <Card
          key={row.rank}
          className={cn(
            'flex-row items-center gap-3 p-4',
            row.rank === 1 && 'border-warning',
            row.isYou && 'border-primary bg-primary-subtle',
          )}
        >
          <Text className="w-16 text-xs font-semibold text-muted-foreground">
            {PODIUM_LABELS[row.rank] ?? `#${row.rank}`}
          </Text>
          <View className="flex-1 gap-0.5">
            <Text variant="subsection" numberOfLines={1}>
              {row.name}
            </Text>
            {row.branch ? (
              <Text variant="meta" numberOfLines={1}>
                {row.branch}
              </Text>
            ) : null}
          </View>
          <Text className="text-lg font-bold text-foreground">{row.score}</Text>
        </Card>
      ))}
    </View>
  );
}

/** One page of the ranking, the reader's own seat pinned under it when it is on another page, then the pager. */
export function Standings({
  board,
  empty,
  onPage,
}: Readonly<{ board: Leaderboard; empty: string; onPage: (page: number) => void }>) {
  const { you, yourPage, page } = board;
  const elsewhere = you !== null && yourPage !== null && yourPage !== page;
  const pages = Math.ceil(board.total / board.pageSize);

  if (board.rows.length === 0 && !elsewhere) return <EmptyState title={empty} />;

  return (
    <View className="gap-3">
      <Text variant="section">Marks</Text>
      <Card>
        {board.rows.map((row, index) => (
          <Seat key={row.rank} row={row} first={index === 0} />
        ))}
        {elsewhere ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Go to your rank, ${you.rank}`}
            onPress={() => onPage(yourPage)}
          >
            <Seat row={you} first={board.rows.length === 0} />
          </Pressable>
        ) : null}
      </Card>
      {pages > 1 ? (
        <View className="flex-row items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            icon={ChevronLeft}
            disabled={page <= 1}
            onPress={() => onPage(page - 1)}
          >
            Previous
          </Button>
          <Text variant="meta">{`Page ${page} of ${pages}`}</Text>
          <Button
            variant="outline"
            size="sm"
            icon={ChevronRight}
            disabled={page >= pages}
            onPress={() => onPage(page + 1)}
          >
            Next
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function Seat({ row, first }: Readonly<{ row: LeaderboardRow; first: boolean }>) {
  return (
    <View
      className={cn(
        'flex-row items-center gap-3 p-4',
        !first && 'border-t border-border',
        row.isYou && 'bg-primary-subtle',
      )}
    >
      <Text className="w-8 text-sm font-semibold text-muted-foreground">{row.rank}</Text>
      <View className="flex-1 gap-0.5">
        <Text variant="label" numberOfLines={1}>
          {row.isYou ? 'You' : row.name}
        </Text>
        {row.branch ? (
          <Text variant="meta" numberOfLines={1}>
            {row.branch}
          </Text>
        ) : null}
      </View>
      <Text variant="subsection">{row.score}</Text>
    </View>
  );
}
