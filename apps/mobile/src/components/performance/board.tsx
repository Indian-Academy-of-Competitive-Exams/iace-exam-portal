/// <reference types="nativewind/types" />
import { View } from 'react-native';
import { PODIUM_LABELS } from '@iace/app-kit';
import { type Leaderboard, type LeaderboardRow } from '@iace/contracts';
import { Text } from '../ui/text';
import { cn } from '../../lib/cn';
import { Card } from '../ui/card';
import { EmptyState } from '../ui/empty-state';

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

/** The seats around the reader, and the reader's own wherever it sits. */
export function Standings({ board, empty }: Readonly<{ board: Leaderboard; empty: string }>) {
  const rows = [...board.neighbourhood];
  if (board.you && !rows.some((row) => row.rank === board.you?.rank)) rows.push(board.you);
  rows.sort((a, b) => a.rank - b.rank);

  if (rows.length === 0) return <EmptyState title={empty} />;

  return (
    <View className="gap-3">
      <Text variant="section">Marks</Text>
      <Card>
        {rows.map((row, index) => (
          <View
            key={row.rank}
            className={cn(
              'flex-row items-center gap-3 p-4',
              index > 0 && 'border-t border-border',
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
        ))}
      </Card>
    </View>
  );
}
