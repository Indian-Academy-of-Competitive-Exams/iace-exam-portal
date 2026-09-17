/// <reference types="nativewind/types" />
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  percentLabel,
  type CohortCurve,
  type PerformancePoint,
  type PerformanceReport,
} from '@iace/contracts';
import { attemptReportQuery, performanceQuery } from '../../lib/queries';
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
  const report = useQuery(attemptReportQuery(attemptId));
  const trend = useQuery(performanceQuery);

  const refresh = () => {
    void report.refetch();
    void trend.refetch();
  };

  const points = trend.data?.points ?? [];
  const testId = report.data?.cohort?.testId ?? testOf(points, attemptId);
  const placed = (report.data?.cohort?.cohortSize ?? 0) > 0;

  return (
    <RefreshScroll refreshing={report.isRefetching} onRefresh={refresh}>
      {report.isLoading ? <Skeleton className="h-64 rounded-xl" /> : null}
      {report.isError ? (
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="This comparison did not load"
          onRetry={refresh}
        />
      ) : null}
      {report.data ? (
        <Body
          report={report.data}
          placed={placed}
          sittings={points.filter((point) => point.testId === testId)}
        />
      ) : null}
    </RefreshScroll>
  );
}

function Body({
  report,
  placed,
  sittings,
}: Readonly<{
  report: PerformanceReport;
  placed: boolean;
  sittings: readonly PerformancePoint[];
}>) {
  if (!placed || report.cohort === null) {
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
      <Against cohort={report.cohort} max={report.composition.maxMarks} />
      <Curve cohort={report.cohort} />
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
      <Text className="text-lg font-semibold text-foreground">Marks</Text>
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
      <Text className="text-lg font-semibold text-foreground">Where the field scored</Text>
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
      <Text className="text-lg font-semibold text-foreground">Your attempts</Text>
      <Card className="p-5">
        <MeasureBars bars={bars} max={max} />
      </Card>
    </View>
  );
}

const testOf = (points: readonly PerformancePoint[], attemptId: string) =>
  points.find((point) => point.attemptId === attemptId)?.testId ?? '';
