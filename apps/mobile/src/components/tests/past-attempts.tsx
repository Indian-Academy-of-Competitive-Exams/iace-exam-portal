/// <reference types="nativewind/types" />
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { everySitting, newestFirst } from '@iace/app-kit';
import { instituteDateTimeLabel, type PerformancePoint } from '@iace/contracts';
import { Text } from '../ui/text';
import { Card } from '../ui/card';
import { DETAIL_ROUTES } from '../../lib/nav';
import { performanceQuery } from '../../lib/queries';
import { plural } from '../../lib/plural';
import { cn } from '../../lib/cn';

const DASH = '—';

/** Every sitting of this paper, newest first, each opening its own report; nothing when it has not been sat. */
export function PastAttempts({ testId }: Readonly<{ testId: string }>) {
  const trend = useQuery(performanceQuery);
  const past = newestFirst(everySitting(trend.data).filter((point) => point.testId === testId));
  if (past.length === 0) return null;

  return (
    <View className="gap-2">
      <View className="flex-row items-baseline justify-between">
        <Text variant="section">Past attempts</Text>
        <Text variant="muted">{plural(past.length, 'attempt')}</Text>
      </View>
      <Card>
        {past.map((point, index) => (
          <Attempt key={point.attemptId} point={point} first={index === 0} />
        ))}
      </Card>
    </View>
  );
}

function Attempt({ point, first }: Readonly<{ point: PerformancePoint; first: boolean }>) {
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.navigate(DETAIL_ROUTES.REPORT(point.attemptId))}
      className={cn('gap-1 p-4', !first && 'border-t border-border')}
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text variant="label" numberOfLines={1} className="flex-1">
          {point.submittedAt ? instituteDateTimeLabel(point.submittedAt) : DASH}
        </Text>
        <Text variant="subsection">{`${point.score} / ${point.maxMarks}`}</Text>
      </View>
      <Text variant="meta">
        {`Rank ${point.rank ?? DASH} · Percentile ${point.percentile ?? DASH}`}
      </Text>
    </Pressable>
  );
}
