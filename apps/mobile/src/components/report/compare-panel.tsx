/// <reference types="nativewind/types" />
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  percentLabel,
  type CohortCurve,
  type PerformancePoint,
  type ScoreCard,
} from '@iace/contracts';
import { everySitting } from '@iace/app-kit';
import { Text } from '../ui/text';
import { performanceQuery, scoreCardQuery } from '../../lib/queries';
import { plural } from '../../lib/plural';
import { Alert } from '../ui/alert';
import { Card } from '../ui/card';
import { EmptyState, EMPTY_STATE_KINDS } from '../ui/empty-state';
import { MeasureBars, type MeasureBar } from '../ui/measure-bars';
import { RefreshScroll } from '../ui/refresh-scroll';
import { Skeleton } from '../ui/skeleton';

const DASH = '—';

/** Who else sat this paper. Without a cohort the benchmark swaps rather than the tab disappearing. */
export function ComparePanel({ attemptId }: Readonly<{ attemptId: string }>) {
  const card = useQuery(scoreCardQuery(attemptId));
  const trend = useQuery(performanceQuery);

  const refresh = () => {
    void card.refetch();
    void trend.refetch();
  };

  const testId = card.data?.testId ?? '';
  const placed = (card.data?.cohort?.cohortSize ?? 0) > 0;

  return (
    <RefreshScroll refreshing={card.isRefetching} onRefresh={refresh}>
      {card.isLoading ? <Skeleton className="h-64 rounded-xl" /> : null}
      {card.isLoadingError ? (
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="This comparison did not load"
          onRetry={refresh}
        />
      ) : null}
      {card.data ? (
        <Body
          card={card.data}
          placed={placed}
          sittings={everySitting(trend.data).filter((point) => point.testId === testId)}
        />
      ) : null}
    </RefreshScroll>
  );
}

function Body({
  card,
  placed,
  sittings,
}: Readonly<{
  card: ScoreCard;
  placed: boolean;
  sittings: readonly PerformancePoint[];
}>) {
  if (!placed || card.cohort === null) {
    return (
      <>
        <Alert variant="info">
          Nobody has been ranked on this paper yet, so it stands against your own attempts for now.
        </Alert>
        <OwnAttempts sittings={sittings} />
      </>
    );
  }

  return (
    <>
      <Against cohort={card.cohort} max={card.maxMarks} />
      <Curve cohort={card.cohort} />
    </>
  );
}

/** You, the field's average and the paper's topper on one scale of marks. */
function Against({ cohort, max }: Readonly<{ cohort: CohortCurve; max: number }>) {
  const bars: MeasureBar[] = [
    {
      key: 'you',
      label: 'You',
      value: cohort.score,
      display: String(cohort.score),
      meta: percentLabel(cohort.percentile, DASH),
      tone: 2,
    },
    {
      key: 'average',
      label: 'Average',
      value: cohort.averageScore ?? 0,
      display: String(cohort.averageScore ?? DASH),
      meta: plural(cohort.cohortSize, 'sitting'),
    },
    {
      key: 'topper',
      label: 'Topper',
      value: cohort.topperScore ?? 0,
      display: String(cohort.topperScore ?? DASH),
      meta: `of ${max}`,
      tone: 3,
    },
  ];

  return (
    <View className="gap-3">
      <Text variant="section">Marks</Text>
      <Card className="p-5">
        <MeasureBars bars={bars} max={max} />
      </Card>
    </View>
  );
}

/** How the field's scores fell, with the band holding this paper named as theirs. */
function Curve({ cohort }: Readonly<{ cohort: CohortCurve }>) {
  if (cohort.bands.length === 0) return null;

  const bars: MeasureBar[] = cohort.bands.map((band) => ({
    key: `${band.from}`,
    label: `${band.from} to ${band.to}`,
    value: band.count,
    display: String(band.count),
    meta: band.isYours ? 'yours' : undefined,
    tone: band.isYours ? 2 : 1,
    faint: !band.isYours,
  }));

  return (
    <View className="gap-3">
      <Text variant="section">Where the field scored</Text>
      <Card className="p-5">
        <MeasureBars bars={bars} max={Math.max(...cohort.bands.map((band) => band.count), 1)} />
      </Card>
    </View>
  );
}

/** A paper nobody has been ranked on yet stands against the student's own sittings of it. */
function OwnAttempts({ sittings }: Readonly<{ sittings: readonly PerformancePoint[] }>) {
  if (sittings.length === 0) return null;

  const max = Math.max(...sittings.map((point) => point.maxMarks), 1);
  const bars: MeasureBar[] = sittings.map((point) => ({
    key: point.attemptId,
    label: `Attempt ${point.attemptNo}`,
    value: point.score,
    display: `${point.score} / ${point.maxMarks}`,
    meta: `${point.accuracy}% accurate`,
    tone: 2,
  }));

  return (
    <View className="gap-3">
      <Text variant="section">Your attempts</Text>
      <Card className="p-5">
        <MeasureBars bars={bars} max={max} />
      </Card>
    </View>
  );
}
