/// <reference types="nativewind/types" />
import { View } from 'react-native';
import { type PerformancePoint } from '@iace/contracts';
import { Text } from '../ui/text';
import { plural } from '../../lib/plural';
import { trendOf } from '../../lib/trend';
import { LinePlot } from '../ui/line-plot';

const TICKS = [0, 25, 50, 75, 100];

/** The line a student came to see, on whichever screen asks for it. */
export function ScoreTrend({ points }: Readonly<{ points: readonly PerformancePoint[] }>) {
  const line = trendOf(points);
  if (line === null) return null;

  return (
    <View className="gap-2 rounded-lg bg-chart-surface p-4">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text variant="section">{line.title}</Text>
        <Text variant="meta">{plural(points.length, 'sitting')}</Text>
      </View>
      <LinePlot
        points={line.points}
        ticks={TICKS}
        band={line.band}
        reference={line.reference}
        suffix={line.suffix}
        label={line.title}
      />
    </View>
  );
}
